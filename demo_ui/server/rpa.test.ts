import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Server } from "node:http";
import { createRpaRouter, RpaInbox, RPA_OCR_MESSAGE_WARNING, type RpaParsedResult, type RpaSession } from "./rpa";
import { readJsonSnapshot, writeAtomicJson } from "./rpa-persistence";
import { ocrWarnings, unknownSourceWarning } from "../src/rpa-capture-warnings";

const directories: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); })));
  for (const directory of directories.splice(0)) {
    assert.equal(path.resolve(directory).startsWith(path.join(process.cwd(), ".rpa-test-")), true);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
function location() {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".rpa-test-"));
  directories.push(directory);
  return { directory, filePath: path.join(directory, "messages.json") };
}
const alice: RpaSession = { userId: "alice", currentWorkspaceId: "workspace-a", expiresAt: Date.now() + 60_000 };
const bob: RpaSession = { userId: "bob", currentWorkspaceId: "workspace-b", expiresAt: Date.now() + 60_000 };
const message = (messageId = "m1") => ({ messageId, chatName: "B300真实交易群", sender: "张三", sentAt: "2026-10-21T09:00:00+08:00", observedAt: "2026-10-21T09:01:00+08:00", text: "深圳 B300 8卡服务器现货2台，已出1台，还剩1台" });
const result = (): RpaParsedResult => ({ data: { summary: { total: 0, goodsCount: 0, demandCount: 0 }, items: [], warnings: [] }, isMock: true, provider: "test" });

test("a fresh desktop starts with no enabled chats and checks for concurrent changes before saving a selection", () => {
  const options = { ...location(), allowedGroups: [], parse: async () => result() };
  const inbox = new RpaInbox(options);
  assert.deepEqual(inbox.enabledGroups(alice), []);
  inbox.selectGroups(alice, {previous: [], selected: ["测试一", "测试二"]});
  assert.throws(() => inbox.selectGroups(alice, {previous: [], selected: ["测试三"]}), /其他页面/);
  assert.throws(() => inbox.selectGroups(alice, {previous: ["测试一", "测试二"], selected: ["微信"]}), /有效/);
  const updated = inbox.selectGroups(alice, {previous: ["测试一", "测试二"], selected: ["测试二", "测试三"]});
  assert.deepEqual(updated.allowedGroups, ["测试二", "测试三"]);
  assert.equal(updated.managedGroups.find(g => g.name === "测试一")?.enabled, false);
  assert.deepEqual(new RpaInbox(options).enabledGroups(alice), updated.allowedGroups);
  assert.deepEqual(inbox.enabledGroups(bob), []);
});

test("inbox sorts the entire filtered collection by publication before paginating historical captures", async () => {
  const { filePath } = location();
  const options = { filePath, parse: async () => result() };
  const inbox = new RpaInbox(options);
  const observedAt = "2026-10-23T01:00:00Z";
  const bubble = (id: string) => ({ ...message(id), captureMode: "OCR_MESSAGE", sentAt: null, observedAt });
  inbox.ingest(alice, { deviceId: "desktop", messages: [
    { ...message("native"), sentAt: "2026-10-21T08:30:00+08:00", observedAt },
    { ...bubble("interval"), publishedTime: { kind: "WECHAT_RANGE", from: "2026-10-20T23:20:00Z", to: "2026-10-21T01:00:00Z" } },
    { ...bubble("later-unknown"), observedAt: "2026-10-24T00:00:00Z" },
    { ...bubble("marker"), publishedTime: { kind: "WECHAT_MARKER", at: "2026-10-21T02:00:00Z" } },
    { ...bubble("date"), publishedTime: { kind: "WECHAT_DATE", date: "2026-10-21" } },
    { ...message("earlier-day"), sentAt: "2026-10-20T23:59:00+08:00", observedAt },
    { ...bubble("earlier-unknown"), captureMode: "OCR_SNAPSHOT" },
    { ...bubble("same-marker"), publishedTime: { kind: "WECHAT_MARKER", at: "2026-10-21T02:00:00Z" } },
  ] });
  await inbox.whenIdle();
  const expected = ["same-marker", "marker", "interval", "native", "date", "earlier-day", "later-unknown", "earlier-unknown"];
  for (const source of [inbox, new RpaInbox(options)]) {
    const pages = [1, 2, 3, 4].flatMap(page => source.list(alice, { status: "READY", page, pageSize: 2 }).items);
    assert.deepEqual(pages.map(entry => entry.messageId), expected);
    assert.equal(new Set(pages.map(entry => entry.id)).size, expected.length);
  }
  const top = inbox.list(alice, {}).items[0];
  inbox.transition(alice, top.id, "dismiss");
  assert.equal(inbox.list(alice, { status: "READY", pageSize: 1 }).items[0].messageId, "marker");
});

