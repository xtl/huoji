/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from "dotenv";
import express from "express";
import * as fs from "fs";
import path from "path";
import { createHash, createHmac, createSign, createVerify, randomUUID } from "crypto";
import { createRpaRouter, RpaInbox, type RpaParsedResult, type RpaMessage } from "./server/rpa";
import { DeepSeekKeyStore, DEEPSEEK_ORIGIN, providerError } from "./server/deepseek-settings";
import { platformAiRouter, PLATFORM_KEY } from "./server/platform-ai";
import { readJsonSnapshot, writeAtomicJson } from "./server/rpa-persistence";
import { createLocalBackfillRouter, isLocalRpaRequest, LocalBackfillController } from "./server/rpa-local-control";
import { readCompactMemorySpec, readMemoryFrequency } from "./src/memory-specs";
import { unknownSourceWarning } from "./src/rpa-capture-warnings";
import { createCircleRouter } from "./server/circle";
import { CreditWallet, InsufficientCredits } from "./server/credit-wallet";
import { actualCharge, modelPrices } from "./server/model-credit-prices";
import { creditPackagesFor, monthlyPrice, monthlyCredits, annualPrice, annualMonthlyCredits, pointsPerCostYuan, pricingVersion, rechargePricingVersion } from "./src/credit-pricing";
import { EnterpriseStore, enterpriseRouter, isCompany } from "./server/enterprise";
import { createWorkspaceLedgerRouter } from "./server/workspace-ledger";

if (process.env.NODE_ENV !== "test") dotenv.config();

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.set("trust proxy", true);
const deepSeekKeys = new DeepSeekKeyStore(path.join(path.dirname(identityFilePath()), "platform-ai-keys"), process.env.HUOJI_DEEPSEEK_MASTER_KEY);
const enterprise = new EnterpriseStore(path.join(path.dirname(identityFilePath()), "enterprise.sqlite"));
const creditWallet = new CreditWallet(enterprise);
app.use("/api/platform",platformAiRouter(enterprise, deepSeekKeys,{
  accounts:()=>[...usersById.values()], sendCode:(phone,code)=>deliverSmsCode(phone,code),
}));
app.use("/api/settings/deepseek", (req,res) => {
  if (!readSession(req.headers.authorization)) return res.status(401).json({error:"请先登录。"});
  if (req.method!=="GET") return res.status(403).json({error:"DeepSeek 密钥由平台统一管理。"});
  res.set("Cache-Control","no-store").json({...deepSeekKeys.status(PLATFORM_KEY),managedBy:"PLATFORM"});
});
app.use(express.json({ limit: "50mb" }));
// Only the explicit staff-management routes below can set this server-side scope.
function businessSession(authorization: unknown, res: express.Response): DemoSession | null {
  return res.locals.staffScope ?? readSession(authorization);
}
const ledgerRouter=createWorkspaceLedgerRouter(path.join(path.dirname(identityFilePath()), "ledger.sqlite"), businessSession);
app.use("/api/workspace/ledger", ledgerRouter);
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.get("/api/health", (_, res) => {
  res.json({
    success: true,
    service: "huoji-web",
    time: new Date().toISOString(),
  });
});

app.get("/downloads/Huoji-Capture-Cloud-x64-Setup.exe", (_req, res) => {
  const name = "Huoji-Capture-Cloud-x64-Setup.exe";
  res.set({ "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
  res.download(path.resolve("downloads", name), name, error => {
    if (error && !res.headersSent) res.status(503).type("text").send("安装包暂时无法下载，请稍后重试。");
  });
});

app.get("/api/auth/captcha/config", (_, res) => {
  res.json(getCaptchaPublicConfig());
});

type PostType = "GOODS" | "DEMAND";
type TradeMode = "SPOT" | "FUTURES" | "RENTAL";
type ProductCategory = "SERVER" | "GPU_CARD" | "MEMORY" | "STORAGE" | "CPU" | "NETWORK" | "OTHER";
type WorkspaceType = "PERSONAL" | "ENTERPRISE";
type MembershipPlanCode = "FREE" | "PRO_MONTHLY" | "PRO_YEARLY";
type PaymentProductType = "CREDIT_PACKAGE" | "MEMBERSHIP_PLAN";
type PaymentChannel = "page" | "wap";
type PaymentStatus = "WAITING" | "PAID" | "CLOSED";

interface ConfigItem {
  label: string;
  value: string;
}

interface ExtractedTradeItem {
  postType: PostType;
  tradeMode: TradeMode;
  productCategory: ProductCategory;
  title: string;
  model: string;
  quantity: number | null;
  quantityUnit: string;
  locationCity: string;
  priceAmount: number | null;
  currency: string;
  condition: string;
  availabilityType: string;
  contactMethod: string;
  sourceContact: string;
  rawText: string;
  confidence: number;
  configItems: ConfigItem[];
}

interface ExtractionEnvelope {
  summary: {
    total: number;
    goodsCount: number;
    demandCount: number;
  };
  items: ExtractedTradeItem[];
  warnings: string[];
}

interface DemoUser {
  id: string;
  phone: string;
  displayName: string;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
}

interface DemoWorkspace {
  id: string;
  name: string;
  type: WorkspaceType;
  status: "ACTIVE" | "SUSPENDED";
  planCode: string;
  ownerUserId: string;
  createdAt: string;
}

interface DemoMembership {
  userId: string;
  workspaceId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  dataScope: "PERSONAL" | "WORKSPACE";
  status: "ACTIVE" | "DISABLED";
}

interface DemoSession {
  token: string;
  verifiedSms?: boolean;
  family?: string;
  accessVersion?: number;
  userId: string;
  currentWorkspaceId: string;
  createdAt: number;
  expiresAt: number;
}

interface SmsChallenge {
  phone: string;
  code: string;
  createdAt: number;
  expiresAt: number;
}

interface PaymentEntitlement {
  creditAmount: number;
  planCode?: MembershipPlanCode;
  planName?: string;
  membershipDays?: number;
  months?: number;
  installments?: number;
}

interface PaymentProduct {
  productType: PaymentProductType;
  productId: string;
  title: string;
  amountYuan: string;
  entitlement: PaymentEntitlement;
}

interface PaymentOrder {
  id: string;
  userId: string;
  workspaceId: string;
  productType: PaymentProductType;
  productId: string;
  title: string;
  amountYuan: string;
  status: PaymentStatus;
  channel: PaymentChannel;
  createdAt: string;
  paidAt?: string;
  alipayTradeNo?: string;
  entitlement: PaymentEntitlement;
}

interface SmsDeliveryResult {
  provider: "mock" | "tencentcloud" | "aliyun";
  isMock: boolean;
  requestId?: string;
}

interface CaptchaPublicConfig {
  enabled: boolean;
  provider: "aliyun" | "none";
  region?: string;
  prefix?: string;
  sceneId?: string;
  mode?: "popup" | "embed";
  scriptUrl?: string;
}

const SMS_TTL_MS = 5 * 60 * 1000;
const SMS_RESEND_COOLDOWN_MS = Number(process.env.SMS_RESEND_COOLDOWN_SECONDS ?? 60) * 1000;
const SMS_UNIVERSAL_CODE = process.env.NODE_ENV === "production" ? "" : (process.env.SMS_UNIVERSAL_CODE ?? "11111111");
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const smsChallenges = new Map<string, SmsChallenge>();
const usersByPhone = new Map<string, DemoUser>();
const usersById = new Map<string, DemoUser>();
const workspacesById = new Map<string, DemoWorkspace>();
const memberships: DemoMembership[] = [];
const sessions = new Map<string, DemoSession>();
const paymentOrders = new Map<string, PaymentOrder>();

const membershipProducts: PaymentProduct[] = [
  {productType:"MEMBERSHIP_PLAN",productId:"PRO_MONTHLY",title:"个人 Pro 月卡",amountYuan:monthlyPrice.toFixed(2),
    entitlement:{creditAmount:monthlyCredits,planCode:"PRO_MONTHLY",planName:"个人 Pro 月卡",months:1}},
  {productType:"MEMBERSHIP_PLAN",productId:"PRO_YEARLY",title:"个人 Pro 年卡",amountYuan:annualPrice.toFixed(2),
    entitlement:{creditAmount:annualMonthlyCredits*12,planCode:"PRO_YEARLY",planName:"个人 Pro 年卡",months:12,installments:12}},
];

loadIdentityState();
loadPaymentOrders();
for (const order of [...paymentOrders.values()].filter(o => o.status==="PAID").sort((a,b)=>(a.paidAt??"").localeCompare(b.paidAt??""))) creditWallet.applyPaid(order);

app.get("/api/wallet",(req,res)=>{
  const session=readSession(req.headers.authorization);
  if (!session) return res.status(401).json({error:"请先登录。"});
  const member=enterprise.member(session.currentWorkspaceId,session.userId);
  const wallet=creditWallet.snapshot(session,member?.role==="MEMBER");
  res.set("Cache-Control","no-store").json({...wallet,paymentReady:getAlipayConfig(appBaseUrl(req)).ready});
});

const circleRouter=createCircleRouter(path.join(path.dirname(identityFilePath()), "circle.sqlite"), (authorization,res) => {
  const session = businessSession(authorization,res);
  if (!session) return null;
  return { userId: session.userId, currentWorkspaceId: session.currentWorkspaceId, displayName: usersById.get(session.userId)!.displayName };
}, undefined, (userId) => enterprise.spaces(userId, true),
  workspaceId => isCompany(workspaceId) || creditWallet.hasActiveMembership(workspaceId),
  accounts => enterprise.accountProfiles(accounts));
app.use("/api/circle",circleRouter);

const rpaInbox = new RpaInbox({
  ...(process.env.NODE_ENV === "production" || process.env.HUOJI_CLOUD === "1" || (process.env.HUOJI_DESKTOP_TEST === "1" && process.env.NODE_ENV === "test") ? {allowedGroups: []} : {}),
  filePath: process.env.RPA_MESSAGES_FILE?.trim() || path.join(process.cwd(), ".data", "rpa-messages.json"),
  parse: parseRpaMessage,
  onError: (error) => console.error("[货记 RPA] worker stopped:", error instanceof Error ? error.message : "unknown"),
});
let localController: LocalBackfillController | undefined;
if (process.env.NODE_ENV !== "test" || process.env.RPA_LOCAL_CONTROL === "1") {
  const postDue = () => {
    try { for (const workspace of creditWallet.postDueGrants()) {
      rpaInbox.resumeAfterRecharge(workspace);
      creditWallet.acknowledgeRecharge(workspace);
    } }
    catch {console.error("[货记] 会员发分暂未完成，将自动重试。");}
  };
  postDue();
  setInterval(postDue,60000).unref();
}
if (process.env.NODE_ENV === "test" && process.env.RPA_LOCAL_CONTROL === "1" && process.env.RPA_LOCAL_ORIGIN && process.env.RPA_LOCAL_REPOSITORY_ROOT) {
  const localOrigin = process.env.RPA_LOCAL_ORIGIN;
  localController = new LocalBackfillController({ repositoryDirectory: process.env.RPA_LOCAL_REPOSITORY_ROOT, localOrigin, readSession,
    runtime: process.env.HUOJI_DESKTOP_TEST === "1" ? process.env.HUOJI_DESKTOP_RUNTIME : undefined,
    enabledGroups: (session) => rpaInbox.enabledGroups(session) });
  app.use("/api/rpa/local", createLocalBackfillRouter({ enabled: true, controller: localController, readSession, localOrigin }));
  app.use("/api/rpa/groups", (request, response, next) => {
    if (["POST", "PATCH", "DELETE"].includes(request.method) && !isLocalRpaRequest(request, localOrigin)) {
      response.status(403).json({ error: "请从当前本机货记地址管理采集群。" });
      return;
    }
    next();
  });
} else {
  app.use("/api/rpa/local", (_request, response) => { response.sendStatus(404); });
}
const rpaRouter=createRpaRouter({ inbox: rpaInbox, readSession:businessSession, baseUrl: appBaseUrl,
  syncGroups: (session, groups) => localController?.syncGroups(session, groups) });
app.use("/api/rpa",rpaRouter);
const staffRouter=express.Router();
staffRouter.use("/ledger",ledgerRouter);
staffRouter.use("/capture",rpaRouter);
staffRouter.use("/circle",circleRouter);
app.use("/api/enterprise/staff/:id",(req,res,next)=>{
  const actor=readSession(req.headers.authorization);
  if(!actor){res.sendStatus(401);return;}
  const subject=String(req.params.id);
  if(!enterprise.managerTarget(actor,subject)){res.status(403).json({error:"无权管理该成员的资料。"});return;}
  const allowed=(req.path==="/ledger" && ["GET","POST"].includes(req.method)) ||
    (req.method==="GET" && (req.path==="/capture/messages" || (req.path==="/circle/posts" && req.query.mine==="1"))) ||
    (req.method==="POST" && /^\/capture\/messages\/[^/]+\/(dismiss|retry)$/.test(req.path)) ||
    (req.method==="PATCH" && /^\/circle\/posts\/[^/]+$/.test(req.path));
  if(!allowed){res.sendStatus(404);return;}
  res.locals.staffScope={...actor,userId:subject};
  next();
},staffRouter);
app.use("/api/enterprise", enterpriseRouter(enterprise,{
  session:readSession, user:id=>usersById.get(id), personal:personalWorkspaceId,
  onCircleVisibilityChanged: () => circleRouter.invalidateFeed(),
  switchSpace(scope,workspace){
    const current=scope as DemoSession;
    if(current.currentWorkspaceId===workspace) return buildAuthPayload(current);
    const family=current.family??current.token;
    const accessVersion=enterprise.member(workspace,scope.userId)?.accessVersion;
    const previous=[...sessions.values()].find(s=>(s.family??s.token)===family && s.currentWorkspaceId===workspace && s.accessVersion===accessVersion && s.expiresAt>Date.now());
    if(previous) return buildAuthPayload(previous);
    const next={...current,family,accessVersion,token:randomUUID(),currentWorkspaceId:workspace};
    sessions.set(next.token,next);
    try { saveIdentityState(); } catch(e){sessions.delete(next.token);throw e;}
    return buildAuthPayload(next);
  }
}));

function cloudSmsReady() { return ["aliyun","tencentcloud"].includes(process.env.SMS_PROVIDER || ""); }
app.get("/api/cloud/capabilities",(req,res)=>{
  const test = process.env.NODE_ENV === "test" && req.hostname === "127.0.0.1" &&
    ["127.0.0.1","::ffff:127.0.0.1"].includes(req.socket.remoteAddress || "") && !req.headers["x-forwarded-for"];
  res.set("Cache-Control","no-store").json({service:"huoji",syncVersion:1,aiBilling:"platform",loginReady:cloudSmsReady() || test});
});
app.use("/api/auth/sms",(_req,res,next)=>{if (process.env.NODE_ENV === "production" && !cloudSmsReady()) {res.status(503).json({error:"云端短信登录尚未开通。"});return;}next();});
app.post("/api/auth/sms/request", async (req, res) => {
  const phone = normalizePhone(asText(req.body?.phone));
  if (!phone) {
    return res.status(400).json({ error: "请输入有效的 11 位手机号。" });
  }

  const existing = smsChallenges.get(phone);
  if (existing && existing.expiresAt > Date.now() && Date.now() - existing.createdAt < SMS_RESEND_COOLDOWN_MS) {
    const retryAfterSeconds = Math.ceil((SMS_RESEND_COOLDOWN_MS - (Date.now() - existing.createdAt)) / 1000);
    return res.status(429).json({ error: `验证码发送太频繁，请 ${retryAfterSeconds} 秒后再试。`, retryAfterSeconds });
  }

  try {
    await verifyCaptchaIfRequired(asText(req.body?.captchaVerifyParam));
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "安全验证失败，请重新验证。",
    });
  }

  const smsProvider = String(process.env.SMS_PROVIDER ?? "mock").toLowerCase();
  const code = smsProvider === "mock" && process.env.SMS_DEV_CODE ? process.env.SMS_DEV_CODE : createSmsCode();
  let delivery: SmsDeliveryResult;
  try {
    delivery = await deliverSmsCode(phone, code, smsProvider);
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : "短信发送失败，请稍后再试。",
    });
  }

  smsChallenges.set(phone, {
    phone,
    code,
    createdAt: Date.now(),
    expiresAt: Date.now() + SMS_TTL_MS,
  });

  return res.json({
    success: true,
    expiresInSeconds: SMS_TTL_MS / 1000,
    provider: delivery.provider,
    requestId: delivery.requestId,
    debugCode: delivery.isMock ? code : undefined,
  });
});

