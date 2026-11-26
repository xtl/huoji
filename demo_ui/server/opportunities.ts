import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { isOpenOpportunity, nextActions, opportunityStages, tradeModes } from "../src/opportunity-types";
import type {
  Opportunity, OpportunityDemand, OpportunityEvent, OpportunityFields, OpportunityQuote, OpportunitySourceRef,
  OpportunitySupply, PortfolioLine, TradeMode,
} from "../src/opportunity-types";
import type { LedgerRow, LedgerSnapshot } from "../src/workspace-ledger";
import type { EnterpriseStore } from "./enterprise";

type Session = { userId: string; currentWorkspaceId: string };
type Viewer = Session & { manager: boolean };
type OpportunityRow = { id: string; createdBy: string; version: number; assigneeId: string;
  demand: string; demandOwner: string | null; demandId: string | null; stage: OpportunityFields["stage"];
  nextAction: OpportunityFields["nextAction"]; nextStep: string; dueAt: string | null; createdAt: string; updatedAt: string };
type SupplySnapshot = Pick<OpportunitySupply, "title" | "model" | "source" | "city" | "quantity" | "unit" | "mode">;
type SupplyRow = { opportunity: string; ownerId: string; id: string; snapshot: string; plannedQuantity: number | null };
type Dependencies = {
  session: (authorization: unknown) => Session | null;
  name: (userId: string) => string;
  snapshot: (userId: string, workspaceId: string) => LedgerSnapshot;
  quote: (session: Session, thread: string, message: number) => OpportunityQuote | null;
};

class OpportunityError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const bad = (message: string) => new OpportunityError(400, message);
const missing = () => new OpportunityError(404, "未找到可访问的商机。");
const forbidden = () => new OpportunityError(403, "当前账号无权执行这项操作。");
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const clean = (value: unknown, length: number) => text(value).slice(0, length);
const amount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1e9 ? value : 0;
const parse = <T>(value: unknown): T => JSON.parse(String(value));
const isAvailable = (row: LedgerRow | undefined) => row &&
  !["SOLD_OUT", "EXPIRED"].includes(String(Reflect.get(row, "status")));
const isVerified = (row: LedgerRow | undefined) => isAvailable(row) &&
  ["VERIFIED", "SELLABLE"].includes(String(Reflect.get(row!, "status")));
const isDemand = (row: LedgerRow) => Reflect.get(row, "postType") === "DEMAND";
const modeOf = (value: unknown): TradeMode => value === "FUTURES" || value === "RENTAL" ? value : "SPOT";
const sourceKey = ({ ownerId, id }: OpportunitySourceRef) => JSON.stringify([ownerId, id]);

function sourceSnapshot(row: LedgerRow): SupplySnapshot {
  const item = row as LedgerRow & Record<string, unknown>;
  return {
    title: clean(item.title, 120), model: clean(item.gpuModel, 100), source: clean(item.sourceContact || item.sourceSender, 100),
    city: clean(item.locationCity, 60), quantity: amount(item.quantity), unit: clean(item.quantityUnit, 16),
    mode: modeOf(item.tradeMode),
  };
}

function demandFields(input: unknown, fallback: Partial<SupplySnapshot> = {}): OpportunityDemand {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const title = clean(value.title ?? fallback.title, 120);
  const model = clean(value.model ?? fallback.model, 100);
  const quantity = amount(value.quantity ?? fallback.quantity);
  const unit = clean(value.unit ?? fallback.unit, 16);
  if (!title || !model || !quantity || !unit) throw bad("请填写需求名称、型号、数量和单位。");
  return {
    title, model, quantity, unit,
    customer: clean(value.customer ?? fallback.source, 100), city: clean(value.city ?? fallback.city, 60),
    mode: modeOf(value.mode ?? fallback.mode),
  };
}

