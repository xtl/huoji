import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import express from "express";
import { readJsonSnapshot, writeAtomicJson } from "./rpa-persistence";

export const DEEPSEEK_ORIGIN = "https://api.deepseek.com";

class SettingsError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function validKey(input: unknown): string {
  const key = typeof input === "string" ? input.trim() : "";
  if (!/^sk-[A-Za-z0-9_-]{8,200}$/.test(key)) {
    throw new SettingsError(400, "请填写完整的 DeepSeek API Key（以 sk- 开头）。");
  }
  return key;
}

type SavedKey = { version: 1; updatedAt: string; iv: string; tag: string; ciphertext: string };

/** One encrypted file per user. Reading settings for a new account does not create files. */
export class DeepSeekKeyStore {
  constructor(private readonly directory: string, private readonly masterKey?: string) {}

  private file(userId: string): string {
    return path.join(this.directory, createHash("sha256").update(userId).digest("hex") + ".json");
  }

  private master(create: boolean): Buffer {
    if (this.masterKey) {
      if (!/^[A-Za-z0-9+/]{43}=$/.test(this.masterKey)) throw new Error("Invalid encryption configuration");
      return Buffer.from(this.masterKey, "base64");
    }
    const file = path.join(this.directory, "master.key");
    if (create && !fs.existsSync(file)) {
      fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      if (fs.readdirSync(this.directory).some(name => /^[a-f0-9]{64}\.json$/.test(name))) {
        throw new Error("Restore the original encryption key before saving credentials");
      }
      // Exclusive creation preserves the master if two processes initialize the directory.
      try { fs.writeFileSync(file, randomBytes(32), { flag: "wx", mode: 0o600, flush: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    const key = fs.readFileSync(file);
    if (key.length !== 32) throw new Error("Invalid encryption configuration");
    return key;
  }

  private read(userId: string): SavedKey | undefined {
    const record = readJsonSnapshot(this.file(userId)) as SavedKey | undefined;
    if (record === undefined) return undefined;
    if (record?.version !== 1 || typeof record.iv !== "string" || typeof record.tag !== "string" ||
      typeof record.ciphertext !== "string" || !Number.isFinite(Date.parse(record.updatedAt))) throw new Error("Invalid credential record");
    return record;
  }

  status(userId: string) {
    const row = this.read(userId);
    return { configured: Boolean(row), updatedAt: row?.updatedAt ?? null };
  }

  get(userId: string): string | undefined {
    const row = this.read(userId);
    if (!row) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", this.master(false), Buffer.from(row.iv, "base64"), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(JSON.stringify([userId, row.updatedAt])));
    decipher.setAuthTag(Buffer.from(row.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, "base64")), decipher.final()]).toString("utf8");
  }

  save(userId: string, input: unknown) {
    const key = validKey(input);
    const updatedAt = new Date().toISOString();
    const iv = randomBytes(12);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const cipher = createCipheriv("aes-256-gcm", this.master(true), iv);
    cipher.setAAD(Buffer.from(JSON.stringify([userId, updatedAt])));
    const ciphertext = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
    writeAtomicJson(this.file(userId), {
      version: 1, updatedAt, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"),
    } satisfies SavedKey);
    return { configured: true, updatedAt };
  }

  remove(userId: string) {
    try { fs.unlinkSync(this.file(userId)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return { configured: false, updatedAt: null };
  }
}

export function providerError(status: number): Error {
  if (status === 401 || status === 403) return new SettingsError(422, "DeepSeek 未接受该密钥，请核对密钥及其权限。");
  if (status === 402) return new SettingsError(422, "DeepSeek 账户余额不足，请检查余额。");
  if (status === 429) return new SettingsError(429, "DeepSeek 请求过于频繁，请稍后重试。");
  return new SettingsError(502, "DeepSeek 请求失败，请稍后重试。");
}

export function secureTransport(req: express.Request): boolean {
  if ((req.socket as import("node:tls").TLSSocket).encrypted) return true;
  const host = req.get("host")?.toLowerCase() ?? "";
  const peer = req.socket.remoteAddress?.replace(/^::ffff:/, "") ?? "";
  const loopback = peer === "::1" || /^127\./.test(peer);
  if (loopback && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return true;
  // The deployed Caddy service terminates TLS and is the web container's only published entry point.
  const privateProxy = loopback || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(peer);
  if (!privateProxy || req.get("x-forwarded-proto") !== "https") return false;
  try {
    const origin = new URL(process.env.APP_URL ?? "");
    return origin.protocol === "https:" && origin.host === host;
  } catch { return false; }
}

export function createDeepSeekSettingsRouter(store: DeepSeekKeyStore, readSession: (authorization: unknown) => { userId: string; readOnly?: boolean } | null) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const session = readSession(req.headers.authorization);
    if (!session) { res.status(401).json({ error: "请重新登录后配置 DeepSeek。" }); return; }
    if (!secureTransport(req)) { res.status(403).json({ error: "请通过 HTTPS 或本机 localhost 打开货记后配置密钥。" }); return; }
    if (session.readOnly && req.method !== "GET") {res.status(403).json({error:"企业密钥由企业主管理。"});return;}
    res.locals.userId = session.userId;
    next();
  });
  router.use(express.json({ limit: "2kb" }));
  router.get("/", (_req, res) => { res.json(store.status(res.locals.userId)); });
  router.put("/", (req, res) => { res.json(store.save(res.locals.userId, req.body?.apiKey)); });
  router.delete("/", (_req, res) => { res.json(store.remove(res.locals.userId)); });
  router.post("/test", async (req, res, next) => {
    try {
      const key = req.body?.apiKey === undefined ? store.get(res.locals.userId) : validKey(req.body.apiKey);
      if (!key) throw new SettingsError(400, "请先输入或保存密钥。");
      let response: Response;
      try {
        response = await fetch(DEEPSEEK_ORIGIN + "/models", {
          headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(10_000),
        });
      } catch { throw new SettingsError(502, "暂时无法连接 DeepSeek，请检查网络后重试。"); }
      if (!response.ok) { await response.body?.cancel(); throw providerError(response.status); }
      const result = await response.json().catch(() => null);
      if (!Array.isArray(result?.data) || !result.data.some((model: { id?: unknown } | null) => typeof model?.id === "string")) {
        throw new SettingsError(502, "DeepSeek 返回的模型列表无效，请稍后重试。");
      }
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  // Body-parser errors can contain submitted secrets. Never forward their text or attached body.
  router.use((error: Error & { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof SettingsError) res.status(error.status).json({ error: error.message });
    else if (error.type?.startsWith("entity.")) res.status(400).json({ error: "配置请求格式无效。" });
    else res.status(503).json({ error: "密钥存储暂时无法访问，请检查服务配置后重试。" });
  });
  return router;
}
