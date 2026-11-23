import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createCloudGateway } from "./rpa-cloud-gateway";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return "http://127.0.0.1:" + (server.address() as AddressInfo).port;
}

test("desktop binds to the central account, syncs selected group messages and shares inventory between logins", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "huoji-cloud-sync-"));
  const env = {
    ...process.env,
    NODE_ENV: "test",
    HUOJI_CLOUD: "1",
    SMS_PROVIDER: "mock",
    SMS_UNIVERSAL_CODE: "",
    RPA_LOCAL_CONTROL: "0",
    AI_PROVIDER: "mock",
    AUTH_STATE_FILE: path.join(dir, "identity.json"),
    RPA_MESSAGES_FILE: path.join(dir, "messages.json"),
    PAYMENT_ORDERS_FILE: path.join(dir, "payments.json"),
  };
  // Run the cloud as an independent process, including its own database handles.
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      [
        'import {app} from "./server.ts";',
        'const server=app.listen(0,"127.0.0.1",()=>process.send(server.address().port));',
        'process.on("message",()=>{server.closeAllConnections();server.close(()=>process.exit(0));});',
      ].join("\n"),
    ],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), env, stdio: ["ignore", "ignore", "inherit", "ipc"] },
  );
  const ended = once(child, "exit");
  const [port] = await Promise.race([
    once(child, "message"),
    ended.then(() => {
      throw Error("测试云服务启动失败");
    }),
  ]);
  const centralStop = async () => {
    if (child.connected) child.send("stop");
    await ended;
  };
  const desktop = createServer();
  const service = "http://127.0.0.1:" + port,
    origin = await listen(desktop);
  for (const file of ["python/python.exe", "collector/collector.py"]) {
    const dest = path.join(dir, "runtime", file);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, "");
  }
  const opts = { origin, service, runtime: path.join(dir, "runtime"), data: path.join(dir, "assistant") };
  assert.throws(() => createCloudGateway(opts), /HTTPS/);
  const gateway = createCloudGateway({ ...opts, testLoopback: true });
  desktop.on("request", gateway.site);
  t.after(async () => {
    gateway.stop();
    desktop.closeAllConnections();
    await new Promise<void>((resolve) => desktop.close(() => resolve()));
    await centralStop();
    rmSync(dir, { force: true, recursive: true });
  });
  async function api(base: string, route: string, token = "", body?: unknown, expected = 200) {
    const res = await fetch(base + "/api/" + route, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(res.status, expected, route);
    return res.json();
  }
  async function login(base: string, phone: string) {
    const challenge = await api(base, "auth/sms/request", "", { phone });
    return api(base, "auth/sms/login", "", { phone, code: challenge.debugCode });
  }
  const first = await login(origin, "13800009911");
  // A separate login obtains its own session while keeping the same account.
  const second = await login(service, "13800009911");
  assert.notEqual(first.token, second.token);
  const other = await login(service, "13800009912");
  const group = "同步验收群";
  assert.deepEqual((await api(origin, "rpa/config", first.token)).allowedGroups, []);
  await api(origin, "rpa/groups/selection", first.token, { previous: [], selected: [group] });
  await api(origin, "rpa/local/connection", first.token, {});
  const profiles = path.join(opts.data, "apps/wechat-rpa/.data/connections");
  const configFile = path.join(profiles, readdirSync(profiles)[0], "connection.json");
  const cfg = JSON.parse(readFileSync(configFile, "utf8"));
  assert.equal(cfg.apiBaseUrl, service);
  assert.deepEqual(cfg.groups, [group]);
  assert.equal(cfg.scope.userId, first.user.id);
  const msg = {
    messageId: "a1",
    chatName: group,
    sender: "测试",
    text: "求购 64G 内存 20 条",
    sentAt: null,
    observedAt: new Date().toISOString(),
  };
  const workerDir = fileURLToPath(new URL("../../apps/wechat-rpa/", import.meta.url));
  async function upload(message: typeof msg, replay: boolean) {
    const script = [
      "import json, sys",
      "from pathlib import Path",
      "from collector import StateStore, load_config, state_file, upload_pending, post_batch",
      "cfg=load_config(Path(sys.argv[1]))",
      "msg=json.loads(sys.argv[2])",
      "store=StateStore(state_file(cfg))",
      "store.bind_scope(cfg)",
      "store.enqueue_history(msg['chatName'],[msg])",
      "result=upload_pending(store,cfg)",
      "if sys.argv[3]=='1': assert msg['messageId'] in post_batch(cfg,[msg])",
      "result['retained']=store.db.execute('SELECT COUNT(*) FROM outbox WHERE delivered_at IS NULL').fetchone()[0]",
      "store.db.close()",
      "print(json.dumps(result))",
    ].join("\n");
    const { stdout } = await promisify(execFile)(
      process.platform === "win32" ? "python" : "python3",
      ["-B", "-c", script, configFile, JSON.stringify(message), replay ? "1" : "0"],
      { cwd: workerDir, timeout: 30000 },
    );
    return JSON.parse(stdout);
  }
  assert.deepEqual(await upload(msg, true), { uploaded: 1, unacknowledged: 0, retained: 0 });
  assert.deepEqual(
    (await api(service, "rpa/messages", second.token)).items.map((x: { text: string }) => x.text),
    [msg.text],
  );
  assert.deepEqual((await api(service, "rpa/messages", other.token)).items, []);
  const row = { id: "fixture-stock", title: "同步验收货源", configItems: [] };
  await api(origin, "workspace/ledger", first.token, {
    operations: [{ id: randomUUID(), seed: false, keys: [], changes: [{ table: "stocks", action: "add", row }] }],
  });
  assert.equal((await api(service, "workspace/ledger", second.token)).snapshot.stocks[0].id, row.id);
  assert.deepEqual((await api(service, "workspace/ledger", other.token)).snapshot.stocks, []);
  await api(origin, "platform/usage", first.token, undefined, 403);
  assert.equal(
    (
      await fetch(origin + "/api/rpa/local/connection", {
        headers: { Origin: "https://other.invalid", Authorization: "Bearer " + first.token },
      })
    ).status,
    403,
  );
  await centralStop();
  await api(origin, "rpa/messages", first.token, undefined, 503);
  const offline = await upload({ ...msg, messageId: "a2" }, false);
  assert.equal(offline.uploaded, 0);
  assert.equal(offline.retained, 1);
});
