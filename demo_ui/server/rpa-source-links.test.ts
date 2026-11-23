import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { deriveRpaSourceLinks, deriveRpaSourceMetadata } from "./rpa-source-links";
import { RpaInbox, type RpaInputMessage, type RpaMessage, type RpaParsedResult } from "./rpa";

const BODY = "采购SK 32g5600 dc24 160条 请提供报价";
function parsed(items: unknown[]): RpaParsedResult {
  return { data: { summary: { total: items.length, goodsCount: 0, demandCount: items.length }, items, warnings: [] }, isMock: true, provider: "source-link-test" };
}
function fixture(): { canonical: RpaMessage; snapshot: RpaMessage } {
  const base = {
    workspaceId: "fixture-workspace", userId: "fixture-user", deviceId: "fixture-device", chatName: "真实货源群",
    status: "READY" as const, attempts: 1, createdAt: "2026-11-02T08:00:00.000Z", updatedAt: "2026-11-02T08:00:00.000Z", sentAt: null,
    reviewFlags: ["OCR_REQUIRES_REVIEW"],
  };
  const canonical: RpaMessage = {
    ...base, id: "rpa_00000000-0000-4000-8000-000000000001", messageId: "fixture-buyer-bubble", sender: "样例甲", captureMode: "OCR_MESSAGE", observedAt: "2026-11-02T08:00:00.000Z", text: BODY,
    source: { channel: "WECHAT_RPA", chatName: base.chatName, sender: "样例甲", sentAt: null, observedAt: "2026-11-02T08:00:00.000Z", messageId: "fixture-buyer-bubble", deviceId: base.deviceId, captureMode: "OCR_MESSAGE" },
    parsedResult: parsed([{ postType: "DEMAND", sourceContact: "样例甲", rawText: "采购SK 32g5600 dc24 160条\n请提供报价" }]),
  };
  const snapshot: RpaMessage = {
    ...base, id: "rpa_00000000-0000-4000-8000-000000000002", messageId: "fixture-mixed-snapshot", sender: "未识别（截图识别）", captureMode: "OCR_SNAPSHOT", observedAt: "2026-11-02T08:05:00.000Z",
    text: "【OCR待核对55%】图\n【OCR待核对41%】图\n其他用户\n出 H200 服务器 1台\n样例甲\n采购SK 32g5600 dc24 160条\n请提供报价\n另一位用户\n收 SSD 10块",
    source: { channel: "WECHAT_RPA", chatName: base.chatName, sender: "未识别（截图识别）", sentAt: null, observedAt: "2026-11-02T08:05:00.000Z", messageId: "fixture-mixed-snapshot", deviceId: base.deviceId, captureMode: "OCR_SNAPSHOT" },
    reviewFlags: ["OCR_REQUIRES_REVIEW", "OCR_TEXT_UNCERTAIN"],
    parsedResult: parsed([{ postType: "GOODS", rawText: "出 H200 服务器 1台" }, { postType: "DEMAND", rawText: BODY, sourceContact: "未知来源" }]),
  };
  return { canonical, snapshot };
}

test("the exact 样例甲 bubble links only its item inside a mixed snapshot and leaves all original evidence intact", () => {
  const { canonical, snapshot } = fixture();
  const before = JSON.stringify({ canonical, snapshot });
  assert.deepEqual(deriveRpaSourceLinks(snapshot, [snapshot, canonical]), [{ itemIndex: 1, captureId: canonical.id, sourceItemIndex: 0, sender: "样例甲", messageId: canonical.messageId, observedAt: canonical.observedAt, match: "EXACT_BUBBLE", uniqueTimeSource: true }]);
  assert.equal(JSON.stringify({ canonical, snapshot }), before);
  assert.equal(snapshot.sender, "未识别（截图识别）");
});

test("different nicknames with identical full messages are ambiguous, even if one name has a matching line", () => {
  const { canonical, snapshot } = fixture();
  const other = { ...structuredClone(canonical), id: "rpa-other-author", sender: "其他卖家" };
  assert.deepEqual(deriveRpaSourceLinks(snapshot, [canonical, other]), []);
  assert.deepEqual(deriveRpaSourceLinks(snapshot, [other, canonical]), []);
});