function readFields(body: Record<string, unknown>): OpportunityFields {
  if (typeof body.stage !== "string" || !Object.hasOwn(opportunityStages, body.stage) ||
      typeof body.nextAction !== "string" || !Object.hasOwn(nextActions, body.nextAction)) throw bad("请选择商机阶段和下一步类型。");
  const stage = body.stage as OpportunityFields["stage"];
  const nextStep = clean(body.nextStep, 300);
  const rawDate = text(body.dueAt);
  const date = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rawDate) ? new Date(rawDate + ":00+08:00") : null;
  const dueAt = date && Number.isFinite(date.getTime()) &&
    new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 16) === rawDate ? date.toISOString() : null;
  if (isOpenOpportunity(stage) && (!nextStep || !dueAt)) throw bad("跟进中的商机需要填写下一步和截止时间。");
  return { assigneeId: text(body.assigneeId), stage, nextAction: body.nextAction as OpportunityFields["nextAction"], nextStep, dueAt };
}

function buildPortfolio(snapshots: Map<string, LedgerSnapshot>) {
  const buckets = new Map<string, PortfolioLine>();
  const captured = new Set<string>();
  for (const [ownerId, ledger] of snapshots) {
    const records = [
      ...ledger.stocks.filter(isAvailable).map(row => ({ row, kind: isVerified(row) ? "VERIFIED" as const : "UNVERIFIED" as const })),
      ...ledger.market.filter(isDemand).map(row => ({ row, kind: "DEMAND" as const })),
    ];
    for (const { row, kind } of records) {
      const { title, model, unit, mode, source, city, quantity } = sourceSnapshot(row);
      if (!model || !unit || !quantity) continue;
      const key = JSON.stringify([model.toUpperCase().replace(/\s+/g, ""), unit, mode]);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { key, model, unit, mode, demand: 0, verified: 0, unverified: 0, sources: [] };
        buckets.set(key, bucket);
      }
      if (row.sourceItemKey) {
        const captureKey = JSON.stringify([key, kind, row.sourceItemKey]);
        if (captured.has(captureKey)) continue;
        captured.add(captureKey);
      }
      const date = clean(Reflect.get(row, "sourceSentAt") || Reflect.get(row, "publishedAt") || Reflect.get(row, "createdAt"), 50);
      bucket.sources.push({ ownerId, id: row.id, title, source, city, quantity, date, kind });
      if (kind === "DEMAND") bucket.demand += quantity;
      else if (kind === "VERIFIED") bucket.verified += quantity;
      else bucket.unverified += quantity;
    }
  }
  return [...buckets.values()].sort((a, b) => b.sources.length - a.sources.length || a.model.localeCompare(b.model));
}

