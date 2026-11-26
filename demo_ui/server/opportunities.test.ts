import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import express from "express";
import { createCircleRouter } from "./circle";
import { EnterpriseStore } from "./enterprise";
import { createOpportunityRouter } from "./opportunities";
import { createWorkspaceLedgerRouter } from "./workspace-ledger";
import type { OpportunityBoard } from "../src/opportunity-types";

test("match, split sourcing, portfolio, private quotes and reassignment work in one company", async t => {
  const dir = mkdtempSync(join(tmpdir(), "huoji-opportunities-"));
  const store = new EnterpriseStore(join(dir, "enterprise.sqlite"));
  store.transaction(db => {
    const company = db.prepare(`INSERT INTO companies(id,name,credit,applicant,status,evidence,mime,created)
      VALUES(?,?,?,?,'APPROVED',X'00','image/png','2026-11-26')`);
    company.run("ent_team", "示例团队", "team", "owner");
    company.run("ent_other", "另一企业", "other", "vendor");
    const member = db.prepare("INSERT INTO company_members(company,userId,role,active) VALUES(?,?,?,1)");
    member.run("ent_team", "owner", "OWNER");
    member.run("ent_team", "manager", "ADMIN");
    member.run("ent_team", "sales", "MEMBER");
    member.run("ent_team", "colleague", "MEMBER");
    member.run("ent_other", "vendor", "OWNER");
  });
  const sessions = {
    sales: { userId: "sales", currentWorkspaceId: "ent_team" },
    colleague: { userId: "colleague", currentWorkspaceId: "ent_team" },
    owner: { userId: "owner", currentWorkspaceId: "ent_team" },
    manager: { userId: "manager", currentWorkspaceId: "ent_team" },
    vendor: { userId: "vendor", currentWorkspaceId: "ent_other" },
    personal: { userId: "sales", currentWorkspaceId: "personal-sales" },
    otherPersonal: { userId: "colleague", currentWorkspaceId: "personal-colleague" },
  };
  const session = (header: unknown) => sessions[String(header).slice(7) as keyof typeof sessions] ?? null;
  const ledger = createWorkspaceLedgerRouter(join(dir, "ledger.sqlite"), session);
  const circle = createCircleRouter(join(dir, "circle.sqlite"), header => {
    const actor = session(header);
    return actor && { ...actor, displayName: actor.userId };
  }, null);
  const app = express();
  app.use(express.json());
  app.use("/ledger", ledger);
  app.use("/circle", circle);
  const deps: Parameters<typeof createOpportunityRouter>[1] = {
    session, name: id => id, snapshot: ledger.readSnapshot,
    quote: (actor, thread, message) => circle.opportunityQuote({ ...actor, displayName: actor.userId }, thread, message),
  };
  app.use("/opportunities", createOpportunityRouter(store, deps));
  app.use("/personal", createOpportunityRouter(store, deps, actor => actor.currentWorkspaceId === "personal-" + actor.userId));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  async function request(user: string, route: string, status = 200, body?: object, method?: string) {
    const res = await fetch(origin + route, { method: method || (body ? "POST" : "GET"),
      headers: { Authorization: "Bearer " + user, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
    const data = await res.json();
    assert.equal(res.status, status, JSON.stringify(data));
    return data;
  }
  const board = (user: string): Promise<OpportunityBoard> => request(user, "/opportunities");
  const trade = { title: "H200 整机", gpuModel: "H200", quantity: 4, quantityUnit: "台", locationCity: "深圳", tradeMode: "SPOT", configItems: [] };
  await request("sales", "/ledger", 200, { operations: [{
    id: "records", seed: false, keys: [], changes: [
      { table: "stocks", action: "add", row: { ...trade, id: "supply-a", status: "VERIFIED" } },
      { table: "stocks", action: "add", row: { ...trade, id: "supply-b", status: "SELLABLE" } },
      { table: "market", action: "add", row: { ...trade, id: "need", quantity: 8, postType: "DEMAND" } },
    ],
  }] });
  const input = { requestId: randomUUID(), demandId: "need", supplyId: "supply-a", plannedQuantity: 4,
    stage: "FOLLOWING", assigneeId: "sales", nextAction: "VERIFY_SUPPLY", nextStep: "确认能否周五提货", dueAt: "2026-11-30T15:00" };
  await request("personal", "/opportunities", 403);
  const created = await request("sales", "/opportunities", 201, input);
  assert.equal((await request("sales", "/opportunities", 200, input)).id, created.id);
  const candidate = { ...input, requestId: randomUUID(), supplyId: "supply-b" };
  assert.equal((await request("sales", "/opportunities", 409, candidate)).existingId, created.id);
  await request("sales", "/opportunities", 200, { ...candidate, joinExisting: true });
  const ownerBoard = await board("owner");
  assert.equal(ownerBoard.opportunities[0].confirmedQuantity, 8);
  assert.equal(ownerBoard.opportunities[0].supplies.length, 2);
  assert.equal(ownerBoard.opportunities[0].dueAt, "2026-11-30T07:00:00.000Z");
  assert.equal(ownerBoard.portfolio[0].verified, 8);
  assert.equal(ownerBoard.portfolio[0].demand, 8);
  assert.equal((await board("manager")).opportunities.length, 1);
  assert.equal((await board("colleague")).opportunities.length, 0);
  assert.equal((await board("vendor")).opportunities.length, 0);
  await request("colleague", "/opportunities/" + created.id, 404, { ...input, assigneeId: "colleague" }, "PATCH");

  const second = await request("sales", "/opportunities", 201, {
    ...input, requestId: randomUUID(), demandId: undefined,
    demand: { title: "另一客户问 H200", model: "H200", quantity: 4, unit: "台" },
  });
  const contested = (await board("owner")).opportunities.find(item => item.id === created.id)!;
  assert.equal(contested.confirmedQuantity, 4);
  assert.ok(contested.supplies.some(supply => supply.pressure));
  await request("sales", "/opportunities/" + second.id, 200, { ...input, stage: "LOST", version: 1 }, "PATCH");
  assert.equal((await board("owner")).opportunities[0].confirmedQuantity, 8);

  const post = await request("sales", "/circle/posts", 201, { nonce: randomUUID(), kind: "求购", title: "H200",
    quantity: "8 台", city: "深圳", mode: "现货", role: "本人采购", days: 3 });
  const quote = { price: "面议", quantity: "4 台", tax: "含税", delivery: "本周", validUntil: "2099-12-01" };
  const thread = await request("vendor", "/circle/send", 200, { nonce: randomUUID(), kind: "quote", quote, postId: post.id });
  const history = await request("sales", "/circle/threads/" + thread.id);
  const linked = { threadId: thread.id, messageId: history.items[0].id };
  await request("owner", `/opportunities/${created.id}/quotes`, 404, { quote: linked });
  await request("sales", `/opportunities/${created.id}/quotes`, 200, { quote: linked });
  await request("sales", `/opportunities/${created.id}/quotes`, 200, { quote: linked });
  const after = (await board("manager")).opportunities[0];
  assert.equal(after.quotes.length, 1);
  assert.equal(after.quotes[0].terms.quantity, "4 台");
  await request("manager", "/opportunities/" + created.id, 409, { ...input, version: 1, assigneeId: "colleague" }, "PATCH");
  await request("manager", "/opportunities/" + created.id, 200, { ...input, version: after.version, assigneeId: "colleague" }, "PATCH");
  const handoff = (await board("colleague")).opportunities[0];
  assert.equal(handoff.id, created.id);
  assert.equal(handoff.events[0].fields.assigneeId, "colleague");
  assert.equal(handoff.quotes.length, 1);
  assert.equal((await board("colleague")).portfolio.length, 0);

  const personalBoard = (user: string): Promise<OpportunityBoard> => request(user, "/personal");
  await request("sales", "/personal", 403);
  await request("owner", "/personal", 403);
  assert.equal((await personalBoard("personal")).opportunities.length, 0);
  await request("personal", "/personal", 404, input);
  await request("personal", "/ledger", 200, { operations: [{
    id: "private-records", seed: false, keys: [], changes: [
      { table: "stocks", action: "add", row: { ...trade, id: "supply-a", title: "个人货源", status: "VERIFIED" } },
      { table: "market", action: "add", row: { ...trade, id: "need", title: "个人采购需求", postType: "DEMAND" } },
    ],
  }] });
  await request("personal", "/personal", 403, { ...input, assigneeId: "colleague" });
  const privateDeal = await request("personal", "/personal", 201, input);
  assert.notEqual(privateDeal.id, created.id);
  assert.equal((await request("personal", "/personal", 200, input)).id, privateDeal.id);
  const privateSnapshot = await personalBoard("personal");
  assert.equal(privateSnapshot.opportunities[0].demand.title, "个人采购需求");
  assert.equal(privateSnapshot.opportunities[0].confirmedQuantity, 4);
  assert.equal(privateSnapshot.portfolio[0].demand, 4);
  await request("personal", `/personal/${privateDeal.id}/quotes`, 404, { quote: linked });
  const ownPost = await request("personal", "/circle/posts", 201, { nonce: randomUUID(), kind: "求购", title: "H200",
    quantity: "4 台", city: "深圳", mode: "现货", role: "本人采购", days: 3 });
  const ownThread = await request("vendor", "/circle/send", 200,
    { nonce: randomUUID(), kind: "quote", quote, postId: ownPost.id });
  const ownHistory = await request("personal", "/circle/threads/" + ownThread.id);
  await request("personal", `/personal/${privateDeal.id}/quotes`, 200,
    { quote: { threadId: ownThread.id, messageId: ownHistory.items[0].id } });
  assert.equal((await personalBoard("personal")).opportunities[0].quotes.length, 1);
  assert.equal((await personalBoard("otherPersonal")).opportunities.length, 0);
  await request("otherPersonal", "/personal/" + privateDeal.id, 404, { ...input, assigneeId: "colleague" }, "PATCH");
  assert.ok((await board("owner")).opportunities.every(item => item.id !== privateDeal.id));
  await request("owner", "/opportunities/" + privateDeal.id, 404, { ...input, assigneeId: "owner" }, "PATCH");
  await request("personal", "/personal/" + privateDeal.id, 200, { ...input, stage: "WON", version: 2 }, "PATCH");
  assert.equal((await personalBoard("personal")).opportunities[0].stage, "WON");
});
