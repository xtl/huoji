import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { CreditWallet } from "./credit-wallet";
import { EnterpriseStore } from "./enterprise";
import { setTimeout as pause } from "node:timers/promises";

test("verified enterprises isolate collection, posts, membership and metered keys across personal and company sessions", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "huoji-enterprise-")),
    network = globalThis.fetch;
  const previous = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: "test",
    AI_PROVIDER: "mock",
    SMS_UNIVERSAL_CODE: "fixture",
    SMS_PROVIDER: "mock",
    AUTH_STATE_FILE: path.join(dir, "identity.json"),
    RPA_MESSAGES_FILE: path.join(dir, "rpa.json"),
    PAYMENT_ORDERS_FILE: path.join(dir, "payments.json"),
    RESEND_API_KEY: "fixture",
    ENTERPRISE_MAIL_FROM: "test@example.test",
  });
  const { app } = await import("../server");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  t.after(() => {
    globalThis.fetch = network;
    process.env = previous;
    server.closeAllConnections();
    server.close();
  });
  const calls: string[] = [];
  let code = "",
    badOutput = false,
    missingUsage = false;
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://api.resend.com/emails") {
      code = JSON.parse(String(init?.body)).text.match(/邀请码 ([a-f0-9]{32})/)[1];
      return Response.json({ id: "fixture-email" });
    }
    assert.equal(String(input), "https://api.deepseek.com/chat/completions");
    calls.push(new Headers(init?.headers).get("Authorization")!);
    return Response.json({
      model: "test-model",
      usage: missingUsage
        ? undefined
        : { prompt_tokens: 40, completion_tokens: 10, prompt_cache_hit_tokens: 20, total_tokens: 50 },
      choices: [{ message: { content: badOutput ? "bad output" : JSON.stringify({ items: [] }) } }],
    });
  };
  async function api(route: string, token = "", method = "GET", body?: unknown, status = 200) {
    const response = await network(url + "/api" + route, {
      method,
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const bodyText = await response.text();
    assert.equal(response.status, status, method + " " + route + " " + bodyText.slice(0, 180));
    try {
      return JSON.parse(bodyText);
    } catch {
      return {};
    }
  }
  const login = (phone: string) => api("/auth/sms/login", "", "POST", { phone, code: "fixture" });
  const [owner, review, admin, employee, other] = await Promise.all(
    ["13900009001", "13900009002", "13900009003", "13900009004", "13900009005"].map(login),
  );
  const ent = "/enterprise",
    settings = "/settings/deepseek";
  const info = () => api(ent, owner.token);
  process.env.HUOJI_LOCAL_REVIEWER_PHONES = review.user.phone;
  process.env.RPA_LOCAL_CONTROL = "0";
  assert.equal((await api(ent, review.token)).reviewer, false);
  process.env.RPA_LOCAL_CONTROL = "1";
  assert.equal((await api(ent, review.token)).reviewer, true);
  assert.equal((await info()).reviewer, false);
  process.env.RPA_LOCAL_CONTROL = "0";
  await api(ent + "/applications", owner.token, "POST", {
    name: "隔离测试公司",
    domain: "example.test",
    credit: "913100000000000001",
    evidence:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aClUAAAAASUVORK5CYII=",
  });
  const id = (await info()).applications[0].id;
  const enter = (token: string, workspaceId = id, status = 200) =>
    api(ent + "/switch", token, "POST", { workspaceId }, status);
  await enter(owner.token, id, 403);
  await api(ent + "/applications/" + id + "/review", owner.token, "POST", { approve: true }, 403);
  process.env.ENTERPRISE_REVIEWER_IDS = owner.user.id + "," + review.user.id;
  await api(ent + "/applications/" + id + "/review", owner.token, "POST", { approve: true }, 403);
  await api(ent + "/applications/" + id + "/evidence", other.token, "GET", undefined, 404);
  await api(ent + "/applications/" + id + "/review", review.token, "POST", { approve: true });
  const company = await enter(owner.token);
  assert.notEqual(company.token, owner.token);
  const invite = (target: string, channel: string, role: string) =>
    api(ent + "/invites", company.token, "POST", { channel, target, role });
  await invite(admin.user.phone, "phone", "ADMIN");
  await invite("worker@example.test", "email", "MEMBER");
  const grant = (await api(ent, admin.token)).offers[0].id;
  await api(ent + "/join", other.token, "POST", { id: grant }, 404);
  await api(ent + "/join", admin.token, "POST", { id: grant });
  await api(ent + "/join", employee.token, "POST", { code });
  await api(ent + "/join", other.token, "POST", { code }, 404);
  const boss = (await enter(admin.token)).token,
    worker = (await enter(employee.token)).token;
  await enter(other.token, id, 403);
  await api(ent + "/invites", boss, "POST", { channel: "phone", target: other.user.phone, role: "ADMIN" }, 403);
  const companyKey = "sk-shared-platform-test";
  await api(settings, employee.token, "PUT", { apiKey: companyKey }, 403);
  await api(settings, company.token, "PUT", { apiKey: companyKey }, 403);
  await api(settings, worker, "PUT", { apiKey: companyKey }, 403);
  await api(settings, boss, "DELETE", undefined, 403);
  await api("/platform/usage", review.token, "GET", undefined, 401);
  await api("/platform/auth/code", "", "POST", { phone: review.user.phone }, 403);
  process.env.HUOJI_PLATFORM_ADMIN_PHONES = review.user.phone;
  const challenge = await api("/platform/auth/code", "", "POST", { phone: review.user.phone });
  await api("/platform/auth/login", "", "POST", { phone: review.user.phone, code: "fixture" }, 401);
  const ops = (await api("/platform/auth/login", "", "POST", { phone: review.user.phone, code: challenge.debugCode })).token;
  await api("/auth/me", ops, "GET", undefined, 401);
  const savedKey = await api("/platform/key", ops, "PUT", { apiKey: companyKey });
  assert.ok(!JSON.stringify(savedKey).includes(companyKey));
  await api("/structure",worker,"POST",{text:"企业余额不足拦截"},402);
  assert.equal(calls.length,0);
  const enterpriseStore = new EnterpriseStore(path.join(dir, "enterprise.sqlite"));
  const wallet = new CreditWallet(enterpriseStore);
  wallet.applyPaid({id:"fixture-company-credit",status:"PAID",paidAt:new Date().toISOString(),userId:owner.user.id,workspaceId:id,title:"测试充值",entitlement:{creditAmount:2000}});
  await api("/structure", worker, "POST", { text: "出 H200" });
  await api("/structure", employee.token, "POST", { text: "出 H200" });
  assert.deepEqual(calls, ["Bearer " + companyKey, "Bearer " + companyKey]);
  badOutput = true;
  await api("/structure", worker, "POST", { text: "出 H200" });
  badOutput = false;
  missingUsage = true;
  await api("/structure", worker, "POST", { text: "出 H200" });
  missingUsage = false;
  const row = { id: "employee-stock", title: "测试企业库存", configItems: [] };
  const save = {
    operations: [{ id: randomUUID(), seed: false, keys: [], changes: [{ table: "stocks", action: "add", row }] }],
  };
  await api("/workspace/ledger", worker, "POST", save);
  assert.equal((await api("/workspace/ledger", employee.token)).snapshot.stocks.length, 0);
  const staff = ent + "/staff/" + employee.user.id;
  assert.equal((await api(staff + "/ledger", boss)).snapshot.stocks[0].id, row.id);
  await api(ent + "/staff/" + admin.user.id + "/ledger", worker, "GET", undefined, 403);
  await api(ent + "/staff/" + other.user.id + "/ledger", boss, "GET", undefined, 403);
  await api(staff + "/ledger", boss, "POST", {
    operations: [
      {
        id: randomUUID(),
        seed: false,
        keys: [],
        changes: [{ table: "stocks", action: "edit", id: row.id, fields: { title: "管理员核对" }, unset: [] }],
      },
    ],
  });
  assert.equal((await api("/workspace/ledger", worker)).snapshot.stocks[0].title, "管理员核对");
  const post = await api(
    "/circle/posts",
    worker,
    "POST",
    {
      nonce: randomUUID(),
      title: "测试发布",
      kind: "供应",
      quantity: "2 台",
      city: "深圳",
      mode: "现货",
      role: "自有货源",
      days: 3,
      companyName: "伪造企业",
    },
    201,
  );
  assert.equal(post.companyName, "隔离测试公司");
  assert.equal(post.publisherAccount, undefined);
  await api("/auth/profile", worker, "PATCH", { displayName: "企业发布员" });
  const getCircleSettings = async (token: string) =>
    (await api(ent, token)).companies.find((space: { id: string }) => space.id === id).showNameInCircle;
  assert.equal(await getCircleSettings(boss), 1);
  await api(ent + "/circle-settings", worker, "PATCH", { showName: false }, 403);
  await api(ent + "/circle-settings", owner.token, "PATCH", { showName: false }, 403);
  await api(ent + "/circle-settings", boss, "PATCH", { showName: "false" }, 400);
  const personalDraft = {
    nonce: randomUUID(), title: "个人发布", kind: "供应", quantity: "1 台", city: "深圳",
    mode: "现货", role: "自有货源", days: 3, companyName: "伪造企业",
  };
  await api("/circle/posts", employee.token, "POST", personalDraft, 403);
  await api("/circle/posts/" + post.id + "/questions", employee.token, "POST", {
    nonce: randomUUID(), body: "请问有现货吗？",
  }, 403);
  await api("/circle/send", employee.token, "POST", {
    nonce: randomUUID(), postId: post.id, kind: "text", text: "请报价",
  }, 403);
  const grantMembership = (account: { currentWorkspaceId: string }, code: string) => {
    enterpriseStore.use(db => db.prepare("INSERT INTO wallet_plans(id,workspace,code,start,end) VALUES(?,?,?,?,?)")
      .run(account.currentWorkspaceId, account.currentWorkspaceId, code, "2000-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z"));
  };
  grantMembership(employee, "PRO_MONTHLY");
  const personalPost = await api("/circle/posts", employee.token, "POST", personalDraft, 201);
  assert.equal(personalPost.companyName, "");
  const circleDb = new DatabaseSync(path.join(dir, "circle.sqlite"));
  try {
    circleDb.prepare("UPDATE posts SET companyName=NULL WHERE id IN (?,?)").run(post.id, personalPost.id);
  } finally {
    circleDb.close();
  }
  const feed = (await api("/circle/posts", other.token)).items;
  assert.equal(feed.find((item: { id: string }) => item.id === post.id).companyName, "隔离测试公司");
  assert.equal(feed.find((item: { id: string }) => item.id === post.id).author, "企业发布员");
  assert.equal(feed.find((item: { id: string }) => item.id === personalPost.id).companyName, "");
  assert.equal((await api("/circle/posts/" + post.id, other.token)).post.companyName, "隔离测试公司");
  const observer = await api("/circle/sync", other.token);
  await api(ent + "/circle-settings", boss, "PATCH", { showName: false });
  assert.notEqual((await api("/circle/sync?after=" + observer.revision, other.token)).revision, observer.revision);
  assert.equal(await getCircleSettings(boss), 0);
  assert.equal((await api("/circle/sync", worker)).companyName, "");
  assert.equal((await api("/circle/posts/" + post.id, other.token)).post.companyName, "");
  assert.equal((await api("/circle/posts", other.token)).items.find((item: { id: string }) => item.id === post.id).companyName, "");
  const hiddenPost = await api("/circle/posts", worker, "POST", {
    ...personalDraft, nonce: randomUUID(), title: "隐藏企业名称时发布",
  }, 201);
  assert.equal(hiddenPost.companyName, "");
  assert.equal(hiddenPost.owner, post.owner);
  grantMembership(other, "PRO_YEARLY");
  const inquiry = await api("/circle/send", other.token, "POST", {
    nonce: randomUUID(), postId: post.id, kind: "text", text: "请问可以报价吗？",
  });
  assert.equal((await api("/circle/threads/" + inquiry.id, worker)).items[0].text, "请问可以报价吗？");
  await api(ent + "/circle-settings", company.token, "PATCH", { showName: true });
  assert.equal((await api("/circle/posts/" + post.id, other.token)).post.companyName, "隔离测试公司");
  assert.equal((await api("/circle/posts/" + hiddenPost.id, other.token)).post.companyName, "隔离测试公司");
  enterpriseStore.use(db => db.prepare("UPDATE wallet_plans SET end=? WHERE workspace=?")
    .run(new Date().toISOString(), other.currentWorkspaceId));
  assert.equal((await api("/circle/threads/" + inquiry.id, other.token)).items.length, 1);
  await api("/circle/send", other.token, "POST", {
    nonce: randomUUID(), threadId: inquiry.id, kind: "text", text: "会员到期后继续发送",
  }, 403);
  await api("/circle/send", other.token, "POST", {
    nonce: randomUUID(), postId: post.id, direct: true, kind: "text", text: "会员到期后新建私信",
  }, 403);
  await api("/circle/send", worker, "POST", {
    nonce: randomUUID(), threadId: inquiry.id, kind: "text", text: "企业员工正常回复",
  });
  await api("/circle/threads/" + inquiry.id, boss, "GET", undefined, 404);
  assert.ok((await api(staff + "/circle/posts?mine=1", boss)).items.some((item: { id: string }) => item.id === post.id));
  await api(staff + "/circle/posts/" + post.id, boss, "PATCH", { action: "close" });
  assert.equal((await api("/circle/posts?mine=1", worker)).items.find((item: { id: string }) => item.id === post.id).active, false);
  await api(staff + "/circle/threads", boss, "GET", undefined, 404);
  await api(
    "/rpa/messages",
    worker,
    "POST",
    {
      deviceId: "fixture",
      messages: [
        {
          messageId: "test",
          chatName: "真实货源群",
          sender: "测试",
          text: "出 H200",
          sentAt: new Date().toISOString(),
          observedAt: new Date().toISOString(),
        },
      ],
    },
    202,
  );
  for (let n = 0; n < 80; n++) {
    if ((await api(staff + "/capture/messages", boss)).items[0]?.status === "READY") break;
    await pause(25);
  }
  assert.equal((await api(staff + "/capture/messages", boss)).items[0].status, "READY");
  assert.equal(calls.at(-1), "Bearer " + companyKey);
  await api("/structure", boss, "POST", { text: "出 H200" });
  const ownRows = (await api(ent + "/usage", worker)).rows;
  assert.ok(ownRows.every((r: { employee: string }) => r.employee === employee.user.id));
  assert.equal(
    ownRows.reduce((n: number, r: { total: number }) => n + r.total, 0),
    150,
  );
  assert.equal(ownRows.find((r: { kind: string }) => r.kind === "PASTE").unknown, 1);
  const capturePath = ent + "/usage?mine=1&kind=CAPTURE";
  const captures = (await api(capturePath, worker)).rows;
  assert.equal(captures.length, 1);
  assert.equal(captures[0].total, 50);
  assert.equal(captures[0].employee, employee.user.id);
  assert.deepEqual((await api(capturePath, boss)).rows, []);
  assert.deepEqual((await api(capturePath, employee.token)).rows, []);
  assert.equal((await api(ent + "/usage?detail=1", company.token)).rows.length, 5);
  assert.equal((await api(ent + "/usage", employee.token)).rows[0].total, 50);
  const accounts = await api("/platform/usage?by=account", ops);
  const metered = accounts.items.find((r: {id:string}) => r.id === employee.user.id);
  assert.deepEqual([metered.total,metered.input,metered.output,metered.unknown], [200,160,40,1]);
  assert.ok(metered.modelCost>0 && metered.chargedCredits>0);
  // The provider also returned billable usage for one unusable response. Only delivered parses debit credits.
  assert.ok(metered.chargedCredits < metered.modelCost*560);
  assert.ok(!JSON.stringify(accounts).includes(employee.user.phone));
  const companies = await api("/platform/usage?by=company", ops);
  assert.equal(companies.items.find((r: {id:string}) => r.id === id).total, 200);
  const detail = await api("/platform/breakdown?by=company&id="+id+"&month="+accounts.month,ops);
  assert.ok(detail.items.some((r:{id:string;kind:string;total:number}) => r.id===employee.user.id && r.kind==="CAPTURE" && r.total===50));
  const count = calls.length;
  await api("/platform/limits",ops,"PUT",{dimension:"company",id,ceiling:200});
  assert.match((await api("/structure",worker,"POST",{text:"出 H200"})).error,/限额/);
  await api("/platform/limits",ops,"PUT",{dimension:"company",id,ceiling:null});
  await api("/platform/limits",ops,"PUT",{dimension:"account",id:employee.user.id,ceiling:0});
  assert.match((await api("/structure",employee.token,"POST",{text:"出 H200"})).error,/限额/);
  assert.match((await api("/structure",worker,"POST",{text:"出 H200"})).error,/限额/);
  assert.equal(calls.length,count);
  await api(ent + "/members/" + employee.user.id, company.token, "PATCH", { role: "DISABLED" });
  await api("/workspace/ledger", worker, "GET", undefined, 401);
  assert.equal((await api("/auth/me", employee.token)).currentWorkspaceId, employee.currentWorkspaceId);
  await api("/auth/logout", boss, "POST", {});
  await api("/auth/me", admin.token, "GET", undefined, 401);
});