test("batch ingestion is durable and idempotent across retries, devices, and restarts", async () => {
  const { filePath } = location();
  const inbox = new RpaInbox({ filePath, parse: async () => result() });
  const first = inbox.ingest(alice, { deviceId: "desktop", messages: [message(), message()] });
  assert.equal(first.acceptedCount, 1);
  assert.equal(first.duplicateCount, 1);
  assert.equal(first.accepted[0].id, first.accepted[1].id);
  assert.equal(readJsonSnapshot(filePath) !== undefined, true);
  const repeated = inbox.ingest(alice, { deviceId: "replacement-desktop", messages: [message()] });
  assert.equal(repeated.duplicateCount, 1);
  await inbox.whenIdle();
  const restarted = new RpaInbox({ filePath, parse: async () => result() });
  const entry = restarted.list(alice, {}).items[0];
  assert.equal(entry.id, first.accepted[0].id);
  assert.equal(entry.status, "READY");
  assert.equal(entry.source.sentAt, "2026-10-21T01:00:00.000Z");
  assert.deepEqual(entry.reviewFlags, ["POSSIBLE_UPDATE", "POSSIBLE_SOLD_OR_CANCELLED"]);
});

test("workspace comes from the authenticated session and scope cannot be overridden", async () => {
  const inbox = new RpaInbox({ ...location(), parse: async () => result() });
  const accepted = inbox.ingest(alice, { workspaceId: bob.currentWorkspaceId, userId: bob.userId, deviceId: "desktop", messages: [message()] });
  assert.equal(inbox.list(alice, {}).total, 1);
  assert.equal(inbox.list(bob, {}).total, 0);
  assert.throws(() => inbox.transition(bob, accepted.accepted[0].id, "dismiss"), /消息不存在/);
  const sameOtherWorkspace = inbox.ingest(bob, { deviceId: "desktop", messages: [message()] });
  assert.notEqual(sameOtherWorkspace.accepted[0].id, accepted.accepted[0].id);
  await inbox.whenIdle();
});

