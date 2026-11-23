import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express from "express";
import type { AddressInfo } from "node:net";
import { createRpaRouter, RpaInbox } from "./rpa";
import { readJsonSnapshot } from "./rpa-persistence";

const execute = promisify(execFile);

test("Python collector uploads Unicode OCR to the real Express router and durably acknowledges each message", async () => {
  const temporary = fs.mkdtempSync(path.join(process.cwd(), ".rpa-integration-"));
  const filePath = path.join(temporary, "inbox.json");
  const requests: string[] = [];
  let parserCalls = 0;
  const parserMessageIds: string[] = [];
  const workerErrorCodes: string[] = [];
  let formalBusinessWrites = 0;
  const inbox = new RpaInbox({ filePath, onError: (error) => workerErrorCodes.push(String((error as NodeJS.ErrnoException).code ?? "UNKNOWN")), parse: async (text, message) => {
    parserCalls += 1;
    parserMessageIds.push(message.messageId);
    if (message.captureMode === "OCR_MESSAGE") {
      assert.equal(text, "Nora:\n测试整机 H200，12台配标准内存，现货 苏州自提，可预约验货");
      return { data: { summary: { total: 1, goodsCount: 1, demandCount: 0 }, items: [{ postType: "GOODS", title: "昵称配对测试货源", sourceContact: "模型误读昵称", configItems: [{ label: "来源", value: "模型误读昵称" }] }], warnings: ["仅测试，需人工确认"] }, isMock: true, provider: "integration-test" };
    }
    assert.equal(text.includes("深圳现货 B300"), true);
    return { data: { summary: { total: 1, goodsCount: 1, demandCount: 0 }, items: [{ postType: "GOODS", title: "合成测试货源", priceAmount: 880000 }], warnings: ["仅测试，需人工确认"] }, isMock: true, provider: "integration-test" };
  } });
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => { requests.push(`${request.method} ${request.path}`); next(); });
  app.post(["/api/goods", "/api/stocks", "/api/demands", "/api/marketplace"], (_request, response) => { formalBusinessWrites += 1; response.sendStatus(500); });
  app.use("/api/rpa", createRpaRouter({ inbox,
    readSession: (authorization) => authorization === "Bearer synthetic-integration-only" ? { userId: "fixture-user", currentWorkspaceId: "fixture-workspace", expiresAt: Date.now() + 60_000 } : null,
    baseUrl: () => "http://127.0.0.1",
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const collectorDirectory = path.resolve(process.cwd(), "../apps/wechat-rpa");
    const script = String.raw`
import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from collector import StateStore, load_config, upload_pending, post_batch

config = load_config(Path(sys.argv[1]) / "fixtures" / "config.json")
config.update({"apiBaseUrl": sys.argv[2], "token": "synthetic-integration-only", "deviceId": "integration-device"})
config["upload"] = {"enabled": True, "batchSize": 50}
store = StateStore(Path(sys.argv[3]) / "collector.sqlite3")
try:
    store.bind_scope(config)
    baseline = {"messageId": "baseline-only", "chatName": "B300真实交易群", "sender": "未识别（截图识别）", "sentAt": None, "observedAt": "2026-10-31T08:00:00.000Z", "text": "合成旧消息", "captureMode": "OCR_SNAPSHOT"}
    assert store.observe(baseline["chatName"], [baseline], "OCR_SNAPSHOT")["baseline"]
    message = {**baseline, "messageId": "synthetic-unicode-001", "observedAt": "2026-10-31T08:01:00.000Z", "text": "深圳现货 B300 8卡服务器 2台，报价88万；来源未确认，🧪仅合成测试"}
    assert store.observe(message["chatName"], [message], "OCR_SNAPSHOT")["queued"] == 1
    paired_baseline = {**baseline, "messageId": "paired-baseline-only", "sender": "Nora", "captureMode": "OCR_MESSAGE"}
    assert store.observe(paired_baseline["chatName"], [paired_baseline], "OCR_MESSAGE")["baseline"]
    paired = {**paired_baseline, "messageId": "synthetic-nora-001", "observedAt": "2026-11-01T08:01:00.000Z", "publishedTime": {"kind": "WECHAT_MARKER", "at": "2026-10-31T07:38:00Z"}, "text": "测试整机 H200，12台配标准内存，现货 苏州自提，可预约验货"}
    assert store.observe(paired["chatName"], [paired], "OCR_MESSAGE")["queued"] == 1
    before = store.status()
    uploaded = upload_pending(store, config)
    assert uploaded["uploaded"] == 2 and uploaded["unacknowledged"] == 0, uploaded
    after = store.status()
    assert after["pending"] == 0 and after["delivered"] == 2, after
    duplicate_ack = post_batch(config, [message, paired])
    assert duplicate_ack == {message["messageId"], paired["messageId"]}, duplicate_ack
    print(json.dumps({"before": before, "uploaded": uploaded, "after": after, "duplicateAck": sorted(duplicate_ack)}))
finally:
    store.close()
`;
    const python = await execute("python", ["-B", "-c", script, collectorDirectory, origin, temporary], { timeout: 20_000, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    assert.equal(python.stderr, "");
    const output = JSON.parse(python.stdout.trim()) as { after: { pending: number; delivered: number }; duplicateAck: string[] };
    assert.deepEqual(output.duplicateAck, ["synthetic-nora-001", "synthetic-unicode-001"]);
    assert.deepEqual({ pending: output.after.pending, delivered: output.after.delivered }, { pending: 0, delivered: 2 });
    await inbox.whenIdle();
    const snapshot = readJsonSnapshot(filePath) as { version: number; messages: Array<{ messageId: string; status: string; text: string; source: { sender: string; sentAt: null; captureMode: string }; parsedResult: { isMock: boolean; data: { items: Array<{ sourceContact?: string; configItems?: Array<{ label: string; value: string }> }> } } }> };
    assert.deepEqual(Object.keys(snapshot).sort(), ["messages", "version"]);
    assert.equal(snapshot.messages.length, 2, "repeat delivery must not create another capture");
    const capturedSnapshot = snapshot.messages.find((message) => message.messageId === "synthetic-unicode-001")!;
    const capturedBubble = snapshot.messages.find((message) => message.messageId === "synthetic-nora-001")!;
    for (const message of snapshot.messages) {
      assert.equal(message.status, "READY");
      assert.equal(message.source.sentAt, null);
      assert.equal(message.parsedResult.isMock, true);
      assert.equal(message.parsedResult.data.items.length, 1, "a parsed offer stays inside the inbox until confirmation");
    }
    assert.equal(capturedSnapshot.text.includes("🧪仅合成测试"), true);
    assert.equal(capturedSnapshot.source.sender, "未识别（截图识别）");
    assert.equal(capturedBubble.source.sender, "Nora");
    assert.equal(capturedBubble.source.captureMode, "OCR_MESSAGE");
    assert.deepEqual(inbox.list({ userId: "fixture-user", currentWorkspaceId: "fixture-workspace", expiresAt: Date.now() + 60_000 }, {}).items.find(item => item.messageId === "synthetic-nora-001")?.publishedTime,
      { kind: "WECHAT_MARKER", at: "2026-10-31T07:38:00.000Z" });
    assert.equal(capturedBubble.parsedResult.data.items[0].sourceContact, "Nora");
    assert.deepEqual(capturedBubble.parsedResult.data.items[0].configItems, [{ label: "来源", value: "Nora" }]);
    assert.deepEqual(workerErrorCodes, [], "the worker must complete durable writes without an unreported interruption");
    assert.equal(parserCalls, 2, `duplicate acknowledgement must not call the parser again: ${JSON.stringify(parserMessageIds)}`);
    assert.equal(formalBusinessWrites, 0);
    assert.equal(requests.filter((request) => request === "GET /api/rpa/config").length, 2);
    assert.equal(requests.filter((request) => request === "POST /api/rpa/messages").length, 2);
    const reloaded = new RpaInbox({ filePath, parse: async () => { throw new Error("READY captures must not be reparsed"); } });
    assert.equal(reloaded.list({ userId: "fixture-user", currentWorkspaceId: "fixture-workspace", expiresAt: Date.now() + 60_000 }, {}).items[0].status, "READY");
  } finally {
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    await inbox.whenIdle();
    assert.equal(path.resolve(temporary).startsWith(path.join(process.cwd(), ".rpa-integration-")), true);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
