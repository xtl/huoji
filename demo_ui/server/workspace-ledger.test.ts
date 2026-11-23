import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { emptyLedger, ledgerChanges, type LedgerOperation } from "../src/workspace-ledger";
import { createWorkspaceLedgerRouter } from "./workspace-ledger";

test("two sessions share an isolated ledger, merge older browser data, and can replay a confirmation", async t => {
  const sessions = new Map([
    ["chrome", {userId: "owner", currentWorkspaceId: "personal"}],
    ["edge", {userId: "owner", currentWorkspaceId: "personal"}],
    ["team", {userId: "owner", currentWorkspaceId: "team"}],
    ["other", {userId: "other", currentWorkspaceId: "personal"}],
  ]);
  const app = express();
  app.use(express.json(), createWorkspaceLedgerRouter(":memory:", auth => sessions.get(String(auth).slice(7)) ?? null));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const request = (account: string, operations?: LedgerOperation[], path = "") => fetch(base + "/" + path, {
    method: operations ? "POST" : "GET", headers: {Authorization: "Bearer " + account, "Content-Type": "application/json"},
    body: operations ? JSON.stringify({operations}) : undefined,
  });
  async function read(account: string, operations?: LedgerOperation[]) {
    const response = await request(account, operations);
    assert.equal(response.status, 200);
    return response.json();
  }
  const row = (id: string, sourceItemKey: string) => ({ id, sourceItemKey, title: "测试产品", configItems: [] });
  const original = { ...emptyLedger(), stocks: [row("s", "s1")], market: [row("m", "m1")], drafts: [row("d", "d1")], confirmedRpaItemKeys: ["legacy"] };
  assert.equal((await request("unknown")).status, 401);
  assert.deepEqual((await read("edge")).snapshot, emptyLedger());
  await read("chrome", [ledgerChanges(emptyLedger(), original, true)]);
  const seen = await read("edge");
  assert.deepEqual(seen.snapshot.stocks, original.stocks);
  assert.deepEqual(seen.snapshot.market, original.market);
  assert.deepEqual(seen.snapshot.drafts, original.drafts);
  assert.deepEqual(new Set(seen.snapshot.confirmedRpaItemKeys), new Set(["s1", "m1", "legacy"]));
  assert.equal((await request("edge", undefined, "?since=" + seen.revision)).status, 204);

  const editOne = { ...original, drafts: [{ ...original.drafts[0], title: "新型号" }] };
  const editTwo = { ...original, drafts: [{ ...original.drafts[0], city: "上海" }] };
  await read("chrome", [ledgerChanges(original, editOne)]);
  const updated = await read("edge", [ledgerChanges(original, editTwo)]);
  assert.equal(updated.snapshot.drafts[0].title, "新型号");
  assert.equal(updated.snapshot.drafts[0].city, "上海");
  const confirmed = {...updated.snapshot, stocks: [...original.stocks, {...updated.snapshot.drafts[0], id:"confirmed:d"}], drafts: []};
  const confirm = ledgerChanges(updated.snapshot, confirmed);
  const saved = await read("edge", [confirm]);
  assert.deepEqual(await read("chrome", [confirm]), saved);
  const stale = {...original, stocks: [row("different-old-id", "s1")], drafts: [row("other-draft-id", "d1")]};
  const merged = await read("chrome", [ledgerChanges(emptyLedger(), stale, true)]);
  assert.equal(merged.snapshot.stocks.length, 2);
  assert.equal(merged.snapshot.drafts.length, 0);
  assert.ok(merged.snapshot.confirmedRpaItemKeys.includes("d1"));
  const deletion = ledgerChanges(merged.snapshot, {...merged.snapshot, market: []});
  await read("edge", [deletion]);
  const afterReplay = await read("chrome", [ledgerChanges(emptyLedger(), original, true)]);
  assert.equal(afterReplay.snapshot.market.length, 0);
  for (const other of ["team", "other"]) assert.deepEqual((await read(other)).snapshot, emptyLedger());
});