app.post("/api/auth/sms/login", (req, res) => {
  const phone = normalizePhone(asText(req.body?.phone));
  const code = asText(req.body?.code);
  if (!phone || !code) {
    return res.status(400).json({ error: "请输入手机号和短信验证码。" });
  }

  const challenge = smsChallenges.get(phone);
  const usesUniversalCode = Boolean(SMS_UNIVERSAL_CODE && code === SMS_UNIVERSAL_CODE);
  if (!usesUniversalCode && (!challenge || challenge.expiresAt < Date.now())) {
    return res.status(400).json({ error: "验证码已过期，请重新获取。" });
  }
  if (!usesUniversalCode && challenge?.code !== code) {
    return res.status(400).json({ error: "验证码不正确。" });
  }

  const before = identitySnapshot();
  try {
    const { user, personalWorkspace } = ensurePersonalAccount(phone);
    if (user.status !== "ACTIVE" || personalWorkspace.status !== "ACTIVE") return res.status(403).json({ error: "账号或工作空间已停用。" });
    const session: DemoSession = {
      token: randomUUID(),
      verifiedSms: !usesUniversalCode && ["aliyun","tencentcloud"].includes(process.env.SMS_PROVIDER || ""),
      userId: user.id,
      currentWorkspaceId: personalWorkspace.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    sessions.set(session.token, session);
    saveIdentityState();
    smsChallenges.delete(phone);
    return res.json(buildAuthPayload(session));
  } catch (error) {
    restoreIdentityState(before);
    console.error("[货记 Web] identity save failed:", error instanceof Error ? error.message : "unknown");
    return res.status(503).json({ error: "登录状态保存失败，请稍后重试。" });
  }
});

app.get("/api/auth/me", (req, res) => {
  const session = readSession(req.headers.authorization);
  if (!session) return res.status(401).json({ error: "登录已失效，请重新登录。" });
  return res.json(buildAuthPayload(session));
});

const avatarPrefix = "data:image/jpeg;base64,";
function readAccountProfile(user: DemoUser) {
  const profile = enterprise.use(db => db.prepare("SELECT displayName,avatar FROM account_profiles WHERE userId=?").get(user.id));
  return { displayName: profile?.displayName ?? maskPhone(user.phone), avatar: profile?.avatar ?? null };
}

app.get("/api/auth/profile", (req, res) => {
  const session = readSession(req.headers.authorization);
  if (!session) return res.status(401).json({ error: "登录已失效，请重新登录。" });
  return res.set("Cache-Control", "no-store").json(readAccountProfile(usersById.get(session.userId)!));
});

app.patch("/api/auth/profile", (req, res) => {
  const session = readSession(req.headers.authorization);
  if (!session) return res.status(401).json({ error: "登录已失效，请重新登录。" });
  const user = usersById.get(session.userId)!;
  const { displayName, avatar } = req.body ?? {};
  if (displayName !== undefined && (typeof displayName !== "string" || displayName.trim().length > 24 ||
      /[\u0000-\u001f\u007f]/.test(displayName))) {
    return res.status(400).json({ error: "昵称最多 24 个字符，请输入单行文字。" });
  }
  if (avatar !== undefined && avatar !== null) {
    if (typeof avatar !== "string" || avatar.length > avatarPrefix.length + 128 * 1024 || !avatar.startsWith(avatarPrefix)) {
      return res.status(400).json({ error: "头像格式无效或图片过大。" });
    }
    const data = avatar.slice(avatarPrefix.length);
    const image = Buffer.from(data, "base64");
    if (image.length < 10 || data !== image.toString("base64") || image[0] !== 255 || image[1] !== 216 ||
        image.at(-2) !== 255 || image.at(-1) !== 217) {
      return res.status(400).json({ error: "无法读取头像图片，请重新选择。" });
    }
  }
  try {
    const updated = enterprise.transaction(db => {
      const row = db.prepare("SELECT displayName,avatar FROM account_profiles WHERE userId=?").get(user.id);
      const profile = {
        displayName: displayName === undefined ? row?.displayName ?? maskPhone(user.phone) : displayName.trim() || maskPhone(user.phone),
        avatar: avatar === undefined ? row?.avatar ?? null : avatar,
      };
      db.prepare("INSERT INTO account_profiles(userId,displayName,avatar) VALUES(?,?,?) ON CONFLICT(userId) DO UPDATE SET displayName=excluded.displayName,avatar=excluded.avatar")
        .run(user.id, profile.displayName, profile.avatar);
      return profile;
    });
    circleRouter.invalidateFeed();
    return res.set("Cache-Control", "no-store").json(updated);
  } catch {
    return res.status(503).json({ error: "个人资料保存失败，请稍后重试。" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const token = parseBearerToken(req.headers.authorization);
  const before = identitySnapshot();
  try {
    const current=sessions.get(token);
    if(current){
      const family=current.family??current.token;
      for(const [key,item] of sessions) if((item.family??key)===family) sessions.delete(key);
    }
    saveIdentityState();
  } catch {
    restoreIdentityState(before);
    return res.status(503).json({ error: "退出状态保存失败，请稍后重试。" });
  }
  return res.json({ success: true });
});

app.post("/api/payments/alipay/orders", (req, res) => {
  const session = readSession(req.headers.authorization);
  if (!session) return res.status(401).json({ error: "登录已失效，请重新登录后支付。" });

  const productType = asText(req.body?.productType) as PaymentProductType;
  const productId = asText(req.body?.productId);
  const enterprise = isCompany(session.currentWorkspaceId);
  if (enterprise && productType==="MEMBERSHIP_PLAN") return res.status(400).json({error:"个人会员请在个人空间购买。"});
  const currentPricing = productType === "CREDIT_PACKAGE" ? rechargePricingVersion : pricingVersion;
  if (req.body?.pricingVersion !== currentPricing) return res.status(409).json({error:"货记分价格已更新，请刷新页面或更新采集助手后再购买。"});
  const channel: PaymentChannel = asText(req.body?.channel) === "wap" ? "wap" : "page";
  const product = findPaymentProduct(productType, productId, enterprise);
  if (!product) return res.status(400).json({ error: "支付商品不存在，请刷新页面后重试。" });

  const config = getAlipayConfig(appBaseUrl(req));
  if (!config.ready) {
    return res.status(503).json({
      error: `支付宝支付尚未配置完整：${config.missing.join("、")}`,
      missing: config.missing,
    });
  }

  const order: PaymentOrder = {
    id: createOutTradeNo(),
    userId: session.userId,
    workspaceId: session.currentWorkspaceId,
    productType: product.productType,
    productId: product.productId,
    title: product.title,
    amountYuan: product.amountYuan,
    status: "WAITING",
    channel,
    createdAt: new Date().toISOString(),
    entitlement: product.entitlement,
  };
  paymentOrders.set(order.id, order);
  try {savePaymentOrders();} catch {paymentOrders.delete(order.id);return res.status(503).json({error:"订单保存失败，请重试。"});}

  return res.json({
    success: true,
    order: serializePaymentOrder(order),
    paymentUrl: buildAlipayPayUrl(order, config),
  });
});

app.get("/api/payments/orders/:orderId", (req, res) => {
  const session = readSession(req.headers.authorization);
  if (!session) return res.status(401).json({ error: "登录已失效，请重新登录。" });

  const order = paymentOrders.get(asText(req.params.orderId));
  if (!order || order.userId !== session.userId || order.workspaceId!==session.currentWorkspaceId) return res.status(404).json({ error: "订单不存在。" });
  return res.json({ success: true, order: serializePaymentOrder(order) });
});

app.get("/api/payments/alipay/return", (req, res) => {
  const baseUrl = appBaseUrl(req);
  const outTradeNo = asText(req.query.out_trade_no);
  const status = outTradeNo ? "RETURNED" : "UNKNOWN";
  const redirectParams = new URLSearchParams({
    payment_order: outTradeNo,
    payment_status: status,
  });
  return res.redirect(`${baseUrl}/?${redirectParams.toString()}`);
});

app.post("/api/payments/alipay/notify", (req, res) => {
  const config = getAlipayConfig(appBaseUrl(req));
  if (!config.ready) return res.type("text/plain").send("failure");

  const params = flattenStringRecord(req.body);
  if (!verifyAlipaySignature(params, config.alipayPublicKey)) return res.type("text/plain").send("failure");

  const outTradeNo = asText(params.out_trade_no);
  const order = paymentOrders.get(outTradeNo);
  if (!order) return res.type("text/plain").send("failure");
  if (params.app_id !== config.appId) return res.type("text/plain").send("failure");
  if (config.sellerId && params.seller_id && params.seller_id !== config.sellerId) return res.type("text/plain").send("failure");
  if (!sameMoney(params.total_amount, order.amountYuan)) return res.type("text/plain").send("failure");

  const tradeStatus = asText(params.trade_status);
  if (tradeStatus === "TRADE_SUCCESS" || tradeStatus === "TRADE_FINISHED") {
    const paid = {...order,status:"PAID" as const,paidAt:order.paidAt??new Date().toISOString(),alipayTradeNo:asText(params.trade_no)||order.alipayTradeNo};
    paymentOrders.set(order.id,paid);
    try { savePaymentOrders(); } catch {paymentOrders.set(order.id,order);return res.type("text/plain").send("failure");}
    try { if(creditWallet.applyPaid(paid)) rpaInbox.resumeAfterRecharge(paid.workspaceId); } catch {return res.type("text/plain").send("failure");}
  } else if (tradeStatus === "TRADE_CLOSED" && order.status!=="PAID") {
    paymentOrders.set(order.id,{...order,status:"CLOSED"});
    try { savePaymentOrders(); } catch {paymentOrders.set(order.id,order);return res.type("text/plain").send("failure");}
  }

  return res.type("text/plain").send("success");
});

function resolveDeepSeek(userId?: string, workspaceId?: string): { apiKey: string; baseUrl: string } | null {
  if (!userId) return null;
  const company = !!workspaceId && isCompany(workspaceId);
  if (company && !enterprise.member(workspaceId, userId)?.active) throw new Error("企业成员授权已失效。");
  try {
    const apiKey = deepSeekKeys.get(PLATFORM_KEY);
    return apiKey ? { apiKey, baseUrl: DEEPSEEK_ORIGIN } : null;
  } catch {
    throw new Error("无法读取平台 AI 密钥，请联系平台管理员。");
  }
}

app.post("/api/structure", async (req, res) => {
  const session = readSession(req.headers.authorization);
  if (req.headers.authorization !== undefined && !session) return res.status(401).json({ error: "请重新登录后解析。" });
  const rawText = asText(req.body?.text);
  if (!rawText) {
    return res.status(400).json({ error: "请先输入需要解析的货源文字。" });
  }

  const provider = String(process.env.AI_PROVIDER ?? "deepseek").toLowerCase();
  try {
    const connection = resolveDeepSeek(session?.userId,session?.currentWorkspaceId);
    if (connection) {
      const startedAt = Date.now();
      const deepseek = await callDeepSeek(rawText, connection, "",session??undefined,"PASTE", asText(req.body?.requestId).slice(0,128)||randomUUID());
      return res.json({
        data: deepseek.result,
        isMock: false,
        provider: "deepseek",
        model: deepseek.model,
        tokenUsage: deepseek.tokenUsage,
        latencyMs: Date.now() - startedAt,
      });
    }
  } catch (error) {
    if(error instanceof InsufficientCredits)return res.status(402).json({error:error.message,code:"INSUFFICIENT_CREDITS"});
    return res.json({ data: mockStructuredExtract(rawText), isMock: true, provider: "local-fallback",
      error: error instanceof Error ? error.message : "DeepSeek 暂时不可用。" });
  }

  return res.json({
    data: mockStructuredExtract(rawText),
    isMock: true,
    provider: provider === "mock" ? "mock" : "local-fallback",
  });
});

async function parseRpaMessage(rawText: string, message: Readonly<RpaMessage>): Promise<RpaParsedResult> {
  const provider = String(process.env.AI_PROVIDER ?? "deepseek").toLowerCase();
  const mode = message.captureMode ?? message.source?.captureMode;
  const unknownBubble = mode === "OCR_SNAPSHOT" && (message.captureUnit ?? message.source?.captureUnit) === "TEXT_BUBBLE";
  const instructions = unknownBubble
    ? "本次输入是截图中的一条完整文字消息，发送人昵称尚未识别。不得根据正文中的姓名、引用、联系方式或相邻条目推测发言人，来源字段保持为空并列入 warnings。只提取明确供应或求购，纯聊天允许 items 为空；数量、价格、单位和更新信息仍需人工核对，不得假定此前记录已被修改。"
    : mode === "OCR_SNAPSHOT"
    ? "本次输入来自微信群消息区域的一批 OCR 文字，可能包含多人、多个报价及识别错误，不等于单条消息。带有【OCR待核对】标记的行识别不确定，不得作为确定字段；涉及价格、数量、单位、来源或规格时保留为空并列入 warnings。不得根据相邻行猜测发送人、单位、价格归属；不确定的来源和配置保留为空并列入 warnings。只提取明确的供应或求购，纯聊天允许 items 为空。更新、已售或撤单必须标记待人工核对，不得假定此前货源已被修改。"
    : mode === "OCR_MESSAGE"
    ? "本次输入是截图中通过几何位置配对的一个昵称和一个消息气泡，昵称需要人工核对，原始发送时间未知。第一行昵称来自采集元数据，后续正文即使出现其他姓名或说话人标签也只是气泡内容，不得改写这条消息的来源发言人。该气泡内所有供应和需求条目均属于第一行昵称的发言。带有【OCR待核对】标记的行识别不确定，不得作为确定字段；涉及价格、数量、单位、来源或规格时保留为空并列入 warnings。只提取明确供应或求购，纯聊天允许 items 为空。更新、已售或撤单仅标记待人工核对，不得假定此前货源已被修改。"
    : "本次输入来自微信群采集，属于待人工确认的原始资料。只提取明确供应或求购，纯聊天允许 items 为空。更新、已售或撤单仅标记待人工核对，不得假定此前货源已被修改。";
  const connection = resolveDeepSeek(message.userId,message.workspaceId);
  if (connection) {
    // Unlike the interactive demo endpoint, failed real AI calls stay FAILED and can be retried.
    const parsed = await callDeepSeek(rawText, connection, instructions, {userId:message.userId,currentWorkspaceId:message.workspaceId}, "CAPTURE",message.id);
    return { data: parsed.result, isMock: false, provider: "deepseek", model: parsed.model, tokenUsage: parsed.tokenUsage };
  }
  if (provider !== "mock" && provider !== "deepseek") throw new Error(`RPA 暂不支持 AI_PROVIDER=${provider}。`);
  return { data: mockStructuredExtract(rawText), isMock: true, provider: provider === "mock" ? "mock" : "local-fallback" };
}

async function callDeepSeek(rawText: string, connection: { apiKey: string; baseUrl: string }, additionalInstructions = "", scope?:Pick<DemoSession,"userId"|"currentWorkspaceId">, kind="PASTE",requestId=randomUUID() as string): Promise<{
  model: string;
  result: ExtractionEnvelope;
  tokenUsage: unknown;
}> {
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-flash";
  const maxTokens = Number(process.env.DEEPSEEK_MAX_TOKENS ?? 12000);
  const payload = {
    model,
    temperature: 0.1,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
    messages: [
      { role: "system", content: `${DEEPSEEK_SYSTEM_PROMPT}\n${additionalInstructions}` },
      { role: "user", content: rawText },
    ],
  };

  if(!scope)throw Error("请登录后使用平台 AI。");
  const prices=modelPrices(model,new Date(),pointsPerCostYuan);
  const digest=createHash("sha256").update(rawText).digest("hex");
  const task=JSON.stringify([scope.currentWorkspaceId,scope.userId,kind,requestId]);
  const inputBound=payload.messages.reduce((n,m)=>n+Buffer.byteLength(m.content,"utf8")+32,128);
  if(!Number.isSafeInteger(maxTokens)||maxTokens<1)throw Error("模型输出额度配置无效。");
  const hold=creditWallet.reserve(scope,task,digest,inputBound*prices.miss,prices.out,maxTokens);
  if(hold.cached)return hold.cached;
  const attempt=hold.attempt!;
  payload.max_tokens=hold.outputLimit!;
  try {
    const usageId=enterprise.beginUsage(scope,kind,model);
    const response=await fetch(connection.baseUrl+"/chat/completions",{
      method:"POST",headers:{Authorization:"Bearer "+connection.apiKey,"Content-Type":"application/json"},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(90_000),redirect:"error"
    }).catch(()=>{throw Error("暂时无法连接 DeepSeek，请检查网络后重试。");});
    if(!response.ok){
      await response.body?.cancel();
      if(response.status<500)enterprise.finishUsage(usageId,model,null,true);
      throw providerError(response.status);
    }
    const data=await response.json().catch(()=>{throw Error("DeepSeek 返回的响应格式无效。");});
    const charge=actualCharge(prices,data.usage);
    enterprise.finishUsage(usageId,data.model??model,data.usage,false,charge===null?null:Math.round(charge/pointsPerCostYuan*10));
    const content=data.choices?.[0]?.message?.content;
    if(typeof content!=="string" || !content)throw Error("DeepSeek 返回了空结果。");
    let envelope:ExtractionEnvelope;
    try {envelope=normalizeEnvelope(parseJsonObject(content),rawText);}
    catch {throw Error("DeepSeek 返回的供需结果格式无效。");}
    const result={model:data.model??model,result:envelope,tokenUsage:data.usage??{}};
    creditWallet.settle(attempt,charge,{usageId,prices,usage:data.usage??null},result,kind==="CAPTURE"?"微信采集解析":"粘贴录入解析");
    return result;
  } catch (error) {creditWallet.release(attempt);throw error;}
}

const DEEPSEEK_SYSTEM_PROMPT = `
你是“货记”的 GPU/服务器/配件供需结构化抽取器。用户会粘贴微信群聊长文本，文本包含联系人、重复转发、供应、求购、租赁、价格、数量、地点、配置。

只输出一个 JSON object，严禁输出 Markdown。根对象字段固定为：
{
  "summary": {"total": number, "goodsCount": number, "demandCount": number},
  "items": [
    {
      "postType": "GOODS" | "DEMAND",
      "tradeMode": "SPOT" | "FUTURES" | "RENTAL",
      "productCategory": "SERVER" | "GPU_CARD" | "MEMORY" | "STORAGE" | "CPU" | "NETWORK" | "OTHER",
      "title": "适合展示的短标题",
      "model": "型号或规格，例如 RTX5090 / 64G 5600 / PM9D3A 3.84T / H200整机",
      "quantity": number | null,
      "quantityUnit": "台|张|片|条|个|颗|块|根|套",
      "locationCity": "深圳|香港|上海|北京|...",
      "priceAmount": number | null,
      "currency": "CNY|USD|HKD|UNKNOWN",
      "condition": "全新|拆新|二手|原箱|待确认",
      "availabilityType": "现货|期货|小期货|租赁|待确认",
      "contactMethod": "联系人或手机号，缺失写站内联系",
      "sourceContact": "来源用户/微信发言人，必填",
      "rawText": "原文中最相关的一行或几行",
      "confidence": number,
      "configItems": [{"label": "品牌/容量/频率/接口/质保等", "value": "值"}]
    }
  ],
  "warnings": ["无法确定价格或重复消息等提醒"]
}

抽取规则：
1. “出、出售、供应、现货出、含税出、明价出、甩货”是 GOODS；“收、求购、找货、找、现款找、批量收、高价收、天价收”是 DEMAND。
2. “出租”是 GOODS，“求租、承租”是 DEMAND，交易方式均为 RENTAL。租金的计费周期和单位按原文保留。“期货、小期货、预售、4-6周、8月”对应 FUTURES；“现货、秒发、当天可发”对应 SPOT。
3. sourceContact 是必填字段，必须优先从微信群聊天记录的说话人行提取，例如“Leo~D:”或“AI&GPU_阿琳:”。同一个说话人下面的每一条 SKU 都继承这个说话人。
4. 不要把手机号、品牌、群名、城市、货源标题当作 sourceContact；手机号应进入 contactMethod。只有确实没有说话人时，sourceContact 才写“未知来源”，并在 warnings 里提醒。
5. 一段消息里有多行 SKU 时拆成多条 item；重复转发的完全相同 SKU 只保留一条，但不同 sourceContact 的同款货要保留为不同 item。
6. 不要编造未出现的信息；价格如“34X万、12xx、33XXX、25+”不确定时 priceAmount 写 null，并把原价格文本放进 configItems 的“价格线索”。
7. 供应和需求都要抽；不是服务器的内存、硬盘/SSD、CPU、网卡/交换机也要抽，不能只抽 GPU。
`.trim();

function normalizeEnvelope(value: unknown, inputText = ""): ExtractionEnvelope {
  const record = isRecord(value) ? value : {};
  const rawItems = Array.isArray(record.items) ? record.items : Array.isArray(value) ? value : [];
  const items = rawItems.map((item) => normalizeItem(item, inputText)).filter((item): item is ExtractedTradeItem => Boolean(item));
  return buildEnvelope(items, Array.isArray(record.warnings) ? record.warnings.map(String) : []);
}

function normalizeItem(value: unknown, inputText = ""): ExtractedTradeItem | null {
  if (!isRecord(value)) return null;
  const rawText = asText(value.rawText ?? value.raw_text);
  const title = asText(value.title);
  const model = asText(value.model ?? value.gpuModel ?? value.gpu_model);
  const category = normalizeCategory(value.productCategory ?? value.product_category ?? `${title} ${model} ${rawText}`);
  const postType = normalizePostType(value.postType ?? value.post_type ?? rawText);
  const tradeMode = normalizeTradeMode(value.tradeMode ?? value.trade_mode ?? rawText);
  const sourceContact = normalizeSourceContact(value.sourceContact ?? value.source_contact, value.configItems ?? value.config_items, rawText, inputText);
  if (!title && !model && !rawText) return null;

  return {
    postType,
    tradeMode,
    productCategory: category,
    title: title || buildTitle(postType, category, model || rawText, tradeMode),
    model: model || parseModelText(rawText || title, category),
    quantity: asNumber(value.quantity),
    quantityUnit: asText(value.quantityUnit ?? value.quantity_unit) || unitForCategory(category),
    locationCity: asText(value.locationCity ?? value.location_city) || parseLocation(`${title} ${rawText}`),
    priceAmount: asNumber(value.priceAmount ?? value.price_amount),
    currency: asText(value.currency) || "CNY",
    condition: asText(value.condition) || parseCondition(`${title} ${rawText}`),
    availabilityType: asText(value.availabilityType ?? value.availability_type) || availabilityText(normalizeTradeMode(rawText)),
    contactMethod: asText(value.contactMethod ?? value.contact_method) || "站内联系",
    sourceContact,
    rawText,
    confidence: clampNumber(asNumber(value.confidence), 0.5, 0.99, 0.82),
    configItems: normalizeConfigItems(value.configItems ?? value.config_items, category, `${title} ${model} ${rawText}`, sourceContact),
  };
}

function mockStructuredExtract(rawText: string): ExtractionEnvelope {
  const blocks = splitSpeakerBlocks(rawText);
  const items: ExtractedTradeItem[] = [];

  for (const block of blocks) {
    let contextIntent: PostType | null = null;
    for (let index = 0; index < block.lines.length; index += 1) {
      const line = cleanLine(block.lines[index]);
      if (!line) continue;
      const lineIntent = detectPostType(line);
      if (lineIntent) contextIntent = lineIntent;
      if (isContextOnly(line)) continue;

      const nextLine = cleanLine(block.lines[index + 1]);
      const combined = shouldAttachQuantityLine(line, nextLine) ? `${line} ${nextLine}` : line;
      if (combined !== line) index += 1;

      const item = parseTradeLine(combined, block.speaker, lineIntent ?? contextIntent);
      if (item) items.push(item);
    }
  }

  return buildEnvelope(dedupeItems(items), []);
}

function parseTradeLine(line: string, speaker: string, contextIntent: PostType | null): ExtractedTradeItem | null {
  const category = detectCategory(line);
  if (!category) return null;
  const postType = detectPostType(line) ?? contextIntent ?? "GOODS";
  const tradeMode = normalizeTradeMode(line);
  const model = parseModelText(line, category);
  const quantityInfo = parseQuantity(line, category);
  const price = parsePrice(line);
  const contact = parseContact(`${speaker} ${line}`);
  const sourceContact = speaker.replace(/[:：]\s*$/, "");
  const title = buildTitle(postType, category, model || line, tradeMode);
  const priceHint = parsePriceHint(line);

  return {
    postType,
    tradeMode,
    productCategory: category,
    title,
    model: model || categoryLabel(category),
    quantity: quantityInfo.quantity,
    quantityUnit: quantityInfo.unit,
    locationCity: parseLocation(`${speaker} ${line}`),
    priceAmount: price,
    currency: /美金|USD|\$/i.test(line) ? "USD" : "CNY",
    condition: parseCondition(line),
    availabilityType: availabilityText(tradeMode),
    contactMethod: contact || "站内联系",
    sourceContact,
    rawText: line,
    confidence: 0.72,
    configItems: normalizeConfigItems(
      [
        ...configFromText(line, category),
        ...(priceHint ? [{ label: "价格线索", value: priceHint }] : []),
        ...(sourceContact ? [{ label: "来源", value: sourceContact }] : []),
      ],
      category,
      line,
      sourceContact,
    ),
  };
}

function splitSpeakerBlocks(rawText: string): Array<{ speaker: string; lines: string[] }> {
  const blocks: Array<{ speaker: string; lines: string[] }> = [];
  let current = { speaker: "未知来源", lines: [] as string[] };
  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const speakerMatch = line.match(/^(.{1,80})[:：]\s*$/);
    if (speakerMatch) {
      if (current.lines.length) blocks.push(current);
      current = { speaker: speakerMatch[1].trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.length) blocks.push(current);
  return blocks;
}

function cleanLine(line: string | undefined): string {
  return (line ?? "")
    .replace(/[🍆😇🌹🍀✨🔥💕☎️]/g, " ")
    .replace(/[【】]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isContextOnly(line: string): boolean {
  return /^(出货|找货|今日收货|现货|收现货|出|收|另收|开价就成交|有订单的来聊|有货联系|实单来聊|需要联系|换群|可互换行业群)[：:!！。\s]*$/i.test(
    line,
  );
}

function shouldAttachQuantityLine(line: string, nextLine: string): boolean {
  return Boolean(nextLine && !parseQuantity(line, "OTHER").quantity && /^(\d+|十几|几百|上千|K量级)\s*(台|张|片|条|根|个|颗|块|套)?/i.test(nextLine));
}

function detectPostType(text: string): PostType | null {
  if (/求租|承租/.test(text)) return "DEMAND";
  if (/出租/.test(text)) return "GOODS";
  if (/高价收|天价收|提价收|批量收|现款找|实单找|找货|求购|收[:：]?|^收|找|需要进/i.test(text)) return "DEMAND";
  if (/现货出|含税出|明价出|特价出|出售|供应|出[:：]?|^出|甩货|可接|库存/i.test(text)) return "GOODS";
  return null;
}

function normalizePostType(value: unknown): PostType {
  const text = asText(value).toUpperCase();
  if (text === "DEMAND" || /收|求购|求租|承租|找/.test(text)) return "DEMAND";
  return "GOODS";
}

function detectCategory(text: string): ProductCategory | null {
  if (/网卡|交换机|迈络思|Mellanox|ConnectX|Q3400|400g/i.test(text)) return "NETWORK";
  if (/CPU|至强|Xeon|AMD|EPYC|6767P|6776P|6760P|6747P|6740P|8468V|8558P?|6530P?|9554|9655|9555/i.test(text)) return "CPU";
  if (/硬盘|固态|SSD|HDD|NVMe|SATA|U\.?2|E1\.?S|M\.?2|SAS|PM9|PM8|P55|P56|ST\d|WD|WUH|WUS|希捷|西数|东芝|思得|SOLIDIGM|SOLINIGM|大普微|忆联|小海豚|\d+(?:\.\d+)?\s*T/i.test(text)) return "STORAGE";
  if (/内存|DDR[45]?|RDIMM|LRDIMM|DIMM|ECC|REG|三星\/SK|海力士|镁光|长鑫/i.test(text)) return "MEMORY";
  if (!/整机|工作站|服务器|显卡/i.test(text) && readCompactMemorySpec(text)) return "MEMORY";
  if (/整机|服务器|工作站|机头|8卡|万卡集群|H100整机|H200整机|B300整机|GB300/i.test(text)) return "SERVER";
  if (/显卡|风扇卡|涡轮卡|公版|PCB|5090|4090|4080|5080|5060|A100|A800|A40|A2|A30|A10|A5000|A6000|RTX|PRO\s?6000|6000D|PRO\s?5000|L20|L40S|T4/i.test(text)) return "GPU_CARD";
  return null;
}

function normalizeCategory(value: unknown): ProductCategory {
  const text = asText(value).toUpperCase();
  if (["SERVER", "GPU_CARD", "MEMORY", "STORAGE", "CPU", "NETWORK", "OTHER"].includes(text)) {
    return text as ProductCategory;
  }
  return detectCategory(asText(value)) ?? "OTHER";
}

function normalizeTradeMode(value: unknown): TradeMode {
  const text = asText(value).toUpperCase();
  if (text === "RENTAL" || /租赁|出租|求租|承租|租用|租金|日租|月租|年租/.test(text)) return "RENTAL";
  if (text === "FUTURES" || /期货|小期货|预售|交期|排产|4-6周|8月/.test(text)) return "FUTURES";
  return "SPOT";
}

function parseModelText(text: string, category: ProductCategory): string {
  if (category === "SERVER") {
    return firstMatch(text, /\b(?:GB300|B300|B200|H200|H100|A100|A800|H800|5090|4090|PRO\s?6000D?|PRO6000D?)\b.*?(?:整机|服务器|工作站|机头)?/i);
  }
  if (category === "GPU_CARD") {
    return firstMatch(text, /\b(?:RTX\s?5090D?|5090|RTX\s?4090D?|4090|RTX\s?4080S?|4080S?|RTX\s?5080|RTX\s?5060TI|PRO\s?6000(?:D|MAX-Q)?|PRO6000(?:D|MAX-Q)?|PRO\s?5000|L40S|L20|T4|A100|A800|A40|A2|A30|A10|A5000|A6000)\b(?:\s*\d{2,3}G)?/i);
  }
  if (category === "MEMORY") {
    return firstMatch(text, /(?:三星|SK|海力士|镁光|长鑫|H3C|HPE|白牌)?\s*(?:DDR[45]\s*)?(?:32|48|64|96|128|256)G\s*(?:2666|2933|3200|4800|5600|6400|7200)?(?:\s*DC\d{2}\+?)?/i);
  }
  if (category === "STORAGE") {
    return firstMatch(text, /(?:PM9D3A|PM9A3|PM893|PM983A?|PM1743|P5510|P5500|P5520|P5600|P5620|PS1010|S4520|J5300|H5100|R6100|ES3500P|ST\d{8,}[A-Z]*|WD[A-Z0-9-]+|WUH[A-Z0-9]+|WUS[A-Z0-9]+|MG\d+[A-Z0-9]+|[A-Z]{1,4}\d{3,5})[A-Z0-9-]*(?:\s*\d+(?:\.\d+)?T|\s*\d+G)?/i) || firstMatch(text, /(?:HDD|SSD|NVMe|SATA|SAS|U\.?2|E1\.?S|M\.?2)?\s*\d+(?:\.\d+)?\s*(?:T|TB|G|GB)/i);
  }
  if (category === "CPU") {
    return firstMatch(text, /(?:Xeon\s*)?(?:\d{4,5}[A-Z+]?|E-\d{4,5}|E5-\d{4}|W[579]-\d{4,5}X?|EPYC\s*\d{4,5}[A-Z]?)/i);
  }
  if (category === "NETWORK") {
    return firstMatch(text, /(?:ConnectX-\d|CX\d|Mellanox|迈络思|Q3400|400G网卡|200G网卡|交换机)[A-Z0-9 -]*/i);
  }
  return text.slice(0, 40);
}

function parseQuantity(text: string, category: ProductCategory): { quantity: number | null; unit: string } {
  const quantityMatch = text.match(/(\d+(?:\.\d+)?)\s*(台|张|片|条|根|个|颗|块|套|pcs?)/i);
  if (quantityMatch) return { quantity: Number(quantityMatch[1]), unit: normalizeUnit(quantityMatch[2], category) };
  const labeledQuantity = text.match(/(?:数量|库存|还剩|起订)\s*(\d+(?:\.\d+)?)/);
  if (labeledQuantity) return { quantity: Number(labeledQuantity[1]), unit: unitForCategory(category) };
  if (/\b(\d+(?:\.\d+)?)\s*K\b/i.test(text)) {
    const value = Number(text.match(/\b(\d+(?:\.\d+)?)\s*K\b/i)?.[1] ?? 1);
    return { quantity: value * 1000, unit: unitForCategory(category) };
  }
  if (/十几\s*(片|张|条|台|个)?/.test(text)) return { quantity: 10, unit: normalizeUnit(text.match(/十几\s*(片|张|条|台|个)?/)?.[1], category) };
  if (/几百\s*(片|张|条|台|个)?/.test(text)) return { quantity: 100, unit: normalizeUnit(text.match(/几百\s*(片|张|条|台|个)?/)?.[1], category) };
  if (/上千|K量级/i.test(text)) return { quantity: 1000, unit: unitForCategory(category) };
  return { quantity: null, unit: unitForCategory(category) };
}

function parsePrice(text: string): number | null {
  const clearWan = text.match(/(?:价格|报价|出价|收)?\s*(\d+(?:\.\d+)?)\s*(万|w)\b/i);
  if (clearWan) return Math.round(Number(clearWan[1]) * 10000);
  const rmb = text.match(/含税\s*(\d{4,6})|(\d{4,6})\s*含税/);
  if (rmb) return Number(rmb[1] ?? rmb[2]);
  return null;
}

function parsePriceHint(text: string): string {
  return firstMatch(text, /\d{2,3}X万|\d{2,3}\.X万|\d{2,3}xxx|\d{2,3}XXX|\d{2,3}\+|12xx|15xx|181n|182n/i);
}

function parseLocation(text: string): string {
  return firstMatch(text, /深圳|香港|上海|北京|广州|杭州|苏州|成都|国内|大陆|海外|新加坡|泰国/i) || "待确认";
}

function parseCondition(text: string): string {
  if (/原箱|原盒|未拆封|全新/i.test(text)) return "全新";
  if (/拆新|拆机/i.test(text)) return "拆新";
  if (/二手|退网|旧/i.test(text)) return "二手";
  return "待确认";
}

function parseContact(text: string): string {
  return firstMatch(text, /1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/) || "站内联系";
}

function ensurePersonalAccount(phone: string): { user: DemoUser; personalWorkspace: DemoWorkspace } {
  const existingUser = usersByPhone.get(phone);
  if (existingUser) {
    const personalWorkspace =
      workspacesById.get(personalWorkspaceId(existingUser.id)) ?? createPersonalWorkspace(existingUser);
    return { user: existingUser, personalWorkspace };
  }

  const now = new Date().toISOString();
  const user: DemoUser = {
    id: `usr_${randomUUID()}`,
    phone,
    displayName: maskPhone(phone),
    status: "ACTIVE",
    createdAt: now,
  };
  usersByPhone.set(phone, user);
  usersById.set(user.id, user);
  const personalWorkspace = createPersonalWorkspace(user);
  return { user, personalWorkspace };
}

interface IdentitySnapshot {
  version: 1;
  users: DemoUser[];
  workspaces: DemoWorkspace[];
  memberships: DemoMembership[];
  sessions: DemoSession[];
}

function identityFilePath(): string {
  return process.env.AUTH_STATE_FILE?.trim() || path.join(process.cwd(), ".data", "identity.json");
}

function identitySnapshot(): IdentitySnapshot {
  return { version: 1, users: [...usersById.values()], workspaces: [...workspacesById.values()], memberships: [...memberships], sessions: [...sessions.values()] };
}

function restoreIdentityState(snapshot: IdentitySnapshot): void {
  usersByPhone.clear();
  usersById.clear();
  workspacesById.clear();
  sessions.clear();
  memberships.splice(0, memberships.length, ...snapshot.memberships);
  for (const user of snapshot.users) { usersById.set(user.id, user); usersByPhone.set(user.phone, user); }
  for (const workspace of snapshot.workspaces) workspacesById.set(workspace.id, workspace);
  for (const session of snapshot.sessions) sessions.set(session.token, session);
}

function loadIdentityState(): void {
  const snapshot = readJsonSnapshot(identityFilePath());
  if (snapshot === undefined) return;
  if (!isRecord(snapshot) || snapshot.version !== 1 || !Array.isArray(snapshot.users) || !Array.isArray(snapshot.workspaces) || !Array.isArray(snapshot.memberships) || !Array.isArray(snapshot.sessions) ||
    snapshot.users.some((user) => !isRecord(user) || typeof user.id !== "string" || typeof user.phone !== "string") ||
    snapshot.workspaces.some((workspace) => !isRecord(workspace) || typeof workspace.id !== "string" || typeof workspace.ownerUserId !== "string") ||
    snapshot.memberships.some((member) => !isRecord(member) || typeof member.userId !== "string" || typeof member.workspaceId !== "string") ||
    snapshot.sessions.some((session) => !isRecord(session) || typeof session.token !== "string" || typeof session.userId !== "string" || typeof session.currentWorkspaceId !== "string" || typeof session.expiresAt !== "number")) {
    throw new Error("身份存储格式无效，请保留原文件并修复后重启。");
  }
  restoreIdentityState(snapshot as unknown as IdentitySnapshot);
}

function saveIdentityState(): void {
  writeAtomicJson(identityFilePath(), identitySnapshot());
}

function createPersonalWorkspace(user: DemoUser): DemoWorkspace {
  const now = new Date().toISOString();
  const workspace: DemoWorkspace = {
    id: personalWorkspaceId(user.id),
    name: `${maskPhone(user.phone)} 的个人空间`,
    type: "PERSONAL",
    status: "ACTIVE",
    planCode: "personal_free",
    ownerUserId: user.id,
    createdAt: now,
  };
  workspacesById.set(workspace.id, workspace);
  memberships.push({
    userId: user.id,
    workspaceId: workspace.id,
    role: "OWNER",
    dataScope: "PERSONAL",
    status: "ACTIVE",
  });
  return workspace;
}

function buildAuthPayload(session: DemoSession) {
  const user = usersById.get(session.userId);
  if (!user) return { error: "用户不存在。" };
  const userMemberships = memberships.filter((item) => item.userId === user.id && item.status === "ACTIVE");
  const workspaces = userMemberships
    .map((membership) => {
      const workspace = workspacesById.get(membership.workspaceId);
      if (!workspace) return null;
      return {
        id: workspace.id,
        name: workspace.name,
        type: workspace.type,
        status: workspace.status,
        planCode: workspace.planCode,
        role: membership.role,
        dataScope: membership.dataScope,
      };
    })
    .filter(Boolean);
  for (const company of enterprise.spaces(user.id)) workspaces.push({
    id:company.id,name:company.name,type:"ENTERPRISE",status:"ACTIVE",planCode:"enterprise",
    role:company.role,dataScope:company.role==="MEMBER"?"PERSONAL":"WORKSPACE",
  });
  return {
    token: session.token,
    user: {
      id: user.id,
      phone: user.phone,
      maskedPhone: maskPhone(user.phone),
      displayName: enterprise.use(db =>
        db.prepare("SELECT displayName FROM account_profiles WHERE userId=?").get(user.id)?.displayName
      ) ?? maskPhone(user.phone),
      status: user.status,
    },
    workspaces,
    currentWorkspaceId: session.currentWorkspaceId,
    enterprise: {
      status: workspaces.some(space=>space?.type==="ENTERPRISE") ? "ACTIVE" : "RESERVED",
      supportedWorkspaceType: "ENTERPRISE",
    },
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}

function findPaymentProduct(productType: PaymentProductType, productId: string, enterprise: boolean): PaymentProduct | undefined {
  if (productType === "MEMBERSHIP_PLAN") return membershipProducts.find(product => product.productId === productId);
  if (productType !== "CREDIT_PACKAGE") return undefined;
  const pack = creditPackagesFor(enterprise).find(item => item.id === productId);
  if (pack) return {
    productType, productId, title: "货记分" + pack.title,
    amountYuan: pack.yuan.toFixed(2), entitlement: { creditAmount: pack.credits },
  };
}

function createOutTradeNo(): string {
  return `HJ${Date.now()}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function serializePaymentOrder(order: PaymentOrder) {
  return {
    id: order.id,
    productType: order.productType,
    productId: order.productId,
    title: order.title,
    amountYuan: order.amountYuan,
    status: order.status,
    channel: order.channel,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    alipayTradeNo: order.alipayTradeNo,
    entitlement: order.entitlement,
  };
}

function paymentOrdersFilePath(): string {
  return process.env.PAYMENT_ORDERS_FILE?.trim() || path.join(process.cwd(), ".data", "payment-orders.json");
}

function loadPaymentOrders(): void {
  const orders=readJsonSnapshot(paymentOrdersFilePath());
  if(orders===undefined)return;
  if(!Array.isArray(orders) || orders.some(order=>!order?.id))throw Error("支付订单文件无效，请核对持久化数据。");
  orders.forEach(order=>paymentOrders.set(order.id,order));
}

function savePaymentOrders(): void {
  writeAtomicJson(paymentOrdersFilePath(), Array.from(paymentOrders.values()));
}

function appBaseUrl(req: express.Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured && !/(MY_APP_URL|YOUR_SERVER_IP)/i.test(configured)) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

function getAlipayConfig(baseUrl: string) {
  const appId = process.env.ALIPAY_APP_ID?.trim() ?? "";
  const merchantPrivateKey = optionalAnyEnv(["ALIPAY_MERCHANT_PRIVATE_KEY", "ALIPAY_APP_PRIVATE_KEY"]);
  const alipayPublicKey = optionalAnyEnv(["ALIPAY_PUBLIC_KEY", "ALIPAY_ALIPAY_PUBLIC_KEY"]);
  const missing = [
    !appId ? "ALIPAY_APP_ID" : "",
    !merchantPrivateKey ? "ALIPAY_MERCHANT_PRIVATE_KEY" : "",
    !alipayPublicKey ? "ALIPAY_PUBLIC_KEY" : "",
  ].filter(Boolean);

  return {
    ready: missing.length === 0,
    missing,
    appId,
    merchantPrivateKey: formatPemKey(merchantPrivateKey, "PRIVATE"),
    alipayPublicKey: formatPemKey(alipayPublicKey, "PUBLIC"),
    gateway: process.env.ALIPAY_GATEWAY?.trim() || "https://openapi.alipay.com/gateway.do",
    notifyUrl: process.env.ALIPAY_NOTIFY_URL?.trim() || `${baseUrl}/api/payments/alipay/notify`,
    returnUrl: process.env.ALIPAY_RETURN_URL?.trim() || `${baseUrl}/api/payments/alipay/return`,
    sellerId: process.env.ALIPAY_SELLER_ID?.trim() || "",
  };
}

function buildAlipayPayUrl(order: PaymentOrder, config: ReturnType<typeof getAlipayConfig>): string {
  const method = order.channel === "wap" ? "alipay.trade.wap.pay" : "alipay.trade.page.pay";
  const bizContent = {
    out_trade_no: order.id,
    total_amount: order.amountYuan,
    subject: order.title,
    body: `货记 ${order.title}`,
    product_code: order.channel === "wap" ? "QUICK_WAP_WAY" : "FAST_INSTANT_TRADE_PAY",
    timeout_express: "30m",
  };
  const params: Record<string, string> = {
    app_id: config.appId,
    method,
    format: "JSON",
    charset: "UTF-8",
    sign_type: "RSA2",
    timestamp: alipayTimestamp(),
    version: "1.0",
    notify_url: config.notifyUrl,
    return_url: config.returnUrl,
    biz_content: JSON.stringify(bizContent),
  };
  params.sign = signAlipayParams(params, config.merchantPrivateKey);
  return `${config.gateway}?${new URLSearchParams(params).toString()}`;
}

function signAlipayParams(params: Record<string, string>, privateKey: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(canonicalAlipayRequestParams(params), "utf8");
  signer.end();
  return signer.sign(privateKey, "base64");
}

function verifyAlipaySignature(params: Record<string, string>, publicKey: string): boolean {
  const sign = params.sign;
  if (!sign) return false;
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(canonicalAlipayNotifyParams(params), "utf8");
    verifier.end();
    return verifier.verify(publicKey, sign, "base64");
  } catch {
    return false;
  }
}

function canonicalAlipayRequestParams(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((key) => key !== "sign" && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

function canonicalAlipayNotifyParams(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((key) => key !== "sign" && key !== "sign_type" && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

function formatPemKey(value: string, kind: "PRIVATE" | "PUBLIC"): string {
  const normalized = value.replace(/\\n/g, "\n").trim();
  if (!normalized) return "";
  if (/-----BEGIN [A-Z ]+-----/.test(normalized)) return normalized;
  const body = normalized.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? normalized;
  return `-----BEGIN ${kind} KEY-----\n${body}\n-----END ${kind} KEY-----`;
}

function alipayTimestamp(date = new Date()): string {
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    " ",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds()),
  ].join("");
}

function flattenStringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, raw] of Object.entries(value)) {
    const item = Array.isArray(raw) ? raw[0] : raw;
    result[key] = asText(item);
  }
  return result;
}

function sameMoney(left: string, right: string): boolean {
  const toCents = (value: string) => Math.round(Number(value) * 100);
  const leftCents = toCents(left);
  const rightCents = toCents(right);
  return Number.isFinite(leftCents) && Number.isFinite(rightCents) && leftCents === rightCents;
}

function optionalAnyEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function readSession(authorization: unknown): DemoSession | null {
  const token = parseBearerToken(authorization);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || (process.env.NODE_ENV === "production" && !session.verifiedSms)) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = usersById.get(session.userId);
  if (isCompany(session.currentWorkspaceId)) {
    const member=enterprise.member(session.currentWorkspaceId,session.userId);
    return user?.status==="ACTIVE" && member?.active && member.accessVersion===session.accessVersion ? session : null;
  }
  const workspace = workspacesById.get(session.currentWorkspaceId);
  const membership = memberships.find((item) => item.userId === session.userId && item.workspaceId === session.currentWorkspaceId && item.status === "ACTIVE");
  if (!user || user.status !== "ACTIVE" || !workspace || workspace.status !== "ACTIVE" || !membership) return null;
  return session;
}

function parseBearerToken(authorization: unknown): string {
  const value = asText(authorization);
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return /^1[3-9]\d{9}$/.test(digits) ? digits : "";
}

function createSmsCode(): string {
  return `${Math.floor(100000 + Math.random() * 900000)}`;
}

function getCaptchaPublicConfig(): CaptchaPublicConfig {
  const provider = String(process.env.CAPTCHA_PROVIDER ?? "none").toLowerCase();
  if (provider !== "aliyun") {
    return { enabled: false, provider: "none" };
  }

  const prefix = process.env.ALIYUN_CAPTCHA_PREFIX?.trim();
  const sceneId = process.env.ALIYUN_CAPTCHA_SCENE_ID?.trim();
  return {
    enabled: Boolean(prefix && sceneId),
    provider: "aliyun",
    region: process.env.ALIYUN_CAPTCHA_REGION || "cn",
    prefix,
    sceneId,
    mode: process.env.ALIYUN_CAPTCHA_MODE === "embed" ? "embed" : "popup",
    scriptUrl: process.env.ALIYUN_CAPTCHA_SCRIPT_URL || "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js",
  };
}

async function verifyCaptchaIfRequired(captchaVerifyParam: string): Promise<void> {
  const provider = String(process.env.CAPTCHA_PROVIDER ?? "none").toLowerCase();
  if (provider === "none" || provider === "mock" || !provider) return;
  if (provider !== "aliyun") throw new Error(`不支持的安全验证服务商：${provider}`);
  if (!captchaVerifyParam) throw new Error("请先完成安全验证。");
  await verifyAliyunCaptcha(captchaVerifyParam);
}

async function verifyAliyunCaptcha(captchaVerifyParam: string): Promise<void> {
  const accessKeyId = requiredAnyEnv(["ALIYUN_CAPTCHA_ACCESS_KEY_ID", "ALIYUN_ACCESS_KEY_ID"]);
  const accessKeySecret = requiredAnyEnv(["ALIYUN_CAPTCHA_ACCESS_KEY_SECRET", "ALIYUN_ACCESS_KEY_SECRET"]);
  const sceneId = requiredEnv("ALIYUN_CAPTCHA_SCENE_ID");
  const endpoint = process.env.ALIYUN_CAPTCHA_ENDPOINT || aliyunCaptchaEndpointForRegion(process.env.ALIYUN_CAPTCHA_REGION || "cn");
  const action = "VerifyIntelligentCaptcha";
  const version = "2023-03-05";
  const body = new URLSearchParams({
    CaptchaVerifyParam: captchaVerifyParam,
    SceneId: sceneId,
  }).toString();
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const nonce = randomUUID().replace(/-/g, "");
  const bodyHash = sha256Hex(body);
  const signedHeaders = "host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version";
  const headersForSign: Record<string, string> = {
    host: endpoint,
    "x-acs-action": action,
    "x-acs-content-sha256": bodyHash,
    "x-acs-date": date,
    "x-acs-signature-nonce": nonce,
    "x-acs-version": version,
  };
  const authorization = createAliyunOpenApiAuthorization({
    accessKeyId,
    accessKeySecret,
    method: "POST",
    pathName: "/",
    query: "",
    bodyHash,
    signedHeaders,
    headers: headersForSign,
  });

  const response = await fetch(`https://${endpoint}/`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      Host: endpoint,
      "x-acs-action": action,
      "x-acs-content-sha256": bodyHash,
      "x-acs-date": date,
      "x-acs-signature-nonce": nonce,
      "x-acs-version": version,
    },
    body,
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`阿里云验证码返回非 JSON 响应：${text.slice(0, 180)}`);
  }

  const payload = isRecord(data) ? data : {};
  const code = asText(payload.Code);
  const message = asText(payload.Message);
  if (!response.ok || (code && code !== "Success")) {
    throw new Error(`阿里云验证码验签失败：${code || response.status} ${message || response.statusText}`);
  }

  const result = isRecord(payload.Result) ? payload.Result : {};
  if (result.VerifyResult !== true) {
    const verifyCode = asText(result.VerifyCode);
    throw new Error(`安全验证未通过：${verifyCode || "VERIFY_FAILED"} ${message}`);
  }
}

function aliyunCaptchaEndpointForRegion(region: string): string {
  return region === "sgp" ? "captcha.ap-southeast-1.aliyuncs.com" : "captcha.cn-shanghai.aliyuncs.com";
}

function createAliyunOpenApiAuthorization(input: {
  accessKeyId: string;
  accessKeySecret: string;
  method: string;
  pathName: string;
  query: string;
  bodyHash: string;
  signedHeaders: string;
  headers: Record<string, string>;
}): string {
  const canonicalHeaders = input.signedHeaders
    .split(";")
    .map((key) => `${key}:${input.headers[key]}`)
    .join("\n");
  const canonicalRequest = [
    input.method,
    input.pathName,
    input.query,
    `${canonicalHeaders}\n`,
    input.signedHeaders,
    input.bodyHash,
  ].join("\n");
  const algorithm = "ACS3-HMAC-SHA256";
  const stringToSign = `${algorithm}\n${sha256Hex(canonicalRequest)}`;
  const signature = hmacSha256Hex(input.accessKeySecret, stringToSign);
  return `${algorithm} Credential=${input.accessKeyId},SignedHeaders=${input.signedHeaders},Signature=${signature}`;
}

async function deliverSmsCode(phone: string, code: string, provider = String(process.env.SMS_PROVIDER ?? "mock").toLowerCase()): Promise<SmsDeliveryResult> {
  if (provider === "mock") {
    return { provider: "mock", isMock: true };
  }
  if (provider === "aliyun") {
    const requestId = await sendAliyunSms(phone, code);
    return { provider: "aliyun", isMock: false, requestId };
  }
  if (provider === "tencentcloud") {
    const requestId = await sendTencentCloudSms(phone, code);
    return { provider: "tencentcloud", isMock: false, requestId };
  }
  throw new Error(`不支持的短信服务商：${provider}`);
}

async function sendAliyunSms(phone: string, code: string): Promise<string | undefined> {
  const accessKeyId = requiredAnyEnv(["ALIYUN_SMS_ACCESS_KEY_ID", "ALIYUN_ACCESS_KEY_ID"]);
  const accessKeySecret = requiredAnyEnv(["ALIYUN_SMS_ACCESS_KEY_SECRET", "ALIYUN_ACCESS_KEY_SECRET"]);
  const signName = requiredEnv("ALIYUN_SMS_SIGN_NAME");
  const templateCode = requiredEnv("ALIYUN_SMS_TEMPLATE_CODE");
  const endpoint = process.env.ALIYUN_SMS_ENDPOINT || "dysmsapi.aliyuncs.com";
  const action = "SendSms";
  const version = "2017-05-25";
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const nonce = randomUUID().replace(/-/g, "");
  const bodyHash = sha256Hex("");
  const query = buildCanonicalQuery({
    PhoneNumbers: phone,
    SignName: signName,
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify(buildAliyunSmsTemplateParam(code)),
    OutId: `login_${Date.now()}`,
  });
  const signedHeaders = "host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version";
  const headersForSign: Record<string, string> = {
    host: endpoint,
    "x-acs-action": action,
    "x-acs-content-sha256": bodyHash,
    "x-acs-date": date,
    "x-acs-signature-nonce": nonce,
    "x-acs-version": version,
  };
  const authorization = createAliyunOpenApiAuthorization({
    accessKeyId,
    accessKeySecret,
    method: "POST",
    pathName: "/",
    query,
    bodyHash,
    signedHeaders,
    headers: headersForSign,
  });

  const response = await fetch(`https://${endpoint}/?${query}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      Host: endpoint,
      "x-acs-action": action,
      "x-acs-content-sha256": bodyHash,
      "x-acs-date": date,
      "x-acs-signature-nonce": nonce,
      "x-acs-version": version,
    },
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`阿里云短信返回非 JSON 响应：${text.slice(0, 180)}`);
  }

  const payload = isRecord(data) ? data : {};
  const responseCode = asText(payload.Code);
  const message = asText(payload.Message);
  if (!response.ok || responseCode !== "OK") {
    throw new Error(`阿里云短信发送失败：${responseCode || response.status} ${message || response.statusText}`);
  }

  return asText(payload.RequestId) || undefined;
}

function buildAliyunSmsTemplateParam(code: string): Record<string, string> {
  const ttlMinutes = String(Math.ceil(SMS_TTL_MS / 60_000));
  const keys = (process.env.ALIYUN_SMS_TEMPLATE_PARAMS || "code")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const templateParam: Record<string, string> = {};
  for (const key of keys) {
    const normalized = key.toLowerCase();
    if (normalized === "code") {
      templateParam[key] = code;
    } else if (normalized === "ttl" || normalized === "minutes") {
      templateParam[key] = ttlMinutes;
    } else {
      templateParam[key] = key.replace(/\{code\}/g, code).replace(/\{ttl\}/g, ttlMinutes);
    }
  }
  return templateParam;
}

async function sendTencentCloudSms(phone: string, code: string): Promise<string | undefined> {
  const secretId = requiredEnv("TENCENTCLOUD_SECRET_ID");
  const secretKey = requiredEnv("TENCENTCLOUD_SECRET_KEY");
  const smsSdkAppId = requiredEnv("TENCENT_SMS_SDK_APP_ID");
  const signName = requiredEnv("TENCENT_SMS_SIGN_NAME");
  const templateId = requiredEnv("TENCENT_SMS_TEMPLATE_ID");
  const endpoint = process.env.TENCENT_SMS_ENDPOINT || "sms.tencentcloudapi.com";
  const region = process.env.TENCENT_SMS_REGION || "ap-guangzhou";
  const service = "sms";
  const action = "SendSms";
  const version = "2021-01-11";
  const timestamp = Math.floor(Date.now() / 1000);
  const params = buildTencentSmsTemplateParams(code);
  const payload = JSON.stringify({
    PhoneNumberSet: [`+86${phone}`],
    SmsSdkAppId: smsSdkAppId,
    SignName: signName,
    TemplateId: templateId,
    TemplateParamSet: params,
    SessionContext: `login_${phone}_${timestamp}`,
  });
  const authorization = createTencentCloudAuthorization({
    secretId,
    secretKey,
    endpoint,
    service,
    action,
    timestamp,
    payload,
  });

  const response = await fetch(`https://${endpoint}/`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      Host: endpoint,
      "X-TC-Action": action,
      "X-TC-Version": version,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Region": region,
    },
    body: payload,
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`腾讯云短信返回非 JSON 响应：${text.slice(0, 180)}`);
  }

  const responseBody = isRecord(data) && isRecord(data.Response) ? data.Response : {};
  const requestId = asText(responseBody.RequestId);
  if (isRecord(responseBody.Error)) {
    const codeText = asText(responseBody.Error.Code);
    const message = asText(responseBody.Error.Message);
    throw new Error(`腾讯云短信发送失败：${codeText || response.status} ${message || response.statusText}`);
  }
  if (!response.ok) {
    throw new Error(`腾讯云短信请求失败：HTTP ${response.status} ${response.statusText}`);
  }

  const statusSet = Array.isArray(responseBody.SendStatusSet) ? responseBody.SendStatusSet : [];
  const firstStatus = statusSet.find(isRecord);
  const sendCode = asText(firstStatus?.Code);
  if (sendCode && sendCode !== "Ok") {
    const message = asText(firstStatus?.Message);
    throw new Error(`腾讯云短信发送失败：${sendCode} ${message}`);
  }

  return requestId || undefined;
}

function buildTencentSmsTemplateParams(code: string): string[] {
  const ttlMinutes = String(Math.ceil(SMS_TTL_MS / 60_000));
  const format = (process.env.TENCENT_SMS_TEMPLATE_PARAMS || "code")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return format.map((item) => {
    if (item === "code") return code;
    if (item === "ttl" || item === "minutes") return ttlMinutes;
    return item.replace(/\{code\}/g, code).replace(/\{ttl\}/g, ttlMinutes);
  });
}

function buildCanonicalQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeAliyunQueryValue(key)}=${encodeAliyunQueryValue(value)}`)
    .join("&");
}

function encodeAliyunQueryValue(value: string): string {
  return encodeURIComponent(value).replace(/\+/g, "%20").replace(/\*/g, "%2A").replace(/%7E/g, "~");
}

function createTencentCloudAuthorization(input: {
  secretId: string;
  secretKey: string;
  endpoint: string;
  service: string;
  action: string;
  timestamp: number;
  payload: string;
}): string {
  const algorithm = "TC3-HMAC-SHA256";
  const contentType = "application/json; charset=utf-8";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    `content-type:${contentType}\nhost:${input.endpoint}\nx-tc-action:${input.action.toLowerCase()}\n`,
    "content-type;host;x-tc-action",
    sha256Hex(input.payload),
  ].join("\n");
  const date = new Date(input.timestamp * 1000).toISOString().slice(0, 10);
  const credentialScope = `${date}/${input.service}/tc3_request`;
  const stringToSign = [algorithm, String(input.timestamp), credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const secretDate = hmacSha256(`TC3${input.secretKey}`, date);
  const secretService = hmacSha256(secretDate, input.service);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = hmacSha256Hex(secretSigning, stringToSign);
  return `${algorithm} Credential=${input.secretId}/${credentialScope}, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function hmacSha256Hex(key: string | Buffer, value: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`缺少环境变量：${key}`);
  return value;
}

function requiredAnyEnv(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  throw new Error(`缺少环境变量：${keys.join(" 或 ")}`);
}

function personalWorkspaceId(userId: string): string {
  return `wsp_personal_${userId.replace(/^usr_/, "")}`;
}

function maskPhone(phone: string): string {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

function normalizeSourceContact(value: unknown, configItems?: unknown, rawText?: unknown, inputText?: string): string {
  return (
    cleanSourceContact(asText(value)) ||
    cleanSourceContact(sourceContactFromConfig(configItems)) ||
    cleanSourceContact(parseSourceContactFromText(asText(rawText))) ||
    cleanSourceContact(findSourceContactForRawText(asText(rawText), inputText ?? "")) ||
    "未知来源"
  );
}

function sourceContactFromConfig(items: unknown): string {
  if (!Array.isArray(items)) return "";
  for (const item of items) {
    if (!isRecord(item)) continue;
    const label = asText(item.label);
    if (isSourceContactLabel(label)) return asText(item.value);
  }
  return "";
}

function parseSourceContactFromText(text: string): string {
  const match = text.match(/^([^:：\n]{1,80})[:：]\s*(?:\S|$)/m);
  const candidate = cleanSourceContact(match?.[1] ?? "");
  if (/^(出|收|求购|找|找货|价格|数量|型号|城市|联系方式?|联系人)$/.test(candidate)) return "";
  return candidate;
}

function findSourceContactForRawText(itemText: string, inputText: string): string {
  const compactItem = itemText.replace(/\s+/g, "");
  if (!compactItem || !inputText.trim()) return "";
  for (const block of splitSpeakerBlocks(inputText)) {
    const speaker = cleanSourceContact(block.speaker);
    if (!speaker || speaker === "未知来源") continue;
    const compactBlock = block.lines.join("\n").replace(/\s+/g, "");
    if (compactBlock.includes(compactItem) || compactItem.includes(compactBlock)) return speaker;
    const hasSharedLine = itemText
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\s+/g, ""))
      .filter((line) => line.length >= 4)
      .some((line) => compactBlock.includes(line));
    if (hasSharedLine) return speaker;
  }
  return "";
}