test("only one matching canonical bubble can contribute its WeChat publication evidence", () => {
  const { canonical, snapshot } = fixture();
  const publishedTime = { kind: "WECHAT_MARKER" as const, at: "2026-11-02T07:00:00.000Z" };
  canonical.publishedTime = publishedTime;
  assert.deepEqual(deriveRpaSourceLinks(snapshot, [canonical])[0].publishedTime, publishedTime);
  assert.equal(snapshot.publishedTime, undefined);
  const repost = { ...canonical, id: "other", publishedTime: { ...publishedTime, at: "2026-11-02T07:45:00.000Z" } };
  const ambiguous = deriveRpaSourceLinks(snapshot, [canonical, repost])[0];
  assert.equal(ambiguous.publishedTime, undefined);
  assert.equal(ambiguous.uniqueTimeSource, false);
  const later = { ...canonical, observedAt: "2026-11-02T08:12:00Z", publishedTime: { kind: "WECHAT_MINUTE" as const, at: "2026-11-02T08:11:00Z" } };
  const subsequent = deriveRpaSourceLinks(snapshot, [later])[0];
  assert.equal(subsequent.publishedTime, undefined);
  assert.equal(subsequent.uniqueTimeSource, false);
  const day = { kind: "WECHAT_DATE" as const, date: "2026-11-02" };
  assert.deepEqual(deriveRpaSourceLinks(snapshot, [{ ...canonical, publishedTime: day }])[0].publishedTime, day);
  assert.equal(deriveRpaSourceLinks(snapshot, [{ ...later, publishedTime: day }])[0].publishedTime, undefined);
});

test("names inside an unknown-author single bubble never become external nickname evidence", () => {
  const { canonical, snapshot } = fixture();
  assert.ok(deriveRpaSourceLinks(snapshot, [canonical]).length);
  assert.deepEqual(deriveRpaSourceLinks({ ...snapshot, captureUnit: "TEXT_BUBBLE" }, [canonical]), []);
  assert.deepEqual(deriveRpaSourceLinks({ ...snapshot, source: { ...snapshot.source, captureUnit: "TEXT_BUBBLE" } }, [canonical]), []);
});

test("links never cross workspace, user, device, group, readiness or the 30-minute capture window", () => {
  const { canonical, snapshot } = fixture();
  const invalid: Array<Partial<RpaMessage>> = [
    { workspaceId: "other-workspace" }, { userId: "other-user" }, { deviceId: "other-device" }, { chatName: "B300真实交易群" },
    { status: "FAILED" }, { status: "DISMISSED" }, { status: "PROCESSING" }, { captureMode: "UIA_MESSAGE" },
    { observedAt: "2026-11-02T07:34:59.999Z" }, { observedAt: "2026-11-02T08:35:00.001Z" }, { observedAt: "invalid" },
  ];
  for (const patch of invalid) assert.deepEqual(deriveRpaSourceLinks(snapshot, [{ ...canonical, ...patch }]), [], JSON.stringify(patch));
  assert.equal(deriveRpaSourceLinks(snapshot, [{ ...canonical, observedAt: "2026-11-02T07:35:00.000Z" }]).length, 1);
  assert.equal(deriveRpaSourceLinks(snapshot, [{ ...canonical, observedAt: "2026-11-02T08:35:00.000Z" }]).length, 1);
});

test("partial SKU resemblance, interrupted nickname/body evidence and uncertain OCR cannot create links", () => {
  const { canonical, snapshot } = fixture();
  const texts = [BODY, `用户 样例甲\n${BODY}`, `样例甲\n中间有其他内容\n${BODY}`, `样例甲\n${BODY} 另加一段`, `样例甲\n${BODY.replace("SK", "sk")}`, `【OCR待核对55%】样例甲\n${BODY}`, `样例甲\n【OCR待核对】${BODY}`, "样例甲\n采购SK 32g5600 dc24 160条\n【OCR待核对】请提供报价"];
  for (const text of texts) assert.deepEqual(deriveRpaSourceLinks({ ...snapshot, text }, [canonical]), [], text);
  const partial = { ...snapshot, parsedResult: parsed([{ rawText: "SK 32g5600 dc24 160条" }]) };
  assert.deepEqual(deriveRpaSourceLinks(partial, [canonical]), []);
  assert.deepEqual(deriveRpaSourceLinks(snapshot, [{ ...canonical, parsedResult: parsed([{ rawText: "SK 32g5600 dc24 160条" }]) }]), []);
  assert.deepEqual(deriveRpaSourceLinks(snapshot, [{ ...canonical, parsedResult: parsed([{ rawText: BODY }, { rawText: BODY }]) }]), []);
  assert.deepEqual(deriveRpaSourceLinks(snapshot, [{ ...canonical, text: `【OCR待核对】${BODY}` }]), []);
});

