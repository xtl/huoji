import assert from "node:assert/strict";
import test from "node:test";
import { wechatTimeLabel } from "../src/wechat-time-label";

test("微信发布时间区分原始时间、相邻标记和跨日范围，按北京时间显示", () => {
  const at = "2026-11-21T16:18:00Z";
  assert.equal(wechatTimeLabel(at), "微信发布 2026-11-22 00:18");
  assert.equal(wechatTimeLabel(null, { kind: "WECHAT_MINUTE", at }), "微信发布 2026-11-22 00:18（分钟）");
  assert.equal(wechatTimeLabel(null, { kind: "WECHAT_MARKER", at }), "微信时间标记 2026-11-22 00:18");
  assert.equal(wechatTimeLabel(null, { kind: "WECHAT_RANGE", from: "2026-11-21T15:58:00Z", to: at }),
    "微信发布时间范围 2026-11-21 23:58 至 2026-11-22 00:18");
  assert.equal(wechatTimeLabel(null, { kind: "WECHAT_RANGE", from: at, to: "2026-11-21T16:53:00Z" }),
    "微信发布时间范围 2026-11-22 00:18 至 00:53");
  assert.equal(wechatTimeLabel(), "微信发布时间未识别");
});

test("微信只显示时分时，按原截图的北京日期显示；只显示日期时保留日期精度", () => {
  const clock = { kind: "WECHAT_CLOCK", clock: "00:14" } as const;
  assert.equal(wechatTimeLabel(null, clock, "2026-12-31T16:18:05Z"), "微信时间标记 2027-01-01 00:14");
  assert.equal(wechatTimeLabel(null, clock, "2026-12-30T16:18:05Z"), "微信时间标记 2026-12-31 00:14");
  assert.equal(wechatTimeLabel(null, clock), "微信时间标记 00:14（采集日期缺失）");
  assert.equal(wechatTimeLabel(null, clock, "2026-12-31T16:09:00Z"), "微信发布时间未识别");
  assert.equal(wechatTimeLabel(null, { kind: "WECHAT_DATE", date: "2026-11-20" }), "微信日期标记 2026-11-20");
  assert.equal(wechatTimeLabel(null, { kind: "WECHAT_DATE", date: "2026-02-31" }), "微信发布时间未识别");
});
