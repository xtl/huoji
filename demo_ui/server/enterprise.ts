import express from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

type Scope = { userId: string; currentWorkspaceId: string };
type User = { phone: string; displayName: string };
type Role = "OWNER" | "ADMIN" | "MEMBER";
type Member = { userId: string; role: Role; active: number; accessVersion: number };
type Space = { id: string; name: string; role: Role; active: number; showNameInCircle: 0 | 1 };
class Problem extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const requireThat = (test: unknown, status: number, message: string) => {
  if (!test) throw new Problem(status, message);
};
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export const isCompany = (id: string) => id.startsWith("ent_");

export class EnterpriseStore {
  constructor(private readonly file: string) {}
  private initialized = false;
  use<T>(fn: (db: DatabaseSync) => T): T {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const db = new DatabaseSync(this.file);
    try {
      db.exec("PRAGMA busy_timeout=5000");
      if (!this.initialized) {
        db.exec(`PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY,name TEXT NOT NULL,credit TEXT NOT NULL,domain TEXT NOT NULL DEFAULT '',applicant TEXT NOT NULL,status TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',evidence BLOB NOT NULL,mime TEXT NOT NULL,created TEXT NOT NULL,reviewer TEXT,reviewed TEXT);
          CREATE UNIQUE INDEX IF NOT EXISTS company_credit ON companies(credit) WHERE status IN ('PENDING','APPROVED');
          CREATE TABLE IF NOT EXISTS company_circle_settings(company TEXT PRIMARY KEY, showName INTEGER NOT NULL CHECK(showName IN (0,1)));
          CREATE TABLE IF NOT EXISTS company_members(company TEXT NOT NULL,userId TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL,accessVersion INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(company,userId));
          CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY, company TEXT NOT NULL,channel TEXT NOT NULL,target TEXT NOT NULL,role TEXT NOT NULL,secret TEXT NOT NULL,expires INTEGER NOT NULL,state TEXT NOT NULL);
          CREATE UNIQUE INDEX IF NOT EXISTS pending_target ON invites(company,channel,target) WHERE state IN ('PENDING','SENDING');
          CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY, workspace TEXT NOT NULL, employee TEXT NOT NULL, kind TEXT NOT NULL, model TEXT NOT NULL,created TEXT NOT NULL,input INTEGER,output INTEGER,hit INTEGER,total INTEGER,status TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS usage_period ON usage(workspace,created,employee);
          CREATE TABLE IF NOT EXISTS ai_limits(dimension TEXT NOT NULL,subject TEXT NOT NULL,ceiling INTEGER,PRIMARY KEY(dimension,subject));
          CREATE TABLE IF NOT EXISTS account_profiles(userId TEXT PRIMARY KEY, displayName TEXT NOT NULL, avatar TEXT);
          CREATE TABLE IF NOT EXISTS platform_ai_audit(id INTEGER PRIMARY KEY,created TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,subject TEXT NOT NULL);`);
        if (!db.prepare("PRAGMA table_info(usage)").all().some(column => column.name === "payer")) {
          db.exec("ALTER TABLE usage ADD COLUMN payer TEXT NOT NULL DEFAULT 'LEGACY'");
        }
        const columns=db.prepare("PRAGMA table_info(usage)").all();
        for(const column of ["costE8","chargedUnits"]){
          if(!columns.some(row=>row.name===column))db.exec("ALTER TABLE usage ADD COLUMN "+column+" INTEGER");
        }
        db.exec("CREATE INDEX IF NOT EXISTS usage_platform_period ON usage(payer,created)");
        this.initialized = true;
      }
      return fn(db);
    } finally {
      db.close();
    }
  }
  transaction<T>(fn: (db: DatabaseSync) => T): T {
    return this.use((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const v = fn(db);
        db.exec("COMMIT");
        return v;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    });
  }
  spaces(userId: string, includeInactive = false) {
    return this.use(
      (db) =>
        db
          .prepare(
            "SELECT c.id,c.name,m.role,m.active,COALESCE(s.showName,1) AS showNameInCircle FROM company_members m JOIN companies c ON c.id=m.company LEFT JOIN company_circle_settings s ON s.company=c.id WHERE m.userId=? AND (m.active=1 OR ?) AND c.status='APPROVED'",
          )
          .all(userId, Number(includeInactive)) as unknown as Space[],
    );
  }
  accountProfiles(accounts: string[]) {
    if (!accounts.length) return new Map<string, { displayName: string; avatar: string | null }>();
    return this.use(db => new Map(db.prepare(
      `SELECT userId,displayName,avatar FROM account_profiles WHERE userId IN (${accounts.map(() => "?").join(",")})`,
    ).all(...accounts).map(row => [String(row.userId), {
      displayName: String(row.displayName),
      avatar: typeof row.avatar === "string" ? row.avatar : null,
    }])));
  }
  member(company: string, userId: string) {
    if (!isCompany(company)) return undefined;
    return this.use(
      (db) =>
        db
          .prepare(
            "SELECT m.userId,m.role,m.active,m.accessVersion FROM company_members m JOIN companies c ON c.id=m.company WHERE m.company=? AND m.userId=? AND c.status='APPROVED'",
          )
          .get(company, userId) as unknown as Member | undefined,
    );
  }
  managerTarget(scope: Scope, target: string) {
    const actor = this.member(scope.currentWorkspaceId, scope.userId);
    const subject = this.member(scope.currentWorkspaceId, target);
    return (
      !!actor?.active && !!subject && (actor.role === "OWNER" || (actor.role === "ADMIN" && subject.role === "MEMBER"))
    );
  }
  beginUsage(scope: Scope, kind: string, model: string) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const [from, until] = usageMonth();
    this.transaction(db => {
      const limits = db.prepare("SELECT dimension,subject,ceiling FROM ai_limits WHERE (dimension='account' AND subject=?) OR (dimension='company' AND subject=?)").all(scope.userId,scope.currentWorkspaceId);
      for (const limit of limits) {
        const field = limit.dimension === "account" ? "employee" : "workspace";
        const used = db.prepare("SELECT COALESCE(SUM(total),0) AS n FROM usage WHERE payer='PLATFORM' AND created>=? AND created<? AND "+field+"=?").get(from,until,limit.subject);
        if (Number(used?.n) >= Number(limit.ceiling)) throw new Error("本月平台 AI 用量已达到限额，请联系平台管理员。");
      }
      db.prepare("INSERT INTO usage(id,workspace,employee,kind,model,created,status,payer) VALUES(?,?,?,?,?,?,'UNKNOWN','PLATFORM')")
        .run(id, scope.currentWorkspaceId, scope.userId, kind, model, now);
    });
    return id;
  }
  finishUsage(id: string, model: string, raw: unknown, rejected = false, costE8:number|null=null) {
    const fields = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const number = (name: string) =>
      typeof fields[name] === "number" && Number.isSafeInteger(fields[name]) && Number(fields[name]) >= 0
        ? Number(fields[name])
        : null;
    const input = number("prompt_tokens"),
      output = number("completion_tokens"),
      hit = number("prompt_cache_hit_tokens");
    const total = number("total_tokens") ?? (input !== null && output !== null ? input + output : null);
    this.use((db) =>
      db
        .prepare("UPDATE usage SET model=?,input=?,output=?,hit=?,total=?,status=?,costE8=? WHERE id=?")
        .run(model, input, output, hit, total, rejected ? "REJECTED" : total === null ? "UNKNOWN" : "REPORTED", costE8,id),
    );
  }
}

