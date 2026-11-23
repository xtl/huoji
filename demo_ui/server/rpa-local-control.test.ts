import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess, spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import express from "express";
import { createLocalBackfillRouter, LocalBackfillController, type LocalBackfillJob } from "./rpa-local-control";
import { readJsonSnapshot, writeAtomicJson } from "./rpa-persistence";

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough(); stderr = new PassThrough(); pid = 32145; killed = 0;
  kill() { this.killed += 1; return true; }
  event(value: unknown) { this.stdout.write(JSON.stringify(value) + "\n"); }
  close(code: number | null) { this.emit("close", code); }
}
const alice = { userId: "local-user", currentWorkspaceId: "local-space", expiresAt: Date.now() + 3600_000 };
const bob = { userId: "other-user", currentWorkspaceId: "other-space", expiresAt: Date.now() + 3600_000 };
const aliceOtherSpace = { ...alice, currentWorkspaceId: "alice-other-space" };
const colleague = { ...bob, currentWorkspaceId: alice.currentWorkspaceId };
const expiredAlice = { ...alice, expiresAt: Date.now() - 1000 };
const GROUPS = ["B300真实交易群", "真实货源群"];
const PROFILE = { windowSize: [820, 640], titleRegion: [20, 12, 300, 48], messageRegion: [8, 52, 810, 480], incomingBubbleLeft: 75 };