test("a sole matching canonical parsed item supplies its real index; same-author repeats choose closest capture", () => {
  const { canonical, snapshot } = fixture();
  canonical.parsedResult = parsed([{ rawText: "不相关的附注" }, { rawText: BODY }]);
  const nearer = { ...structuredClone(canonical), id: "rpa-nearer", observedAt: "2026-11-02T08:04:00.000Z" };
  assert.equal(deriveRpaSourceLinks(snapshot, [canonical, nearer])[0].captureId, nearer.id);
  assert.equal(deriveRpaSourceLinks(snapshot, [nearer, canonical])[0].sourceItemIndex, 1);
});

test("quoted, replied or forwarded nicknames cannot supply authorship, while unrelated quote blocks do not veto a real bubble", () => {
  const { canonical, snapshot } = fixture();
  for (const marker of ["引用消息", "回复消息", "转发消息", "合并转发", "聊天记录"]) {
    assert.deepEqual(deriveRpaSourceLinks({ ...snapshot, text: `Alistair\n${marker}\n样例甲\n${BODY}` }, [canonical]), [], marker);
  }
  assert.equal(deriveRpaSourceLinks({ ...snapshot, text: `Alistair\n引用消息\n其他用户\n其他商品\n\n样例甲\n${BODY}` }, [canonical]).length, 1);
});

test("server-owned aliases are bidirectional across snapshots and all same-author canonical whitespace variants", () => {
  const { canonical, snapshot } = fixture();
  const before = JSON.stringify({ canonical, snapshot });
  const first = deriveRpaSourceMetadata([canonical, snapshot]);
  assert.deepEqual(first.get(canonical)!.sourceItemAliases, [{ itemIndex: 0, keys: [`${canonical.id}:0`, `${snapshot.id}:1`].sort() }]);
  const otherSnapshot = { ...structuredClone(snapshot), id: "rpa-second-snapshot", parsedResult: parsed([{ rawText: BODY }]) };
  const variant = { ...structuredClone(canonical), id: "rpa-canonical-variant", observedAt: "2026-11-02T08:04:00.000Z", text: "采购 SK32g5600\n dc24 160条 请提供报价", parsedResult: parsed([{ rawText: "采购SK32g5600 dc24\n160条请提供报价" }]) };
  const metadata = deriveRpaSourceMetadata([otherSnapshot, variant, snapshot, canonical]);
  const keys = [`${canonical.id}:0`, `${snapshot.id}:1`, `${otherSnapshot.id}:0`, `${variant.id}:0`].sort();
  assert.deepEqual(metadata.get(canonical)!.sourceItemAliases, [{ itemIndex: 0, keys }]);
  assert.deepEqual(metadata.get(variant)!.sourceItemAliases, [{ itemIndex: 0, keys }]);
  assert.deepEqual(metadata.get(snapshot)!.sourceItemAliases, [{ itemIndex: 1, keys }]);
  assert.deepEqual(metadata.get(otherSnapshot)!.sourceItemAliases, [{ itemIndex: 0, keys }]);
  assert.equal(metadata.get(snapshot)!.sourceLinks[0].captureId, variant.id, "changing the preferred capture still retains every earlier equivalent key");
  assert.equal(JSON.stringify({ canonical, snapshot }), before);
  const foreign = { ...structuredClone(otherSnapshot), id: "rpa-other-scope", userId: "other-user" };
  const scoped = deriveRpaSourceMetadata([canonical, snapshot, foreign]);
  assert.deepEqual(scoped.get(foreign)!.sourceItemAliases, []);
  assert.equal(scoped.get(canonical)!.sourceItemAliases[0].keys.includes(`${foreign.id}:0`), false);
});

