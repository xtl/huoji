import express from "express";
import { randomBytes, randomInt } from "node:crypto";
import { DeepSeekKeyStore, createDeepSeekSettingsRouter, secureTransport } from "./deepseek-settings";
import { EnterpriseStore, usageMonth } from "./enterprise";
import { pointScale, type CreditWallet } from "./credit-wallet";

export const PLATFORM_KEY = "platform-shared-deepseek";
type Account = { id: string; phone: string };
type Dimension = "account" | "company";
type Subject = { id: string; name: string };
const fullPhoneViewer = "13714133178";
const mask = (phone: string) => phone.slice(0, 3) + "****" + phone.slice(-4);
const fields =
  "COUNT(*) calls,COALESCE(SUM(input),0) input,COALESCE(SUM(output),0) output,COALESCE(SUM(total),0) total,SUM(status='UNKNOWN') unknown,SUM(status='REJECTED') rejected,COALESCE(SUM(costE8),0)/100000000.0 modelCost,COALESCE(SUM(chargedUnits),0)/10000000.0 chargedCredits";
const zero = { calls: 0, input: 0, output: 0, total: 0, unknown: 0, rejected: 0, modelCost:0, chargedCredits:0 };

export function platformAiRouter(
  store: EnterpriseStore,
  keys: DeepSeekKeyStore,
  deps: {
    accounts: () => Account[];
    wallet: CreditWallet;
    personalWorkspaceId: (id: string) => string;
    sendCode: (phone: string, code: string) => Promise<unknown>;
  },
) {
  const router = express.Router();
  const challenges = new Map<string, { code: string; until: number; attempts: number }>();
  const sessions = new Map<string, { actor: string; until: number }>();
  const allowed = (phone: string) =>
    (process.env.HUOJI_PLATFORM_ADMIN_PHONES || "")
      .split(",")
      .map((x) => x.trim())
      .includes(phone) && /^1[3-9]\d{9}$/.test(phone);
  function actor(header: unknown) {
    const key = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
    const entry = sessions.get(key);
    if (entry && entry.until > Date.now() && allowed(entry.actor)) return entry.actor;
    sessions.delete(key);
    return null;
  }
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!secureTransport(req)) {
      res.status(403).json({ error: "请通过货记 HTTPS 地址打开平台后台。" });
      return;
    }
    next();
  });
  router.use(express.json({ limit: "4kb" }));
  router.post("/auth/code", async (req, res) => {
    const phone = String(req.body?.phone ?? "");
    if (!allowed(phone)) {
      res.status(403).json({ error: "该手机号未获平台管理授权。" });
      return;
    }
    const previous = challenges.get(phone);
    if (previous && previous.until - 240000 > Date.now()) {
      res.status(429).json({ error: "请稍后再获取验证码。" });
      return;
    }
    const mock =
      process.env.NODE_ENV === "test" &&
      (process.env.SMS_PROVIDER || "mock") === "mock" &&
      req.hostname === "127.0.0.1" &&
      ["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress || "") &&
      !req.headers["x-forwarded-for"];
    if (!mock && !["aliyun", "tencentcloud"].includes(process.env.SMS_PROVIDER || "")) {
      res.status(503).json({ error: "平台管理员登录需要开通短信服务。" });
      return;
    }
    const code = String(randomInt(100000, 1000000));
    const challenge = { code, until: Date.now() + 300000, attempts: 0 };
    challenges.set(phone, challenge);
    try {
      if (!mock) await deps.sendCode(phone, code);
      res.json({ sent: true, ...(mock ? { debugCode: code } : {}) });
    } catch {
      if (challenges.get(phone) === challenge) challenges.delete(phone);
      res.status(503).json({ error: "短信发送失败，请稍后重试。" });
    }
  });
  router.post("/auth/login", (req, res) => {
    const phone = String(req.body?.phone ?? ""),
      c = challenges.get(phone);
    if (c) c.attempts++;
    if (!allowed(phone) || !c || c.until <= Date.now() || c.attempts > 5 || c.code !== req.body?.code) {
      res.status(401).json({ error: "验证码无效或已过期。" });
      return;
    }
    challenges.delete(phone);
    for (const [key, s] of sessions) if (s.until <= Date.now()) sessions.delete(key);
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { actor: phone, until: Date.now() + 4 * 3600000 });
    res.json({ token });
  });
  router.use((req, res, next) => {
    const phone = actor(req.headers.authorization);
    if (!phone) {
      res.status(401).json({ error: "请使用平台管理员手机号登录。" });
      return;
    }
    res.locals.actor = phone;
    next();
  });
  router.post("/auth/logout", (req, res) => {
    sessions.delete(req.headers.authorization!.slice(7));
    res.json({ ok: true });
  });
  function audit(phone: string, action: string, subject: string) {
    store.use((db) =>
      db
        .prepare("INSERT INTO platform_ai_audit(created,actor,action,subject) VALUES(?,?,?,?)")
        .run(new Date().toISOString(), phone, action, subject),
    );
  }
  router.use(
    "/key",
    (req, res, next) => {
      if (req.method === "PUT" || req.method === "DELETE")
        audit(res.locals.actor, req.method === "PUT" ? "REQUEST_KEY_CHANGE" : "REQUEST_KEY_REMOVE", "DeepSeek");
      next();
    },
    createDeepSeekSettingsRouter(keys, (auth) => (actor(auth) ? { userId: PLATFORM_KEY } : null)),
  );
  function subjects(dimension: Dimension, viewer: string): Subject[] {
    if (dimension === "account") {
      return deps.accounts().map(account => ({
        id: account.id,
        name: viewer === fullPhoneViewer ? account.phone : mask(account.phone),
      }));
    }
    return store.use((db) =>
      db.prepare("SELECT id,name FROM companies WHERE status='APPROVED' ORDER BY name").all(),
    ) as unknown as Subject[];
  }
  router.get("/usage", (req, res) => {
    const dimension = req.query.by === "company" ? "company" : "account";
    const month = String(req.query.month || new Date(Date.now() + 28800000).toISOString().slice(0, 7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      res.status(400).json({ error: "月份无效。" });
      return;
    }
    const [from, until] = usageMonth(month);
    const field = dimension === "account" ? "employee" : "workspace";
    const rows = store.use((db) =>
      db
        .prepare(
          "SELECT " +
            field +
            " id," +
            fields +
            " FROM usage WHERE payer='PLATFORM' AND created>=? AND created<? GROUP BY " +
            field,
        )
        .all(from, until),
    );
    const lookup = new Map(rows.map((row) => [String(row.id), row]));
    const limits = store.use((db) =>
      db.prepare("SELECT subject,ceiling FROM ai_limits WHERE dimension=?").all(dimension),
    );
    const ceilings = new Map(limits.map((x) => [x.subject, x.ceiling]));
    const search = String(req.query.q || "")
      .trim()
      .toLowerCase();
    const items = subjects(dimension, res.locals.actor)
      .map((s) => ({ ...zero, ...lookup.get(s.id), ...s, ceiling: ceilings.get(s.id) ?? null }))
      .filter((s) => !search || (s.name + " " + s.id).toLowerCase().includes(search))
      .sort((a, b) => Number(b.total) - Number(a.total) || a.name.localeCompare(b.name));
    const page = Number(req.query.page ?? 1);
    if (!Number.isSafeInteger(page) || page < 1) {
      res.status(400).json({ error: "页码无效。" });
      return;
    }
    const pageItems = items.slice((page - 1) * 40, page * 40);
    const now = new Date().toISOString();
    const rowsWithStatus = dimension === "account" ? store.use(db => {
      const plan = db.prepare("SELECT MAX(end) AS expiry, MAX(start<=? AND end>?) AS active FROM wallet_plans WHERE workspace=?");
      const certification = db.prepare(`SELECT name,status FROM companies c WHERE applicant=? OR
        (status='APPROVED' AND EXISTS (SELECT 1 FROM company_members m WHERE m.company=c.id AND m.userId=? AND m.active=1))
        ORDER BY created DESC`);
      return pageItems.map(row => {
        const membership = plan.get(now, now, deps.personalWorkspaceId(row.id));
        return { ...row, membership: membership?.active ? "有效" : membership?.expiry ? "已到期" : "未开通",
          expiry: membership?.expiry, companies: certification.all(row.id, row.id) };
      });
    }) : pageItems;
    res.json({
      month,
      count: items.length,
      items: rowsWithStatus,
      total: items.reduce((sum, x) => sum + Number(x.total), 0),
    });
  });
  router.post("/accounts/:id/grants", (req, res) => {
    const userId = req.params.id;
    const { kind, points, requestId } = req.body || {};
    if (!deps.accounts().some(account => account.id === userId)) {
      res.status(404).json({error:"账号不存在。"});
      return;
    }
    if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId) ||
        !(kind === "membership" && points === 0 || kind === "credits" && Number.isSafeInteger(points) && points > 0 && Number.isSafeInteger(points * pointScale))) {
      res.status(400).json({error:"请选择会员或输入有效的正整数货记分。"});
      return;
    }
    const applied = deps.wallet.grantFromPlatform({userId, currentWorkspaceId: deps.personalWorkspaceId(userId)}, res.locals.actor, requestId, kind, points);
    if (!applied) {
      res.status(409).json({error:"该发放编号已用于其他操作。"});
      return;
    }
    res.json({ok:true});
  });
  router.get("/breakdown", (req, res) => {
    const month = String(req.query.month ?? "");
    const by = req.query.by,
      id = String(req.query.id ?? "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !["account", "company"].includes(String(by)) || !id) {
      res.status(400).json({ error: "查询条件无效。" });
      return;
    }
    const [from, until] = usageMonth(month);
    const company = by === "company",
      field = company ? "employee" : "workspace",
      filter = company ? "workspace" : "employee";
    const labels = new Map(subjects(company ? "account" : "company", res.locals.actor).map((s) => [s.id, s.name]));
    const rows = store.use((db) =>
      db
        .prepare(
          "SELECT " +
            field +
            " id,kind," +
            fields +
            " FROM usage WHERE payer='PLATFORM' AND created>=? AND created<? AND " +
            filter +
            "=? GROUP BY " +
            field +
            ",kind ORDER BY total DESC",
        )
        .all(from, until, id),
    );
    res.json({
      items: rows.map((r) => ({ ...r, name: labels.get(String(r.id)) ?? (company ? "历史账号" : "个人空间") })),
    });
  });
  router.put("/limits", (req, res) => {
    const { dimension, id, ceiling } = req.body || {};
    if (
      !["company", "account"].includes(dimension) ||
      typeof id !== "string" ||
      !(ceiling === null || (Number.isSafeInteger(ceiling) && ceiling >= 0)) ||
      !subjects(dimension, res.locals.actor).some((s) => s.id === id)
    ) {
      res.status(400).json({ error: "请选择有效账号或企业，限额应为非负整数。" });
      return;
    }
    store.transaction((db) => {
      if (ceiling === null) db.prepare("DELETE FROM ai_limits WHERE dimension=? AND subject=?").run(dimension, id);
      else
        db.prepare(
          "INSERT INTO ai_limits(dimension,subject,ceiling) VALUES(?,?,?) ON CONFLICT(dimension,subject) DO UPDATE SET ceiling=excluded.ceiling",
        ).run(dimension, id, ceiling);
      db.prepare("INSERT INTO platform_ai_audit(created,actor,action,subject) VALUES(?,?,?,?)").run(
        new Date().toISOString(),
        res.locals.actor,
        "SET_LIMIT",
        JSON.stringify({ dimension, id, ceiling }),
      );
    });
    res.json({ ok: true });
  });
  router.use(
    (
      error: Error & { type?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error.type?.startsWith("entity.")) {
        res.status(400).json({ error: "请求格式无效。" });
        return;
      }
      res.status(503).json({ error: "平台管理操作未完成，请稍后重试。" });
    },
  );
  return router;
}