async function setup(t: TestContext, options: { enabled?: boolean; enabledGroups?: () => readonly string[]; timeoutMs?: number; restoreGraceMs?: number; connected?: boolean; writeConnection?: typeof writeAtomicJson } = {}) {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".rpa-control-test-"));
  const app = express(); app.use(express.json());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const calls: Array<{ command: string; args: string[]; options: Record<string, unknown>; child: FakeChild }> = [];
  const spawnMock = ((command: string, args: string[], spawnOptions: Record<string, unknown>) => {
    const child = new FakeChild();
    calls.push({ command, args, options: spawnOptions, child });
    return child as unknown as ChildProcess;
  }) as typeof spawn;
  const readSession = (authorization: unknown) => authorization === "Bearer alice" || authorization === "Bearer private-test-connection" ? alice
    : authorization === "Bearer bob" ? bob : authorization === "Bearer alice-other-space" ? aliceOtherSpace
      : authorization === "Bearer colleague" ? colleague : authorization === "Bearer expired-alice" ? expiredAlice : null;
  const controllerOptions = { repositoryDirectory: directory, localOrigin: origin, spawn: spawnMock, readSession, enabledGroups: options.enabledGroups, timeoutMs: options.timeoutMs, restoreGraceMs: options.restoreGraceMs, writeConnection: options.writeConnection };
  const controller = new LocalBackfillController(controllerOptions);
  const config = { schemaVersion: 1, deviceId: "original-device", statePath: ".data/original.sqlite3", capture: { mode: "ocr", profiles: {} },
    selectors: { original: true }, pollIntervalSeconds: 10, scope: { userId: alice.userId, workspaceId: alice.currentWorkspaceId }, apiBaseUrl: origin, groups: GROUPS, token: "private-test-connection", upload: { enabled: true, batchSize: 50 } };
  const writeConfig = (patch: Record<string, unknown> = {}) => fs.writeFileSync(controller.paths.connection, JSON.stringify({ ...config, ...patch }));
  if (options.connected !== false) {
    fs.mkdirSync(path.dirname(controller.paths.python), { recursive: true });
    fs.mkdirSync(path.dirname(controller.paths.calibration), { recursive: true });
    fs.writeFileSync(controller.paths.python, "synthetic-placeholder-never-executed");
    fs.writeFileSync(controller.paths.collector, "synthetic-placeholder-never-executed");
    writeConfig();
    fs.writeFileSync(controller.paths.calibration, JSON.stringify({ schemaVersion: 1, profiles: { [GROUPS[0]]: PROFILE, [GROUPS[1]]: PROFILE } }));
  }
  app.use("/api/rpa/local", createLocalBackfillRouter({ enabled: options.enabled !== false, controller, readSession, localOrigin: origin }));
  const requestRoute = (route: string, method = "GET", body?: unknown, token = "alice", extraHeaders: Record<string, string> = {}) => fetch(`${origin}/api/rpa/local${route}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) });
  const request = (url = "", method = "GET", body?: unknown, token = "alice", extraHeaders: Record<string, string> = {}) => requestRoute(`/backfill${url}`, method, body, token, extraHeaders);
  const refresh = (body?: unknown, token = "alice", extraHeaders: Record<string, string> = {}) => requestRoute("/connection/refresh", "POST", body, token, extraHeaders);
  t.after(async () => {
    for (const call of calls) call.child.close(1);
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    assert.equal(path.resolve(directory).startsWith(path.join(process.cwd(), ".rpa-control-test-")), true);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { controller, controllerOptions, request, requestRoute, refresh, origin, calls, writeConfig, directory };
}

test("explicit enrollment preserves the legacy binding and isolates queues by person and space across restarts", async (t) => {
  const f = await setup(t);
  const legacy = fs.readFileSync(f.controller.paths.connection, "utf8");
  const directory = path.join(f.controller.paths.cwd, ".data", "connections");
  for (const bearer of ["colleague", "alice-other-space"]) {
    const view = await (await f.requestRoute("/connection", "GET", undefined, bearer)).json();
    assert.equal(view.connectionRequired, true);
    assert.deepEqual(view.groups, []);
    assert.equal(view.job, null);
    assert.equal((await f.requestRoute("/connection", "POST", { scope: alice }, bearer)).status, 400);
  }
  assert.equal(fs.existsSync(directory), false);
  assert.equal((await f.requestRoute("/connection", "POST", {}, "missing")).status, 401);
  assert.equal((await f.requestRoute("/connection", "POST", {}, "colleague", {origin: "https://untrusted.example"})).status, 403);
  const devices = new Set();
  for (const [bearer, session] of [["colleague", colleague], ["alice-other-space", aliceOtherSpace]] as const) {
    const response = await f.requestRoute("/connection", "POST", {}, bearer);
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.available, true);
    assert.deepEqual(status.groups, GROUPS);
    assert.equal(status.realtime.running, false);
    assert.equal(JSON.stringify(status).includes(bearer), false);
    const configs = fs.readdirSync(directory).map(name => path.join(directory, name, "connection.json"));
    const file = configs.find(name => JSON.parse(fs.readFileSync(name, "utf8")).token === bearer)!;
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(saved.scope, {userId: session.userId, workspaceId: session.currentWorkspaceId});
    const queue = path.resolve(path.dirname(file), saved.statePath);
    assert.equal(path.dirname(queue), path.dirname(file));
    fs.writeFileSync(queue, "fixture-pending-" + bearer);
    devices.add(saved.deviceId);
    assert.equal((await f.requestRoute("/connection", "POST", {}, bearer)).status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), saved);
    assert.equal(fs.readFileSync(queue, "utf8"), "fixture-pending-" + bearer);
    assert.equal(new LocalBackfillController(f.controllerOptions).connectionStatus(session).connectionRequired, false);
  }
  assert.equal(devices.size, 2);
  assert.equal(f.calls.length, 0);
  assert.equal(fs.readFileSync(f.controller.paths.connection, "utf8"), legacy);
  const started = await f.request("", "POST", {pages: 1}, "colleague");
  assert.equal(started.status, 202);
  const file = f.calls[0].args[f.calls[0].args.indexOf("--config") + 1];
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).token, "colleague");
  assert.equal((await (await f.requestRoute("/connection", "GET", undefined, "alice")).json()).job, null);
});

test("live capture can only be started and stopped for its own enrolled space and returns safe progress", async (t) => {
  const f = await setup(t);
  const live = (action: string, who: string) => f.requestRoute("/realtime/" + action, "POST", {}, who);
  assert.equal((await live("start", "bob")).status, 403);
  await f.requestRoute("/connection", "POST", {}, "bob");
  assert.equal((await live("start", "bob")).status, 200);
  assert.equal((await live("start", "bob")).status, 200);
  assert.equal(f.calls.length, 1);
  const {args, child} = f.calls[0];
  assert.deepEqual(args.slice(-3), ["collect", "--supervised", "--upload"]);
  const file = args[args.indexOf("--config") + 1];
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).scope.userId, bob.userId);
  child.event({uploaded: 3, groups: [{chatName: "PRIVATE", status: "WINDOW_NOT_OPEN"}]});
  const view = async (who: string) => (await (await f.requestRoute("/connection", "GET", undefined, who)).json()).realtime;
  const mine = await view("bob");
  assert.equal(mine.uploaded, 3);
  assert.match(mine.note, /群窗口/);
  assert.ok(!JSON.stringify(mine).includes("PRIVATE"));
  assert.deepEqual(await view("alice"), {running:false, occupied:true});
  assert.equal((await live("stop", "alice")).status, 409);
  assert.equal((await live("start", "alice")).status, 409);
  assert.equal(child.stdin.writableEnded, false);
  assert.equal((await (await live("stop", "bob")).json()).realtime.stopping, true);
  assert.equal(child.stdin.writableEnded, true);
  child.close(0);
  assert.equal((await view("bob")).running, false);
  assert.deepEqual(await view("alice"), {running:false, occupied:false});
});

test("revoking the bound session gracefully stops the supervised reader", async (t) => {
  const f = await setup(t);
  t.mock.timers.enable({ apis: ["setInterval"] });
  await f.requestRoute("/realtime/start", "POST", {});
  const child = f.calls[0].child;
  f.writeConfig({token: "revoked-test-token"});
  t.mock.timers.tick(5001);
  assert.equal(child.stdin.writableEnded, true);
  child.close(0);
  const result = await (await f.requestRoute("/connection")).json();
  assert.equal(result.connectionRefreshRequired, true);
  assert.equal(result.realtime.running, false);
});

test("expired same-scope connection can refresh only its token, preserving configuration and exposing no credentials", async (t) => {
  const fixture = await setup(t);
  fixture.writeConfig({ token: "revoked-private-value" });
  const before = readJsonSnapshot(fixture.controller.paths.connection) as Record<string, unknown>;
  const capability = await (await fixture.request()).json();
  assert.equal(capability.available, false);
  assert.equal(capability.connectionRefreshRequired, true);
  const response = await fixture.refresh({});
  assert.equal(response.status, 200);
  const refreshed = await response.json();
  assert.equal(refreshed.refreshed, true);
  assert.equal(refreshed.available, true);
  assert.equal(refreshed.connectionRefreshRequired, false);
  assert.match(refreshed.message, /下次补采/);
  assert.match(refreshed.message, /实时采集的下一轮/);
  assert.equal(JSON.stringify(refreshed).includes("revoked-private-value"), false);
  assert.equal(JSON.stringify(refreshed).includes("alice"), false);
  assert.deepEqual(readJsonSnapshot(fixture.controller.paths.connection), { ...before, token: "alice" });
  assert.equal(fixture.calls.length, 0);
  assert.equal((await fixture.refresh()).status, 200, "an empty request is safe and idempotent");
});

test("refresh requires a fresh bearer, matching scope and same-origin host without changing old bytes", async (t) => {
  const disabled = await setup(t, { enabled: false });
  assert.equal((await disabled.refresh({})).status, 404);
  const fixture = await setup(t);
  fixture.writeConfig({ token: "revoked-private-value" });
  const before = fs.readFileSync(fixture.controller.paths.connection, "utf8");
  for (const token of ["missing", "expired-alice"]) assert.equal((await fixture.refresh({}, token)).status, 401);
  for (const token of ["bob", "alice-other-space"]) assert.equal((await fixture.refresh({}, token)).status, 403);
  assert.equal((await fixture.refresh({}, "alice", { origin: "https://untrusted.example" })).status, 403);
  const wrongHost = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${fixture.origin}/api/rpa/local/connection/refresh`, { method: "POST", headers: { host: "untrusted.example", authorization: "Bearer alice" } }, (response) => { response.resume(); resolve(response.statusCode!); });
    request.once("error", reject); request.end();
  });
  assert.equal(wrongHost, 403);
  assert.equal(fs.readFileSync(fixture.controller.paths.connection, "utf8"), before);
  assert.equal(fixture.calls.length, 0);
});

