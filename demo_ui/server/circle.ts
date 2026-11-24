import { Router, type Request, type Response } from "express";
import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { tencentDelivery } from "./circle-tencent";
import { businessRoles, type QuoteTerms } from "../src/circle-types";

type Actor = { userId: string; currentWorkspaceId: string; displayName: string };
class Problem extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function field(value: unknown, max: number, required = true) {
  if (value == null && !required) return "";
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim()))
    throw new Problem(400, "请检查必填内容和字数。");
  return value.trim();
}
function choice(value: unknown, options: readonly string[]) {
  if (!options.includes(String(value))) throw new Problem(400, "请选择有效的选项。");
  return String(value);
}
function key(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9-]{16,80}$/i.test(value))
    throw new Problem(400, "请刷新后重试。");
  return value;
}
const now = () => new Date().toISOString();
const notFound = () => new Problem(404, "这条记录不存在或无权访问。");
const maxPage = 30;
const idFor = (a: Pick<Actor, "userId" | "currentWorkspaceId">) =>
  "hj_" +
  createHash("sha256")
    .update(JSON.stringify([a.userId, a.currentWorkspaceId]))
    .digest("hex")
    .slice(0, 28);

export function createCircleRouter(
  file: string,
  authenticate: (bearer: unknown, res: import("express").Response) => Actor | null,
  cloud = tencentDelivery(),
  companiesForAccount: (userId: string) => Array<{ id: string; name: string }> = () => [],
  canParticipate: (workspaceId: string) => boolean = () => true,
) {
  const router = Router();
  let database: DatabaseSync | undefined;
  const events = new EventEmitter();
  events.setMaxListeners(0);
  function db() {
    if (database) return database;
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    const d = new DatabaseSync(file);
    d.exec(`
      PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS actors(id TEXT PRIMARY KEY, name TEXT NOT NULL, account TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revision(id TEXT PRIMARY KEY, n INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES actors(id), nonce TEXT NOT NULL,
        kind TEXT NOT NULL,title TEXT NOT NULL,quantity TEXT NOT NULL,city TEXT NOT NULL,mode TEXT NOT NULL,role TEXT NOT NULL,
        price TEXT NOT NULL,terms TEXT NOT NULL,publishedAt TEXT NOT NULL,expiresAt TEXT NOT NULL,confirmedAt TEXT NOT NULL,closed INTEGER DEFAULT 0,
        UNIQUE(owner,nonce));
      CREATE INDEX IF NOT EXISTS posts_date ON posts(publishedAt DESC,id DESC);
      CREATE INDEX IF NOT EXISTS posts_expiry ON posts(expiresAt) WHERE closed=0;
      CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY, post TEXT NOT NULL REFERENCES posts(id), sender TEXT NOT NULL REFERENCES actors(id),
        nonce TEXT NOT NULL,body TEXT NOT NULL,answer TEXT NOT NULL DEFAULT '',createdAt TEXT NOT NULL, UNIQUE(sender,nonce));
      CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY, post TEXT NOT NULL, a TEXT NOT NULL REFERENCES actors(id),b TEXT NOT NULL REFERENCES actors(id),
        status TEXT NOT NULL DEFAULT 'open', lastText TEXT NOT NULL DEFAULT '', updatedAt TEXT NOT NULL,readA INTEGER DEFAULT 0,readB INTEGER DEFAULT 0,
        UNIQUE(post,a,b));
      CREATE INDEX IF NOT EXISTS threads_a ON threads(a,updatedAt DESC);
      CREATE INDEX IF NOT EXISTS threads_b ON threads(b,updatedAt DESC);
      CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, thread TEXT NOT NULL REFERENCES threads(id), sender TEXT NOT NULL,nonce TEXT NOT NULL,
        kind TEXT NOT NULL,text TEXT NOT NULL,quote TEXT,version INTEGER NOT NULL DEFAULT 0,sentAt TEXT NOT NULL, UNIQUE(sender,nonce));
      CREATE INDEX IF NOT EXISTS conversation_history ON messages(thread,id);
      CREATE TABLE IF NOT EXISTS delivery(id INTEGER PRIMARY KEY REFERENCES messages(id), recipient TEXT NOT NULL, attempts INTEGER DEFAULT 0, due INTEGER DEFAULT 0);
    `);
    d.exec("BEGIN IMMEDIATE");
    try {
      const columns = d.prepare("PRAGMA table_info(posts)").all().map(column => column.name);
      if (!columns.includes("businessRole")) {
        d.exec("ALTER TABLE posts ADD COLUMN businessRole TEXT NOT NULL DEFAULT ''");
      }
      if (!columns.includes("companyName")) d.exec("ALTER TABLE posts ADD COLUMN companyName TEXT");
      d.exec("COMMIT");
    } catch (error) {
      d.exec("ROLLBACK");
      d.close();
      throw error;
    }
    database = d;
    return d;
  }
  function one(sql: string, ...bind: any[]) {
    return db()
      .prepare(sql)
      .get(...bind) as Record<string, any> | undefined;
  }
  function all(sql: string, ...bind: any[]) {
    return db()
      .prepare(sql)
      .all(...bind) as Record<string, any>[];
  }
  function run(sql: string, ...bind: any[]) {
    return db()
      .prepare(sql)
      .run(...bind);
  }
  function tx<T>(fn: () => T) {
    db().exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      db().exec("COMMIT");
      return value;
    } catch (error) {
      db().exec("ROLLBACK");
      throw error;
    }
  }
  function bump(...ids: string[]) {
    for (const id of new Set(ids))
      run("INSERT INTO revision VALUES (?,1) ON CONFLICT(id) DO UPDATE SET n=n+1", id);
  }
  function wake(...ids: string[]) {
    for (const id of new Set(ids)) events.emit(id);
  }
  let flushing = false;
  async function flush() {
    if (!cloud || flushing) return;
    flushing = true;
    try {
      const pending = all(
        "SELECT d.*,m.thread,m.sender FROM delivery d JOIN messages m ON m.id=d.id WHERE due<=? ORDER BY d.id LIMIT 40",
        Date.now(),
      );
      for (const item of pending) {
        try {
          await cloud.deliver(item.sender, item.recipient, item.thread, item.id);
          run("DELETE FROM delivery WHERE id=?", item.id);
        } catch {
          run(
            "UPDATE delivery SET attempts=attempts+1,due=? WHERE id=?",
            Date.now() + Math.min(300000, 2000 * 2 ** Math.min(8, item.attempts)),
            item.id,
          );
        }
      }
    } finally {
      flushing = false;
    }
  }
  const timer = cloud ? setInterval(() => void flush().catch(() => {}), 7000) : null;
  timer?.unref();
  router.use((req, res, next) => {
    const actor = authenticate(req.headers.authorization,res);
    if (!actor) {
      res.status(401).json({ error: "请重新登录货记。" });
      return;
    }
    const id = idFor(actor);
    run("INSERT OR IGNORE INTO actors(id,name,account) VALUES(?,?,?)", id, actor.displayName, actor.userId);
    res.locals.me = id;
    res.locals.actor = actor;
    res.set("Cache-Control", "private, no-store");
    next();
  });
  const postsSql =
    "SELECT p.id,p.owner,u.name author,u.account publisherAccount,p.companyName,p.kind,p.title,p.quantity,p.city,p.mode,p.role,p.businessRole,p.price,p.terms,p.publishedAt,p.expiresAt,p.confirmedAt,p.closed FROM posts p JOIN actors u ON u.id=p.owner";
  function publicPost(row: Record<string, any>, legacyNames = new Map<string, string>()) {
    const { publisherAccount, companyName, ...p } = row;
    if (companyName === null && !legacyNames.has(p.owner)) {
      const company = companiesForAccount(publisherAccount).find(space =>
        idFor({ userId: publisherAccount, currentWorkspaceId: space.id }) === p.owner,
      );
      legacyNames.set(p.owner, company?.name ?? "");
    }
    return { ...p, companyName: companyName ?? legacyNames.get(p.owner) ?? "", active: !p.closed && p.expiresAt > now() } as Record<string, any>;
  }
  function getPost(id: string) {
    const p = one(postsSql + " WHERE p.id=?", id);
    if (!p) throw notFound();
    return publicPost(p);
  }
  function own(id: string, me: string) {
    const p = getPost(id);
    if (p.owner !== me) throw notFound();
    return p;
  }
  function thread(id: string, me: string) {
    const t = one("SELECT * FROM threads WHERE id=? AND (a=? OR b=?)", id, me, me);
    if (!t) throw notFound();
    return t;
  }
  function signal(me: string) {
    const rev = (id: string) => one("SELECT n FROM revision WHERE id=?", id)?.n ?? 0;
    const unread = one(
      "SELECT COUNT(*) n FROM threads t JOIN messages m ON m.thread=t.id WHERE (t.a=? OR t.b=?) AND m.sender<>? AND m.id>CASE WHEN t.a=? THEN t.readA ELSE t.readB END",
      me,
      me,
      me,
      me,
    )!.n;
    const expiry =
      one("SELECT max(expiresAt) at FROM posts WHERE closed=0 AND expiresAt<=?", now())?.at ?? "";
    return {
      actor: me,
      name: one("SELECT name FROM actors WHERE id=?", me)!.name,
      revision: [rev("feed"), rev(me), expiry].join("."),
      unread,
    };
  }
  router.get("/sync", (req, res) => {
    const me = res.locals.me,
      state = signal(me);
    if (req.query.after !== state.revision) {
      res.json(state);
      return;
    }
    const finish = () => {
      cleanup();
      if (res.destroyed) return;
      const session = authenticate(req.headers.authorization,res);
      if (!session || idFor(session) !== me) {
        res.status(401).json({ error: "登录已过期。" });
        return;
      }
      res.json(signal(me));
    };
    const timeout = setTimeout(finish, 22000);
    const cleanup = () => {
      clearTimeout(timeout);
      events.off(me, finish);
      events.off("feed", finish);
      res.off("close", cleanup);
    };
    events.once(me, finish);
    events.once("feed", finish);
    res.once("close", cleanup);
  });
  const participationAllowed = (res: Response) => canParticipate((res.locals.actor as Actor).currentWorkspaceId);
  function requireParticipation(res: Response) {
    if (!participationAllowed(res)) throw new Problem(403, "开通个人会员后，可发布广场供需并与同行对话。");
  }
  router.get("/im", (_req, res) => res.json(
    cloud && participationAllowed(res) ? cloud.credentials(res.locals.me) : { appId: 0 },
  ));
  router.get("/posts", (req, res) => {
    const params: any[] = [],
      where: string[] = [];
    if (req.query.mine === "1") {
      where.push("p.owner=?");
      params.push(res.locals.me);
    } else {
      where.push("p.closed=0 AND p.expiresAt>?");
      params.push(now());
    }
    if (req.query.kind) {
      where.push("p.kind=?");
      params.push(choice(req.query.kind, ["供应", "求购"]));
    }
    if (req.query.scope) {
      const scope = choice(req.query.scope, ["rental", "sale"]);
      where.push(scope === "rental" ? "p.mode='租赁'" : "p.mode<>'租赁'");
    }
    if (req.query.q) {
      const q = field(req.query.q, 80);
      where.push("(instr(lower(p.title),lower(?)) OR instr(lower(p.city),lower(?)))");
      params.push(q, q);
    }
    const offset = Math.max(0, Math.min(1000000, Number(req.query.offset) || 0));
    const rows = all(
      postsSql + " WHERE " + where.join(" AND ") + " ORDER BY p.publishedAt DESC,p.id DESC LIMIT ? OFFSET ?",
      ...params,
      maxPage + 1,
      Math.floor(offset),
    );
    const legacyNames = new Map<string, string>();
    res.json({
      items: rows.slice(0, maxPage).map((p) => publicPost(p, legacyNames)),
      more: rows.length > maxPage,
    });
  });
  router.post("/posts", (req, res) => {
    requireParticipation(res);
    const me = res.locals.me,
      b = req.body ?? {},
      nonce = key(b.nonce);
    const existing = one("SELECT id FROM posts WHERE owner=? AND nonce=?", me, nonce);
    if (existing) {
      res.json(getPost(existing.id));
      return;
    }
    const kind = choice(b.kind, ["供应", "求购"]),
      role = choice(b.role, kind === "供应" ? ["自有货源", "受托供货"] : ["本人采购", "受托采购"]);
    const days = Number(b.days);
    if (![1, 3, 7].includes(days)) throw new Problem(400, "有效期可选择 1、3 或 7 天。");
    const id = randomUUID(),
      at = now(),
      until = new Date(Date.now() + days * 86400000).toISOString();
    const actor = res.locals.actor as Actor;
    const companyName = companiesForAccount(actor.userId).find(space => space.id === actor.currentWorkspaceId)?.name ?? "";
    tx(() => {
      if (b.displayName) run("UPDATE actors SET name=? WHERE id=?", field(b.displayName, 32), me);
      run(
        "INSERT INTO posts(id,owner,nonce,kind,title,quantity,city,mode,role,businessRole,price,terms,publishedAt,expiresAt,confirmedAt,companyName) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        me,
        nonce,
        kind,
        field(b.title, 90),
        field(b.quantity, 35),
        field(b.city, 45),
        choice(b.mode, ["现货", "期货", "租赁"]),
        role,
        b.businessRole == null || b.businessRole === "" ? "" : choice(b.businessRole, businessRoles),
        field(b.price, 70, false),
        field(b.terms, 450, false),
        at,
        until,
        at,
        companyName,
      );
      bump("feed");
    });
    wake("feed");
    res.status(201).json(getPost(id));
  });
  router.get("/posts/:id", (req, res) => {
    const post = getPost(req.params.id),
      me = res.locals.me;
    const questions = all(
      "SELECT q.id,u.name author,q.body,q.answer,q.createdAt FROM questions q JOIN actors u ON u.id=q.sender WHERE q.post=? ORDER BY q.id DESC",
      post.id,
    );
    const offers =
      post.owner === me
        ? all(
            `SELECT t.id threadId,u.name,m.quote,m.version,m.sentAt FROM threads t JOIN messages m ON m.id=(SELECT max(x.id) FROM messages x WHERE x.thread=t.id AND x.kind='quote' AND x.sender<>?) JOIN actors u ON u.id=m.sender WHERE t.post=? ORDER BY m.id DESC`,
            me,
            post.id,
          ).map((r) => ({ ...r, quote: JSON.parse(r.quote) }))
        : [];
    res.json({ post, questions, offers });
  });
  router.patch("/posts/:id", (req, res) => {
    const p = own(req.params.id, res.locals.me),
      cmd = choice(req.body?.action, ["close", "confirm", "quantity"]);
    if (cmd !== "close" && !p.active) throw new Problem(409, "该发布已结束或过期。");
    tx(() => {
      if (cmd === "close") run("UPDATE posts SET closed=1 WHERE id=?", p.id);
      else if (cmd === "quantity")
        run(
          "UPDATE posts SET quantity=?,confirmedAt=? WHERE id=?",
          field(req.body.quantity, 35),
          now(),
          p.id,
        );
      else run("UPDATE posts SET confirmedAt=? WHERE id=?", now(), p.id);
      bump("feed");
    });
    wake("feed");
    res.json(getPost(p.id));
  });
  router.post("/posts/:id/questions", (req, res) => {
    requireParticipation(res);
    const p = getPost(req.params.id),
      me = res.locals.me,
      b = req.body ?? {};
    if (!p.active) throw new Problem(409, "该帖已结束。");
    tx(() => {
      if (b.questionId) {
        if (p.owner !== me) throw notFound();
        if (
          !run(
            "UPDATE questions SET answer=? WHERE id=? AND post=?",
            field(b.body, 300),
            Number(b.questionId),
            p.id,
          ).changes
        )
          throw notFound();
      } else {
        if (p.owner === me) throw new Problem(400, "可以在同行的问题下直接答复。");
        run(
          "INSERT INTO questions(post,sender,nonce,body,createdAt) VALUES(?,?,?,?,?) ON CONFLICT(sender,nonce) DO NOTHING",
          p.id,
          me,
          key(b.nonce),
          field(b.body, 300),
          now(),
        );
      }
      bump("feed");
    });
    wake("feed");
    res.json({ ok: true });
  });
  const threadSql = `SELECT t.id,t.post postId,peer.id peer,peer.name,COALESCE(p.title,'同行私信') title,COALESCE(p.kind,'') kind,
    t.status,t.lastText,t.updatedAt,(SELECT count(*) FROM messages m WHERE m.thread=t.id AND m.sender<>? AND m.id>CASE WHEN t.a=? THEN t.readA ELSE t.readB END) unread
    FROM threads t JOIN actors peer ON peer.id=CASE WHEN t.a=? THEN t.b ELSE t.a END LEFT JOIN posts p ON p.id=t.post`;
  router.get("/threads", (req, res) => {
    const me = res.locals.me;
    res.json({
      items: all(threadSql + " WHERE t.a=? OR t.b=? ORDER BY t.updatedAt DESC,t.id", me, me, me, me, me),
    });
  });
  router.get("/threads/:id", (req, res) => {
    const me = res.locals.me,
      t = thread(req.params.id, me);
    const cursor = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const rows = all(
      "SELECT id,sender,kind,text,quote,version,sentAt FROM messages WHERE thread=? AND id<? ORDER BY id DESC LIMIT 51",
      t.id,
      cursor,
    );
    res.json({
      thread: one(threadSql + " WHERE t.id=?", me, me, me, t.id),
      more: rows.length > 50,
      items: rows
        .slice(0, 50)
        .reverse()
        .map((m) => ({ ...m, quote: m.quote ? JSON.parse(m.quote) : null })),
    });
  });
  router.post("/threads/:id/read", (req, res) => {
    const me = res.locals.me,
      t = thread(req.params.id, me),
      upto = Number(req.body?.id);
    if (!Number.isSafeInteger(upto) || !one("SELECT id FROM messages WHERE id=? AND thread=?", upto, t.id))
      throw new Problem(400, "无效的阅读位置。");
    const col = t.a === me ? "readA" : "readB";
    if (t[col] < upto) {
      tx(() => {
        run("UPDATE threads SET " + col + "=? WHERE id=? AND " + col + "<?", upto, t.id, upto);
        bump(me);
      });
      wake(me);
    }
    res.json({ ok: true });
  });
  router.post("/send", (req, res) => {
    requireParticipation(res);
    const me = res.locals.me,
      b = req.body ?? {},
      nonce = key(b.nonce);
    const previous = one("SELECT thread FROM messages WHERE sender=? AND nonce=?", me, nonce);
    if (previous) {
      res.json({ id: previous.thread });
      return;
    }
    let other = "";
    const id = tx(() => {
      let t;
      if (b.threadId) {
        t = thread(field(b.threadId, 64), me);
      } else {
        const ref = getPost(field(b.postId, 64)),
          post = b.direct === true ? "" : ref.id;
        if (post && !ref.active) throw new Problem(409, "该发布已结束，无法新建询价。");
        const peer = ref.owner;
        if (
          one("SELECT account FROM actors WHERE id=?", peer)?.account ===
          one("SELECT account FROM actors WHERE id=?", me)?.account
        )
          throw new Problem(400, "这是你自己的发布。");
        const [a, c] = [me, peer].sort();
        run(
          "INSERT INTO threads(id,post,a,b,updatedAt) VALUES(?,?,?,?,?) ON CONFLICT(post,a,b) DO NOTHING",
          randomUUID(),
          post,
          a,
          c,
          now(),
        );
        t = one("SELECT * FROM threads WHERE post=? AND a=? AND b=?", post, a, c)!;
      }
      other = t.a === me ? t.b : t.a;
      const kind = choice(b.kind, ["text", "quote", "status"]);
      let message = "",
        quote: QuoteTerms | null = null,
        version = 0;
      if (kind === "status") {
        if (t.status === "done") throw new Problem(409, "对接已结束。");
        run("UPDATE threads SET status='done' WHERE id=?", t.id);
        message = "已结束对接";
      } else {
        if (t.status === "done") throw new Problem(409, "对接已结束。");
        if (kind === "quote") {
          if (!t.post) throw new Problem(400, "请从供需帖发送报价。");
          const ref = getPost(t.post);
          if ((ref.kind === "供应" && ref.owner !== me) || (ref.kind === "求购" && ref.owner === me))
            throw new Problem(403, "报价由供货方发送。");
          if (!ref.active) throw new Problem(409, "该供需已结束，无法新增报价。");
          const q = b.quote ?? {};
          quote = {
            product: field(q.product, 90, false),
            quantity: field(q.quantity, 35),
            price: field(q.price, 45),
            tax: choice(q.tax, ["含税", "未税", "税另议"]),
            delivery: field(q.delivery, 65),
            validUntil: field(q.validUntil, 24),
          };
          const deadline = Date.parse(quote.validUntil + "T23:59:59.999+08:00");
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(quote.validUntil) ||
            !Number.isFinite(deadline) ||
            deadline < Date.now() ||
            new Date(deadline + 8 * 3600000).toISOString().slice(0, 10) !== quote.validUntil
          )
            throw new Problem(400, "请选择有效的报价截止日期。");
          version =
            1 +
            one("SELECT COALESCE(max(version),0) v FROM messages WHERE thread=? AND kind='quote'", t.id)!.v;
          message = "报价 V" + version + " · " + quote.price + " · " + quote.quantity;
        } else message = field(b.text, 2000);
      }
      const at = now();
      const mid = Number(
        run(
          "INSERT INTO messages(thread,sender,nonce,kind,text,quote,version,sentAt) VALUES(?,?,?,?,?,?,?,?)",
          t.id,
          me,
          nonce,
          kind,
          message,
          quote ? JSON.stringify(quote) : null,
          version,
          at,
        ).lastInsertRowid,
      );
      run("UPDATE threads SET updatedAt=?,lastText=? WHERE id=?", at, message.slice(0, 120), t.id);
      if (cloud) run("INSERT INTO delivery(id,recipient) VALUES(?,?)", mid, other);
      bump(me, other);
      return t.id;
    });
    wake(me, other);
    if (cloud) void flush().catch(() => {});
    res.json({ id });
  });
  router.use((error: Error, _req: Request, res: Response, _next: unknown) => {
    if (!(error instanceof Problem)) console.error("[同行广场] 操作失败", error.name);
    res
      .status(error instanceof Problem ? error.status : 500)
      .json({ error: error instanceof Problem ? error.message : "暂时无法保存或加载，请重试。" });
  });
  return router;
}