export function usageMonth(value = new Date(Date.now() + 8 * 3600000).toISOString().slice(0,7)): [string,string] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error("月份无效。");
  const [year, month] = value.split("-").map(Number);
  return [new Date(value+"-01T00:00:00+08:00").toISOString(), new Date(Date.UTC(year,month,1)-8*3600000).toISOString()];
}

function proof(value: unknown) {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(text(value));
  if (!match || match[2].length > 4 * 1024 * 1024) throw new Problem(400, "请上传 3 MB 以内的 JPG 或 PNG 认证材料。");
  const bytes = Buffer.from(match[2], "base64");
  const signature = match[1] === "image/png" ? "89504e470d0a1a0a" : "ffd8ff";
  requireThat(bytes.subarray(0, signature.length / 2).toString("hex") === signature, 400, "认证材料格式无效。");
  return { mime: match[1], bytes };
}
async function sendInvite(email: string, company: string, code: string) {
  const key = process.env.RESEND_API_KEY,
    from = process.env.ENTERPRISE_MAIL_FROM;
  requireThat(key && from, 503, "企业邀请邮箱尚未配置，请联系平台配置发件服务，或使用手机号邀请。");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(12000),
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "货记企业邀请",
      text:
        company +
        " 邀请你加入企业空间。请在货记登录你自己的账号，进入企业版，输入邀请码 " +
        code +
        "。邀请在 7 天后失效。",
    }),
  });
  requireThat(response.ok, 502, "邀请邮件发送失败，请检查发件服务后重试。");
}