test("group changes are authenticated, scoped, durable and preserve existing captures", async () => {
  const { filePath } = location();
  const inbox = new RpaInbox({ filePath, parse: async () => result() });
  const otherOwner = { ...alice, userId: "teammate" };
  const app = express();
  app.use(express.json());
  app.use("/api/rpa", createRpaRouter({ inbox, readSession: (auth) => auth === "Bearer a" ? alice : auth === "Bearer t" ? otherOwner : null, baseUrl: () => "http://localhost" }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/rpa`;
  const request = (method: string, auth: string, body?: object, route = "/groups") => fetch(base + route, {
    method, headers: { authorization: auth, "content-type": "application/json" }, body: body && JSON.stringify(body),
  });
  const name = "内存现货 / 华南 📦";
  const changes = (method: string, body: object) => request(method, "Bearer a", body);
  assert.equal((await request("POST", "", { name })).status, 401);
  assert.equal((await request("GET", "")).status, 401);
  for (const invalidName of ["", " ", " 名称", "名\n称", "名\u0085称", "名\u2028称", "WeChat", "微信", "x".repeat(201)]) {
    assert.equal((await changes("POST", { name: invalidName })).status, 400);
  }
  assert.equal((await changes("POST", { name, workspaceId: otherOwner.currentWorkspaceId })).status, 400);
  const added = await changes("POST", { name });
  assert.equal(added.status, 200);
  assert.deepEqual((await added.json()).managedGroups.at(-1), { name, enabled: true });
  assert.equal((await changes("POST", { name })).status, 409);
  assert.equal((await changes("PATCH", { name, enabled: 0 })).status, 400);
  assert.equal((await changes("PATCH", { name: "不在列表", enabled: true })).status, 404);
  const payload = { deviceId: "desktop", messages: [{ ...message(), chatName: name }] };
  const id = inbox.ingest(alice, payload).accepted[0].id;
  await inbox.whenIdle();
  assert.throws(() => inbox.ingest(otherOwner, payload), /白名单/);
  assert.throws(() => inbox.ingest(bob, payload), /白名单/);
  assert.equal(inbox.list(otherOwner, {}).total, 0);
  assert.throws(() => inbox.transition(otherOwner, id, "dismiss"), /不存在/);
  assert.equal((await changes("PATCH", { name, enabled: false })).status, 200);
  assert.throws(() => inbox.ingest(alice, payload), /白名单/);
  assert.equal(inbox.list(alice, {}).items[0].id, id);
  assert.equal((await changes("PATCH", { name, enabled: true })).status, 200);
  assert.equal(inbox.ingest(alice, payload).accepted[0].id, id);
  await inbox.whenIdle();
  for (const group of inbox.enabledGroups(alice)) assert.equal((await changes("DELETE", { name: group })).status, 200);
  assert.equal((await changes("DELETE", { name })).status, 404);
  assert.throws(() => inbox.ingest(alice, payload), /白名单/);
  assert.deepEqual((await (await request("GET", "Bearer a", undefined, "/config")).json()).allowedGroups, []);
  assert.deepEqual((await (await request("GET", "Bearer t")).json()).allowedGroups, ["B300真实交易群", "真实货源群"]);
  const restarted = new RpaInbox({ filePath, parse: async () => result() });
  assert.deepEqual(restarted.groupConfig(alice), { managedGroups: [], allowedGroups: [] });
  assert.deepEqual(restarted.enabledGroups({ ...alice, currentWorkspaceId: "other-space" }), ["B300真实交易群", "真实货源群"]);
  assert.equal(restarted.list(alice, {}).items[0].id, id);
});

test("a failed local sync or failed settings write leaves both group lists unchanged", () => {
  const { filePath } = location();
  const inbox = new RpaInbox({ filePath, parse: async () => result() });
  const before = inbox.enabledGroups(alice);
  const add = { name: "另一群" };
  assert.throws(() => inbox.editGroup(alice, "add", add, () => { throw new Error("busy"); }), /busy/);
  assert.deepEqual(inbox.enabledGroups(alice), before);
  assert.equal(fs.existsSync(filePath + ".groups.json"), false);
  fs.mkdirSync(filePath + ".groups.json");
  const syncs: string[][] = [];
  assert.throws(() => inbox.editGroup(alice, "add", add, (_session, groups) => syncs.push(groups)), /保存失败/);
  assert.deepEqual(syncs, [[...before, add.name], before]);
  assert.deepEqual(inbox.enabledGroups(alice), before);
});

test("publication evidence survives retries and restarts without reparsing or changing capture timestamps", async () => {
  const { filePath } = location();
  let parses = 0;
  const inbox = new RpaInbox({ filePath, parse: async () => { parses++; return result(); } });
  const original = { ...message("repeat-content-hash"), captureMode: "OCR_MESSAGE", sentAt: null };
  const at = "2026-10-21T01:00:00.000Z";
  const marker = { kind: "WECHAT_MARKER", at };
  const minute = { kind: "WECHAT_MINUTE", at };
  const upload = (item: object, owner = alice, deviceId = "desktop") => inbox.ingest(owner, { deviceId, messages: [item] });
  const id = upload(original).accepted[0].id;
  await inbox.whenIdle();
  const before = inbox.list(alice, {}).items[0];
  const more = { ...original, publishedTime: marker };
  upload({ ...more, observedAt: "2026-10-22T09:01:00+08:00" });
  upload(more, alice, "other-desktop");
  const otherCapture = upload(more, { ...alice, userId: "other-owner" });
  assert.notEqual(otherCapture.accepted[0].id, id);
  assert.equal(inbox.list(alice, {}).items[0].publishedTime, undefined, "a repost may share the same OCR hash");
  assert.equal(upload(more).duplicateCount, 1);
  assert.throws(() => inbox.ingest(alice, { deviceId: "desktop", messages: [
    { ...original, publishedTime: minute }, { ...original, text: "conflict" },
  ] }), /冲突/);
  assert.deepEqual(inbox.list(alice, {}).items[0].publishedTime, marker, "failed batch rolls back evidence too");
  upload({ ...original, publishedTime: minute });
  upload(more);
  upload(original);
  await inbox.whenIdle();
  assert.equal(parses, 2, "each owner's own capture is parsed exactly once");
  const reloaded = new RpaInbox({ filePath, parse: async () => { parses++; return result(); } });
  const after = reloaded.list(alice, {}).items[0];
  assert.equal(after.id, id);
  assert.equal(after.status, "READY");
  assert.equal(after.sentAt, null);
  assert.equal(after.observedAt, before.observedAt);
  assert.equal(after.createdAt, before.createdAt);
  assert.deepEqual(after.parsedResult, before.parsedResult);
  assert.deepEqual(after.publishedTime, minute);
  assert.deepEqual(after.source.publishedTime, minute);
  assert.deepEqual(reloaded.publicationTimes(alice, id).items, [{ id, sentAt: null, publishedTime: minute }]);
  assert.deepEqual(reloaded.publicationTimes({ ...alice, userId: "other-owner" }, id).items, []);
  assert.deepEqual(reloaded.publicationTimes(bob, id).items, []);
  for (const invalidIds of ["", [id], "," + id, "x".repeat(129), Array(51).fill(id).join(",")]) {
    assert.throws(() => reloaded.publicationTimes(alice, invalidIds), /编号/);
  }
  const duplicateText = { ...original, messageId: "same-author-again", text: original.text.replace("B300", "B300\n") };
  reloaded.ingest(alice, { deviceId: "other-desktop", messages: [duplicateText] });
  await reloaded.whenIdle();
  assert.equal(reloaded.publicationTimes(alice, id).items[0].repeatedContent, undefined);
  reloaded.ingest(alice, { deviceId: "desktop", messages: [{ ...duplicateText, messageId: "same-author-here" }] });
  await reloaded.whenIdle();
  assert.equal(parses, 4);
  assert.deepEqual(reloaded.publicationTimes(alice, id).items, [{ id, sentAt: null, publishedTime: minute, repeatedContent: true }]);
});

test("only a complete OCR bubble can carry bounded, minute-precision WeChat evidence", async () => {
  const inbox = new RpaInbox({ ...location(), parse: async () => result() });
  const original = { ...message(), captureMode: "OCR_SNAPSHOT", captureUnit: "TEXT_BUBBLE", sentAt: null };
  const at = "2026-10-21T01:00:00Z";
  const marker = { kind: "WECHAT_MARKER", at };
  for (const item of [
    { ...original, sentAt: at }, { ...message(), publishedTime: marker },
    { ...original, captureUnit: "VIEWPORT_REMAINDER", publishedTime: marker },
    ...[null, [], { ...marker, kind: "EXACT" }, { ...marker, at: "2026-02-31T01:00:00Z" },
      { ...marker, at: at.replace(":00Z", ":03Z") }, { ...marker, at: "2026-10-21T01:02:00Z" },
      { kind: "WECHAT_CLOCK", clock: "24:00" },
      { kind: "WECHAT_DATE", date: "2026-02-30" }, { kind: "WECHAT_DATE", date: "2026-10-22" },
      { kind: "WECHAT_DATE", date: "2026-10-20", at },
      { kind: "WECHAT_RANGE", from: at, to: "2026-10-20T23:59:00Z" },
    ].map((publishedTime) => ({ ...original, publishedTime })),
  ]) assert.throws(() => inbox.ingest(alice, { deviceId: "desktop", messages: [item] }));
  assert.equal(inbox.list(alice, {}).total, 0);
  const range = { kind: "WECHAT_RANGE", from: "2026-10-20T23:00:00.000Z", to: "2026-10-21T01:00:00.000Z" };
  const send = (publishedTime: object) => inbox.ingest(alice, { deviceId: "desktop", messages: [{ ...original, publishedTime }] });
  send({ kind: "WECHAT_DATE", date: "2026-10-21" });
  assert.deepEqual(inbox.list(alice, {}).items[0].publishedTime, { kind: "WECHAT_DATE", date: "2026-10-21" });
  send({ kind: "WECHAT_RANGE", from: "2026-10-20T15:00:00.000Z", to: range.to });
  assert.deepEqual(inbox.list(alice, {}).items[0].publishedTime, { kind: "WECHAT_DATE", date: "2026-10-21" });
  send(range);
  const narrower = { ...range, from: "2026-10-21T00:59:00.000Z" };
  send(narrower);
  send(range);
  send({ kind: "WECHAT_MINUTE", at: "2026-10-20T22:00:00Z" });
  await inbox.whenIdle();
  const entry = inbox.list(alice, {}).items[0];
  assert.deepEqual(entry.publishedTime, narrower);
  assert.equal(entry.sender, "未识别（截图识别）");
  assert.equal(entry.sentAt, null);
});

test("legacy clocks resolve on the Beijing date of the original capture on upload and restart", async () => {
  const { filePath } = location();
  const options = { filePath, parse: async () => result() };
  const original = { ...message(), captureMode: "OCR_MESSAGE", sentAt: null, observedAt: "2026-12-31T16:05:30Z" };
  const clock = { kind: "WECHAT_CLOCK", clock: "00:04" };
  const ahead = { kind: "WECHAT_CLOCK", clock: "23:59" };
  const marker = { kind: "WECHAT_MARKER", at: "2026-12-31T16:04:00.000Z" };
  const inbox = new RpaInbox(options);
  const ids = inbox.ingest(alice, { deviceId: "desktop", messages: [
    { ...original, publishedTime: clock }, { ...original, messageId: "ahead", publishedTime: ahead },
    { ...original, messageId: "day", publishedTime: { kind: "WECHAT_DATE", date: "2027-01-01" } },
    { ...original, messageId: "unknown" },
  ] }).accepted.map(item => item.id);
  await inbox.whenIdle();
  const times = (store: RpaInbox) => store.publicationTimes(alice, ids.join(",")).items.map(item => item.publishedTime);
  const expected = [marker, undefined, { kind: "WECHAT_DATE", date: "2027-01-01" }, undefined];
  assert.deepEqual(times(inbox), expected);
  const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
  for (const [index, evidence] of [clock, ahead].entries()) {
    const record = saved.messages[index];
    record.publishedTime = record.source.publishedTime = evidence;
    record.createdAt = "2027-02-01T00:00:00Z";
  }
  writeAtomicJson(filePath, saved);
  const before = fs.readFileSync(filePath, "utf8");
  const reloaded = new RpaInbox(options);
  assert.deepEqual(times(reloaded), expected);
  const bubble = reloaded.list(alice, {}).items.find(item => item.id === ids[0])!;
  assert.deepEqual(bubble.source.publishedTime, marker);
  assert.equal(bubble.sentAt, null);
  assert.equal(fs.readFileSync(filePath, "utf8"), before);
});

test("legacy lookup flags a later unique canonical bubble when its publication time cannot belong to an earlier viewport", async () => {
  const inbox = new RpaInbox({ ...location(), parse: async () => result() });
  const known = { ...message(), captureMode: "OCR_MESSAGE", sentAt: null, publishedTime: { kind: "WECHAT_MINUTE", at: "2026-10-21T01:00:00Z" } };
  const older = { ...known, captureMode: "OCR_SNAPSHOT", publishedTime: undefined, messageId: "earlier-screen",
    observedAt: "2026-10-21T00:55:00Z", text: `${known.sender}\n${known.text}` };
  const post = (input: object, deviceId = "desktop") => inbox.ingest(alice, { deviceId, messages: [input] });
  const id = post(known).accepted[0].id;
  post({ ...older, messageId: "other-screen", text: "另一条报价" });
  post({ ...older, messageId: "other-device" }, "elsewhere");
  post({ ...older, messageId: "out-of-window", observedAt: "2026-10-20T01:00:00Z" });
  assert.equal(inbox.publicationTimes(alice, id).items[0].legacyTimeAmbiguous, undefined);
  post(older);
  await inbox.whenIdle();
  const item = inbox.publicationTimes(alice, id).items[0];
  assert.equal(item.repeatedContent, undefined);
  assert.equal(item.legacyTimeAmbiguous, true);
  assert.deepEqual(item.publishedTime, { kind: "WECHAT_MINUTE", at: "2026-10-21T01:00:00.000Z" }, "a proven direct capture keeps its time");
});

test("invalid batches, non-allowlisted groups and conflicting IDs are rejected atomically", async () => {
  const inbox = new RpaInbox({ ...location(), parse: async () => result() });
  assert.throws(() => inbox.ingest(alice, { deviceId: "desktop", messages: [message(), { ...message("m2"), chatName: "其他群" }] }), /白名单/);
  assert.equal(inbox.list(alice, {}).total, 0);
  assert.throws(() => inbox.ingest(alice, { deviceId: "desktop", messages: Array.from({ length: 51 }, () => message()) }), /50/);
  assert.throws(() => inbox.ingest(alice, { deviceId: "desktop", messages: [{ ...message(), sentAt: "2026-10-21 09:00" }] }), /ISO/);
  inbox.ingest(alice, { deviceId: "desktop", messages: [message()] });
  assert.throws(() => inbox.ingest(alice, { deviceId: "desktop", messages: [message("m2"), { ...message(), text: "changed" }] }), /冲突/);
  assert.equal(inbox.list(alice, {}).total, 1);
  await inbox.whenIdle();
});

test("AI work is asynchronous, concurrency is one, failures persist and retry succeeds", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  const inbox = new RpaInbox({ ...location(), parse: async () => {
    active += 1; maximumActive = Math.max(maximumActive, active); calls += 1;
    try { await gate; if (calls === 1) throw new Error("provider unavailable"); return result(); }
    finally { active -= 1; }
  } });
  const accepted = inbox.ingest(alice, { deviceId: "desktop", messages: [message(), message("m2")] });
  assert.equal(calls, 0, "accepting a batch must not wait for AI");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  await inbox.whenIdle();
  assert.equal(maximumActive, 1);
  const failed = inbox.list(alice, { status: "FAILED" }).items[0];
  assert.equal(failed.id, accepted.accepted[0].id);
  assert.equal(failed.error, "provider unavailable");
  inbox.transition(alice, failed.id, "retry");
  await inbox.whenIdle();
  const ready = inbox.list(alice, {}).items.find((item) => item.id === failed.id)!;
  assert.equal(ready.status, "READY");
  assert.equal(ready.attempts, 2);
  assert.equal(ready.parsedResult?.isMock, true);
});

test("restart requeues interrupted work; dismissing in-flight work preserves dismissal", async () => {
  const { filePath } = location();
  const first = new RpaInbox({ filePath, parse: async () => result() });
  first.ingest(alice, { deviceId: "desktop", messages: [message()] });
  await first.whenIdle();
  const snapshot = readJsonSnapshot(filePath) as { version: number; messages: Array<{ status: string }> };
  snapshot.messages[0].status = "PROCESSING";
  writeAtomicJson(filePath, snapshot);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const restarted = new RpaInbox({ filePath, parse: async () => { await gate; return result(); } });
  assert.equal(restarted.list(alice, {}).items[0].status, "PENDING");
  restarted.kick();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const entry = restarted.list(alice, {}).items[0];
  assert.equal(entry.status, "PROCESSING");
  restarted.transition(alice, entry.id, "dismiss");
  release();
  await restarted.whenIdle();
  assert.equal(restarted.list(alice, {}).items[0].status, "DISMISSED");
});

test("a disk write failure cannot acknowledge or commit accepted messages", async () => {
  const { filePath } = location();
  const inbox = new RpaInbox({ filePath, parse: async () => result() });
  fs.mkdirSync(filePath);
  assert.throws(() => inbox.ingest(alice, { deviceId: "desktop", messages: [message()] }));
  assert.equal(inbox.list(alice, {}).total, 0);
  assert.equal(fs.readdirSync(path.dirname(filePath)).some((name) => name.endsWith(".tmp")), false);
  await inbox.whenIdle();
});

test("HTTP import requires login and hides foreign records from listing and actions", async () => {
  const inbox = new RpaInbox({ ...location(), parse: async () => result() });
  const app = express();
  app.use(express.json());
  app.use("/api/rpa", createRpaRouter({ inbox, readSession: (authorization) => authorization === "Bearer a" ? alice : authorization === "Bearer b" ? bob : null, baseUrl: () => "http://localhost" }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/rpa`;
  assert.equal((await fetch(`${base}/messages`)).status, 401);
  const posted = await fetch(`${base}/messages`, { method: "POST", headers: { authorization: "Bearer a", "content-type": "application/json" }, body: JSON.stringify({ deviceId: "desktop", messages: [message()] }) });
  assert.equal(posted.status, 202);
  const payload = await posted.json() as { accepted: Array<{ id: string }> };
  const times = `${base}/publication-times?ids=${payload.accepted[0].id}`;
  assert.equal((await fetch(times)).status, 401);
  assert.deepEqual(await (await fetch(times, { headers: { authorization: "Bearer b" } })).json(), { items: [] });
  const ownTimes = await fetch(times, { headers: { authorization: "Bearer a" } });
  assert.equal(ownTimes.headers.get("cache-control"), "no-store");
  assert.deepEqual(await ownTimes.json(), { items: [{ id: payload.accepted[0].id, sentAt: "2026-10-21T01:00:00.000Z" }] });
  const list = await (await fetch(`${base}/messages`, { headers: { authorization: "Bearer b" } })).json() as { total: number };
  assert.equal(list.total, 0);
  assert.equal((await fetch(`${base}/messages/${payload.accepted[0].id}/dismiss`, { method: "POST", headers: { authorization: "Bearer b" } })).status, 404);
  const config = await (await fetch(`${base}/config`, { headers: { authorization: "Bearer a" } })).json() as { allowedGroups: string[]; sessionExpiresAt: string; scope: { userId: string; workspaceId: string } };
  assert.deepEqual(config.allowedGroups, ["B300真实交易群", "真实货源群"]);
  assert.equal(config.sessionExpiresAt, new Date(alice.expiresAt).toISOString());
  assert.deepEqual(config.scope, { userId: alice.userId, workspaceId: alice.currentWorkspaceId });
  const otherConfig = await (await fetch(`${base}/config`, { headers: { authorization: "Bearer b" } })).json() as { scope: { userId: string; workspaceId: string } };
  assert.deepEqual(otherConfig.scope, { userId: bob.userId, workspaceId: bob.currentWorkspaceId });
  await inbox.whenIdle();
});

test("real Web auth reload keeps identity and sessions stable, and logout persists revocation", async () => {
  const { directory } = location();
  const savedEnvironment = { ...process.env };
  process.env.NODE_ENV = "test";
  process.env.AI_PROVIDER = "mock";
  process.env.SMS_UNIVERSAL_CODE = "test-login-code";
  process.env.AUTH_STATE_FILE = path.join(directory, "identity.json");
  process.env.RPA_MESSAGES_FILE = path.join(directory, "rpa.json");
  process.env.PAYMENT_ORDERS_FILE = path.join(directory, "payments.json");
  const appUrl = new URL("../server.ts", import.meta.url).href;
  const loadApp = async (suffix: string) => {
    const module = await import(`${appUrl}?identity-test=${suffix}`);
    const server = module.app.listen(0, "127.0.0.1") as Server;
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    return `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  };
  try {
    const first = await loadApp("first");
    const login = async (base: string) => {
      const response = await fetch(`${base}/api/auth/sms/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "13800138000", code: "test-login-code" }) });
      assert.equal(response.status, 200);
      return await response.json() as { token: string; user: { id: string }; currentWorkspaceId: string };
    };
    const initial = await login(first);
    const second = await loadApp("second");
    const me = await fetch(`${second}/api/auth/me`, { headers: { authorization: `Bearer ${initial.token}` } });
    assert.equal(me.status, 200);
    const repeated = await login(second);
    assert.equal(repeated.user.id, initial.user.id);
    assert.equal(repeated.currentWorkspaceId, initial.currentWorkspaceId);
    const logout = await fetch(`${second}/api/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${initial.token}` } });
    assert.equal(logout.status, 200);
    const third = await loadApp("third");
    assert.equal((await fetch(`${third}/api/auth/me`, { headers: { authorization: `Bearer ${initial.token}` } })).status, 401);
    assert.equal((await fetch(`${third}/api/auth/me`, { headers: { authorization: `Bearer ${repeated.token}` } })).status, 200);
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in savedEnvironment)) delete process.env[name];
    Object.assign(process.env, savedEnvironment);
  }
});

