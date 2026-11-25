import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { EnterpriseStore, isCompany } from "./enterprise";

// Integer ten-millionths of a point preserve the smallest supported cached-token charge.
export const pointScale = 10_000_000;
type Db = DatabaseSync;
type Order = {
  id: string;
  workspaceId: string;
  userId: string;
  paidAt?: string;
  status: string;
  title: string;
  entitlement: {
    creditAmount: number;
    planCode?: string;
    membershipDays?: number;
    months?: number;
    installments?: number;
  };
};
type Scope = { userId: string; currentWorkspaceId: string };
type Grant = {
  id: string;
  workspace: string;
  employee: string;
  title: string;
  amount: number;
  due: string;
  kind: string;
};

// Clamp month-end anniversaries to the last day, using the original Beijing billing date as anchor.
export function addBillingMonths(anchor: string, months: number) {
  const offset = 8 * 3600_000;
  const date = new Date(Date.parse(anchor) + offset);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, end));
  return new Date(date.getTime() - offset).toISOString();
}

export class CreditWallet {
  constructor(private store: EnterpriseStore) {
    store.use((db) =>
      db.exec(`
      CREATE TABLE IF NOT EXISTS wallet_balances(workspace TEXT PRIMARY KEY, units INTEGER NOT NULL DEFAULT 0 CHECK(units>=0));
      CREATE TABLE IF NOT EXISTS wallet_plans(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,code TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS wallet_plan_period ON wallet_plans(workspace,start,end);
      CREATE TABLE IF NOT EXISTS platform_wallet_grants(id TEXT PRIMARY KEY,actor TEXT NOT NULL,workspace TEXT NOT NULL,kind TEXT NOT NULL,points INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet_grants(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,employee TEXT NOT NULL,title TEXT NOT NULL,kind TEXT NOT NULL,amount INTEGER NOT NULL,due TEXT NOT NULL,applied INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS wallet_due ON wallet_grants(workspace,applied,due);
      CREATE TABLE IF NOT EXISTS wallet_recharges(workspace TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS wallet_entries(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,employee TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,delta INTEGER NOT NULL,balance INTEGER NOT NULL,created TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS wallet_entries_space ON wallet_entries(workspace,created);
      CREATE TABLE IF NOT EXISTS wallet_calls(task TEXT PRIMARY KEY,workspace TEXT NOT NULL,employee TEXT NOT NULL,attempt TEXT NOT NULL,digest TEXT NOT NULL,held INTEGER NOT NULL,expires INTEGER NOT NULL,receipt TEXT,result TEXT);
      CREATE INDEX IF NOT EXISTS wallet_held ON wallet_calls(workspace,expires);
    `),
    );
  }
  private prepare(db: Db, workspace: string, now: string) {
    const created = db.prepare("INSERT OR IGNORE INTO wallet_balances(workspace) VALUES(?)").run(workspace);
    if (created.changes && !isCompany(workspace)) {
      // Preserve the existing one-time personal welcome entitlement without trusting browser balances.
      db.prepare(
        "INSERT OR IGNORE INTO wallet_grants(id,workspace,employee,title,kind,amount,due) VALUES(?,?,?,'新账号体验积分','GRANT',128,?)",
      ).run("welcome:" + workspace, workspace, "", now);
    }
    const due = db
      .prepare("SELECT * FROM wallet_grants WHERE workspace=? AND applied=0 AND due<=? ORDER BY due,id")
      .all(workspace, now) as unknown as Grant[];
    for (const grant of due) {
      this.post(db, grant.id, workspace, grant.employee, grant.kind, grant.title, grant.amount * pointScale, now);
      db.prepare("UPDATE wallet_grants SET applied=1 WHERE id=?").run(grant.id);
      if (grant.id.startsWith("pay:"))
        db.prepare("INSERT OR IGNORE INTO wallet_recharges VALUES(?)").run(workspace);
    }
    db.prepare("DELETE FROM wallet_calls WHERE workspace=? AND result IS NULL AND expires<=?").run(
      workspace,
      Date.parse(now),
    );
  }
  private balance(db: Db, workspace: string) {
    return Number(db.prepare("SELECT units FROM wallet_balances WHERE workspace=?").get(workspace)?.units ?? 0);
  }
  private available(db: Db, workspace: string) {
    const held = db
      .prepare("SELECT COALESCE(SUM(held),0) AS held FROM wallet_calls WHERE workspace=? AND result IS NULL")
      .get(workspace);
    return this.balance(db, workspace) - Number(held?.held);
  }
  postDueGrants(now = new Date().toISOString()) {
    return this.store.transaction((db) => {
      const due = db.prepare("SELECT DISTINCT workspace FROM wallet_grants WHERE applied=0 AND due<=?").all(now);
      const workspaces = due.map((row) => String(row.workspace));
      for (const workspace of workspaces) this.prepare(db, workspace, now);
      return db
        .prepare("SELECT workspace FROM wallet_recharges")
        .all()
        .map((row) => String(row.workspace));
    });
  }
  acknowledgeRecharge(workspace: string) {
    this.store.use((db) => db.prepare("DELETE FROM wallet_recharges WHERE workspace=?").run(workspace));
  }
  private post(
    db: Db,
    id: string,
    workspace: string,
    employee: string,
    kind: string,
    title: string,
    delta: number,
    created: string,
  ) {
    db.prepare("UPDATE wallet_balances SET units=units+? WHERE workspace=?").run(delta, workspace);
    db.prepare("INSERT INTO wallet_entries VALUES(?,?,?,?,?,?,?,?)").run(
      id,
      workspace,
      employee,
      kind,
      title,
      delta,
      this.balance(db, workspace),
      created,
    );
  }
  applyPaid(order: Order, now = new Date().toISOString()) {
    if (order.status !== "PAID" || !order.paidAt || !order.workspaceId) return;
    const paidAt = order.paidAt;
    const e = order.entitlement,
      periods = e.installments ?? 1;
    if (!Number.isSafeInteger(e.creditAmount) || e.creditAmount <= 0 || e.creditAmount % periods !== 0)
      throw Error("支付订单权益无效。");
    return this.store.transaction((db) => {
      const firstId = "pay:" + order.id + ":0";
      if (db.prepare("SELECT id FROM wallet_grants WHERE id=?").get(firstId)) return false;
      let anchor = paidAt;
      if (e.planCode) {
        const last = db
          .prepare("SELECT max(end) AS end FROM wallet_plans WHERE workspace=?")
          .get(order.workspaceId);
        if (typeof last?.end === "string" && last.end > anchor) anchor = last.end;
        const end = e.months
          ? addBillingMonths(anchor, e.months)
          : new Date(Date.parse(anchor) + (e.membershipDays ?? 30) * 86400_000).toISOString();
        db.prepare("INSERT INTO wallet_plans VALUES(?,?,?,?,?)").run(
          order.id,
          order.workspaceId,
          e.planCode,
          anchor,
          end,
        );
      }
      const insert = db.prepare(
        "INSERT INTO wallet_grants(id,workspace,employee,title,kind,amount,due) VALUES(?,?,?,?,?,?,?)",
      );
      for (let i = 0; i < periods; i++) {
        const due = e.months ? addBillingMonths(anchor, i) : paidAt;
        const label = periods === 1 ? order.title : order.title + " · 第 " + (i + 1) + " 期";
        insert.run(
          "pay:" + order.id + ":" + i,
          order.workspaceId,
          order.userId,
          label,
          e.planCode ? "GRANT" : "RECHARGE",
          e.creditAmount / periods,
          due,
        );
      }
      this.prepare(db, order.workspaceId, now);
      return anchor <= now;
    });
  }
  private activePlan(db: Db, workspace: string, now: string) {
    return db.prepare("SELECT code,end FROM wallet_plans WHERE workspace=? AND start<=? AND end>? ORDER BY start DESC LIMIT 1")
      .get(workspace, now, now);
  }
  grantFromPlatform(scope: Scope, actor: string, requestId: string, kind: "membership" | "credits", points: number, now = new Date().toISOString()) {
    const workspace = scope.currentWorkspaceId;
    if (!Number.isSafeInteger(points * pointScale) || (kind === "credits" ? points < 1 || !Number.isInteger(points) : points !== 0))
      throw Error("无效的发放额度。");
    return this.store.transaction(db => {
      const previous = db.prepare("SELECT * FROM platform_wallet_grants WHERE id=?").get(requestId);
      if (previous) return previous.workspace === workspace && previous.actor === actor && previous.kind === kind && previous.points === points;
      const id = "platform:" + requestId;
      if (kind === "membership") {
        const last = db.prepare("SELECT MAX(end) AS end FROM wallet_plans WHERE workspace=?").get(workspace);
        const start = typeof last?.end === "string" && last.end > now ? last.end : now;
        const end = new Date(Date.parse(start) + 7 * 86400_000).toISOString();
        db.prepare("INSERT INTO wallet_plans VALUES(?,?,?,?,?)").run(id, workspace, "PRO_TRIAL", start, end);
      } else {
        this.prepare(db, workspace, now);
        if (!Number.isSafeInteger(this.balance(db, workspace) + points * pointScale)) throw Error("余额超过可记录范围。");
        this.post(db, id, workspace, scope.userId, "GRANT", "平台发放货记分", points * pointScale, now);
        db.prepare("INSERT OR IGNORE INTO wallet_recharges VALUES(?)").run(workspace);
      }
      db.prepare("INSERT INTO platform_wallet_grants VALUES(?,?,?,?,?)").run(requestId, actor, workspace, kind, points);
      db.prepare("INSERT INTO platform_ai_audit(created,actor,action,subject) VALUES(?,?,?,?)")
        .run(now, actor, kind === "membership" ? "GRANT_7_DAYS" : "GRANT_CREDITS", JSON.stringify({ userId: scope.userId, workspace, points, requestId }));
      return true;
    });
  }
  hasActiveMembership(workspace: string, now = new Date().toISOString()) {
    return this.store.use(db => Boolean(this.activePlan(db, workspace, now)));
  }
  snapshot(scope: Scope, ownEntriesOnly: boolean, now = new Date().toISOString()) {
    const workspace = scope.currentWorkspaceId;
    return this.store.transaction((db) => {
      this.prepare(db, workspace, now);
      const plan = this.activePlan(db, workspace, now);
      const next = db
        .prepare("SELECT amount,due FROM wallet_grants WHERE workspace=? AND applied=0 ORDER BY due LIMIT 1")
        .get(workspace);
      const filter = ownEntriesOnly ? " AND employee=?" : "";
      const entries = db
        .prepare(
          "SELECT id,kind AS type,title,delta,balance,created AS createdAt FROM wallet_entries WHERE workspace=?" +
            filter +
            " ORDER BY rowid DESC LIMIT 80",
        )
        .all(workspace, ...(ownEntriesOnly ? [scope.userId] : []));
      return {
        creditBalance: this.available(db, workspace) / pointScale,
        planCode: plan?.code ?? "FREE",
        planName: plan?.code === "PRO_TRIAL" ? "个人 Pro 体验会员" : plan?.code === "PRO_YEARLY" ? "个人 Pro 年卡" : plan ? "个人 Pro 月卡" : "免费版",
        membershipStatus: plan ? "ACTIVE" : "FREE",
        membershipExpiresAt: plan ? db.prepare("SELECT MAX(end) AS end FROM wallet_plans WHERE workspace=?").get(workspace)?.end : undefined,
        nextGrant: next ?? null,
        transactions: entries.map(({ delta, balance, ...entry }) => ({
          ...entry,
          amount: Number(delta) / pointScale,
          balanceAfter: Number(balance) / pointScale,
        })),
      };
    });
  }
  reserve(scope: Scope, task: string, digest: string, inputHold: number, outputUnit: number, maxTokens: number) {
    return this.store.transaction((db) => {
      const workspace = scope.currentWorkspaceId,
        now = Date.now();
      this.prepare(db, workspace, new Date(now).toISOString());
      const prior = db.prepare("SELECT digest,result FROM wallet_calls WHERE task=?").get(task);
      if (prior) {
        if (prior.digest !== digest) throw Error("该解析编号已用于另一条内容。");
        if (prior.result) return { cached: JSON.parse(String(prior.result)) };
        throw Error("该解析正在处理，请稍后查看结果。");
      }
      const available = this.available(db, workspace);
      const outputLimit = Math.min(maxTokens, Math.floor((available - inputHold) / outputUnit));
      if (outputLimit < Math.min(256, maxTokens)) throw new InsufficientCredits();
      const attempt = randomUUID();
      db.prepare(
        "INSERT INTO wallet_calls(task,workspace,employee,attempt,digest,held,expires) VALUES(?,?,?,?,?,?,?)",
      ).run(task, workspace, scope.userId, attempt, digest, inputHold + outputLimit * outputUnit, now + 300000);
      return { attempt, outputLimit };
    });
  }
  release(attempt: string) {
    this.store.use((db) => db.prepare("DELETE FROM wallet_calls WHERE attempt=? AND result IS NULL").run(attempt));
  }
  settle(
    attempt: string,
    units: number | null,
    receipt: { usageId?: string; [key: string]: unknown },
    result: unknown,
    title: string,
  ) {
    this.store.transaction((db) => {
      const row = db
        .prepare("SELECT task,workspace,employee,held,result FROM wallet_calls WHERE attempt=?")
        .get(attempt);
      if (!row) throw Error("解析预留已失效，请重试。");
      if (row.result) return;
      // An inconsistent provider receipt is held for review rather than charging more than authorized.
      if (units !== null && units >= 0 && units <= Number(row.held)) {
        this.post(
          db,
          "ai:" + attempt,
          String(row.workspace),
          String(row.employee),
          "CONSUME",
          title,
          -units,
          new Date().toISOString(),
        );
        if (receipt.usageId) db.prepare("UPDATE usage SET chargedUnits=? WHERE id=?").run(units, receipt.usageId);
      }
      db.prepare("UPDATE wallet_calls SET held=0,receipt=?,result=? WHERE attempt=?").run(
        JSON.stringify(receipt),
        JSON.stringify(result),
        attempt,
      );
    });
  }
}
export class InsufficientCredits extends Error {
  constructor() {
    super("当前空间货记分不足，请购买货记分后重新解析。");
  }
}
