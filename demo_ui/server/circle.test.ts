import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCircleRouter } from "./circle";
import type { AddressInfo } from "node:net";

test("demo history stays separate, keeps its owner and rejects messages", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "huoji-circle-demo-"));
  const identity = join(dir, "identity.json");
  const capture = join(dir, "rpa-messages.json");
  const phone = "13800000000";
  writeFileSync(identity, JSON.stringify({
    users: [{ phone, id: "demo-owner" }],
    workspaces: [{ ownerUserId: "demo-owner", id: "personal", type: "PERSONAL" }],
  }));
  writeFileSync(capture, JSON.stringify({ messages: [{
    userId: "demo-owner", workspaceId: "personal", sender: "private-canary",
    parsedResult: { data: { items: [{ gpuModel: "H200" }] } },
  }] }));
  const app = express();
  app.use(express.json());
  app.use(createCircleRouter(join(dir, "circle.sqlite"), header => ({
    userId: String(header).slice(7), currentWorkspaceId: "personal", displayName: "真实账号昵称",
  }), null));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  async function request(route: string, who = "viewer", method = "GET", body?: object) {
    const res = await fetch(origin + route, {
      method, headers: { Authorization: "Bearer " + who, "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
    });
    return { status: res.status, payload: await res.json() };
  }
  assert.deepEqual((await request("/posts")).payload.items, []);
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const seed = () => JSON.parse(execFileSync(process.execPath, ["scripts/seed-circle-demo.cjs", phone, date], {
    encoding: "utf8", env: { ...process.env, AUTH_STATE_FILE: identity, RPA_MESSAGES_FILE: capture },
    stdio: ["ignore", "pipe", "pipe"],
  }));
  const first = seed();
  assert.equal(first.inserted, 750);
  assert.equal(first.referencedModels, 1);
  assert.equal(first.totals.length, 15);
  assert.ok(first.totals.every((day: { total: number }) => day.total === 50));
  assert.equal(seed().inserted, 0);
  assert.deepEqual((await request("/posts")).payload.items, []);
  assert.deepEqual((await request("/posts?mine=1", "demo-owner")).payload.items, []);
  const { items, more } = (await request("/posts?demo=1")).payload;
  assert.equal(items.length, 30);
  assert.equal(more, true);
  const secondPage = (await request("/posts?demo=1&offset=30")).payload.items;
  assert.equal(new Set([...items, ...secondPage].map((post: { author: string }) => post.author)).size, 30);
  assert.ok(items.every((post: { demo: boolean }) => post.demo));
  const { id } = items[0];
  assert.equal((await request("/send", "viewer", "POST", { nonce: randomUUID(), postId: id, kind: "text", text: "询价" })).status, 409);
  assert.equal((await request("/posts/" + id + "/questions", "viewer", "POST", { nonce: randomUUID(), body: "有货吗" })).status, 409);
  assert.equal((await request("/posts/" + id, "viewer", "PATCH", { action: "close" })).status, 404);
  assert.equal((await request("/posts/" + id, "demo-owner", "PATCH", { action: "close" })).status, 200);
});