test("OCR snapshots preserve unknown attribution and require explicit review", async () => {
  let parsedText = "";
  const inbox = new RpaInbox({ ...location(), parse: async (text) => { parsedText = text; return result(); } });
  const input = { ...message(), sender: "", sentAt: null, captureMode: "OCR_SNAPSHOT" };
  inbox.ingest(alice, { deviceId: "desktop", messages: [input] });
  await inbox.whenIdle();
  const entry = inbox.list(alice, {}).items[0];
  assert.equal(entry.captureMode, "OCR_SNAPSHOT");
  assert.equal(entry.source.sentAt, null);
  assert.equal(entry.sender, "未识别（截图识别）");
  assert.equal(entry.reviewFlags.includes("OCR_REQUIRES_REVIEW"), true);
  assert.equal(parsedText, input.text, "a screenshot must not be attributed to an invented sender");
});

test("paired OCR bubble binds every parsed supply and demand to Nora despite forged body authors", async () => {
  const { filePath } = location();
  const input = { ...message("nora-bubble"), sender: "Nora", sentAt: null, captureMode: "OCR_MESSAGE", text: "Mallory:\n出 H200 服务器 32台\n收 B300 2台\n【OCR待核对】价格未确认" };
  let parsedText = "";
  const inbox = new RpaInbox({ filePath, parse: async (text) => {
    parsedText = text;
    return { ...result(), data: { summary: { total: 2, goodsCount: 1, demandCount: 1 }, warnings: ["价格待核对", unknownSourceWarning], items: [
      { postType: "GOODS", sourceContact: "Mallory", configItems: [{ label: "来源", value: "Mallory" }, { label: "发言人", value: "Bob" }, { label: "GPU", value: "H200" }] },
      { postType: "DEMAND", source_contact: "伪造来源", config_items: [{ label: "来源用户", value: "伪造来源" }] },
    ] } };
  } });
  inbox.ingest(alice, { deviceId: "desktop", messages: [input] });
  await inbox.whenIdle();
  const captured = inbox.list(alice, {}).items[0];
  assert.equal(parsedText, `Nora:\n${input.text}`);
  assert.equal(captured.sender, "Nora");
  assert.equal(captured.source.sender, "Nora");
  assert.equal(captured.source.captureMode, "OCR_MESSAGE");
  assert.equal(captured.source.sentAt, null);
  assert.equal(captured.text, input.text);
  assert.equal(captured.reviewFlags.includes("OCR_REQUIRES_REVIEW"), true);
  assert.equal(captured.reviewFlags.includes("OCR_TEXT_UNCERTAIN"), true);
  assert.deepEqual(captured.parsedResult?.data.warnings, ["价格待核对", RPA_OCR_MESSAGE_WARNING]);
  const items = captured.parsedResult!.data.items as Array<{ sourceContact: string; source_contact?: string; config_items?: unknown; configItems: Array<{ label: string; value: string }> }>;
  assert.deepEqual(items.map((item) => item.sourceContact), ["Nora", "Nora"]);
  assert.equal(items.some((item) => item.source_contact || item.config_items), false);
  assert.deepEqual(items[0].configItems, [{ label: "GPU", value: "H200" }, { label: "来源", value: "Nora" }]);
  assert.deepEqual(items[1].configItems, [{ label: "来源", value: "Nora" }]);
  const restored = new RpaInbox({ filePath, parse: async () => result() });
  assert.deepEqual(restored.list(alice, {}).items[0].parsedResult, captured.parsedResult);
});

