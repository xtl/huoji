import test from "node:test";
import assert from "node:assert/strict";
import {
  assessVerification, emptyVerificationEntry, suggestSellerFields, validateVerificationEntry,
  type VerificationContext, type VerificationEntry,
} from "../src/supply-verification";

const context: VerificationContext = {
  demandText: "样例甲 13900000000 采购SK 64g6400 dc25 200条，底价999，联系样例甲",
  supplyText: "Nora 转报白牌 120条现货",
  supplyQuantity: 120, demandQuantity: 200, unit: "条", demandUnit: "条", category: "MEMORY",
};
const morning = "2026-11-22T09:00:00+08:00";
const noon = new Date("2026-11-22T12:00:00+08:00");
const until = "2026-11-22T16:00:00+08:00";
function event(overrides: Partial<VerificationEntry>): VerificationEntry {
  return { ...emptyVerificationEntry(), recordedAt: morning, confirmedBy: "陈老板", reply: "供方回复原文", ...overrides };
}

test("群消息不构成核实，发给对方的问题仅含必要的规格和数量", () => {
  const result = assessVerification(context, [], noon);
  assert.equal(result.stockQuantity, undefined);
  assert.equal(result.activeReservedQuantity, 0);
  assert.match(result.sellerQuestion, /SK 64G 6400/);
  assert.match(result.sellerQuestion, /DC25/);
  assert.match(result.sellerQuestion, /200条/);
  assert.match(result.sellerQuestion, /120条/);
  const directPost = assessVerification({ ...context, supplyText: "白牌，120条现货" }, [], noon);
  assert.match(directPost.sellerQuestion, /原消息提到白牌/);
  assert.doesNotMatch(result.sellerQuestion, /样例甲|13900000000|999|Nora/);
  const server = assessVerification({ ...context, category: "SERVER", demandText: "求 H200 整机含内存条" }, [], noon);
  assert.doesNotMatch(server.sellerQuestion, /白牌/);
});

test("从卖家肯定答复中提议填写，仅识别可锁，任何推测或否定均留待人工", () => {
  const reply = "白牌，DC25，120条都在，只能锁80条到下午4点";
  assert.deepEqual(suggestSellerFields(reply, "条"), {
    packaging: "white-label", batch: "DC25", stockQuantity: 120, reservableQuantity: 80,
  });
  const result = assessVerification(context, [event({ reply, ...suggestSellerFields(reply, "条") })], noon);
  assert.equal(result.stockQuantity, 120);
  assert.equal(result.activeReservableQuantity, 80);
  assert.equal(result.activeReservedQuantity, 0);
  assert.match(result.buyerQuestion, /白牌/);
  for (const uncertain of ["不是白牌，120条都在", "没货，只能锁80条", "有120条？", "不保证可以锁80条", "可能已锁80条"]) {
    assert.deepEqual(suggestSellerFields(uncertain, "条"), {});
  }
  assert.deepEqual(suggestSellerFields("原厂颗粒，已锁80条到明天", "条"), {});
  assert.deepEqual(suggestSellerFields("现货200台", "条"), {});
  assert.equal(suggestSellerFields("现货100条，现货200条", "条").stockQuantity, undefined);
});

test("卖方核实、买方接受和部分预留分别归属原回复，16点到期后不再计入", () => {
  const supplier = event({ holder: "holder", packaging: "white-label", stockQuantity: 120, batch: "DC25" });
  const reserved = event({ recordedAt: "2026-11-22T10:00:00+08:00", reservedQuantity: 80, reservedUntil: until });
  const buyer = event({ role: "buyer", recordedAt: "2026-11-22T11:00:00+08:00", confirmedBy: "样例甲",
    reply: "白牌可以", acceptedPackaging: "white-label", buyerAcceptsPackaging: "yes" });
  const inputs = [buyer, supplier, reserved];
  const result = assessVerification(context, inputs, noon);
  assert.equal(result.latestStockEntry, supplier);
  assert.equal(result.latestReservedEntry, reserved);
  assert.equal(result.latestBuyerPackagingEntry, buyer);
  assert.equal(result.activeReservedQuantity, 80);
  assert.equal(result.shortfall, 120);
  assert.equal(result.buyerQuestion, "");
  const expired = assessVerification(context, inputs, new Date(until));
  assert.equal(expired.reservationExpired, true);
  assert.equal(expired.activeReservedQuantity, 0);
  assert.equal(expired.stockQuantity, 120);
  assert.equal(expired.shortfall, 200);
  assert.deepEqual(inputs, [buyer, supplier, reserved]);
});

test("中间人转述及有数量但缺期限的预留均不能生效，角色补充不能追认过去的转述", () => {
  const relayed = event({ holder: "intermediary", reservedQuantity: 80, reservedUntil: until });
  const confirmedHolder = event({ holder: "holder" });
  const otherRespondent = event({ confirmedBy: "另一联系人", reservedQuantity: 80, reservedUntil: until });
  assert.equal(assessVerification(context, [relayed, confirmedHolder], noon).activeReservedQuantity, 0);
  assert.equal(assessVerification(context, [confirmedHolder, otherRespondent], noon).activeReservedQuantity, 0);
  assert.equal(assessVerification(context, [confirmedHolder, event({ reservedQuantity: 80 })], noon).activeReservedQuantity, 0);
  const renewed = event({ reservedQuantity: 40, reservedUntil: until });
  assert.equal(assessVerification(context, [relayed, confirmedHolder, renewed], noon).activeReservedQuantity, 40);
  assert.equal(assessVerification(context, [confirmedHolder, renewed, event({ reservedQuantity: 0 })], noon).activeReservedQuantity, 0);
});

test("买方答复仅适用于其核对的品牌，改报白牌时重新询问", () => {
  const white = event({ packaging: "white-label" });
  const original = event({ packaging: "original" });
  const approved = event({ role: "buyer", buyerAcceptsPackaging: "yes", acceptedPackaging: "original" });
  assert.equal(assessVerification(context, [original, approved], noon).latestBuyerPackagingEntry, approved);
  assert.equal(assessVerification(context, [original, approved, white], noon).latestBuyerPackagingEntry, undefined);
  const staleAcceptance = assessVerification(context, [original, white, approved], noon);
  assert.equal(staleAcceptance.latestBuyerPackagingEntry, undefined);
  assert.match(staleAcceptance.buyerQuestion, /白牌/);
  const declined = event({ role: "buyer", buyerAcceptsPackaging: "no", acceptedPackaging: "white-label" });
  assert.doesNotMatch(assessVerification(context, [white, declined], noon).sellerQuestion, /预留/);
  assert.doesNotMatch(assessVerification(context, [event({ batch: "DC24" })], noon).sellerQuestion, /预留/);
});

test("跨单位、相互矛盾或格式损坏的数据不产生可用承诺", () => {
  const hold = event({ holder: "holder", reservedQuantity: 80, reservedUntil: until });
  const lowerStock = event({ stockQuantity: 40 });
  assert.equal(assessVerification(context, [hold, lowerStock], noon).activeReservedQuantity, 0);
  assert.equal(assessVerification({ ...context, demandUnit: "台" }, [hold], noon).shortfall, undefined);
  for (const invalid of [
    event({ stockQuantity: -1 }), event({ reservedUntil: until }), event({ reservedUntil: "bad", reservedQuantity: 8 }),
    event({ confirmedBy: "" }), event({ role: "buyer", stockQuantity: 10 }),
    event({ role: "buyer", buyerAcceptsPackaging: "yes" }), event({ stockQuantity: 12, reservedQuantity: 15 }),
  ]) assert.ok(validateVerificationEntry(invalid, context));
});
