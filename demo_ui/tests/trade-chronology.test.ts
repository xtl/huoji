import assert from "node:assert/strict";
import test from "node:test";
import { compareChronology, publicationEpoch, sortTradesByTime, tradeChronology } from "../src/trade-chronology";

test("a late backfill cannot outrank a newer message, including across page boundaries", () => {
  const lateImport = "2026-11-23T10:00:00+08:00";
  const records = Array.from({ length: 65 }, (_, minute) => ({
    id: minute, sourceSentAt: new Date(Date.UTC(2026, 10, 20, 0, minute)).toISOString(),
    createdAt: new Date(Date.parse(lateImport) - minute * 60000).toISOString(),
  }));
  const sorted = sortTradesByTime([...records, { id: -1, sourceSentAt: "", createdAt: lateImport }]);
  assert.deepEqual(sorted.map(item => item.id), [...records.map(r => r.id).reverse(), -1]);
  assert.deepEqual(sorted.slice(29, 32).map(item => item.id), [35, 34, 33]);
});

test("WeChat date, range and clock evidence use Beijing calendar and preserve uncertain precision", () => {
  const observed = "2026-11-21T00:15:00+08:00";
  assert.equal(publicationEpoch(null, { kind: "WECHAT_CLOCK", clock: "00:05" }, observed), Date.parse("2026-11-20T16:05:00Z"));
  assert.equal(publicationEpoch(null, { kind: "WECHAT_CLOCK", clock: "08:15" }), null);
  assert.equal(publicationEpoch(null, { kind: "WECHAT_DATE", date: "2026-11-21" }), Date.parse("2026-11-20T16:00:00Z"));
  assert.equal(publicationEpoch(null, { kind: "WECHAT_DATE", date: "2026-02-30" }), null);
  const range = { kind: "WECHAT_RANGE", from: "2026-11-21T09:20:00Z", to: "2026-11-21T09:28:00Z" } as const;
  assert.equal(publicationEpoch("", range), Date.parse(range.to));
  assert.equal(publicationEpoch(range.from, range), Date.parse(range.from));
  assert.equal(publicationEpoch(null, { ...range, from: range.to, to: range.from }), null);
});

test("unknown publication times use capture then entry time with stable ties", () => {
  const newer = "2026-11-23T01:00:00Z", older = "2026-11-22T01:00:00Z";
  const captured = tradeChronology({ sourceObservedAt: older, createdAt: newer });
  const pasted = tradeChronology({ createdAt: newer });
  assert.ok(compareChronology(pasted, captured) < 0);
  assert.equal(compareChronology(captured, tradeChronology({ publishedAt: older })), 0);
  assert.ok(compareChronology(tradeChronology({ sourceSentAt: older }), pasted) < 0);
});