test("whole-screen OCR keeps separate parsed authors instead of binding all items to a nickname", async () => {
  const inbox = new RpaInbox({ ...location(), parse: async () => ({ ...result(), data: { summary: { total: 2, goodsCount: 1, demandCount: 1 }, warnings: [], items: [
    { postType: "GOODS", sourceContact: "Alice", configItems: [{ label: "来源", value: "Alice" }] },
    { postType: "DEMAND", sourceContact: "Bob", configItems: [{ label: "来源", value: "Bob" }] },
  ] } }) });
  inbox.ingest(alice, { deviceId: "desktop", messages: [{ ...message(), sender: "Nora", sentAt: null, captureMode: "OCR_SNAPSHOT" }] });
  await inbox.whenIdle();
  const captured = inbox.list(alice, {}).items[0];
  assert.equal(captured.source.sender, "未识别（截图识别）");
  assert.deepEqual((captured.parsedResult!.data.items as Array<{ sourceContact: string }>).map((item) => item.sourceContact), ["Alice", "Bob"]);
  assert.equal(captured.parsedResult!.data.warnings.includes(RPA_OCR_MESSAGE_WARNING), false);
});

test("capture mode changes cannot silently acknowledge an existing ID, including legacy UIA records", async () => {
  const { filePath } = location();
  const inbox = new RpaInbox({ filePath, parse: async () => result() });
  const original = { ...message(), sender: "Nora", sentAt: null };
  inbox.ingest(alice, { deviceId: "desktop", messages: [original] });
  await inbox.whenIdle();
  const snapshot = readJsonSnapshot(filePath) as { version: 1; messages: Array<{ captureMode?: string; source: { captureMode?: string } }> };
  delete snapshot.messages[0].captureMode;
  delete snapshot.messages[0].source.captureMode;
  writeAtomicJson(filePath, snapshot);
  const restored = new RpaInbox({ filePath, parse: async () => result() });
  assert.equal(restored.ingest(alice, { deviceId: "desktop", messages: [{ ...original, captureMode: "UIA_MESSAGE" }] }).duplicateCount, 1);
  assert.throws(() => restored.ingest(alice, { deviceId: "desktop", messages: [{ ...original, captureMode: "OCR_MESSAGE" }] }), /冲突/);
  assert.equal(restored.list(alice, {}).total, 1);
  assert.throws(() => restored.ingest(alice, { deviceId: "desktop", messages: [{ ...message("bad-time"), sender: "Nora", captureMode: "OCR_MESSAGE" }] }), /sentAt/);
  assert.throws(() => restored.ingest(alice, { deviceId: "desktop", messages: [{ ...original, messageId: "missing-author", sender: "", captureMode: "OCR_MESSAGE" }] }), /sender/);
  await restored.whenIdle();
});

