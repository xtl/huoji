import express from "express";
import path from "node:path";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { LocalBackfillController, createLocalBackfillRouter } from "./rpa-local-control";
import type { RpaSession } from "./rpa";

export function createCloudGateway(opts: {
  service: string;
  origin: string;
  runtime: string;
  data: string;
  testLoopback?: boolean;
}) {
  const service = new URL(opts.service);
  if (
    (service.protocol !== "https:" &&
      !(opts.testLoopback && service.protocol === "http:" && service.hostname === "127.0.0.1")) ||
    service.username ||
    service.password ||
    service.href !== service.origin + "/"
  )
    throw new Error("云端地址须是受信任的 HTTPS 站点。");
  type Binding = { session: RpaSession; groups: string[]; checked: number; accessed: number };
  const bindings = new Map<string, Binding>();
  const scopeKey = (s: RpaSession) => JSON.stringify([s.userId, s.currentWorkspaceId]);
  const scopes = new Map<string, string[]>();
  let compatibleUntil = 0;
  async function compatible() {
    if (Date.now() < compatibleUntil) return;
    const res = await fetch(service.origin + "/api/cloud/capabilities", {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    const data = res.ok ? await res.json() : null;
    if (
      data?.service !== "huoji" ||
      data.syncVersion !== 1 ||
      data.aiBilling !== "platform" ||
      data.loginReady !== true
    )
      throw Error("云端尚未开通");
    compatibleUntil = Date.now() + 30000;
  }
  async function validate(auth: string, background = false) {
    const res = await fetch(service.origin + "/api/rpa/config", {
      headers: { Authorization: auth },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      bindings.delete(auth);
      return null;
    }
    const cfg = await res.json(),
      expiresAt = Date.parse(cfg.sessionExpiresAt);
    if (
      !cfg.success ||
      !cfg.scope?.userId ||
      !cfg.scope.workspaceId ||
      !Array.isArray(cfg.allowedGroups) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      bindings.delete(auth);
      return null;
    }
    const session = { userId: cfg.scope.userId, currentWorkspaceId: cfg.scope.workspaceId, expiresAt };
    const accessed = background ? bindings.get(auth)?.accessed ?? Date.now() : Date.now();
    const entry = { session, groups: cfg.allowedGroups, checked: Date.now(), accessed };
    bindings.set(auth, entry);
    scopes.set(scopeKey(session), entry.groups);
    return entry;
  }
  function readSession(auth: unknown) {
    const entry = bindings.get(String(auth));
    if (!entry || entry.session.expiresAt <= Date.now() || Date.now() - entry.checked > 60000) return null;
    entry.accessed = Date.now();
    return entry.session;
  }
  const controller = new LocalBackfillController({
    repositoryDirectory: opts.data,
    runtime: opts.runtime,
    localOrigin: opts.origin,
    uploadOrigin: service.origin,
    readSession,
    enabledGroups: (s) => scopes.get(scopeKey(s)) ?? [],
  });
  const timer = setInterval(() => {
    for (const [auth, entry] of bindings) {
      if (entry.session.expiresAt <= Date.now() || Date.now() - entry.accessed > 90000) {
        bindings.delete(auth);
        continue;
      }
      if (Date.now() - entry.checked < 18000) continue;
      void validate(auth, true)
        .then((next) => {
          if (next) {
            controller.syncGroups(next.session, next.groups);
          }
        })
        .catch(() => {});
    }
  }, 20000);
  timer.unref();
  const site = express();
  site.use((req, res, next) => {
    if (req.headers.host !== new URL(opts.origin).host) {
      res.sendStatus(403);
      return;
    }
    if (req.path === "/api/assistant/presence" && req.headers.origin === service.origin) {
      res.vary("Origin");
      res.set("Cache-Control", "no-store");
      if (req.method === "OPTIONS" && req.get("Access-Control-Request-Method") === "GET") {
        res.set({
          "Access-Control-Allow-Origin": service.origin,
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Private-Network": "true",
        }).sendStatus(204);
        return;
      }
      if (req.method === "GET") {
        res.set("Access-Control-Allow-Origin", service.origin).json({ assistant: "huoji-cloud", protocol: 1 });
        return;
      }
      res.sendStatus(405);
      return;
    }
    if (req.headers.origin && req.headers.origin !== opts.origin) {
      res.sendStatus(403);
      return;
    }
    next();
  });
  site.use("/api/local-cloud", (_req, res) => res.json({ origin: service.origin }));
  site.use("/api/platform", (_req, res) => res.status(403).json({ error: "请直接在云端货记网站打开平台后台。" }));
  site.use("/api", async (_req, res, next) => {
    try {
      await compatible();
      next();
    } catch {
      res.status(503).json({ error: "未能连接货记云同步服务，请检查 HTTPS、云版服务和短信登录是否已开通。" });
    }
  });
  site.use(
    "/api/rpa/local",
    express.json({ limit: "16kb" }),
    async (req, res, next) => {
      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        res.sendStatus(401);
        return;
      }
      try {
        if (!(await validate(auth))) {
          res.status(401).json({ error: "云端登录已过期，请重新登录。" });
          return;
        }
        next();
      } catch {
        res.status(503).json({ error: "无法连接货记云端，请检查网络。已排队的消息保存在本机。" });
      }
    },
    createLocalBackfillRouter({ enabled: true, controller, readSession, localOrigin: opts.origin }),
  );
  site.use("/api", (req, res) => {
    const headers: Record<string, string> = {};
    for (const name of ["authorization", "content-type", "accept", "last-event-id"]) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    // Fixed upstream and path. Business data, commercial sessions and AI all live there.
    const forward = (service.protocol === "https:" ? httpsRequest : httpRequest)(
      {
        hostname: service.hostname,
        port: service.port || undefined,
        path: req.originalUrl,
        method: req.method,
        headers,
        timeout: 100000,
      },
      (up) => {
        if (up.statusCode && up.statusCode >= 300 && up.statusCode < 400) {
          up.resume();
          res.status(502).json({ error: "云端地址发生跳转，请检查服务配置。" });
          return;
        }
        res.status(up.statusCode ?? 502);
        for (const name of ["content-type", "cache-control", "retry-after"])
          if (up.headers[name]) res.set(name, String(up.headers[name]));
        up.on("error", () => res.destroy());
        up.pipe(res);
      },
    );
    forward.on("timeout", () => forward.destroy());
    forward.on("error", () => {
      if (!res.headersSent) res.status(503).json({ error: "货记云端暂时无法连接。" });
      else res.destroy();
    });
    res.on("close", () => {
      if (!res.writableEnded) forward.destroy();
    });
    req.pipe(forward);
  });
  site.use(express.static(path.join(opts.runtime, "web")));
  site.get(/.*/, (_req, res) => res.sendFile(path.join(opts.runtime, "web/index.html")));
  return {
    site,
    stop() {
      clearInterval(timer);
      controller.stopRealtime();
    },
  };
}