test("refresh never creates a binding or accepts supplied configuration and malformed existing setup stays unavailable", async (t) => {
  const missing = await setup(t, { connected: false });
  assert.equal((await missing.refresh({})).status, 409);
  assert.equal(fs.existsSync(missing.controller.paths.connection), false);
  assert.equal((await (await missing.request()).json()).connectionRefreshRequired, false);
  const fixture = await setup(t);
  const initial = fs.readFileSync(fixture.controller.paths.connection, "utf8");
  for (const body of [null, [], "value", { token: "bob" }, { scope: {} }, { path: "other.json" }, { groups: GROUPS }]) {
    assert.equal((await fixture.refresh(body)).status, 400);
    assert.equal(fs.readFileSync(fixture.controller.paths.connection, "utf8"), initial);
  }
  for (const patch of [
    { apiBaseUrl: "https://remote.example" }, { apiBaseUrl: `${fixture.origin}/wrong-path` },
    { upload: { enabled: false } }, { groups: [GROUPS[0], GROUPS[0]] }, { token: "" }, { token: "bob" },
  ]) {
    fixture.writeConfig(patch);
    const before = fs.readFileSync(fixture.controller.paths.connection, "utf8");
    assert.equal((await fixture.refresh({})).status, 409);
    assert.equal((await (await fixture.request()).json()).connectionRefreshRequired, false);
    assert.equal(fs.readFileSync(fixture.controller.paths.connection, "utf8"), before);
  }
  fixture.writeConfig({ token: "expired-alice", groups: [""] });
  assert.equal((await (await fixture.request()).json()).connectionRefreshRequired, false, "invalid setup is not advertised as only an expired token");
  fs.writeFileSync(fixture.controller.paths.connection, "{broken-json");
  assert.equal((await fixture.refresh({})).status, 409);
  assert.equal((await (await fixture.request()).json()).connectionRefreshRequired, false);
  assert.equal(fs.readFileSync(fixture.controller.paths.connection, "utf8"), "{broken-json");
  assert.equal(fixture.calls.length, 0);
});

test("connection refresh waits for active and restoring jobs to finish", async (t) => {
  const fixture = await setup(t);
  await fixture.request("", "POST", { pages: 1 });
  const before = fs.readFileSync(fixture.controller.paths.connection, "utf8");
  assert.equal((await fixture.refresh({})).status, 409);
  fixture.calls[0].child.event({ event: "backfill", status: "RESTORING" });
  assert.equal((await fixture.refresh({})).status, 409);
  assert.equal(fs.readFileSync(fixture.controller.paths.connection, "utf8"), before);
  fixture.calls[0].child.event({ event: "backfill", status: "CANCELLED", returnedToLatest: true });
  fixture.calls[0].child.close(0);
  assert.equal((await fixture.refresh({})).status, 200);
  assert.equal(fixture.calls.length, 1);
});