export function createOpportunityRouter(store: EnterpriseStore, deps: Dependencies, isPersonalWorkspace?: (session: Session) => boolean) {
  const router = Router();
  const personal = isPersonalWorkspace !== undefined;
  const prefix = personal ? "personal_" : "";
  const opportunities = prefix + "opportunities";
  const suppliesTable = prefix + "opportunity_supplies";
  const quotesTable = prefix + "opportunity_quotes";
  const eventsTable = prefix + "opportunity_events";
  const scope = personal ? "workspace" : "company";
  let initialized = false;
  router.use((req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    const session = deps.session(req.headers.authorization);
    if (!session) return next(new OpportunityError(401, "请先登录。"));
    const member = personal ? null : store.member(session.currentWorkspaceId, session.userId);
    if (!(isPersonalWorkspace ? isPersonalWorkspace(session) : member?.active)) {
      return next(new OpportunityError(403, personal ? "请切换到个人空间。" : "请切换到已认证的企业空间。"));
    }
    res.locals.viewer = { ...session, manager: member?.role === "OWNER" || member?.role === "ADMIN" } satisfies Viewer;
    if (!initialized) {
      store.use(db => db.exec(`
        CREATE TABLE IF NOT EXISTS ${opportunities} (
          id TEXT PRIMARY KEY, ${scope} TEXT NOT NULL${personal ? "" : " REFERENCES companies(id)"}, createdBy TEXT NOT NULL,
          requestId TEXT NOT NULL, assigneeId TEXT NOT NULL, demand TEXT NOT NULL, demandOwner TEXT, demandId TEXT,
          stage TEXT NOT NULL, nextAction TEXT NOT NULL, nextStep TEXT NOT NULL, dueAt TEXT,
          createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
          UNIQUE(${scope},createdBy,requestId)
        );
        CREATE INDEX IF NOT EXISTS ${prefix}opportunity_board ON ${opportunities}(${scope},stage,dueAt);
        CREATE INDEX IF NOT EXISTS ${prefix}opportunity_assignee ON ${opportunities}(${scope},assigneeId);
        CREATE INDEX IF NOT EXISTS ${prefix}opportunity_demand ON ${opportunities}(${scope},demandOwner,demandId);
        CREATE TABLE IF NOT EXISTS ${suppliesTable} (
          opportunity TEXT NOT NULL REFERENCES ${opportunities}(id), ownerId TEXT NOT NULL, id TEXT NOT NULL,
          snapshot TEXT NOT NULL, plannedQuantity REAL, PRIMARY KEY(opportunity,ownerId,id)
        );
        CREATE TABLE IF NOT EXISTS ${quotesTable} (
          opportunity TEXT NOT NULL REFERENCES ${opportunities}(id), threadId TEXT NOT NULL, messageId INTEGER NOT NULL,
          snapshot TEXT NOT NULL, PRIMARY KEY(opportunity,threadId,messageId)
        );
        CREATE TABLE IF NOT EXISTS ${eventsTable} (
          id INTEGER PRIMARY KEY, opportunity TEXT NOT NULL REFERENCES ${opportunities}(id), at TEXT NOT NULL,
          byUser TEXT NOT NULL, note TEXT NOT NULL, fields TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ${prefix}opportunity_event_history ON ${eventsTable}(opportunity,id DESC);
      `));
      initialized = true;
    }
    next();
  });

  const current = (db: DatabaseSync, viewer: Viewer, id: string) => {
    const row = db.prepare(`SELECT * FROM ${opportunities} WHERE ${scope}=? AND id=?`).get(viewer.currentWorkspaceId, id) as unknown as OpportunityRow | undefined;
    if (!row || (!viewer.manager && row.assigneeId !== viewer.userId)) throw missing();
    return row;
  };
  function checkAssignee(viewer: Viewer, assigneeId: string, previous?: string) {
    if (!assigneeId || (!viewer.manager && assigneeId !== viewer.userId)) throw forbidden();
    if (!personal && assigneeId !== previous && !store.member(viewer.currentWorkspaceId, assigneeId)?.active) throw bad("请选择仍在企业的成员。");
  }
  function recordEvent(db: DatabaseSync, id: string, by: string, note: string, fields: OpportunityFields) {
    db.prepare(`INSERT INTO ${eventsTable}(opportunity,at,byUser,note,fields) VALUES(?,?,?,?,?)`)
      .run(id, new Date().toISOString(), by, note, JSON.stringify(fields));
  }
  function verifyVersion(body: Record<string, unknown>, row: OpportunityRow) {
    if (body.version !== row.version) throw new OpportunityError(409, "这笔商机已更新，请刷新后再提交。");
  }
  function readQuote(viewer: Viewer, value: unknown) {
    if (!value || typeof value !== "object") throw bad("请选择要归档的报价。");
    const id = Reflect.get(value, "messageId");
    const thread = clean(Reflect.get(value, "threadId"), 80);
    const quote = thread && Number.isSafeInteger(id) && id > 0 && deps.quote(viewer, thread, id);
    if (!quote) throw new OpportunityError(404, "报价不存在或当前账号无权归档。");
    return quote;
  }
  function insertQuote(db: DatabaseSync, id: string, quote: OpportunityQuote) {
    return db.prepare(`INSERT OR IGNORE INTO ${quotesTable} VALUES(?,?,?,?)`)
      .run(id, quote.threadId, quote.id, JSON.stringify(quote)).changes > 0;
  }
  function insertSupply(db: DatabaseSync, id: string, ref: OpportunitySourceRef, source: SupplySnapshot, planned: number | null) {
    return db.prepare(`INSERT INTO ${suppliesTable} VALUES(?,?,?,?,?)
      ON CONFLICT(opportunity,ownerId,id) DO UPDATE SET plannedQuantity=excluded.plannedQuantity
      WHERE ${suppliesTable}.plannedQuantity IS NOT excluded.plannedQuantity`)
      .run(id, ref.ownerId, ref.id, JSON.stringify(source), planned).changes > 0;
  }
  function readSupply(viewer: Viewer, ref: OpportunitySourceRef) {
    if (ref.ownerId !== viewer.userId && (!viewer.manager || !store.member(viewer.currentWorkspaceId, ref.ownerId)?.active)) throw forbidden();
    const row = deps.snapshot(ref.ownerId, viewer.currentWorkspaceId).stocks.find(item => item.id === ref.id);
    if (!row || !isAvailable(row)) throw new OpportunityError(404, "货源已移除或不可用，请刷新资料。");
    return sourceSnapshot(row);
  }
  function plan(value: unknown, source: SupplySnapshot, demand: OpportunityDemand) {
    if (value == null) return null;
    const planned = amount(value);
    if (!planned || source.unit !== demand.unit || source.mode !== demand.mode || planned > source.quantity) {
      throw bad("计划数量须与需求单位和交易方式一致，并且不能超过该货源数量。");
    }
    return planned;
  }
  function fieldsFrom(row: OpportunityRow): OpportunityFields {
    return { stage: row.stage, assigneeId: row.assigneeId, nextAction: row.nextAction, nextStep: row.nextStep, dueAt: row.dueAt };
  }
  function touch(db: DatabaseSync, id: string) {
    db.prepare(`UPDATE ${opportunities} SET updatedAt=?,version=version+1 WHERE id=?`).run(new Date().toISOString(), id);
  }

  router.get("/", (_req, res) => {
    const viewer = res.locals.viewer as Viewer;
    const workspace = viewer.currentWorkspaceId;
    const data = store.use(db => {
      const members = personal ? [{ id: viewer.userId, name: deps.name(viewer.userId), active: true }]
        : db.prepare("SELECT userId AS id,active FROM company_members WHERE company=?").all(workspace)
          .map(row => ({ id: String(row.id), name: deps.name(String(row.id)), active: Boolean(row.active) }));
      const memberIds = members.filter(member => member.active).map(member => member.id);
      const visibleMembers = viewer.manager ? memberIds : [viewer.userId];
      const snapshots = new Map<string, LedgerSnapshot>();
      const snapshot = (userId: string) => {
        if (!memberIds.includes(userId)) return undefined;
        if (!snapshots.has(userId)) snapshots.set(userId, deps.snapshot(userId, workspace));
        return snapshots.get(userId);
      };
      for (const id of visibleMembers) snapshot(id);
      const portfolio = buildPortfolio(new Map(visibleMembers.flatMap(id => {
        const data = snapshots.get(id);
        return data ? [[id, data] as const] : [];
      })));
      const rows = db.prepare(`SELECT * FROM ${opportunities} WHERE ${scope}=? AND (? OR assigneeId=?)
        ORDER BY stage IN ('WON','LOST'),dueAt,updatedAt DESC`).all(workspace, Number(viewer.manager), viewer.userId) as unknown as OpportunityRow[];
      const allocations = new Map<string, number>();
      const plannedRows = db.prepare(`SELECT s.* FROM ${suppliesTable} s JOIN ${opportunities} o ON o.id=s.opportunity
        WHERE o.${scope}=? AND o.stage NOT IN ('WON','LOST') AND s.plannedQuantity IS NOT NULL`).all(workspace) as unknown as SupplyRow[];
      for (const row of plannedRows) {
        const key = sourceKey(row);
        allocations.set(key, (allocations.get(key) ?? 0) + (row.plannedQuantity ?? 0));
      }
      const visible = rows.map((row): Opportunity => {
        const demand = parse<OpportunityDemand>(row.demand);
        const supplies = (db.prepare(`SELECT * FROM ${suppliesTable} WHERE opportunity=?`).all(row.id) as unknown as SupplyRow[]).map(link => {
          const saved = parse<SupplySnapshot>(link.snapshot);
          const liveRow = snapshot(link.ownerId)?.stocks.find(entry => entry.id === link.id);
          const live = liveRow && sourceSnapshot(liveRow);
          const capacity = live?.quantity ?? 0;
          const matching = live && live.unit === saved.unit && live.mode === saved.mode &&
            live.model.toUpperCase() === saved.model.toUpperCase() && live.unit === demand.unit && live.mode === demand.mode;
          const total = allocations.get(sourceKey(link)) ?? 0;
          const pressure = !!capacity && total > capacity;
          const verifiedQuantity = matching && isVerified(liveRow) && !pressure && link.plannedQuantity
            ? Math.min(capacity, link.plannedQuantity) : 0;
          return { ...saved, ownerId: link.ownerId, id: link.id, plannedQuantity: link.plannedQuantity,
            verifiedQuantity, pressure, unavailable: !isAvailable(liveRow) };
        });
        return {
          id: row.id, version: row.version, ...fieldsFrom(row), demand,
          demandRef: row.demandOwner && row.demandId ? { ownerId: row.demandOwner, id: row.demandId } : null,
          createdAt: row.createdAt, updatedAt: row.updatedAt, supplies,
          confirmedQuantity: Math.min(demand.quantity, supplies.reduce((sum, item) => sum + item.verifiedQuantity, 0)),
          quotes: db.prepare(`SELECT snapshot FROM ${quotesTable} WHERE opportunity=?`)
            .all(row.id).map(quote => parse<OpportunityQuote>(quote.snapshot))
            .sort((a, b) => b.sentAt.localeCompare(a.sentAt) || b.id - a.id),
          events: db.prepare(`SELECT at,byUser,note,fields FROM ${eventsTable} WHERE opportunity=? ORDER BY id DESC LIMIT 30`)
            .all(row.id).map((event): OpportunityEvent => ({
              at: String(event.at), by: deps.name(String(event.byUser)), note: String(event.note), fields: parse(event.fields),
            })),
        };
      });
      return { manager: viewer.manager, members: viewer.manager ? members : members.filter(m => m.id === viewer.userId), opportunities: visible, portfolio };
    });
    res.json(data);
  });

  router.post("/", (req, res) => {
    const viewer = res.locals.viewer as Viewer;
    const workspace = viewer.currentWorkspaceId;
    const body = req.body ?? {};
    const requestId = clean(body.requestId, 80);
    if (!requestId || !/^[\w-]{16,80}$/.test(requestId)) throw bad("请刷新后重试。");
    const replay = (db: DatabaseSync) => {
      const row = db.prepare(`SELECT id FROM ${opportunities} WHERE ${scope}=? AND createdBy=? AND requestId=?`)
        .get(workspace, viewer.userId, requestId);
      return row && current(db, viewer, String(row.id));
    };
    const prior = store.use(replay);
    if (prior) return res.json({ id: prior.id });
    const fields = readFields(body);
    checkAssignee(viewer, fields.assigneeId);
    const demandId = clean(body.demandId, 2048);
    const supplyId = clean(body.supplyId, 2048);
    const demandSource = demandId && deps.snapshot(viewer.userId, workspace).market.find(row => row.id === demandId && isDemand(row));
    if (demandId && !demandSource) throw new OpportunityError(404, "需求尚未同步或已移除，请刷新后再试。");
    const demand = demandFields(body.demand, demandSource ? sourceSnapshot(demandSource) : undefined);
    const supplyRef = { ownerId: viewer.userId, id: supplyId };
    const supply = supplyId ? readSupply(viewer, supplyRef) : null;
    const quantity = supply ? plan(body.plannedQuantity, supply, demand) : null;
    const quote = body.quote ? readQuote(viewer, body.quote) : null;
    const created = store.transaction(db => {
      const previous = replay(db);
      if (previous) return { id: previous.id, existing: true };
      if (demandId) {
        const existing = db.prepare(`SELECT id FROM ${opportunities} WHERE ${scope}=? AND demandOwner=? AND demandId=?
          AND stage NOT IN ('WON','LOST') ORDER BY createdAt DESC LIMIT 1`).get(workspace, viewer.userId, demandId);
        if (existing) {
          const id = String(existing.id);
          const row = current(db, viewer, id);
          if (body.joinExisting !== true) return { id, duplicate: true };
          let changed = false;
          if (supply && !db.prepare(`SELECT 1 FROM ${suppliesTable} WHERE opportunity=? AND ownerId=? AND id=?`).get(id, supplyRef.ownerId, supplyRef.id)) {
            changed = insertSupply(db, id, supplyRef, supply, plan(body.plannedQuantity, supply, parse(row.demand)));
          }
          if (quote) changed = insertQuote(db, id, quote) || changed;
          if (changed) { touch(db, id); recordEvent(db, id, viewer.userId, "补充商机来源", fieldsFrom(row)); }
          return { id, existing: true };
        }
      }
      if (body.joinExisting === true) throw new OpportunityError(409, "原商机已结束，请关闭后重新转商机。");
      const id = randomUUID(), at = new Date().toISOString();
      db.prepare(`INSERT INTO ${opportunities}(id,${scope},createdBy,requestId,assigneeId,demand,demandOwner,demandId,
        stage,nextAction,nextStep,dueAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, workspace, viewer.userId, requestId, fields.assigneeId, JSON.stringify(demand), demandId ? viewer.userId : null,
          demandId || null, fields.stage, fields.nextAction, fields.nextStep, fields.dueAt, at, at);
      if (supply) insertSupply(db, id, supplyRef, supply, quantity);
      if (quote) insertQuote(db, id, quote);
      recordEvent(db, id, viewer.userId, "创建商机", fields);
      return { id };
    });
    if ("duplicate" in created) return res.status(409).json({ existingId: created.id, error: "这条需求已经有在跟的商机。" });
    res.status(created.existing ? 200 : 201).json(created);
  });

  router.patch("/:id", (req, res) => {
    const viewer = res.locals.viewer as Viewer;
    const fields = readFields(req.body ?? {});
    const before = store.use(db => current(db, viewer, req.params.id));
    checkAssignee(viewer, fields.assigneeId, before.assigneeId);
    store.transaction(db => {
      const row = current(db, viewer, req.params.id);
      verifyVersion(req.body, row);
      db.prepare(`UPDATE ${opportunities} SET assigneeId=?,stage=?,nextAction=?,nextStep=?,dueAt=? WHERE id=?`)
        .run(fields.assigneeId, fields.stage, fields.nextAction, fields.nextStep, fields.dueAt, row.id);
      touch(db, row.id);
      recordEvent(db, row.id, viewer.userId, clean(req.body.note, 300) || "更新跟进", fields);
    });
    res.json({ id: req.params.id });
  });

  router.post("/:id/supplies", (req, res) => {
    const viewer = res.locals.viewer as Viewer;
    const body = req.body ?? {};
    const ref = { ownerId: clean(body.ownerId, 2048), id: clean(body.sourceId, 2048) };
    store.transaction(db => {
      const row = current(db, viewer, req.params.id);
      verifyVersion(body, row);
      if (!isOpenOpportunity(row.stage)) throw new OpportunityError(409, "请先重新打开该商机。");
      const link = db.prepare(`SELECT snapshot FROM ${suppliesTable} WHERE opportunity=? AND ownerId=? AND id=?`)
        .get(row.id, ref.ownerId, ref.id);
      let changed: boolean;
      if (body.remove === true) {
        changed = db.prepare(`DELETE FROM ${suppliesTable} WHERE opportunity=? AND ownerId=? AND id=?`)
          .run(row.id, ref.ownerId, ref.id).changes > 0;
      } else {
        const source = link ? parse<SupplySnapshot>(link.snapshot) : readSupply(viewer, ref);
        changed = insertSupply(db, row.id, ref, source, plan(body.plannedQuantity, source, parse(row.demand)));
      }
      if (changed) {
        touch(db, row.id);
        recordEvent(db, row.id, viewer.userId, body.remove === true ? "移除关联货源" : "更新备选货源", fieldsFrom(row));
      }
    });
    res.json({ id: req.params.id });
  });

  router.post("/:id/quotes", (req, res) => {
    const viewer = res.locals.viewer as Viewer;
    const quote = readQuote(viewer, req.body?.quote);
    store.transaction(db => {
      const row = current(db, viewer, req.params.id);
      if (!insertQuote(db, row.id, quote)) return;
      touch(db, row.id);
      recordEvent(db, row.id, viewer.userId, `归档报价 V${quote.version}`, fieldsFrom(row));
    });
    res.json({ id: req.params.id });
  });

  router.use((error: Error, _req: unknown, res: import("express").Response, next: import("express").NextFunction) => {
    if (!(error instanceof OpportunityError)) return next(error);
    res.status(error.status).json({ error: error.message });
  });
  return router;
}
