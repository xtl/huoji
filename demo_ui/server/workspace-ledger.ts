import { Router } from "express";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { emptyLedger, ledgerTables, type LedgerOperation, type LedgerRow, type LedgerSnapshot } from "../src/workspace-ledger";

const validKey = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 2048;
const plain = (v: unknown) => v != null && typeof v === "object" && !Array.isArray(v);
const safeField = (key: string) => !["id", "__proto__", "constructor", "prototype"].includes(key);

function validOperation(op: LedgerOperation) {
  if (!op || !validKey(op.id) || typeof op.seed !== "boolean" || !Array.isArray(op.changes) ||
      !Array.isArray(op.keys) || !op.keys.every(validKey)) return false;
  return op.changes.every(c => {
    if (!c || !ledgerTables.includes(c.table)) return false;
    if (c.action === "add") return plain(c.row) && validKey(c.row.id) &&
      Array.isArray(Reflect.get(c.row, "configItems")) && typeof Reflect.get(c.row, "title") === "string";
    if (op.seed || !validKey(c.id)) return false;
    if (c.action === "remove") return true;
    return c.action === "edit" && plain(c.fields) && Object.keys(c.fields).every(safeField) &&
      Array.isArray(c.unset) && c.unset.every(k => typeof k === "string" && safeField(k));
  });
}

function mergeOperations(snapshot: LedgerSnapshot, removed: Set<string>, ops: LedgerOperation[]) {
  const indexed = (rows: LedgerRow[]) => new Map(rows.map(row => [row.id, row]));
  const tables = { stocks: indexed(snapshot.stocks), market: indexed(snapshot.market), drafts: indexed(snapshot.drafts) };
  const confirmed = new Set(snapshot.confirmedRpaItemKeys);
  const sources = {
    stocks: new Set(snapshot.stocks.map(row => row.sourceItemKey).filter(Boolean)),
    market: new Set(snapshot.market.map(row => row.sourceItemKey).filter(Boolean)),
    drafts: new Set(snapshot.drafts.map(row => row.sourceItemKey).filter(Boolean)),
  };
  for (const op of ops) {
    for (const key of op.keys) confirmed.add(key);
    for (const c of op.changes) {
      const table = tables[c.table];
      if (c.action === "add") {
        const row = c.row, source = row.sourceItemKey;
        if (op.seed && (removed.has(JSON.stringify([c.table, row.id])) || (source && removed.has(JSON.stringify([c.table, "source", source]))))) continue;
        if (table.has(row.id) || (source && sources[c.table].has(source))) continue;
        if (c.table !== "drafts") {
          const other = c.table === "stocks" ? "market" : "stocks";
          if ((source && sources[other].has(source)) || (row.id.startsWith("confirmed:") && tables[other].has(row.id))) continue;
        }
        table.set(row.id, row);
        if (source) sources[c.table].add(source);
      } else if (c.action === "remove") {
        const source = table.get(c.id)?.sourceItemKey;
        table.delete(c.id);
        removed.add(JSON.stringify([c.table, c.id]));
        if (source) {
          sources[c.table].delete(source);
          removed.add(JSON.stringify([c.table, "source", source]));
        }
      } else {
        const row = table.get(c.id);
        if (!row) continue;
        const next = { ...row, ...c.fields, id: row.id, sourceItemKey: row.sourceItemKey };
        for (const field of c.unset) if (field !== "sourceItemKey") Reflect.deleteProperty(next, field);
        if (typeof Reflect.get(next, "title") !== "string" || !Array.isArray(Reflect.get(next, "configItems"))) throw new Error("记录格式有误");
        table.set(c.id, next);
      }
    }
  }
  for (const table of ["stocks", "market"] as const) for (const key of sources[table]) if (key) confirmed.add(key);
  for (const [id, draft] of tables.drafts) {
    if ((draft.sourceItemKey && confirmed.has(draft.sourceItemKey)) ||
        tables.stocks.has("confirmed:" + id) || tables.market.has("confirmed:" + id)) tables.drafts.delete(id);
  }
  return { version: 1 as const, stocks: [...tables.stocks.values()], market: [...tables.market.values()],
    drafts: [...tables.drafts.values()], confirmedRpaItemKeys: [...confirmed] };
}

export function createWorkspaceLedgerRouter(file: string, authenticate: (auth: unknown, res: import("express").Response) => { userId: string; currentWorkspaceId: string } | null) {
  const router = Router();
  let database: DatabaseSync | undefined;
  function db() {
    if (database) return database;
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    const d = new DatabaseSync(file);
    d.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS ledgers(scope TEXT PRIMARY KEY, revision INTEGER NOT NULL, snapshot TEXT NOT NULL, removed TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS applied(scope TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(scope,id));`);
    database = d;
    return d;
  }
  function read(scope: string) {
    const row = db().prepare("SELECT revision,snapshot,removed FROM ledgers WHERE scope=?").get(scope);
    return row ? { revision: Number(row.revision), snapshot: JSON.parse(String(row.snapshot)) as LedgerSnapshot, removed: JSON.parse(String(row.removed)) as string[] }
      : { revision: 0, snapshot: emptyLedger(), removed: [] as string[] };
  }
  router.use((req, res, next) => {
    const session = authenticate(req.headers.authorization,res);
    res.set("Cache-Control", "private, no-store");
    if (!session) { res.status(401).json({error: "请重新登录后同步资料。"}); return; }
    res.locals.scope = JSON.stringify([session.userId, session.currentWorkspaceId]);
    next();
  });
  router.get("/", (req, res) => {
    const scope = res.locals.scope;
    const revision = Number(db().prepare("SELECT revision FROM ledgers WHERE scope=?").get(scope)?.revision ?? 0);
    if (req.query.since === String(revision)) { res.status(204).end(); return; }
    const data = read(scope);
    res.json({revision: data.revision, snapshot: data.snapshot});
  });
  router.post("/", (req, res) => {
    const ops = req.body?.operations;
    if (!Array.isArray(ops) || !ops.length || ops.length > 32 || !ops.every(validOperation)) {
      res.status(400).json({error: "供需资料格式有误，浏览器副本已保留。"}); return;
    }
    const scope = res.locals.scope, d = db();
    d.exec("BEGIN IMMEDIATE");
    try {
      const applied = d.prepare("INSERT OR IGNORE INTO applied(scope,id) VALUES(?,?)");
      const fresh = ops.filter(op => applied.run(scope, op.id).changes > 0);
      const current = read(scope), removed = new Set(current.removed);
      const snapshot = fresh.length ? mergeOperations(current.snapshot, removed, fresh) : current.snapshot;
      const revision = current.revision + Number(fresh.length > 0);
      if (fresh.length) d.prepare("INSERT OR REPLACE INTO ledgers(scope,revision,snapshot,removed) VALUES(?,?,?,?)")
        .run(scope, revision, JSON.stringify(snapshot), JSON.stringify([...removed]));
      d.exec("COMMIT");
      res.json({revision, snapshot});
    } catch (error) {
      d.exec("ROLLBACK");
      throw error;
    }
  });
  return Object.assign(router, {
    readSnapshot(userId: string, workspaceId: string) {
      return read(JSON.stringify([userId, workspaceId])).snapshot;
    },
  });
}