test("capture units persist in both metadata locations without granting unknown bubbles an author", async () => {
  const { filePath } = location();
  const inbox = new RpaInbox({ filePath, parse: async () => ({ ...result(), data: { summary: { total: 1, goodsCount: 1, demandCount: 0 }, items: [{ postType: "GOODS", sourceContact: "正文伪造来源", rawText: "B300 现货" }], warnings: [] } }) });
  inbox.ingest(alice, { deviceId: "desktop", messages: [
    { ...message("known-bubble"), sender: "Nora", sentAt: null, captureMode: "OCR_MESSAGE", captureUnit: "TEXT_BUBBLE" },
    { ...message("unknown-bubble"), sender: "Nora", sentAt: null, captureMode: "OCR_SNAPSHOT", captureUnit: "TEXT_BUBBLE", text: "B300 现货" },
    { ...message("viewport"), sentAt: null, captureMode: "OCR_SNAPSHOT", captureUnit: "VIEWPORT_REMAINDER" },
  ] });
  await inbox.whenIdle();
  const entries = inbox.list(alice, {}).items;
  const known = entries.find((entry) => entry.messageId === "known-bubble")!;
  const unknown = entries.find((entry) => entry.messageId === "unknown-bubble")!;
  const viewport = entries.find((entry) => entry.messageId === "viewport")!;
  assert.equal(known.captureUnit, "TEXT_BUBBLE");
  assert.equal(known.source.captureUnit, "TEXT_BUBBLE");
  assert.equal((known.parsedResult!.data.items[0] as { sourceContact: string }).sourceContact, "Nora");
  assert.equal(unknown.captureMode, "OCR_SNAPSHOT");
  assert.equal(unknown.captureUnit, "TEXT_BUBBLE");
  assert.equal(unknown.source.captureUnit, "TEXT_BUBBLE");
  assert.deepEqual(unknown.parsedResult?.data.warnings, [ocrWarnings.unknownBubble]);
  assert.equal(unknown.sender, "未识别（截图识别）");
  assert.equal(unknown.source.sender, "未识别（截图识别）");
  assert.deepEqual(unknown.sourceLinks, [], "a single unknown bubble still needs the existing independent-name-line evidence");
  assert.equal(viewport.source.captureUnit, "VIEWPORT_REMAINDER");
  assert.deepEqual(viewport.parsedResult?.data.warnings, [ocrWarnings.viewport]);
  const restored = new RpaInbox({ filePath, parse: async () => result() });
  assert.deepEqual(restored.list(alice, {}).items.map((entry) => entry.source.captureUnit), entries.map((entry) => entry.source.captureUnit));
});

