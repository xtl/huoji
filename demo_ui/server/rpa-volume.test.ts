import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { RpaInbox, type RpaInputMessage, type RpaParsedResult } from "./rpa";
import { readJsonSnapshot } from "./rpa-persistence";

test("400 synthetic text bubbles remain isolated, idempotent and durable across two groups", { timeout: 120_000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".rpa-volume-test-"));
  const filePath = path.join(directory, "messages.json");
  const groups = ["B300真实交易群", "真实货源群"];
  const session = { userId: "volume-test-user", currentWorkspaceId: "volume-test-workspace", expiresAt: Date.now() + 60_000 };
  let parserCalls = 0;
  const workerErrors: string[] = [];
  const parsedIds = new Set<string>();
  const messages: RpaInputMessage[] = groups.flatMap((chatName, groupIndex) => Array.from({ length: 200 }, (_, index) => ({
    messageId: `synthetic-${groupIndex}-${index}`, chatName,
    sender: index % 2 === 0 ? `合成昵称-${index % 10}` : "不应成为未知气泡来源",
    captureMode: index % 2 === 0 ? "OCR_MESSAGE" as const : "OCR_SNAPSHOT" as const,
    captureUnit: "TEXT_BUBBLE" as const, sentAt: null,
    observedAt: "2026-11-02T08:00:00.000Z",
    text: `仅合成量级验证 ${groupIndex}-${index} 求购 H200 ${index + 1} 台，禁止作为真实业务使用`,
  })));
  const inbox = new RpaInbox({ filePath, onError: (error) => workerErrors.push(String((error as NodeJS.ErrnoException).code ?? "UNKNOWN")), parse: async (_text, message): Promise<RpaParsedResult> => {
    parserCalls += 1; parsedIds.add(message.messageId);
    return { isMock: true, provider: "volume-test-only", data: { summary: { total: 1, goodsCount: 0, demandCount: 1 }, items: [{ postType: "DEMAND", rawText: message.text, sourceContact: "模型猜测昵称不可采信", configItems: [{ label: "来源", value: "模型猜测昵称不可采信" }] }], warnings: [] } };
  } });
  const began = performance.now();
  try {
    let accepted = 0;
    for (let offset = 0; offset < messages.length; offset += 50) accepted += inbox.ingest(session, { deviceId: "volume-test-device", messages: messages.slice(offset, offset + 50) }).acceptedCount;
    const ingestedAt = performance.now();
    assert.equal(accepted, 400);
    await inbox.whenIdle();
    const readyAt = performance.now();
    assert.deepEqual(workerErrors, []);
    assert.equal(parserCalls, 400);
    assert.equal(parsedIds.size, 400);
    const captures = [1, 2, 3, 4].flatMap((page) => inbox.list(session, { page, pageSize: 100, status: "READY" }).items);
    assert.equal(captures.length, 400);
    assert.equal(new Set(captures.map((capture) => capture.id)).size, 400);
    for (const group of groups) assert.equal(captures.filter((capture) => capture.chatName === group).length, 200);
    for (const capture of captures) {
      assert.equal(capture.captureUnit, "TEXT_BUBBLE");
      assert.equal(capture.source.captureUnit, "TEXT_BUBBLE");
      assert.equal(capture.sentAt, null);
      if (capture.captureMode === "OCR_MESSAGE") {
        assert.equal(capture.source.sender, capture.sender);
        assert.equal((capture.parsedResult!.data.items[0] as { sourceContact: string }).sourceContact, capture.sender);
      } else {
        assert.equal(capture.sender, "未识别（截图识别）");
        assert.equal(capture.source.sender, "未识别（截图识别）");
        assert.deepEqual(capture.sourceLinks, []);
        assert.deepEqual(capture.sourceItemAliases, []);
      }
    }
    let duplicateCount = 0;
    for (let offset = 0; offset < messages.length; offset += 50) {
      const response = inbox.ingest(session, { deviceId: "volume-test-device", messages: messages.slice(offset, offset + 50) });
      assert.equal(response.acceptedCount, 0); duplicateCount += response.duplicateCount;
    }
    await inbox.whenIdle();
    assert.equal(duplicateCount, 400);
    assert.equal(parserCalls, 400, "duplicate uploads must not parse any message again");
    assert.deepEqual(workerErrors, []);
    const persisted = readJsonSnapshot(filePath) as { messages: unknown[] };
    assert.equal(persisted.messages.length, 400);
    let restartParserCalls = 0;
    const restored = new RpaInbox({ filePath, parse: async () => { restartParserCalls += 1; throw new Error("READY captures must not reparse"); } });
    restored.kick(); await restored.whenIdle();
    assert.equal(restored.list(session, { status: "READY" }).total, 400);
    assert.equal(restored.list(session, {}).total, 400);
    assert.equal(restored.list({ ...session, currentWorkspaceId: "other-synthetic-workspace" }, {}).total, 0);
    assert.equal(restartParserCalls, 0);
    assert.deepEqual(fs.readdirSync(directory), ["messages.json"]);
    t.diagnostic(JSON.stringify({ total: 400, perGroup: 200, knownBubbles: 200, unknownBubbles: 200, batchLimit: 50, ready: captures.length, parserCalls, duplicateAcknowledgements: duplicateCount, restartParserCalls, workerErrors, ingestMs: Math.round(ingestedAt - began), processingMs: Math.round(readyAt - ingestedAt), totalMs: Math.round(performance.now() - began) }));
  } finally {
    await inbox.whenIdle();
    assert.equal(path.resolve(directory).startsWith(path.join(process.cwd(), ".rpa-volume-test-")), true);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
