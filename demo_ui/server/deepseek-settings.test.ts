import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { DeepSeekKeyStore, DEEPSEEK_ORIGIN } from "./deepseek-settings";

const keyA = "sk-synthetic-test-alice";
const keyB = "sk-synthetic-test-bob";

test("encrypted credentials persist and cannot be transplanted between accounts", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "huoji-ds-store-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new DeepSeekKeyStore(dir);
  store.save("a", keyA);
  const first = fs.readdirSync(dir).find(name => name.endsWith(".json"))!;
  const sealed = fs.readFileSync(path.join(dir, first), "utf8");
  assert.equal(sealed.includes(keyA), false);
  assert.equal(new DeepSeekKeyStore(dir).get("a"), keyA);
  store.save("b", keyB);
  const second = fs.readdirSync(dir).find(name => name.endsWith(".json") && name !== first)!;
  fs.writeFileSync(path.join(dir, second), sealed);
  assert.throws(() => store.get("b"));
  assert.equal(store.get("a"), keyA);
  fs.unlinkSync(path.join(dir, "master.key"));
  assert.throws(() => store.save("a", keyB));
  assert.equal(fs.readFileSync(path.join(dir, first), "utf8"), sealed);
});

test("platform-only key management and redaction apply to interactive parsing and the inbox worker", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "huoji-ds-app-"));
  const previous = { ...process.env };
  const network = globalThis.fetch;
  const requests: { target: string; bearer: string }[] = [];
  Object.assign(process.env, {
    NODE_ENV: "test", AI_PROVIDER: "mock", SMS_UNIVERSAL_CODE: "test-code",
    AUTH_STATE_FILE: path.join(dir, "identity.json"), RPA_MESSAGES_FILE: path.join(dir, "messages.json"),
    PAYMENT_ORDERS_FILE: path.join(dir, "payments.json"), DEEPSEEK_BASE_URL: "https://untrusted.invalid",
    DEEPSEEK_API_KEY: "sk-synthetic-service-key",
    HUOJI_PLATFORM_ADMIN_PHONES: "13800001001", SMS_PROVIDER: "mock",
  });
  delete process.env.HUOJI_DEEPSEEK_MASTER_KEY;
  t.after(() => { globalThis.fetch = network; process.env = previous; fs.rmSync(dir, { recursive: true, force: true }); });
  const { app } = await import("../server");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = "http://127.0.0.1:" + address.port;
  const settings = "/api/platform/key";
  async function request(route: string, method = "GET", token?: string, body?: unknown) {
    return network(base + route, { method, headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json",
    }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  let failProvider = false;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    assert.ok([DEEPSEEK_ORIGIN + "/models", DEEPSEEK_ORIGIN + "/chat/completions"].includes(target));
    assert.equal(init?.redirect, "error");
    const bearer = new Headers(init?.headers).get("Authorization") ?? "";
    requests.push({ target, bearer });
    if (failProvider) return new Response(keyA, { status: 401 });
    if (target.endsWith("/models")) return Response.json({ data: [{ id: "deepseek-flash" }] });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [] }) } }] });
  };
  async function login(phone: string) {
    const res = await request("/api/auth/sms/login", "POST", undefined, { phone, code: "test-code" });
    assert.equal(res.status, 200);
    return (await res.json()).token as string;
  }
  const alice = await login("13800001001");
  const bob = await login("13800001002");
  assert.equal((await request(settings)).status, 401);
  assert.equal((await request(settings,"GET",alice)).status,401);
  const challenge=await (await request("/api/platform/auth/code","POST",undefined,{phone:"13800001001"})).json();
  const admin=(await (await request("/api/platform/auth/login","POST",undefined,{phone:"13800001001",code:challenge.debugCode})).json()).token;
  // fetch normalizes Host to the URL, so use the HTTP client to exercise a LAN-facing origin.
  const insecureStatus = await new Promise<number | undefined>((resolve, reject) => {
    http.get(base + settings, { headers: { host: "lan.example", authorization: "Bearer " + admin } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(insecureStatus, 403);
  assert.deepEqual(await (await request(settings, "GET", admin)).json(), { configured: false, updatedAt: null });
  const malformed = await network(base + settings, { method: "PUT", headers: {
    authorization: "Bearer " + admin, "content-type": "application/json",
  }, body: keyA });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.text()).includes(keyA), false);
  const saved = await request(settings, "PUT", admin, { apiKey: keyA });
  assert.deepEqual(Object.keys(await saved.json()).sort(), ["configured", "updatedAt"]);
  assert.equal(requests.length, 0);
  assert.equal((await (await request("/api/settings/deepseek", "GET", bob)).json()).managedBy,"PLATFORM");
  assert.equal((await request(settings + "/test", "POST", bob, {})).status, 401);
  assert.equal((await request(settings + "/test", "POST", admin, { apiKey: keyB })).status, 200);
  assert.equal(requests.at(-1)?.bearer, "Bearer " + keyB);
  assert.equal((await request(settings + "/test", "POST", admin, {})).status, 200);
  assert.equal(requests.at(-1)?.bearer, "Bearer " + keyA);
  const input = { text: "求购 64G 内存 200 条" };
  assert.equal((await (await request("/api/structure", "POST", alice, input)).json()).isMock, false);
  assert.equal(requests.at(-1)?.target, DEEPSEEK_ORIGIN + "/chat/completions");
  const callCount = requests.length;
  assert.equal((await (await request("/api/structure", "POST", undefined, input)).json()).isMock, true);
  assert.equal((await request("/api/structure", "POST", "expired", input)).status, 401);
  assert.equal(requests.length, callCount);
  assert.equal((await request(settings, "PUT", bob, { apiKey: keyB })).status, 401);
  await request("/api/structure", "POST", bob, input);
  assert.equal(requests.at(-1)?.bearer, "Bearer " + keyA);
  failProvider = true;
  const failed = await request(settings + "/test", "POST", admin, {});
  assert.equal(failed.status, 422);
  assert.equal((await failed.text()).includes(keyA), false);
  const message = { messageId: "fixture", chatName: "真实货源群", sender: "测试", sentAt: null,
    observedAt: new Date().toISOString(), text: "64G 内存 120条", userId: "untrusted" };
  assert.equal((await request("/api/rpa/messages", "POST", alice, { deviceId: "fixture", messages: [message] })).status, 202);
  let final: { status: string; error?: string } | undefined;
  for (let pass = 0; pass < 40; pass++) {
    const inbox = await (await request("/api/rpa/messages", "GET", alice)).json();
    final = inbox.items[0];
    if (final?.status === "FAILED") break;
    await pause(10);
  }
  assert.equal(final?.status, "FAILED");
  assert.equal(final?.error?.includes(keyA), false);
  assert.equal(requests.at(-1)?.bearer, "Bearer " + keyA);
  await request(settings, "DELETE", bob);
  assert.equal((await (await request(settings, "GET", admin)).json()).configured, true);
  await request(settings, "DELETE", admin);
  const local = await (await request("/api/structure", "POST", alice, input)).json();
  assert.equal(local.isMock, true);
  assert.equal(local.provider, "mock");
  assert.equal(local.error, undefined);
  assert.doesNotMatch(local.data.warnings.join(" "), /DEEPSEEK_API_KEY|本地离线解析|本地规则解析/);
  // Old per-user or environment keys cannot silently replace a removed platform key.
  process.env.AI_PROVIDER = "deepseek";
  process.env.DEEPSEEK_BASE_URL = DEEPSEEK_ORIGIN;
  failProvider = false;
  const beforeFallback = requests.length;
  assert.equal((await (await request("/api/structure", "POST", alice, input)).json()).isMock, true);
  assert.equal(requests.length, beforeFallback);
});