test("members publish whitelisted fields, talk privately, revise quotes and retain closed records", async (t) => {
  const app = express();
  app.use(express.json());
  app.use(
    "/c",
    createCircleRouter(
      ":memory:",
      (header) => {
        const [userId, currentWorkspaceId] = String(header ?? "")
          .slice(7)
          .split("/");
        return userId && currentWorkspaceId ? { userId, currentWorkspaceId, displayName: userId } : null;
      },
      null,
    ),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/c";
  async function req(user: string, path: string, body?: object, method?: string, expected = 200) {
    const res = await fetch(base + path, {
      method: method ?? (body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + user },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    assert.equal(res.status, expected, JSON.stringify(data));
    return data;
  }
  const buyer = "buyer/personal",
    seller = "seller/work",
    third = "other/work";
  await req("", "/posts", undefined, "GET", 401);
  const listing = {
    nonce: randomUUID(),
    kind: "求购",
    title: "SK DDR5 64G",
    quantity: "200 条",
    city: "上海",
    mode: "现货",
    role: "本人采购",
    days: 3,
    sourceSender: "private-canary",
  };
  const p = await req(buyer, "/posts", listing, "POST", 201);
  assert.equal((await req(buyer, "/posts", listing)).id, p.id);
  assert.equal(p.businessRole, "");
  const rental = await req(seller, "/posts", { ...listing, nonce: randomUUID(), mode: "租赁", businessRole: "贸易商" }, "POST", 201);
  assert.equal((await req(third, "/posts?scope=rental")).items[0].businessRole, "贸易商");
  assert.deepEqual((await req(third, "/posts?scope=sale")).items.map((row: {id: string}) => row.id), [p.id]);
  assert.deepEqual((await req(third, "/posts?scope=rental&kind=供应")).items, []);
  await req(seller, "/posts", { ...listing, nonce: randomUUID(), businessRole: "其他角色" }, "POST", 400);
  await req(seller, "/posts/" + rental.id, { action: "close" }, "PATCH");
  assert.equal(JSON.stringify(await req(third, "/posts")).includes("private-canary"), false);
  await req(third, "/posts/" + p.id, { action: "close" }, "PATCH", 404);
  const sig = await req(buyer, "/sync");
  const wake = req(buyer, "/sync?after=" + sig.revision);
  const quote = {
    quantity: "80 条",
    price: "1200 元/条",
    tax: "含税",
    delivery: "次日",
    validUntil: "2099-12-01",
  };
  const first = { postId: p.id, kind: "quote", nonce: randomUUID(), quote };
  const a = await req(seller, "/send", first);
  assert.equal((await req(seller, "/send", first)).id, a.id);
  assert.equal((await wake).unread, 1);
  await req(buyer, "/send", { postId: p.id, nonce: randomUUID(), kind: "text", text: "self" }, "POST", 400);
  await req("buyer/enterprise", "/threads/" + a.id, undefined, "GET", 404);
  await req(third, "/threads/" + a.id, undefined, "GET", 404);
  await req(third, "/send", { threadId: a.id, nonce: randomUUID(), kind: "text", text: "x" }, "POST", 404);
  await req(buyer, "/send", { threadId: a.id, nonce: randomUUID(), kind: "quote", quote }, "POST", 403);
  const second = await req(seller, "/send", {
    ...first,
    nonce: randomUUID(),
    quote: { ...quote, price: "1150 元/条" },
  });
  assert.equal(a.id, second.id);
  const h = await req(buyer, "/threads/" + a.id);
  assert.deepEqual(
    h.items.map((m: any) => m.version),
    [1, 2],
  );
  await req(buyer, "/threads/" + a.id + "/read", { id: h.items[0].id });
  assert.equal((await req(buyer, "/sync")).unread, 1);
  await req(buyer, "/threads/" + a.id + "/read", { id: h.items[1].id });
  assert.equal((await req(buyer, "/sync")).unread, 0);
  assert.equal((await req(buyer, "/posts/" + p.id)).offers[0].quote.price, "1150 元/条");
  assert.deepEqual((await req(third, "/posts/" + p.id)).offers, []);
  await req(seller, "/posts/" + p.id + "/questions", { nonce: randomUUID(), body: "是同批次吗？" });
  const question = (await req(third, "/posts/" + p.id)).questions[0];
  await req(buyer, "/posts/" + p.id + "/questions", { questionId: question.id, body: "需要同一批次" });
  assert.equal((await req(third, "/posts/" + p.id)).questions[0].answer, "需要同一批次");
  const dm = await req(seller, "/send", {
    postId: p.id,
    direct: true,
    nonce: randomUUID(),
    kind: "text",
    text: "你好",
  });
  assert.notEqual(dm.id, a.id);
  await req(buyer, "/posts/" + p.id, { action: "close" }, "PATCH");
  assert.equal((await req(seller, "/posts")).items.length, 0);
  await req(third, "/send", { postId: p.id, nonce: randomUUID(), kind: "text", text: "询价" }, "POST", 409);
  assert.equal((await req(buyer, "/threads/" + a.id)).items.length, 2);
  await req(buyer, "/send", { threadId: a.id, nonce: randomUUID(), kind: "status" });
  await req(seller, "/send", { threadId: a.id, nonce: randomUUID(), kind: "text", text: "x" }, "POST", 409);
});
