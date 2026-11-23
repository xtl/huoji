import assert from "node:assert/strict";
import test from "node:test";
import { appendMatchHistory, matchHistoryPrefix, readMatchHistory } from "../src/match-verification-history";
import { emptyVerificationEntry } from "../src/supply-verification";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    key: index => Array.from(data.keys())[index] ?? null,
    clear: () => data.clear(),
    removeItem: key => { data.delete(key); },
  };
}

test("replies survive a fresh read, a retried save and interleaved writes without crossing account, workspace or deal", () => {
  const storage = memoryStorage();
  const prefix = matchHistoryPrefix("user", "desk", "demand", "stock");
  const otherPrefixes = [
    matchHistoryPrefix("other", "desk", "demand", "stock"), matchHistoryPrefix("user", "other", "demand", "stock"),
    matchHistoryPrefix("user", "desk", "other", "stock"), matchHistoryPrefix("user", "desk", "demand", "other"),
  ];
  const seller = { ...emptyVerificationEntry("seller"), confirmedBy: "供方甲", reply: "120条现货", stockQuantity: 120 };
  const buyer = { ...emptyVerificationEntry("buyer"), confirmedBy: "买方乙", reply: "收到了" };
  appendMatchHistory(storage, prefix, seller);
  appendMatchHistory(storage, prefix, buyer);
  appendMatchHistory(storage, prefix, seller);
  assert.deepEqual(new Set(readMatchHistory(storage, prefix).map(entry => entry.id)), new Set([seller.id, buyer.id]));
  assert.throws(() => appendMatchHistory(storage, prefix, { ...seller, reply: "误覆盖" }));
  for (const other of otherPrefixes) assert.deepEqual(readMatchHistory(storage, other), []);
});

test("unreadable evidence is reported and the original record survives", () => {
  const storage = memoryStorage();
  const prefix = matchHistoryPrefix("user", "desk", "demand", "stock");
  storage.setItem(prefix + "damaged", "null");
  assert.throws(() => readMatchHistory(storage, prefix));
  assert.equal(storage.getItem(prefix + "damaged"), "null");
});