test("capture-unit idempotency recognizes legacy defaults and rejects semantic changes or invalid combinations", async () => {
  const { filePath } = location();
  const inbox = new RpaInbox({ filePath, parse: async () => result() });
  const known = { ...message("legacy-known"), sender: "Nora", sentAt: null, captureMode: "OCR_MESSAGE" };
  const viewport = { ...message("legacy-viewport"), sentAt: null, captureMode: "OCR_SNAPSHOT" };
  inbox.ingest(alice, { deviceId: "desktop", messages: [known, viewport] });
  await inbox.whenIdle();
  const saved = readJsonSnapshot(filePath) as { messages: Array<{ captureUnit?: string; source: { captureUnit?: string } }> };
  for (const entry of saved.messages) { delete entry.captureUnit; delete entry.source.captureUnit; }
  writeAtomicJson(filePath, saved);
  const restored = new RpaInbox({ filePath, parse: async () => result() });
  assert.equal(restored.ingest(alice, { deviceId: "desktop", messages: [{ ...known, captureUnit: "TEXT_BUBBLE" }, { ...viewport, captureUnit: "VIEWPORT_REMAINDER" }] }).duplicateCount, 2);
  assert.equal(restored.ingest(alice, { deviceId: "desktop", messages: [known, viewport] }).duplicateCount, 2);
  assert.throws(() => restored.ingest(alice, { deviceId: "desktop", messages: [{ ...viewport, captureUnit: "TEXT_BUBBLE" }] }), /冲突/);
  const unknown = { ...viewport, messageId: "new-unknown", captureUnit: "TEXT_BUBBLE" };
  restored.ingest(alice, { deviceId: "desktop", messages: [unknown] });
  assert.equal(restored.ingest(alice, { deviceId: "desktop", messages: [unknown] }).duplicateCount, 1);
  assert.throws(() => restored.ingest(alice, { deviceId: "desktop", messages: [{ ...unknown, captureUnit: undefined }] }), /冲突/);
  for (const invalid of [
    { ...message("uia"), captureUnit: "TEXT_BUBBLE" },
    { ...message("uia-explicit"), captureMode: "UIA_MESSAGE", captureUnit: "VIEWPORT_REMAINDER" },
    { ...known, messageId: "bad-known", captureUnit: "VIEWPORT_REMAINDER" },
    { ...viewport, messageId: "bad-unit", captureUnit: "UNKNOWN" },
    { ...viewport, messageId: "null-unit", captureUnit: null },
  ]) assert.throws(() => restored.ingest(alice, { deviceId: "desktop", messages: [invalid] }), /采集单元|气泡|captureUnit/);
  await restored.whenIdle();
});