export function enterpriseRouter(
  store: EnterpriseStore,
  deps: {
    session: (header: unknown) => Scope | null;
    user: (id: string) => User | undefined;
    switchSpace: (scope: Scope, workspace: string) => unknown;
    personal: (id: string) => string;
    onCircleVisibilityChanged?: () => void;
  },
) {
  const r = express.Router();
  const reviewer = (id: string) =>
    (process.env.ENTERPRISE_REVIEWER_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .includes(id) ||
    (process.env.NODE_ENV === "test" && process.env.RPA_LOCAL_CONTROL === "1" &&
      (process.env.HUOJI_LOCAL_REVIEWER_PHONES || "").split(",").some(phone => !!phone && phone === deps.user(id)?.phone));
  const manage = (scope: Scope, ownerOnly = false) => {
    const member = store.member(scope.currentWorkspaceId, scope.userId);
    requireThat(
      member?.active && (member.role === "OWNER" || (!ownerOnly && member.role === "ADMIN")),
      403,
      "当前账号无此企业管理权限。",
    );
  };
  const run =
    (fn: (req: express.Request, s: Scope, res: express.Response) => unknown) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      Promise.resolve()
        .then(() => fn(req, res.locals.scope, res))
        .then((value) => {
          if (!res.headersSent) res.json(value ?? { ok: true });
        })
        .catch(next);
    };
  r.use((req, res, next) => {
    const s = deps.session(req.headers.authorization);
    res.set("Cache-Control", "private, no-store");
    if (!s) {
      res.status(401).json({ error: "请先登录。" });
      return;
    }
    res.locals.scope = s;
    next();
  });
  const applicationFields = "id,name,credit,domain,status,reason,created,reviewed";
  r.get(
    "/",
    run((_req, s) => {
      const phone = deps.user(s.userId)!.phone,
        company = s.currentWorkspaceId,
        actor = store.member(company, s.userId);
      return store.use((db) => ({
        companies: db
          .prepare(
            "SELECT c.id,c.name,m.role,COALESCE(s.showName,1) AS showNameInCircle FROM company_members m JOIN companies c ON c.id=m.company LEFT JOIN company_circle_settings s ON s.company=c.id WHERE m.userId=? AND m.active=1 AND c.status='APPROVED' ORDER BY c.name",
          )
          .all(s.userId),
        applications: db
          .prepare("SELECT " + applicationFields + " FROM companies WHERE applicant=? ORDER BY created DESC")
          .all(s.userId),
        offers: db
          .prepare(
            "SELECT i.id,c.name,i.role FROM invites i JOIN companies c ON c.id=i.company WHERE channel='phone' AND target=? AND state='PENDING' AND expires>?",
          )
          .all(phone, Date.now()),
        reviewer: reviewer(s.userId),
        reviewQueue: reviewer(s.userId)
          ? db
              .prepare(
                "SELECT " +
                  applicationFields +
                  ",applicant FROM companies WHERE status='PENDING' AND applicant<>? ORDER BY created",
              )
              .all(s.userId)
              .map((a) => ({ ...a, applicantPhone: deps.user(String(a.applicant))?.phone }))
          : [],
        members:
          actor && actor.role !== "MEMBER"
            ? db
                .prepare(
                  "SELECT userId,role,active FROM company_members WHERE company=? ORDER BY active DESC,role,userId",
                )
                .all(company)
                .map((m) => ({ ...m, name: deps.user(String(m.userId))?.displayName || "成员" }))
            : [],
        invitations:
          actor?.role === "OWNER"
            ? db
                .prepare(
                  "SELECT id,channel,target,role,expires FROM invites WHERE company=? AND state IN ('PENDING','SENDING') AND expires>? ORDER BY expires DESC",
                )
                .all(company, Date.now())
            : [],
      }));
    }),
  );
  r.patch("/circle-settings", run((req, scope) => {
    manage(scope);
    const showName = req.body?.showName;
    requireThat(typeof showName === "boolean", 400, "请选择是否在广场展示企业名称。");
    const changed = store.use(db => db.prepare(
      `INSERT INTO company_circle_settings(company, showName) VALUES (?, ?)
       ON CONFLICT(company) DO UPDATE SET showName=excluded.showName
       WHERE company_circle_settings.showName<>excluded.showName`,
    ).run(scope.currentWorkspaceId, Number(showName)).changes);
    if (changed) deps.onCircleVisibilityChanged?.();
    return { showName };
  }));
  r.post(
    "/applications",
    run((req, s) => {
      const name = text(req.body.name),
        credit = text(req.body.credit).toUpperCase(),
        domain = text(req.body.domain).toLowerCase(),
        file = proof(req.body.evidence);
      requireThat(
        name.length >= 2 && name.length <= 100 && /^[0-9A-HJ-NPQRTUWXY]{18}$/.test(credit),
        400,
        "请填写企业全称和 18 位统一社会信用代码。",
      );
      requireThat(
        !domain || (domain.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)),
        400,
        "请填写企业自有邮箱域名。",
      );
      return store.transaction((db) => {
        requireThat(
          !db.prepare("SELECT 1 FROM companies WHERE credit=? AND status IN ('PENDING','APPROVED')").get(credit),
          409,
          "该企业已提交认证或已认证。",
        );
        db.prepare(
          "INSERT INTO companies(id,name,credit,domain,applicant,status,evidence,mime,created) VALUES(?,?,?,?,?,'PENDING',?,?,?)",
        ).run("ent_" + randomUUID(), name, credit, domain, s.userId, file.bytes, file.mime, new Date().toISOString());
      });
    }),
  );
  r.get(
    "/applications/:id/evidence",
    run((req, s, res) => {
      const row = store.use((db) =>
        db.prepare("SELECT applicant,mime,evidence FROM companies WHERE id=?").get(String(req.params.id)),
      );
      requireThat(row && (row.applicant === s.userId || reviewer(s.userId)), 404, "材料不存在。");
      res
        .set("X-Content-Type-Options", "nosniff")
        .type(String(row!.mime))
        .send(Buffer.from(row!.evidence as Uint8Array));
    }),
  );
  r.post(
    "/applications/:id/review",
    run((req, s) => {
      requireThat(reviewer(s.userId), 403, "仅平台审核人员可审核企业。");
      const status = req.body.approve === true ? "APPROVED" : "REJECTED",
        reason = text(req.body.reason);
      requireThat(
        typeof req.body.approve === "boolean" && reason.length <= 500 && (status === "APPROVED" || reason.length > 0),
        400,
        "请填写审核结论，驳回时须说明原因。",
      );
      return store.transaction((db) => {
        const id = String(req.params.id),
          row = db.prepare("SELECT applicant,status FROM companies WHERE id=?").get(id);
        requireThat(row?.status === "PENDING", 409, "申请已处理或不存在。");
        requireThat(row!.applicant !== s.userId, 403, "申请须由其他审核员审核。");
        db.prepare("UPDATE companies SET status=?,reason=?,reviewer=?,reviewed=? WHERE id=?").run(
          status,
          reason,
          s.userId,
          new Date().toISOString(),
          id,
        );
        if (status === "APPROVED")
          db.prepare("INSERT INTO company_members(company,userId,role,active) VALUES(?,?,'OWNER',1)").run(id, row!.applicant);
      });
    }),
  );
  r.post(
    "/switch",
    run((req, s) => {
      const id = text(req.body.workspaceId);
      requireThat(id === deps.personal(s.userId) || store.member(id, s.userId)?.active, 403, "无权进入该空间。");
      return deps.switchSpace(s, id);
    }),
  );
  r.post(
    "/invites",
    run(async (req, s) => {
      manage(s, true);
      const channel = text(req.body.channel),
        target = text(req.body.target).toLowerCase(),
        role = text(req.body.role);
      requireThat(
        ["ADMIN", "MEMBER"].includes(role) &&
          (channel === "phone"
            ? /^1[3-9]\d{9}$/.test(target)
            : channel === "email" && target.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)),
        400,
        "请选择角色并填写有效的手机号或企业邮箱。",
      );
      const code = randomBytes(16).toString("hex"),
        id = randomUUID(),
        time = Date.now(),
        company = s.currentWorkspaceId;
      const name = store.transaction((db) => {
        const record = db.prepare("SELECT name,domain FROM companies WHERE id=?").get(company)!;
        if (channel === "email" && record.domain)
          requireThat(target.split("@")[1] === record.domain, 400, "请使用企业认证时登记的邮箱域名。");
        db.prepare("UPDATE invites SET state='EXPIRED' WHERE company=? AND expires<=?").run(company, time);
        requireThat(
          !db
            .prepare("SELECT 1 FROM invites WHERE company=? AND target=? AND state IN ('PENDING','SENDING')")
            .get(company, target),
          409,
          "该成员已有有效邀请。",
        );
        if (channel === "phone")
          requireThat(
            !db
              .prepare("SELECT userId FROM company_members WHERE company=? AND active=1")
              .all(company)
              .some((m) => deps.user(String(m.userId))?.phone === target),
            409,
            "此手机号已加入企业。",
          );
        db.prepare("INSERT INTO invites VALUES(?,?,?,?,?,?,?,?)").run(
          id,
          company,
          channel,
          target,
          role,
          digest(code),
          time + 7 * 86400000,
          channel === "email" ? "SENDING" : "PENDING",
        );
        return String(record.name);
      });
      if (channel === "email") {
        try {
          await sendInvite(target, name, code);
          store.use((db) => db.prepare("UPDATE invites SET state='PENDING' WHERE id=? AND state='SENDING'").run(id));
        } catch (e) {
          store.use((db) => db.prepare("UPDATE invites SET state='FAILED' WHERE id=? AND state='SENDING'").run(id));
          throw e;
        }
      }
      return { ok: true };
    }),
  );
  r.delete(
    "/invites/:id",
    run((req, s) => {
      manage(s, true);
      store.use((db) =>
        db
          .prepare("UPDATE invites SET state='REVOKED' WHERE id=? AND company=? AND state IN ('PENDING','SENDING')")
          .run(String(req.params.id), s.currentWorkspaceId),
      );
    }),
  );
  r.post(
    "/join",
    run((req, s) =>
      store.transaction((db) => {
        const id = text(req.body.id),
          code = text(req.body.code);
        const invite = id
          ? db
              .prepare("SELECT * FROM invites WHERE id=? AND channel='phone' AND target=?")
              .get(id, deps.user(s.userId)!.phone)
          : db.prepare("SELECT * FROM invites WHERE channel='email' AND secret=?").get(digest(code));
        requireThat(
          invite?.state === "PENDING" && Number(invite.expires) > Date.now(),
          404,
          "找不到有效邀请，请核对账号或邀请码。",
        );
        requireThat(
          !db
            .prepare("SELECT 1 FROM company_members WHERE company=? AND userId=? AND active=1")
            .get(invite!.company, s.userId),
          409,
          "你已加入该企业。",
        );
        db.prepare(
          "INSERT INTO company_members(company,userId,role,active) VALUES(?,?,?,1) ON CONFLICT(company,userId) DO UPDATE SET role=excluded.role,active=1",
        ).run(invite!.company, s.userId, invite!.role);
        db.prepare("UPDATE invites SET state='ACCEPTED' WHERE id=?").run(invite!.id);
      }),
    ),
  );
  r.patch(
    "/members/:id",
    run((req, s) => {
      manage(s, true);
      const id = String(req.params.id),
        role = text(req.body.role);
      requireThat(["ADMIN", "MEMBER", "DISABLED"].includes(role), 400, "成员角色无效。");
      const result = store.use((db) =>
        db
          .prepare(
            "UPDATE company_members SET role=CASE WHEN ?='DISABLED' THEN role ELSE ? END,accessVersion=accessVersion+(?='DISABLED'),active=CASE WHEN ?='DISABLED' THEN 0 ELSE 1 END WHERE company=? AND userId=? AND role<>'OWNER' AND active=1",
          )
          .run(role, role, role, role, s.currentWorkspaceId, id),
      );
      requireThat(result.changes === 1, 409, "成员不可调整。");
    }),
  );
  r.get(
    "/usage",
    run((req, s) => {
      const month = text(req.query.month) || new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
      requireThat(/^\d{4}-(0[1-9]|1[0-2])$/.test(month), 400, "月份无效。");
      const start = new Date(month + "-01T00:00:00+08:00");
      const [year, m] = month.split("-").map(Number);
      const until = new Date(Date.UTC(year, m, 1) - 8 * 3600000).toISOString();
      const role = store.member(s.currentWorkspaceId, s.userId)?.role;
      const own = req.query.mine === "1" || (role !== "OWNER" && role !== "ADMIN");
      const filter = " FROM usage WHERE workspace=? AND created>=? AND created<?" + (own ? " AND employee=?" : "") + (req.query.kind === "CAPTURE" ? " AND kind='CAPTURE'" : "");
      const params = [s.currentWorkspaceId, start.toISOString(), until, ...(own ? [s.userId] : [])];
      if (req.query.detail === "1") {
        const page = Number(req.query.page ?? 1);
        requireThat(Number.isSafeInteger(page) && page >= 1 && page <= 100000, 400, "页码无效。");
        const rows = store.use((db) =>
          db
            .prepare(
              "SELECT id,created,model,kind,employee,input,output,total,status" +
                filter +
                " ORDER BY created DESC,id DESC LIMIT 21 OFFSET ?",
            )
            .all(...params, (page - 1) * 20),
        );
        return {
          more: rows.length > 20,
          rows: rows.slice(0, 20).map((r) => ({ ...r, name: deps.user(String(r.employee))?.displayName || "成员" })),
        };
      }
      const rows = store.use((db) =>
        db
          .prepare(
            "SELECT employee,kind,SUM(COALESCE(input,0)) input,SUM(COALESCE(output,0)) output,SUM(COALESCE(hit,0)) hit,SUM(COALESCE(total,0)) total,COUNT(*) calls,SUM(status='UNKNOWN') unknown,SUM(status='REJECTED') rejected" +
              filter +
              " GROUP BY employee,kind ORDER BY total DESC",
          )
          .all(...params),
      );
      return { month, rows: rows.map((r) => ({ ...r, name: deps.user(String(r.employee))?.displayName || "成员" })) };
    }),
  );
  r.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
    res
      .status(error instanceof Problem ? error.status : 503)
      .json({ error: error instanceof Problem ? error.message : "企业服务暂时不可用，请稍后重试。" }),
  );
  return r;
}
