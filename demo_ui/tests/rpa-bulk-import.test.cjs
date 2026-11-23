const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

const projectDir = path.resolve(__dirname, "..");
const bundled = esbuild.buildSync({
  entryPoints: [path.join(projectDir, "src/components/WechatRpaInbox.tsx")],
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
}).outputFiles[0].text;
const compiled = new Module(path.join(projectDir, "rpa-bulk-tests.cjs"), module);
compiled.filename = path.join(projectDir, "rpa-bulk-tests.cjs");
compiled.paths = module.paths;
compiled._compile(bundled, compiled.filename);
const { rpaMessageCanBulkImport, rpaMessageReview, rpaItemSource, collectStableRpaReadyMessages } = compiled.exports;

const message = (id, overrides = {}) => ({
  id, messageId: id, deviceId: "fixture-device", chatName: "B300真实交易群", sender: "fixture-sender", sentAt: null,
  observedAt: "2026-11-02T12:00:00Z", text: "B300现货2张", status: "READY", captureMode: "OCR_MESSAGE",
  result: { items: [{ postType: "GOODS", model: "B300", quantity: 2 }] }, ...overrides,
});
const pageOf = (items, page, pageSize = 100) => ({ items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize });

test("RPA import keeps publication evidence on its own bubble or its canonical item link", () => {
  const publishedTime = { kind: "WECHAT_CLOCK", clock: "11:18" };
  const m = message("m", { publishedTime });
  assert.deepEqual(rpaItemSource(m, 0).publishedTime, publishedTime);
  const snap = message("s", { captureMode: "OCR_SNAPSHOT", captureUnit: "VIEWPORT_REMAINDER", publishedTime,
    sourceLinks: [{ itemIndex: 1, captureId: "m", sourceItemIndex: 0, sender: m.sender, messageId: "m", observedAt: m.observedAt, publishedTime, match: "EXACT_BUBBLE" }] });
  assert.equal(rpaItemSource(snap, 0).publishedTime, undefined);
  assert.deepEqual(rpaItemSource(snap, 1).publishedTime, publishedTime);
  assert.equal(rpaItemSource(m, 0).sentAt, null);
});

test("stored offline OCR warnings show one capture caution and preserve specific trade and uncertainty flags", () => {
  const fullScreen = message("legacy", {
    captureMode: "OCR_SNAPSHOT", reviewFlags: ["OCR_REQUIRES_REVIEW"],
    parsedResult: { isMock: true, provider: "mock", data: { items: [], warnings: [
      "当前为本地离线解析。配置 DEEPSEEK_API_KEY 后会调用 DeepSeek 做完整语义抽取。",
      "当前为本地规则解析，尚未调用真实 AI；请核对后再入库。",
      "截图文字可能混合多人和多个报价；来源、单位、价格归属需要逐条人工核对。",
      "部分条目没有识别到微信来源用户，请在待确认结果中补齐。",
    ] } },
  });
  const review = rpaMessageReview(fullScreen);
  assert.equal(review.method, "本地规则");
  assert.equal(review.warnings.length, 1);
  assert.match(review.warnings[0], /多条报价.*逐条核对.*单位/);
  fullScreen.parsedResult.data.warnings.push("第二条报价缺单价。");
  fullScreen.reviewFlags.push("POSSIBLE_SOLD_OR_CANCELLED", "OCR_TEXT_UNCERTAIN");
  const details = rpaMessageReview(fullScreen).warnings;
  assert.equal(details.length, 4);
  assert.ok(details.includes("第二条报价缺单价。"));
  assert.ok(details.some(text => text.includes("可能已售出")));
  assert.ok(details.some(text => text.includes("文字识别不确定")));
  const single = rpaMessageReview({ ...fullScreen, captureUnit: "TEXT_BUBBLE" });
  assert.match(single.warnings[0], /这条报价/);
  assert.doesNotMatch(single.warnings.join(" "), /多人|多条报价/);
  const legacySource = { ...fullScreen, captureMode: undefined, source: { captureMode: "OCR_SNAPSHOT" } };
  assert.deepEqual(rpaMessageReview(legacySource).warnings, details);
  assert.equal(rpaMessageCanBulkImport({ ...message("old"), captureMode: undefined, source: legacySource.source }), false);
});

test("processing method follows record metadata regardless of OCR, and only bound source warnings are removed", () => {
  const unsourced = "部分条目没有识别到微信来源用户，请在待确认结果中补齐。";
  const parsed = message("paired", {
    isMock: false, provider: "deepseek", reviewFlags: ["OCR_REQUIRES_REVIEW"],
    result: { items: [], warnings: ["昵称与消息气泡由截图位置配对，来源昵称、数量和价格仍需人工核对；原消息时间尚未识别。"] },
  });
  assert.equal(rpaMessageReview(parsed).method, "DeepSeek");
  assert.equal(rpaMessageReview(parsed).warnings.length, 1);
  assert.equal(rpaMessageReview(message("unknown")).method, "未记录");
  const direct = message("uia", { captureMode: "UIA_MESSAGE", result: { items: [{ sourceContact: "未知来源" }], warnings: [unsourced] } });
  assert.deepEqual(rpaMessageReview(direct).warnings, [unsourced]);
  direct.result.items[0].sourceContact = direct.sender;
  assert.deepEqual(rpaMessageReview(direct).warnings, []);
});

