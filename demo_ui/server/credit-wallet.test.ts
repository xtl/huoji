import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { createSign, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { CreditWallet, addBillingMonths, pointScale } from "./credit-wallet";
import { EnterpriseStore } from "./enterprise";
import { actualCharge, modelPrices } from "./model-credit-prices";
import { pointsPerCostYuan, pricingVersion } from "../src/credit-pricing";

test("annual billing credits 12 anniversaries, preserves the old entitlement and reserves concurrent spending", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "huoji-annual-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new EnterpriseStore(path.join(dir, "ledger.sqlite"));
  const wallet = new CreditWallet(store);
  const scope = { userId: "member", currentWorkspaceId: "ent_annual" };
  const start = "2026-01-30T16:00:00.000Z"; // midnight in Beijing on Jan 31
  const order = {
    id: "annual",
    workspaceId: scope.currentWorkspaceId,
    userId: scope.userId,
    status: "PAID",
    title: "年卡",
    paidAt: start,
    entitlement: { creditAmount: 84000, planCode: "PRO_YEARLY", installments: 12, months: 12 },
  };
  wallet.applyPaid(order, start);
  wallet.applyPaid(order, start);
  assert.equal(wallet.snapshot(scope, false, start).creditBalance, 7000);
  assert.equal(addBillingMonths(start, 1), "2026-02-27T16:00:00.000Z");
  assert.equal(wallet.snapshot(scope, false, "2026-02-27T15:59:59.999Z").creditBalance, 7000);
  assert.equal(wallet.snapshot(scope, false, addBillingMonths(start, 1)).creditBalance, 14000);
  wallet.postDueGrants(addBillingMonths(start, 11));
  assert.equal(wallet.snapshot(scope, false, addBillingMonths(start, 12)).creditBalance, 84000);
  assert.equal(wallet.snapshot(scope, false, addBillingMonths(start, 12)).planCode, "FREE");
  assert.equal(wallet.snapshot({ ...scope, currentWorkspaceId: "ent_other" }, false, start).creditBalance, 0);
  wallet.applyPaid({ ...order, id: "legacy-topup", entitlement: { creditAmount: 100 } }, start);
  assert.equal(wallet.snapshot(scope, false, start).creditBalance, 84100);
  const rate = modelPrices("deepseek-flash", new Date("2026-11-23T02:00:00Z"), pointsPerCostYuan);
  const usage = { prompt_tokens: 2000, prompt_cache_hit_tokens: 1000, completion_tokens: 300 };
  assert.equal(actualCharge(rate, usage)! / pointScale, 2.4864);
  assert.equal(actualCharge(rate, { prompt_tokens: 2000, completion_tokens: 300 }), null);
  assert.equal(modelPrices("deepseek-flash", new Date("2027-10-01T02:00:00Z"), pointsPerCostYuan).peak, false);
  const hold = wallet.reserve(scope, "call", "d", 84100 * pointScale - 1000, 1, 1000);
  assert.throws(() => wallet.reserve(scope, "another", "d", 0, 1, 1000), /货记分不足/);
  wallet.settle(hold.attempt!, actualCharge(rate, usage), { rate, usage }, { result: 1 }, "粘贴录入解析");
  assert.deepEqual(wallet.reserve(scope, "call", "d", 0, 1, 1000).cached, { result: 1 });
  assert.equal(wallet.snapshot(scope, false).creditBalance, 84097.5136);
});

test("signed Alipay top-up and membership orders use their stored entitlement and workspace exactly once", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "huoji-paid-"));
  const original = { ...process.env };
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  Object.assign(process.env, {
    NODE_ENV: "test",
    RPA_LOCAL_CONTROL: "0",
    SMS_UNIVERSAL_CODE: "fixture",
    ALIPAY_APP_ID: "test-app",
    ALIPAY_MERCHANT_PRIVATE_KEY: privateKey,
    ALIPAY_PUBLIC_KEY: publicKey,
    ALIPAY_SELLER_ID: "test-seller",
    AUTH_STATE_FILE: path.join(dir, "identity.json"),
    RPA_MESSAGES_FILE: path.join(dir, "rpa.json"),
    PAYMENT_ORDERS_FILE: path.join(dir, "orders.json"),
  });
  const { app } = await import("../server");
  const site = app.listen(0, "127.0.0.1");
  await once(site, "listening");
  t.after(() => {
    site.closeAllConnections();
    site.close();
    process.env = original;
    rmSync(dir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + (site.address() as AddressInfo).port + "/api";
  let token = "";
  const api = (route: string, body?: unknown) =>
    fetch(base + route, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: body ? JSON.stringify(body) : undefined,
    });
  token = (await (await api("/auth/sms/login", { phone: "13900008876", code: "fixture" })).json()).token;
  const balance = async () => (await (await api("/wallet")).json()).creditBalance;
  assert.equal(await balance(), 128);
  const create = async (productType: string, productId: string) =>
    (await (await api("/payments/alipay/orders", { productType, productId, pricingVersion })).json()).order;
  const settle = async (id: string, amount: string, valid = true) => {
    const fields = {
      app_id: "test-app",
      out_trade_no: id,
      total_amount: amount,
      trade_status: "TRADE_SUCCESS",
      seller_id: "test-seller",
    };
    const content = Object.entries(fields)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => k + "=" + v)
      .join("&");
    const sign = valid ? createSign("RSA-SHA256").update(content).sign(privateKey, "base64") : "invalid";
    return (await api("/payments/alipay/notify", { ...fields, sign_type: "RSA2", sign })).text();
  };
  for (const [price, points] of [
    [10, 2000],
    [50, 10000],
    [100, 20000],
  ]) {
    const order = await create("CREDIT_PACKAGE", "credits_cny_" + price);
    assert.equal(order.amountYuan, price.toFixed(2));
    assert.equal(order.entitlement.creditAmount, points);
    const before = await balance();
    assert.equal(await settle(order.id, order.amountYuan, false), "failure");
    assert.equal(await settle(order.id, "1.00"), "failure");
    assert.equal(await balance(), before);
    assert.equal(await settle(order.id, order.amountYuan), "success");
    assert.equal(await settle(order.id, order.amountYuan), "success");
    assert.equal(await balance(), before + points);
  }
  const annual = await create("MEMBERSHIP_PLAN", "PRO_YEARLY"),
    monthly = await create("MEMBERSHIP_PLAN", "PRO_MONTHLY");
  assert.equal(monthly.amountYuan, "28.00");
  assert.equal(monthly.entitlement.creditAmount, 5600);
  assert.equal(annual.amountYuan, "336.00");
  const before = await balance();
  assert.equal(await settle(annual.id, "336.00"), "success");
  assert.equal(await balance(), before + 7000);
  assert.equal((await (await api("/wallet")).json()).nextGrant.amount, 7000);
});