test("connection refresh atomic replacement failure returns a safe error and preserves old bytes", async (t) => {
  const fixture = await setup(t, { writeConnection: (file, value) => writeAtomicJson(file, value, {
    platform: "linux", rename: () => { throw Object.assign(new Error("private write detail must not leak"), { code: "EACCES" }); },
  }) });
  fixture.writeConfig({ token: "revoked-private-value" });
  const before = fs.readFileSync(fixture.controller.paths.connection, "utf8");
  const response = await fixture.refresh({});
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.match(result.error, /原配置已保留/);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(fs.readFileSync(fixture.controller.paths.connection, "utf8"), before);
  assert.deepEqual(fs.readdirSync(fixture.controller.paths.cwd).filter((name) => name.endsWith(".tmp")), []);
  assert.equal(fixture.calls.length, 0);
});

test("local control is hidden unless enabled; bearer, origin and connection scope are mandatory", async (t) => {
  const disabled = await setup(t, { enabled: false });
  assert.equal((await disabled.request()).status, 404);
  assert.equal((await disabled.request("", "POST", { pages: 5 })).status, 404);
  assert.equal(disabled.calls.length, 0);
  const enabled = await setup(t);
  assert.equal((await enabled.request("", "GET", undefined, "missing")).status, 401);
  assert.equal((await enabled.request("", "GET", undefined, "bob")).status, 403);
  assert.equal((await enabled.request("", "POST", { pages: 5 }, "alice", { origin: "https://untrusted.example" })).status, 403);
  const wrongHost = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${enabled.origin}/api/rpa/local/backfill`, { headers: { host: "untrusted.example", authorization: "Bearer alice" } }, (response) => { response.resume(); resolve(response.statusCode!); });
    request.once("error", reject); request.end();
  });
  assert.equal(wrongHost, 403);
  const capability = await (await enabled.request()).json();
  assert.equal(capability.available, true);
  assert.deepEqual(capability.groups, GROUPS);
  assert.equal(capability.maxPages, 30);
  assert.equal(capability.job, null);
  assert.equal(JSON.stringify(capability).includes("private-test-connection"), false);
  assert.equal(enabled.calls.length, 0);
});

test("missing setup, wrong server and expired connection credentials fail closed with safe reasons", async (t) => {
  const missing = await setup(t, { connected: false });
  const capability = await (await missing.request()).json();
  assert.equal(capability.available, false);
  assert.equal(typeof capability.reason, "string");
  assert.equal((await missing.request("", "POST", { pages: 5 })).status, 503);
  const fixture = await setup(t);
  fixture.writeConfig({ apiBaseUrl: "https://remote.example" });
  assert.equal((await (await fixture.request()).json()).available, false);
  fixture.writeConfig({ token: "revoked-private-value" });
  const expired = await (await fixture.request()).json();
  assert.equal(expired.available, false);
  assert.match(expired.reason, /凭证.*过期/);
  assert.equal(JSON.stringify(expired).includes("revoked-private-value"), false);
  fixture.writeConfig({ token: "bob" });
  assert.equal((await (await fixture.request()).json()).available, false);
  assert.equal(fixture.calls.length, 0);
});

test("start accepts only bounded pages and exact groups and spawns a fixed hidden command", async (t) => {
  const fixture = await setup(t);
  for (const body of [{ pages: 0 }, { pages: 31 }, { pages: "5" }, { pages: 5, command: "untrusted.exe" }, { pages: 5, groups: ["其他群"] }, { pages: 5, groups: [GROUPS[0], GROUPS[0]] }]) {
    assert.equal((await fixture.request("", "POST", body)).status, 400);
  }
  assert.equal(fixture.calls.length, 0);
  const response = await fixture.request("", "POST", { pages: 5, groups: [GROUPS[1]] });
  assert.equal(response.status, 202);
  const { job } = await response.json() as { job: LocalBackfillJob };
  const call = fixture.calls[0];
  assert.equal(call.command, fixture.controller.paths.python);
  assert.deepEqual(call.args.slice(0, -1), ["-X", "utf8", fixture.controller.paths.collector, "--config", fixture.controller.paths.connection, "--calibration", fixture.controller.paths.calibration, "backfill", "--pages", "5", "--group", GROUPS[1], "--upload", "--cancel-file"]);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.windowsHide, true);
  assert.equal(call.options.cwd, fixture.controller.paths.cwd);
  assert.equal(call.args.join(" ").includes("private-test-connection"), false);
  assert.equal(job.groupCount, 1);
  assert.equal((await fixture.request("", "POST", { pages: 5 })).status, 409);
  assert.equal((await fixture.request(`/${job.id}/cancel`, "POST", undefined, "bob")).status, 404);
  assert.equal((await fixture.request("/not-owned/cancel", "POST")).status, 404);
});

test("group edits sync only the bound connection; missing profiles do not block calibrated groups", async (t) => {
  let enabled = [...GROUPS];
  const f = await setup(t, { enabledGroups: () => enabled });
  const config = () => readJsonSnapshot(f.controller.paths.connection) as Record<string, unknown>;
  const initial = config();
  f.controller.syncGroups(bob, ["其他工作区"]);
  assert.deepEqual(config(), initial);
  const added = "-新区交易群";
  enabled = [...GROUPS, added];
  f.controller.syncGroups(alice, enabled);
  assert.deepEqual(config(), { ...initial, groups: enabled });
  const cap = f.controller.capability(alice);
  assert.equal(cap.available, true);
  assert.equal(cap.calibrationAvailable, true);
  assert.deepEqual(cap.groups, GROUPS);
  assert.deepEqual(cap.uncalibratedGroups, [added]);
  assert.equal((await f.request("", "POST", { days: 1, groups: [added] })).status, 400);
  const job = f.controller.start(alice, { pages: 1 });
  assert.deepEqual(job.groups.map((g) => g.chatName), GROUPS);
  assert.throws(() => f.controller.syncGroups(alice, []), /任务结束/);
  f.calls[0].child.close(1);
  const verification = f.controller.calibrate(alice, "Bearer alice", { name: added });
  const probe = f.calls[1];
  assert.deepEqual(probe.args.slice(-2), ["calibrate", `--group=${added}`]);
  assert.equal(probe.options.shell, false);
  assert.ok(!probe.args.includes("--upload"));
  assert.throws(() => f.controller.start(alice, { pages: 1 }), /等待任务/);
  assert.throws(() => f.controller.syncGroups(alice, []), /任务结束/);
  probe.child.event({ profile: { ...PROFILE, privateWorkerData: "not-persisted" } });
  probe.child.close(0);
  assert.deepEqual((await verification).groups, enabled);
  const saved = readJsonSnapshot(f.controller.paths.calibration) as { profiles: Record<string, unknown> };
  assert.deepEqual(saved.profiles[added], PROFILE);
  assert.deepEqual(saved.profiles[GROUPS[0]], PROFILE);
  assert.deepEqual(f.controller.start(alice, { days: 3 }).groups.map((g) => g.chatName), enabled);
  f.calls[2].child.close(1);
  enabled = [];
  f.controller.syncGroups(alice, enabled);
  assert.deepEqual(config().groups, []);
  assert.equal(f.controller.capability(alice).available, false);
  assert.deepEqual(f.controller.capability(alice).groups, []);
  assert.equal((await f.request("", "POST", { pages: 1 })).status, 503);
});

test("calibration validates scope, worker diagnostics, actual geometry and configuration changes before saving", async (t) => {
  const f = await setup(t);
  const current = () => fs.readFileSync(f.controller.paths.calibration, "utf8");
  const initial = current();
  for (const invalid of [{ name: "其他群" }, { name: GROUPS[0], profile: PROFILE }, { name: " " }]) {
    assert.equal((await f.requestRoute("/groups/calibrate", "POST", invalid)).status, 400);
  }
  assert.equal((await f.requestRoute("/groups/calibrate", "POST", { name: GROUPS[0] }, "bob")).status, 403);
  assert.equal(f.calls.length, 0);
  for (const result of [
    { payload: { profile: { ...PROFILE, titleRegion: PROFILE.messageRegion } }, exit: 0, reason: /无法核实/ },
    { payload: { error: "OCR_CALIBRATION_NO_TEMPLATE:SECRET", availableSizes: [[800, 620], ["SECRET", 200]], raw: "SECRET" }, exit: 1, reason: /800 × 620/ },
    { payload: { error: "SECRET" }, exit: 1, reason: /无法核实/ },
  ]) {
    const request = f.controller.calibrate(alice, "Bearer alice", { name: GROUPS[0] });
    const probe = f.calls.at(-1)!;
    probe.child.event(result.payload); probe.child.close(result.exit);
    await assert.rejects(request, (error: Error) => result.reason.test(error.message) && !error.message.includes("SECRET"));
    assert.equal(current(), initial);
  }
  const last = f.controller.calibrate(alice, "Bearer alice", { name: GROUPS[0] });
  const probe = f.calls.at(-1)!;
  f.writeConfig({ deviceId: "a-new-device" });
  probe.child.event({ profile: PROFILE }); probe.child.close(0);
  await assert.rejects(last, /配置已更新/);
  assert.equal(current(), initial);
});

test("refresh can repair outdated groups and switching them off does not create an unbound local connection", async (t) => {
  const enabled = ["新群"];
  const f = await setup(t, { enabledGroups: () => enabled });
  assert.equal(f.controller.capability(alice).connectionRefreshRequired, true);
  assert.equal((await f.refresh({})).status, 200);
  assert.deepEqual((readJsonSnapshot(f.controller.paths.connection) as { groups: string[] }).groups, enabled);
  const cap = f.controller.capability(alice);
  assert.deepEqual(cap.uncalibratedGroups, enabled);
  assert.equal(cap.calibrationAvailable, true);
  assert.equal(cap.available, false);
  const missing = await setup(t, { connected: false });
  missing.controller.syncGroups(alice, enabled);
  assert.equal(fs.existsSync(missing.controller.paths.connection), false);
});

test("safe progress cannot expose stdout or stderr; completion requires clean exit and confirmed restoration", async (t) => {
  const fixture = await setup(t);
  const { job } = await (await fixture.request("", "POST", { pages: 5 })).json() as { job: LocalBackfillJob };
  const child = fixture.calls[0].child;
  child.stdout.write("private raw chat and token MUST_NOT_APPEAR\n");
  child.stderr.write("private stderr MUST_NOT_APPEAR");
  child.event({ event: "backfill", status: "RUNNING", chatName: GROUPS[0], groupIndex: 1, pagesCompleted: 2, queued: 3, uploaded: 1, skippedScreens: 2, groups: [{ chatName: GROUPS[0], pagesCompleted: 2, queued: 3, uploaded: 1, skippedScreens: 2 }], error: "MUST_NOT_APPEAR" });
  const running = await (await fixture.request()).json();
  assert.equal(running.job.id, job.id);
  assert.equal(running.job.pagesCompleted, 2);
  assert.equal(running.job.groups[0].queued, 3);
  assert.equal(running.job.skippedScreens, 2);
  assert.equal(running.job.groups[0].skippedScreens, 2);
  child.event({ event: "backfill", status: "RESTORING", skippedScreens: 1001, groups: [{ chatName: GROUPS[0], skippedScreens: -1 }] });
  const bounded = await (await fixture.request()).json();
  assert.equal(bounded.job.skippedScreens, 2);
  assert.equal(bounded.job.groups[0].skippedScreens, 2);
  child.event({ event: "backfill", status: "COMPLETED", returnedToLatest: true, pagesCompleted: 10 });
  assert.equal((await (await fixture.request()).json()).job.status, "RESTORING");
  child.close(0);
  const completed = await (await fixture.request()).json();
  assert.equal(completed.job.status, "COMPLETED");
  assert.equal(completed.job.returnedToLatest, true);
  assert.equal(completed.job.skippedScreens, 2);
  assert.equal(JSON.stringify(completed).includes("MUST_NOT_APPEAR"), false);
  assert.equal(JSON.stringify(completed).includes(fixture.directory), false);
  const second = await (await fixture.request("", "POST", { pages: 1 })).json();
  fixture.calls[1].child.close(0);
  const unconfirmed = await (await fixture.request()).json();
  assert.equal(unconfirmed.job.id, second.job.id);
  assert.equal(unconfirmed.job.status, "FAILED");
  assert.equal(unconfirmed.job.returnedToLatest, false);
  assert.equal(unconfirmed.job.restoreRequired, undefined);
});

test("a missing independent window is reported by name and requires no return scroll", async (t) => {
  const fixture = await setup(t);
  await fixture.request("", "POST", { days: 3, groups: GROUPS });
  const child = fixture.calls[0].child;
  child.event({ event: "backfill", status: "FAILED", chatName: GROUPS[0], error: "OCR_WINDOW_NOT_FOUND: MUST_NOT_APPEAR",
    restoreRequired: false, returnedToLatest: false, groups: [
      { chatName: GROUPS[0], stopReason: "OCR_WINDOW_NOT_FOUND: MUST_NOT_APPEAR", scrollAttempted: false },
      { chatName: GROUPS[1], stopReason: "NOT_STARTED", scrollAttempted: false },
    ] });
  child.close(1);
  const final = new LocalBackfillController(fixture.controllerOptions).capability(alice).job!;
  assert.equal(final.status, "FAILED");
  assert.equal(final.restoreRequired, false);
  assert.equal(final.returnedToLatest, false);
  assert.equal(final.groups[0].failureCode, "OCR_WINDOW_NOT_FOUND");
  assert.equal(final.groups[1].failureCode, undefined);
  assert.match(final.error!, /「B300真实交易群」未找到独立群聊窗口/);
  assert.doesNotMatch(JSON.stringify(final), /MUST_NOT_APPEAR/);
});

test("scroll and return failures preserve the original cause without trusting arbitrary diagnostics", async (t) => {
  const fixture = await setup(t);
  await fixture.request("", "POST", { pages: 5, groups: [GROUPS[1]] });
  const child = fixture.calls[0].child;
  child.event({ event: "backfill", status: "RESTORING", groups: [{ chatName: GROUPS[1], scrollAttempted: true,
    stopReason: "BACKFILL_TITLE_MISMATCH" }] });
  child.event({ event: "backfill", status: "FAILED", error: "BACKFILL_RESTORE_FAILED", returnedToLatest: false, restoreRequired: false,
    groups: [{ chatName: GROUPS[1], scrollAttempted: false, stopReason: "constructor", restoreError: "OCR_WINDOW_MINIMIZED: MUST_NOT_APPEAR" }] });
  child.close(1);
  const final = fixture.controller.capability(alice).job!;
  assert.equal(final.restoreRequired, true);
  assert.equal(final.groups[0].scrollAttempted, true);
  assert.equal(final.groups[0].failureCode, "BACKFILL_TITLE_MISMATCH");
  assert.equal(final.groups[0].restoreFailureCode, "OCR_WINDOW_MINIMIZED");
  assert.match(final.error!, /「真实货源群」.*群名.*最小化/);
  assert.doesNotMatch(JSON.stringify(final), /MUST_NOT_APPEAR|constructor/);
});

test("a clean cancellation before touching any window does not require a fake return confirmation", async (t) => {
  const fixture = await setup(t);
  await fixture.request("", "POST", { pages: 3, groups: [GROUPS[0]] });
  const child = fixture.calls[0].child;
  child.event({ event: "backfill", status: "CANCELLED", returnedToLatest: false, restoreRequired: false,
    groups: [{ chatName: GROUPS[0], scrollAttempted: false, stopReason: "CANCELLED" }] });
  child.close(0);
  const final = fixture.controller.capability(alice).job!;
  assert.equal(final.status, "CANCELLED");
  assert.equal(final.returnedToLatest, false);
  assert.equal(final.restoreRequired, false);
});

test("date presets launch only the requested mode and groups", async (t) => {
  const fixture = await setup(t);
  const capability = await (await fixture.request()).json();
  assert.deepEqual(capability.daysOptions, [1, 3, 7]);
  assert.equal(capability.maxDatePages, 200);
  for (const body of [{}, { groups: GROUPS }, { days: true }, { days: 2 }, { days: "3" }, { days: 1.5 }, { days: 7, pages: 1 }, { days: 7, groups: [] }, { days: 7, maxPages: 999 }, { days: 1, rangeEnd: "client time" }]) {
    assert.equal((await fixture.request("", "POST", body)).status, 400);
  }
  assert.equal((await fixture.request("", "POST", { days: 3, groups: ["其他群"] })).status, 400);
  assert.equal((await fixture.request("", "POST", { days: 7 }, "bob")).status, 403);
  assert.equal(fixture.calls.length, 0);
  for (const days of [1, 3, 7]) {
    const response = await fixture.request("", "POST", { days, groups: [GROUPS[1]] });
    assert.equal(response.status, 202);
    const { job } = await response.json() as { job: LocalBackfillJob };
    assert.equal(job.days, days);
    assert.equal(job.pagesRequested, 200);
    assert.deepEqual(job.groups.map((g) => g.chatName), [GROUPS[1]]);
    const call = fixture.calls.at(-1)!;
    assert.deepEqual(call.args.slice(7, -1), ["backfill", "--days", String(days), "--group", GROUPS[1], "--upload", "--cancel-file"]);
    assert.equal(call.options.shell, false);
    call.child.close(1);
  }
});

test("date coverage requires each group to cross the cutoff and preserves partial results on restart", async (t) => {
  const fixture = await setup(t);
  const job = fixture.controller.start(alice, { days: 3 });
  const child = fixture.calls[0].child;
  const range = { rangeStart: "2026-11-19T01:23:45.012345+00:00", rangeEnd: "2026-11-22T01:23:45.012345+00:00" };
  const first = { chatName: GROUPS[0], stopReason: "DATE_BOUNDARY_REACHED", targetReached: true, messagesCounted: 5, undatedSkipped: 2, fallbackScreens: 1, returnedToLatest: true };
  child.event({ event: "backfill", status: "RUNNING", rangeStart: "MUST_NOT_APPEAR", rangeEnd: "MUST_NOT_APPEAR", groups: [{ chatName: GROUPS[0], stopReason: "MUST_NOT_APPEAR", undatedSkipped: -1 }] });
  assert.equal(fixture.controller.capability(alice).job!.rangeStart, undefined);
  child.event({ event: "backfill", status: "RUNNING", ...range, groups: [first] });
  const during = fixture.controller.capability(alice).job!;
  assert.equal(during.rangeStart, "2026-11-19T01:23:45.012Z");
  assert.equal(during.rangeEnd, "2026-11-22T01:23:45.012Z");
  assert.equal(during.undatedSkipped, 2);
  assert.equal(during.targetReached, false);
  child.event({ event: "backfill", status: "FAILED", error: "BACKFILL_DATE_RANGE_INCOMPLETE", returnedToLatest: true, targetReached: true,
    groups: [first, { chatName: GROUPS[1], stopReason: "TOP_REACHED", pagesCompleted: 5, targetReached: false, messagesCounted: 7, undatedSkipped: 3, returnedToLatest: true }] });
  child.close(1);
  const restored = new LocalBackfillController(fixture.controllerOptions).capability(alice).job!;
  assert.equal(restored.id, job.id);
  assert.equal(restored.days, 3);
  assert.equal(restored.status, "FAILED");
  assert.equal(restored.targetReached, false);
  assert.equal(restored.returnedToLatest, true);
  assert.match(restored.error!, /未能确认覆盖/);
  assert.equal(restored.undatedSkipped, 5);
  assert.equal(restored.messagesCounted, 12);
  assert.deepEqual(restored.groups.map((g) => g.messagesCounted), [5, 7]);
  assert.equal(restored.queued, 0);
  assert.equal(restored.fallbackScreens, 1);
  assert.deepEqual(restored.groups.map((g) => g.stopReason), ["DATE_BOUNDARY_REACHED", "TOP_REACHED"]);
  assert.equal(JSON.stringify(restored).includes("MUST_NOT_APPEAR"), false);
});

test("only restored date jobs with confirmed group boundaries can complete", async (t) => {
  const fixture = await setup(t);
  const range = { rangeStart: "2026-11-21T12:12:00Z", rangeEnd: "2026-11-22T12:12:00Z" };
  for (const reached of [false, true]) {
    fixture.controller.start(alice, { days: 1, groups: [GROUPS[0]] });
    const child = fixture.calls.at(-1)!.child;
    child.event({ event: "backfill", status: "COMPLETED", ...range, targetReached: true, returnedToLatest: true,
      groups: [{ chatName: GROUPS[0], stopReason: reached ? "DATE_BOUNDARY_REACHED" : "PAGE_LIMIT", targetReached: true, undatedSkipped: 4, returnedToLatest: true }] });
    child.close(0);
    const final = fixture.controller.capability(alice).job!;
    assert.equal(final.status, reached ? "COMPLETED" : "FAILED");
    assert.equal(final.undatedSkipped, 4);
    assert.equal(final.targetReached, reached);
  }
});

test("cancel writes only the owned job's file and waits for normal restore, even after connection changes", async (t) => {
  const fixture = await setup(t);
  const { job } = await (await fixture.request("", "POST", { pages: 5 })).json();
  const child = fixture.calls[0].child;
  fixture.writeConfig({ scope: { userId: bob.userId, workspaceId: bob.currentWorkspaceId }, token: "bob" });
  const cancelled = await fixture.request(`/${job.id}/cancel`, "POST");
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).job.cancelRequested, true);
  assert.equal(child.killed, 0);
  assert.deepEqual(fs.readdirSync(fixture.controller.paths.cancelDirectory), [`${job.id}.cancel`]);
  child.event({ event: "backfill", status: "RESTORING" });
  child.event({ event: "backfill", status: "CANCELLED", returnedToLatest: true }); child.close(0);
  fixture.writeConfig();
  const final = await (await fixture.request()).json();
  assert.equal(final.job.status, "CANCELLED");
  assert.equal(final.job.returnedToLatest, true);
});

test("timeout first requests restoration then kills only the trusted Windows job tree", async (t) => {
  const fixture = await setup(t, { timeoutMs: 20, restoreGraceMs: 40 });
  const { job } = await (await fixture.request("", "POST", { pages: 5 })).json();
  await new Promise((resolve) => setTimeout(resolve, 28));
  const restoring = await (await fixture.request()).json();
  assert.equal(restoring.job.status, "RESTORING");
  assert.equal(restoring.job.cancelRequested, true);
  assert.equal(fs.existsSync(path.join(fixture.controller.paths.cancelDirectory, `${job.id}.cancel`)), true);
  await new Promise((resolve) => setTimeout(resolve, 65));
  const failed = await (await fixture.request()).json();
  assert.equal(failed.job.status, "FAILED");
  assert.equal(failed.job.returnedToLatest, false);
  if (process.platform === "win32") {
    const treeKill = fixture.calls[1];
    assert.equal(path.basename(treeKill.command).toLowerCase(), "taskkill.exe");
    assert.deepEqual(treeKill.args, ["/PID", "32145", "/T", "/F"]);
    assert.equal(treeKill.options.shell, false);
    assert.equal(treeKill.options.windowsHide, true);
    assert.equal(fixture.calls[0].child.killed, 0);
  } else assert.equal(fixture.calls[0].child.killed, 1);
});

test("service restart marks an interrupted job failed and requests cancellation without spawning", async (t) => {
  const fixture = await setup(t);
  const { job } = await (await fixture.request("", "POST", { pages: 5 })).json();
  const legacy = readJsonSnapshot(fixture.controller.paths.jobs) as { job: Partial<LocalBackfillJob> & { groups: Array<{ skippedScreens?: number }> } };
  delete legacy.job.skippedScreens;
  for (const group of legacy.job.groups) delete group.skippedScreens;
  writeAtomicJson(fixture.controller.paths.jobs, legacy);
  const reloaded = new LocalBackfillController(fixture.controllerOptions);
  const restored = reloaded.capability(alice).job!;
  assert.equal(restored.id, job.id);
  assert.equal(restored.status, "FAILED");
  assert.equal(restored.returnedToLatest, false);
  assert.equal(restored.skippedScreens, 0);
  assert.deepEqual(restored.groups.map((group) => group.skippedScreens), [0, 0]);
  assert.match(restored.error!, /服务已重启/);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fs.existsSync(path.join(reloaded.paths.cancelDirectory, `${job.id}.cancel`)), true);
  const state = readJsonSnapshot(reloaded.paths.jobs) as { job: LocalBackfillJob };
  assert.equal(state.job.status, "FAILED");
});

test("a timed-out worker can finish restoration during the grace period without forced termination", async (t) => {
  const fixture = await setup(t, { timeoutMs: 15, restoreGraceMs: 1000 });
  await fixture.request("", "POST", { pages: 5 });
  await new Promise((resolve) => setTimeout(resolve, 35));
  const child = fixture.calls[0].child;
  child.event({ event: "backfill", status: "CANCELLED", returnedToLatest: true }); child.close(0);
  const final = await (await fixture.request()).json();
  assert.equal(final.job.status, "CANCELLED");
  assert.equal(final.job.returnedToLatest, true);
  assert.equal(fixture.calls.length, 1);
  assert.equal(child.killed, 0);
});
