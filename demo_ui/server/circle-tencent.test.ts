import test from "node:test";
import assert from "node:assert/strict";
import { tencentDelivery } from "./circle-tencent";

test("Tencent signs only an IM identity and dispatches a business reference without private quote contents", async (t) => {
  const keys = ["TENCENT_IM_APP_ID", "TENCENT_IM_ADMIN", "TENCENT_IM_SECRET_KEY"] as const;
  const prior = keys.map((k) => process.env[k]);
  t.after(() =>
    keys.forEach((k, i) => {
      if (prior[i] === undefined) delete process.env[k];
      else process.env[k] = prior[i];
    }),
  );
  process.env.TENCENT_IM_APP_ID = "100001";
  process.env.TENCENT_IM_ADMIN = "unit-admin";
  process.env.TENCENT_IM_SECRET_KEY = "test-signing-value";
  const calls: { path: string; body: Record<string, any> }[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL, opts: RequestInit) => {
    assert.equal(url.origin, "https://console.tim.qq.com");
    calls.push({ path: url.pathname, body: JSON.parse(String(opts.body)) });
    return new Response(JSON.stringify({ ErrorCode: 0 }), { status: 200 });
  });
  const provider = tencentDelivery()!;
  const auth = provider.credentials("hj_a");
  assert.deepEqual(Object.keys(auth).sort(), ["appId", "userId", "userSig"]);
  assert.equal(auth.userId, "hj_a");
  assert.ok(auth.userSig.length > 30);
  await provider.deliver("hj_a", "hj_b", "example-thread", 2);
  assert.equal(calls.filter((c) => c.path.endsWith("account_import")).length, 2);
  const message = calls.find((c) => c.path.endsWith("sendmsg"))!.body;
  assert.equal(message.From_Account, "hj_a");
  assert.equal(message.To_Account, "hj_b");
  assert.deepEqual(JSON.parse(message.MsgBody[0].MsgContent.Data), {
    business: "huoji",
    thread: "example-thread",
    id: 2,
  });
  await provider.deliver("hj_a", "hj_b", "example-thread", 3);
  assert.equal(calls.filter((c) => c.path.endsWith("account_import")).length, 2);
});