function isSourceContactLabel(label: string): boolean {
  return /^(来源|来源用户|说话人|发言人|微信用户)$/.test(label.trim());
}

function cleanSourceContact(value: string): string {
  return value.replace(/[:：]\s*$/, "").trim();
}

function configFromText(text: string, category: ProductCategory): ConfigItem[] {
  const items: ConfigItem[] = [];
  const brand = firstMatch(text, /三星|Samsung|SK|海力士|Hynix|镁光|Micron|长鑫|华为|Dell|戴尔|浪潮|超微|Supermicro|华勤|H3C|HPE|希捷|西数|东芝|Intel|英特尔|NVIDIA|英伟达|华硕|ASUS|技嘉|MSI/i);
  if (brand) items.push({ label: "品牌", value: brand });
  if (category === "MEMORY") {
    pushMatch(items, "容量", text, /(?:32|48|64|96|128|256)G/i);
    const frequency = readMemoryFrequency(text);
    if (frequency) items.push({ label: "频率", value: frequency });
    pushMatch(items, "批次", text, /DC\d{2}\+?|PB0|EB2|ws/i);
  }
  if (category === "STORAGE") {
    pushMatch(items, "容量", text, /\d+(?:\.\d+)?\s*(?:T|TB|G|GB)/i);
    pushMatch(items, "接口", text, /NVMe|SATA|SAS|U\.?2|E1\.?S|M\.?2|GEN[45]|PCIe\s?[45]/i);
    pushMatch(items, "料号", text, /[A-Z]{2,}\d{4,}[A-Z0-9-]*/i);
  }
  if (category === "GPU_CARD" || category === "SERVER") {
    pushMatch(items, "GPU", text, /H100|H200|B200|B300|GB300|5090D?|4090D?|PRO\s?6000D?|L40S|A100|A800/i);
    pushMatch(items, "显存", text, /\d{2,3}G/i);
    pushMatch(items, "形态", text, /风扇卡|涡轮卡|公版|PCB|SXM|PCIe|整机|服务器|工作站|模组/i);
    pushMatch(items, "质保", text, /质保\s*[一二三四五六七八九十\d]+年|一年质保|三年质保|含税/i);
  }
  if (category === "CPU") {
    pushMatch(items, "型号", text, /(?:Xeon\s*)?(?:\d{4,5}[A-Z+]?|E-\d{4,5}|E5-\d{4}|W[579]-\d{4,5}X?)/i);
  }
  if (category === "NETWORK") {
    pushMatch(items, "规格", text, /400G|200G|100G|ConnectX-\d|CX\d|Q3400/i);
  }
  return items;
}