test("list derives links after reverse arrival and ignores pagination, status filtering and AI-supplied links", async () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".rpa-source-test-"));
  const filePath = path.join(directory, "messages.json");
  const session = { userId: "fixture-user", currentWorkspaceId: "fixture-workspace", expiresAt: Date.now() + 60_000 };
  const { canonical, snapshot } = fixture();
  const input = (capture: RpaMessage): RpaInputMessage => ({ messageId: capture.messageId, chatName: capture.chatName, sender: capture.sender, sentAt: null, observedAt: capture.observedAt, text: capture.text, captureMode: capture.captureMode });
  const inbox = new RpaInbox({ filePath, parse: async (_text, message) => {
    const result = structuredClone(message.captureMode === "OCR_SNAPSHOT" ? snapshot.parsedResult! : canonical.parsedResult!);
    Object.assign(result, { sourceLinks: [{ itemIndex: 0, sender: "AI伪造来源", captureId: "untrusted" }] });
    Object.assign(result.data, { sourceLinks: [{ itemIndex: 0, sender: "AI伪造来源", captureId: "untrusted" }] });
    Object.assign(result.data, { sourceItemAliases: [{ itemIndex: 0, keys: ["forged:0"] }] });
    return result;
  } });
  try {
    const acceptedSnapshot = inbox.ingest(session, { deviceId: "fixture-device", messages: [input(snapshot)] });
    await inbox.whenIdle();
    assert.deepEqual(inbox.list(session, {}).items[0].sourceLinks, []);
    const acceptedCanonical = inbox.ingest(session, { deviceId: "fixture-device", messages: [input(canonical)] });
    await inbox.whenIdle();
    const snapshotId = acceptedSnapshot.accepted[0].id;
    const canonicalId = acceptedCanonical.accepted[0].id;
    const firstPage = inbox.list(session, { page: 1, pageSize: 1 });
    const secondPage = inbox.list(session, { page: 2, pageSize: 1 });
    assert.equal(firstPage.items[0].id, snapshotId, "the snapshot was observed later");
    assert.equal(secondPage.items[0].id, canonicalId);
    assert.equal(firstPage.items[0].sourceLinks?.[0].captureId, canonicalId);
    inbox.transition(session, snapshotId, "dismiss");
    const stored = JSON.parse(fs.readFileSync(filePath, "utf8"));
    for (const message of stored.messages) Object.assign(message, { sourceLinks: [{ itemIndex: 0, sender: "持久化伪造来源", captureId: "forged" }], sourceItemAliases: [{ itemIndex: 0, keys: ["forged-persisted:0"] }] });
    fs.writeFileSync(filePath, JSON.stringify(stored));
    const before = fs.readFileSync(filePath, "utf8");
    const filtered = inbox.list(session, { status: "DISMISSED", pageSize: 1 });
    assert.equal(filtered.items[0].sourceLinks?.[0].sender, "样例甲");
    assert.equal(filtered.items[0].sourceLinks?.[0].sourceItemIndex, 0);
    assert.equal(filtered.items[0].sourceLinks?.[0].itemIndex, 1);
    assert.deepEqual(filtered.items[0].sourceItemAliases, [{ itemIndex: 1, keys: [`${canonicalId}:0`, `${snapshotId}:1`].sort() }]);
    assert.equal(fs.readFileSync(filePath, "utf8"), before, "listing must never mutate persisted raw text or parse results");
    const reloaded = new RpaInbox({ filePath, parse: async () => { throw new Error("existing READY captures must not be reparsed"); } });
    assert.equal(reloaded.list(session, { status: "DISMISSED" }).items[0].sourceLinks?.[0].captureId, canonicalId);
    const restoredCanonical = reloaded.list(session, { status: "READY" }).items[0];
    assert.deepEqual(restoredCanonical.sourceItemAliases, [{ itemIndex: 0, keys: [`${canonicalId}:0`, `${snapshotId}:1`].sort() }]);
    assert.equal(JSON.stringify(restoredCanonical.sourceItemAliases).includes("forged"), false);
    assert.equal(reloaded.list({ ...session, currentWorkspaceId: "other-workspace" }, {}).total, 0);
  } finally {
    await inbox.whenIdle();
    assert.equal(path.resolve(directory).startsWith(path.join(process.cwd(), ".rpa-source-test-")), true);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