test("bulk accepts complete parsed text, preserves legacy OCR_MESSAGE, excludes whole viewports and empty/failed records", () => {
  for (const options of [{}, { captureMode: "UIA_MESSAGE" }, { captureMode: undefined }, { captureMode: "OCR_SNAPSHOT", captureUnit: "TEXT_BUBBLE" }]) {
    assert.equal(rpaMessageCanBulkImport(message("m", options)), true);
  }
  for (const options of [
    { captureMode: "OCR_SNAPSHOT" }, { captureMode: "OCR_SNAPSHOT", captureUnit: "VIEWPORT_REMAINDER" },
    { captureUnit: "VIEWPORT_REMAINDER" }, { text: "  " }, { status: "FAILED" }, { result: { items: [] } },
  ]) assert.equal(rpaMessageCanBulkImport(message("m", options)), false);
});

test("bulk qualification uses canonical links and server aliases, but still accepts a message with some pending items", () => {
  const snapshot = message("s", {
    captureMode: "OCR_SNAPSHOT", captureUnit: "TEXT_BUBBLE",
    sourceLinks: [{ itemIndex: 0, captureId: "canonical", sourceItemIndex: 0, sender: "fixture-sender", messageId: "c", observedAt: "2026-11-02T12:00:00Z", match: "EXACT_BUBBLE" }],
    sourceItemAliases: [{ itemIndex: 0, keys: ["old-screen:0", "canonical:0"] }],
  });
  assert.equal(rpaMessageCanBulkImport(snapshot, new Set(["old-screen:0"])), false);
  assert.equal(rpaMessageCanBulkImport(snapshot, new Set(["canonical:0"])), false);
  assert.equal(rpaMessageCanBulkImport({ ...snapshot, result: { items: [{ model: "B300" }, { model: "H200" }] } }, new Set(["canonical:0"])), true);
});

test("all pages are read twice with total and unique-ID validation before returning one batch", async () => {
  const items = Array.from({ length: 205 }, (_, index) => message(`m${index}`));
  const calls = [];
  const collected = await collectStableRpaReadyMessages(async (page, pageSize) => {
    calls.push([page, pageSize]);
    return pageOf(items, page, pageSize);
  }, new AbortController().signal);
  assert.equal(collected.length, 205);
  assert.deepEqual(calls, [[1, 100], [2, 100], [3, 100], [1, 100], [2, 100], [3, 100]]);
});

test("a total change restarts collection and returns only the later complete stable batch", async () => {
  const items = Array.from({ length: 205 }, (_, index) => message(`m${index}`));
  let calls = 0;
  const collected = await collectStableRpaReadyMessages(async (page, size) => {
    calls += 1;
    const response = pageOf(items, page, size);
    return calls === 2 ? { ...response, total: 206 } : response;
  }, new AbortController().signal);
  assert.equal(collected.length, 205);
  assert.equal(calls, 8);
});

test("same-total ID replacement between full reads is detected and retried", async () => {
  let calls = 0;
  const oldItems = [message("old-1"), message("old-2")];
  const newItems = [message("old-1"), message("new-2")];
  const collected = await collectStableRpaReadyMessages(async (page, size) => {
    calls += 1;
    return pageOf(calls === 1 ? oldItems : newItems, page, size);
  }, new AbortController().signal);
  assert.deepEqual(collected.map((item) => item.id), ["old-1", "new-2"]);
  assert.equal(calls, 4);
});

test("duplicate IDs across pages fail after bounded retries without returning a partial batch", async () => {
  const items = Array.from({ length: 101 }, (_, index) => message(index === 100 ? "m0" : `m${index}`));
  let calls = 0;
  await assert.rejects(collectStableRpaReadyMessages(async (page, size) => {
    calls += 1;
    return pageOf(items, page, size);
  }, new AbortController().signal), /采集列表持续变化/);
  assert.equal(calls, 6);
});

test("a failed later page aborts the whole collection without retrying or returning partial results", async () => {
  const items = Array.from({ length: 101 }, (_, index) => message(`m${index}`));
  let calls = 0;
  await assert.rejects(collectStableRpaReadyMessages(async (page, size) => {
    calls += 1;
    if (page === 2) throw new Error("fixture network failure");
    return pageOf(items, page, size);
  }, new AbortController().signal), /fixture network failure/);
  assert.equal(calls, 2);
});

test("cancellation before or during a page prevents any returned batch", async () => {
  const before = new AbortController();
  before.abort();
  let calls = 0;
  await assert.rejects(collectStableRpaReadyMessages(async () => { calls += 1; return pageOf([], 1); }, before.signal), { name: "AbortError" });
  assert.equal(calls, 0);
  const during = new AbortController();
  await assert.rejects(collectStableRpaReadyMessages(async () => {
    calls += 1;
    during.abort();
    return pageOf([message("m")], 1);
  }, during.signal), { name: "AbortError" });
  assert.equal(calls, 1);
});