function normalizeConfigItems(value: unknown, category: ProductCategory, rawText: string, sourceContact = ""): ConfigItem[] {
  const sourceItems = Array.isArray(value)
    ? value
        .map((item) => {
          if (!isRecord(item)) return null;
          const label = asText(item.label);
          const itemValue = asText(item.value);
          return label && itemValue ? { label, value: itemValue } : null;
        })
        .filter((item): item is ConfigItem => Boolean(item))
    : configFromText(rawText, category);
  const cleanSource = cleanSourceContact(sourceContact);
  if (cleanSource) {
    const sourceIndex = sourceItems.findIndex((item) => isSourceContactLabel(item.label));
    if (sourceIndex >= 0) {
      sourceItems[sourceIndex] = { label: "来源", value: cleanSource };
    } else {
      sourceItems.push({ label: "来源", value: cleanSource });
    }
  }
  const seen = new Set<string>();
  return sourceItems.filter((item) => {
    const key = `${item.label}:${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pushMatch(items: ConfigItem[], label: string, text: string, pattern: RegExp): void {
  const value = firstMatch(text, pattern);
  if (value) items.push({ label, value });
}

function buildEnvelope(items: ExtractedTradeItem[], warnings: string[]): ExtractionEnvelope {
  const sourceWarnings = items.some((item) => item.sourceContact === "未知来源")
    ? [unknownSourceWarning]
    : [];
  return {
    summary: {
      total: items.length,
      goodsCount: items.filter((item) => item.postType === "GOODS").length,
      demandCount: items.filter((item) => item.postType === "DEMAND").length,
    },
    items,
    warnings: [...new Set([...warnings, ...sourceWarnings])],
  };
}

function dedupeItems(items: ExtractedTradeItem[]): ExtractedTradeItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [
      item.postType,
      item.tradeMode,
      item.productCategory,
      item.sourceContact,
      item.model.toLowerCase(),
      item.quantity ?? "",
      item.locationCity,
      item.rawText.toLowerCase().replace(/\s+/g, ""),
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildTitle(postType: PostType, category: ProductCategory, model: string, mode: TradeMode): string {
  const verb = mode === "RENTAL" ? (postType === "GOODS" ? "出租" : "求租") : postType === "GOODS" ? "出" : "收";
  return `${verb}${categoryLabel(category)} ${model}`.trim();
}

function categoryLabel(category: ProductCategory): string {
  const labels: Record<ProductCategory, string> = {
    SERVER: "服务器",
    GPU_CARD: "显卡",
    MEMORY: "内存",
    STORAGE: "硬盘/SSD",
    CPU: "CPU",
    NETWORK: "网络设备",
    OTHER: "配件",
  };
  return labels[category];
}

function unitForCategory(category: ProductCategory): string {
  const units: Record<ProductCategory, string> = {
    SERVER: "台",
    GPU_CARD: "张",
    MEMORY: "条",
    STORAGE: "个",
    CPU: "颗",
    NETWORK: "个",
    OTHER: "个",
  };
  return units[category];
}

function normalizeUnit(value: string | undefined, category: ProductCategory): string {
  const unit = asText(value);
  if (!unit) return unitForCategory(category);
  if (/pcs?/i.test(unit)) return "个";
  return unit;
}

function availabilityText(mode: TradeMode): string {
  if (mode === "FUTURES") return "期货";
  if (mode === "RENTAL") return "租赁";
  return "现货";
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error("DeepSeek response did not contain a JSON object.");
  return JSON.parse(trimmed.slice(first, last + 1));
}

function firstMatch(text: string, pattern: RegExp): string {
  return text.match(pattern)?.[0]?.trim() ?? "";
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function clampNumber(value: number | null, min: number, max: number, fallback: number): number {
  if (value === null) return fallback;
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function startServer() {
  rpaInbox.kick();
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[货记 Web] listening on http://0.0.0.0:${PORT}`);
  });
}

export { app };
export function stopLocalRealtime() { localController?.stopRealtime(); }
if (process.env.NODE_ENV !== "test") void startServer();
