import { creditPackagesFor, monthlyCredits, monthlyPrice, annualPrice, annualMonthlyCredits, annualBonusCredits, pointsPerCostYuan, creditsPerYuan, pricingVersion, rechargePricingVersion } from "./credit-pricing";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { WorkbenchHeader, MobileNavigation } from "./components/WorkspaceChrome";
import AccountProfile from "./components/AccountProfile";
import TradeSearch from "./components/TradeSearch";
import CircleWorkspace from "./components/CircleWorkspace";
import { useCircleLive } from "./components/circle-client";
import type { CircleParticipation, CircleSource } from "./circle-types";
import { navigateWorkspace, useWorkspaceRoute, useMessageEntry, setIntakeView, setAccountSection, DEEPSEEK_SETTINGS_HASH, TALK_HASH, type AccountSection, type TabKey } from "./workspace-navigation";
import { readCompactMemorySpec, readMemoryFrequency } from "./memory-specs";
import { startLedgerSync, type SyncState } from "./workspace-ledger-client";
import "./trade-workspace.css";
import "./related-matches.css";
import { compareChronology, sortTradesByTime, tradeChronology } from "./trade-chronology";
import "./review-workspace.css";
import { improvesPublishedTime, wechatClockMarker, type WechatPublishedTime } from "./wechat-published-time";
import { readWechatTime, tradeTimeCaption, wechatTimeLabel, wechatTimestamp } from "./wechat-time-label";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  Users,
  ClipboardCheck,
  CreditCard,
  KeyRound,
  Radio,
  Phone,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import WechatRpaInbox, { rpaMessageResult, rpaItemSource, rpaItemIsImported, rpaMessageCanBulkImport, type WechatRpaMessage } from "./components/WechatRpaInbox";
import { monitorSession, readStoredSession, removeExpiredStoredSession, SESSION_EXPIRED_NOTICE } from "./auth-session";
import { SupplyVerificationPanel } from "./components/SupplyVerificationPanel";
import WorkspaceSwitcher from "./components/WorkspaceSwitcher";
import EnterpriseHome, { TokenUsage } from "./components/EnterpriseHome";
import "./components/account-center.css";
import { appendMatchHistory, matchHistoryPrefix, readMatchHistory } from "./match-verification-history";
import type { VerificationEntry } from "./supply-verification";

const pageTitles: Record<TabKey, string> = { input: "消息工作台", stock: "供应库", market: "需求库", match: "供需匹配", account: "个人中心", circle: "同行广场" };
type MarketType = "GOODS" | "DEMAND";
type TradeMode = "SPOT" | "FUTURES" | "RENTAL";
type ProductCategory = "SERVER" | "GPU_CARD" | "MEMORY" | "STORAGE" | "CPU" | "NETWORK" | "OTHER";
type PriceFilter = "ALL" | "HAS_PRICE" | "NO_PRICE" | "UNDER_10000" | "FROM_10000_TO_100000" | "FROM_100000_TO_500000" | "OVER_500000";
type BadgeTone = "default" | "blue" | "green" | "orange" | "red";
type NoticeTone = "info" | "success" | "warning";
type WorkspaceType = "PERSONAL" | "ENTERPRISE";
type WorkspaceCollection = "stocks" | "market";
type CaptchaStatus = "disabled" | "loading" | "ready" | "error";
type MembershipPlanCode = "FREE" | "PRO_MONTHLY" | "PRO_YEARLY";
type CreditTransactionType = "RECHARGE" | "CONSUME" | "GRANT" | "REFUND" | "ADJUST";
type MatchStatus = "NEW" | "CONTACTED" | "IGNORED";
type MatchScoreLevel = "STRONG" | "GOOD" | "WEAK";
type MatchView = "RECOMMENDED" | "DEMAND_TO_SUPPLY" | "SUPPLY_TO_DEMAND";
type MatchScoreFilter = "ALL" | MatchScoreLevel;
type MatchStatusFilter = "ALL" | MatchStatus;
type DateFilter = "ALL" | "TODAY" | "LAST_3_DAYS" | "LAST_7_DAYS" | "LAST_14_DAYS" | "LAST_30_DAYS";

const LIST_PAGE_SIZE = 30;
const AUTH_STORAGE_KEY = "huoji_auth_session";
const MATCH_STATUS_STORAGE_PREFIX = "huoji_match_statuses";
const AI_EXAMPLE_TEXT = "深圳现货 H100 8卡服务器 2台 全新 价格120万";

interface ConfigItem {
  label: string;
  value: string;
}

interface RpaProvenance {
  sourceCaptureId?: string;
  sourceItemKey?: string;
  sourceMessageId?: string;
  sourceChatName?: string;
  sourceSender?: string;
  sourceSentAt?: string | null;
  sourcePublishedTime?: WechatPublishedTime;
  sourceCanLookupPublishedTime?: boolean;
  sourceObservedAt?: string;
  sourceCaptureMode?: "UIA_MESSAGE" | "OCR_SNAPSHOT" | "OCR_MESSAGE";
}

type CaptureTime = {
  id: string;
  sentAt: string | null;
  publishedTime?: WechatPublishedTime;
  repeatedContent?: boolean;
  legacyTimeAmbiguous?: boolean;
};

function useWechatTimes(session: AuthSession | null, sources: RpaProvenance[]) {
  const token = session?.token;
  const workspaceId = session?.currentWorkspaceId;
  const ids = useMemo(() => [...new Set(sources.filter(item => item.sourceCanLookupPublishedTime !== false)
    .map(item => item.sourceCaptureId).filter((id): id is string => Boolean(id && /^[a-zA-Z0-9_-]{1,128}$/.test(id))))].sort().join(","), [sources]);
  const [loaded, setLoaded] = useState<{ token: string; workspaceId: string; ids: string; values: Map<string, CaptureTime> } | null>(null);
  useEffect(() => {
    if (!token || !workspaceId || !ids) { setLoaded(null); return; }
    const controller = new AbortController();
    async function read() {
      const keys = ids.split(",");
      const values = new Map<string, CaptureTime>();
      for (let offset = 0; offset < keys.length && !controller.signal.aborted; offset += 50) {
        const params = new URLSearchParams({ ids: keys.slice(offset, offset + 50).join(",") });
        try {
          const response = await fetch(`/api/rpa/publication-times?${params}`, {
            headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
          });
          if (!response.ok) break;
          const body = await response.json() as { items: CaptureTime[] };
          for (const item of body.items) values.set(item.id, item);
        } catch { break; }
      }
      if (!controller.signal.aborted) setLoaded({ token, workspaceId, ids, values });
    }
    void read();
    return () => controller.abort();
  }, [token, workspaceId, ids]);
  return loaded && loaded.workspaceId === workspaceId && loaded.token === token && loaded.ids === ids ? loaded.values : undefined;
}

function enrichWechatTime<T extends StockItem | MarketPost | TradeDraft>(item: T, times?: Map<string, CaptureTime>): T {
  const source = item.sourceCaptureId && times?.get(item.sourceCaptureId);
  const usable = source && item.sourceCanLookupPublishedTime !== false
    && (item.sourceCanLookupPublishedTime === true || !(source.repeatedContent || source.legacyTimeAmbiguous));
  const saved = item.sourcePublishedTime;
  const prior = saved?.kind === "WECHAT_CLOCK" && item.sourceObservedAt
    ? wechatClockMarker(saved.clock, item.sourceObservedAt) : saved;
  const sentAt = usable ? item.sourceSentAt || source.sentAt : item.sourceSentAt;
  const evidence = usable && source.publishedTime && improvesPublishedTime(prior, source.publishedTime)
    ? source.publishedTime : prior;
  if (sentAt === item.sourceSentAt && evidence === item.sourcePublishedTime) return item;
  const updated = { ...item, sourceSentAt: sentAt, sourcePublishedTime: evidence };
  return { ...updated, configItems: configWithRpaProvenance(item.configItems, updated) };
}

interface StockItem extends RpaProvenance {
  id: string;
  productCategory: ProductCategory;
  title: string;
  gpuModel: string;
  gpuCount: number;
  quantity: number;
  quantityUnit: string;
  locationCity: string;
  priceAmount?: number;
  condition?: string;
  availabilityType?: string;
  tradeMode: TradeMode;
  configItems: ConfigItem[];
  status: "UNVERIFIED" | "VERIFIED" | "SELLABLE" | "EXPIRED" | "SOLD_OUT";
  source: "AI" | "MANUAL";
  sourceContact: string;
  createdAt: string;
}

interface MarketPost extends RpaProvenance {
  id: string;
  productCategory: ProductCategory;
  tradeMode: TradeMode;
  postType: MarketType;
  title: string;
  gpuModel: string;
  quantity: number;
  quantityUnit: string;
  locationCity: string;
  priceAmount?: number;
  contactMethod: string;
  sourceContact: string;
  configItems: ConfigItem[];
  publishedAt: string;
}

interface ParsedTradeItem {
  postType?: MarketType | string;
  tradeMode?: TradeMode | string;
  productCategory?: ProductCategory | string;
  title?: string;
  model?: string;
  gpuModel?: string;
  gpuCount?: number | string;
  quantity?: number | string | null;
  quantityUnit?: string;
  locationCity?: string;
  priceAmount?: number | string | null;
  currency?: string;
  condition?: string;
  availabilityType?: string;
  contactMethod?: string;
  sourceContact?: string;
  rawText?: string;
  confidence?: number;
  configItems?: ConfigItem[];
}

interface NoticeState {
  tone: NoticeTone;
  text: string;
}

interface TradeDraft extends RpaProvenance {
  id: string;
  createdAt?: string;
  postType: MarketType;
  productCategory: ProductCategory;
  tradeMode: TradeMode;
  title: string;
  gpuModel: string;
  gpuCount: string;
  quantity: string;
  quantityUnit: string;
  locationCity: string;
  priceAmount: string;
  contactMethod: string;
  sourceContact: string;
  configItems: ConfigItem[];
  source: "AI" | "MANUAL";
  rawText: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  tone?: NoticeTone;
}

interface OntologyProfile {
  category: ProductCategory;
  text: string;
  canonicalText: string;
  modelKey: string;
  tokens: string[];
  specs: Record<string, string>;
}

interface MatchScoreDetail {
  label: string;
  score: number;
  max: number;
  note: string;
}

interface MatchCandidate {
  id: string;
  demand: MarketPost;
  stock: StockItem;
  scoreTotal: number;
  level: MatchScoreLevel;
  scoreDetail: MatchScoreDetail[];
  reasons: string[];
  riskNotes: string[];
  status: MatchStatus;
  updatedAt: string;
}

interface EntryOverrides {
  postType?: MarketType;
  tradeMode?: TradeMode;
  productCategory?: ProductCategory;
}

interface SaveParsedResult {
  stockCount: number;
  marketCount: number;
  refreshedStockCount: number;
  refreshedMarketCount: number;
  refreshedCount: number;
}

interface WorkspaceSnapshot {
  version: 1;
  stocks: StockItem[];
  market: MarketPost[];
  drafts: TradeDraft[];
  confirmedRpaItemKeys: string[];
}

interface AiStructureResponse {
  data?: {
    summary?: { total?: number; goodsCount?: number; demandCount?: number };
    items?: ParsedTradeItem[];
  } | ParsedTradeItem;
  isMock?: boolean;
  provider?: string;
  model?: string;
  error?: string;
}

interface UserProfile {
  id: string;
  phone: string;
  maskedPhone: string;
  displayName: string;
  status: "ACTIVE" | "DISABLED";
}

interface WorkspaceSummary {
  id: string;
  name: string;
  type: WorkspaceType;
  status: "ACTIVE" | "SUSPENDED";
  planCode: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  dataScope: "PERSONAL" | "WORKSPACE";
}

export interface AuthSession {
  token: string;
  user: UserProfile;
  workspaces: WorkspaceSummary[];
  currentWorkspaceId: string;
  enterprise?: {
    status: "RESERVED" | "ACTIVE";
    supportedWorkspaceType: WorkspaceType;
  };
  expiresAt: string;
}

interface CreditTransaction {
  id: string;
  type: CreditTransactionType;
  title: string;
  amount: number;
  balanceAfter: number;
  createdAt: string;
  note?: string;
}

interface AccountWallet {
  paymentReady: boolean;
  planCode: MembershipPlanCode;
  planName: string;
  membershipStatus: "ACTIVE" | "FREE" | "EXPIRED";
  membershipExpiresAt?: string;
  creditBalance: number;
  nextGrant?: {amount:number; due:string} | null;
  transactions: CreditTransaction[];
}

interface SmsRequestResponse {
  success?: boolean;
  expiresInSeconds?: number;
  provider?: string;
  requestId?: string;
  debugCode?: string;
  error?: string;
}

interface CaptchaConfig {
  enabled: boolean;
  provider: "aliyun" | "none";
  region?: string;
  prefix?: string;
  sceneId?: string;
  mode?: "popup" | "embed";
  scriptUrl?: string;
}

type PaymentProductType = "CREDIT_PACKAGE" | "MEMBERSHIP_PLAN";
type PaymentChannel = "page" | "wap";
type PaymentStatus = "WAITING" | "PAID" | "CLOSED";

interface PaymentOrderView {
  id: string;
  productType: PaymentProductType;
  productId: string;
  title: string;
  amountYuan: string;
  status: PaymentStatus;
  channel: PaymentChannel;
  createdAt: string;
  paidAt?: string;
  alipayTradeNo?: string;
  entitlement: {
    creditAmount: number;
    planCode?: MembershipPlanCode;
    planName?: string;
    membershipDays?: number;
  };
}

interface PaymentOrderResponse {
  success?: boolean;
  order?: PaymentOrderView;
  paymentUrl?: string;
  error?: string;
  missing?: string[];
}

interface AliyunCaptchaInstance {
  show?: () => void;
  hide?: () => void;
  startTracelessVerification?: () => void;
}

interface AliyunCaptchaError {
  code?: string;
  msg?: string;
}

interface AliyunCaptchaOptions {
  SceneId: string;
  mode: "popup" | "embed";
  element: string;
  button: string;
  success: (captchaVerifyParam: string) => void;
  fail?: (result: unknown) => void;
  getInstance: (instance: AliyunCaptchaInstance) => void;
  slideStyle?: { width: number; height: number };
  language?: string;
  timeout?: number;
  delayBeforeSuccess?: boolean;
  onError?: (errorInfo: AliyunCaptchaError) => void;
  onClose?: (reason: string) => void;
}

declare global {
  interface Window {
    AliyunCaptchaConfig?: {
      region: string;
      prefix: string;
    };
    initAliyunCaptcha?: (options: AliyunCaptchaOptions) => void;
  }
}


const membershipPlans: Array<{
  code: MembershipPlanCode;
  name: string;
  price: string;
  period: string;
  features: string[];
}> = [
  {
    code: "FREE",
    name: "免费版",
    price: "¥0",
    period: "长期",
    features: ["整理供应与需求", "查看供需匹配"],
  },
  {
    code: "PRO_MONTHLY",
    name: "个人 Pro 月卡",
    price: "¥"+monthlyPrice,
    period: "月",
    features: [`每月含 ${monthlyCredits.toLocaleString("zh-CN")} 货记分`],
  },
  {
    code: "PRO_YEARLY",
    name: "个人 Pro 年卡",
    price: "¥"+annualPrice,
    period: "年",
    features: [`全年 ${(annualMonthlyCredits*12).toLocaleString("zh-CN")} 分，含额外赠送的 ${annualBonusCredits.toLocaleString("zh-CN")} 分`, `分 12 期，每月到账 ${annualMonthlyCredits.toLocaleString("zh-CN")} 分`],
  },
];

function CaptureInboxPanel({ visible, ...props }: Parameters<typeof WechatRpaInbox>[0] & { visible: boolean }) {
  const [visited, setVisited] = useState(false);
  useEffect(() => { if (visible) setVisited(true); }, [visible]);
  if (!visited && !visible) return null;
  return <div hidden={!visible}><WechatRpaInbox {...props} /></div>;
}

export default function App() {
  const { activeTab, intakeView, accountSection, hash } = useWorkspaceRoute();
  const rental = hash === "#stock/rental" || hash === "#market/rental";
  const [initialAuth] = useState(() => loadAuthSession());
  const [authSession, setAuthSession] = useState<AuthSession | null>(initialAuth.session);
  const liveCircle = useCircleLive(authSession?.token, authSession?.currentWorkspaceId);
  const messageScope = authSession ? JSON.stringify([authSession.user.id, authSession.currentWorkspaceId]) : "";
  const messageEntry = useMessageEntry(messageScope, hash, intakeView, liveCircle.unread, Boolean(liveCircle.actor));
  const [authNotice, setAuthNotice] = useState(initialAuth.expired ? SESSION_EXPIRED_NOTICE : "");
  const currentAuthToken = useRef<string | null>(authSession?.token ?? null);
  currentAuthToken.current = authSession?.token ?? null;
  useEffect(() => {
    if (!initialAuth.expired) return;
    try {
      // Recheck before removing only the stale auth key; a newer login survives.
      removeExpiredStoredSession(localStorage, AUTH_STORAGE_KEY);
    } catch { /* Expired authentication is already rejected in memory. */ }
  }, [initialAuth.expired]);
  const currentWorkspace = authSession?.workspaces.find((workspace) => workspace.id === authSession.currentWorkspaceId) ?? null;
  const currentWorkspaceId = currentWorkspace?.id ?? "";
  const [stocks, setStocks] = useState<StockItem[]>(() =>
    normalizeStocks(loadWorkspaceCollection<StockItem[]>(authSession, "stocks", [])),
  );
  const [marketPosts, setMarketPosts] = useState<MarketPost[]>(() =>
    normalizeMarketPosts(loadWorkspaceCollection<MarketPost[]>(authSession, "market", [])),
  );
  const [accountWallet, setAccountWallet] = useState<AccountWallet|null>(null);
  const [walletError,setWalletError]=useState("");
  const [walletVersion,refreshWallet]=useState(0);
  useEffect(()=>{
    const token=authSession?.token;
    if(!token)return;
    let active=true;
    let latest=0;
    async function read(){
      const sequence=++latest;
      try{
        const response=await fetch("/api/wallet",{headers:{Authorization:"Bearer "+token},cache:"no-store"});
        if(!response.ok)throw Error("暂时无法读取当前空间的钱包。");
        const data=await response.json();
        if(active && sequence===latest && currentAuthToken.current===token){setAccountWallet(data);setWalletError("");}
      }catch{
        if(active && sequence===latest && currentAuthToken.current===token){setAccountWallet(null);setWalletError("暂时无法读取当前空间的钱包。");}
      }
    }
    void read();
    const timer=setInterval(()=>{if(!document.hidden)void read();},30000);
    window.addEventListener("focus",read);
    return ()=>{active=false;clearInterval(timer);window.removeEventListener("focus",read);};
  },[authSession?.token,walletVersion,activeTab,accountSection]);
  const [aiText, setAiText] = useState("");
  const [query, setQuery] = useState("");
  const [marketModeFilter, setMarketModeFilter] = useState<TradeMode | "ALL">("ALL");
  const [marketCategoryFilter, setMarketCategoryFilter] = useState<ProductCategory | "ALL">("ALL");
  const [stockCategoryFilter, setStockCategoryFilter] = useState<ProductCategory | "ALL">("ALL");
  const [stockCityFilter, setStockCityFilter] = useState("ALL");
  const [stockSourceFilter, setStockSourceFilter] = useState<StockItem["source"] | "ALL">("ALL");
  const [stockSourceContactFilter, setStockSourceContactFilter] = useState("ALL");
  const [stockModeFilter, setStockModeFilter] = useState<TradeMode | "ALL">("ALL");
  const [stockPriceFilter, setStockPriceFilter] = useState<PriceFilter>("ALL");
  const [marketSourceContactFilter, setMarketSourceContactFilter] = useState("ALL");
  const [stockDateFilter, setStockDateFilter] = useState<DateFilter>("ALL");
  const [marketDateFilter, setMarketDateFilter] = useState<DateFilter>("ALL");
  const [stockFiltersOpen, setStockFiltersOpen] = useState(false);
  const [marketFiltersOpen, setMarketFiltersOpen] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const searchReturnRow = useRef("");
  function openInspector() {
    searchReturnRow.current = "";
    if (inspectorCollapsed) {
      listScroll.current = window.scrollY;
      detailTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setInspectorCollapsed(false);
  }
  function closeInspector() {
    setInspectorCollapsed(true);
    requestAnimationFrame(() => {
      if (searchReturnRow.current) {
        const trigger = tradeListRef.current?.querySelector<HTMLButtonElement>(`button[data-trade-id="${CSS.escape(searchReturnRow.current)}"]`);
        searchReturnRow.current = "";
        if (trigger) {
          trigger.focus({ preventScroll: true });
          trigger.scrollIntoView({ block: "center" });
          return;
        }
      }
      if (window.matchMedia("(max-width: 1023px)").matches) window.scrollTo(0, listScroll.current);
      detailTrigger.current?.focus({ preventScroll: true });
    });
  }
  function navigateTo(tab: TabKey) {
    if (tab === activeTab) {
      if (rental) {
        if (tab === "stock") resetStockFilters(); else resetMarketFilters();
        navigateWorkspace(`#${tab}`);
      }
      if (tab === "circle") navigateWorkspace("#circle");
      if (tab === "input") navigateWorkspace(messageEntry.href);
      if (tab === "account") setAccountSection("overview");
      if (!inspectorCollapsed) closeInspector();
      return;
    }
    setRelatedTarget(null);
    setInspectorCollapsed(true);
    setNotice(null);
    setQuery("");
    navigateWorkspace(tab === "input" ? messageEntry.href : `#${tab}`);
  }
  useEffect(() => { window.scrollTo(0, 0); }, [activeTab, intakeView, accountSection, rental]);
  useEffect(() => {
    document.title = authSession ? `${activeTab === "input" && intakeView === "paste" ? "粘贴录入" : pageTitles[activeTab]} · 货记` : "登录 · 货记";
  }, [authSession, activeTab, intakeView]);
  useEffect(() => {
    const onBack = () => { setInspectorCollapsed(true); setQuery(""); setNotice(null); };
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);
  useEffect(() => {
    if (inspectorCollapsed) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = inspectorRef.current;
      if (!panel) return;
      panel.tabIndex = -1;
      panel.focus({ preventScroll: true });
      const { top } = panel.getBoundingClientRect();
      if (top < 64 || top > window.innerHeight - 120) {
        panel.scrollIntoView({ block: "start" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, inspectorCollapsed]);
  const [stockPage, setStockPage] = useState(1);
  const tradeListRef = useRef<HTMLDivElement>(null);
  function changeTradePage(setPage: (page: number) => void, page: number) {
    setPage(page);
    requestAnimationFrame(() => {
      tradeListRef.current?.focus({ preventScroll: true });
      tradeListRef.current?.scrollIntoView({ block: "start" });
    });
  }
  const [marketPage, setMarketPage] = useState(1);
  const [matchPage, setMatchPage] = useState(1);
  const [selectedStockId, setSelectedStockId] = useState("");
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [relatedTarget, setRelatedTarget] = useState<{ kind: "stock" | "market"; id: string } | null>(null);
  useEffect(() => setRelatedTarget(null), [activeTab, rental]);
  const [matchView, setMatchView] = useState<MatchView>("RECOMMENDED");
  const [matchCategoryFilter, setMatchCategoryFilter] = useState<ProductCategory | "ALL">("ALL");
  const [matchModeFilter, setMatchModeFilter] = useState<TradeMode | "ALL">("ALL");
  const [matchScoreFilter, setMatchScoreFilter] = useState<MatchScoreFilter>("ALL");
  const [matchStatusFilter, setMatchStatusFilter] = useState<MatchStatusFilter>("ALL");
  const [matchDateFilter, setMatchDateFilter] = useState<DateFilter>("ALL");
  const [matchFiltersOpen, setMatchFiltersOpen] = useState(false);
  const [matchStatuses, setMatchStatuses] = useState<Record<string, MatchStatus>>(() => loadMatchStatuses(authSession));
  const [draftItems, setDraftItems] = useState<TradeDraft[]>(() => loadTradeDrafts(authSession));
  const [confirmedRpaItemKeys, setConfirmedRpaItemKeys] = useState<string[]>(() => loadRpaConfirmedItemKeys(authSession));
  const [ledgerSyncState, setLedgerSyncState] = useState<SyncState>("loading");
  const ledgerSync = useRef<ReturnType<typeof startLedgerSync<WorkspaceSnapshot>> | null>(null);
  const [draftPage, setDraftPage] = useState(1);
  const [reviewFilter, setReviewFilter] = useState<"all" | "missing" | "complete">("all");
  const [editingDraftId, setEditingDraftId] = useState("");
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const clearDraftDialog = useRef<HTMLDialogElement>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAiParsing, setIsAiParsing] = useState(false);
  const pendingAiRequest=useRef<{token:string;text:string;id:string} | null>(null);
  const [aiParseMessage, setAiParseMessage] = useState("");
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [paymentBusyKey, setPaymentBusyKey] = useState("");
  useEffect(() => {
    if (activeTab !== "input" || intakeView !== "review") setEditingDraftId("");
  }, [activeTab, intakeView]);

  useEffect(() => {
    if (!authSession) return;
    setStocks(normalizeStocks(loadWorkspaceCollection<StockItem[]>(authSession, "stocks", [])));
    setMarketPosts(normalizeMarketPosts(loadWorkspaceCollection<MarketPost[]>(authSession, "market", [])));
    setAccountWallet(null);setWalletError("");
    setDraftItems(loadTradeDrafts(authSession));
    setConfirmedRpaItemKeys(loadRpaConfirmedItemKeys(authSession));
    setQuery("");
    setStockPage(1);
    setMarketPage(1);
    setMatchPage(1);
    setDraftPage(1);
    setReviewFilter("all");
    setEditingDraftId("");
    setMatchStatuses(loadMatchStatuses(authSession));
    setRelatedTarget(null);
  }, [authSession?.currentWorkspaceId]);

  useEffect(() => {
    if (!authSession) return;
    const params = new URLSearchParams(window.location.search);
    const returnedOrderId = params.get("payment_order") || "";
    const pendingOrderId = localStorage.getItem(pendingPaymentStorageKey(authSession)) || "";
    const orderId = returnedOrderId || pendingOrderId;
    if (!orderId) return;
    setAccountSection("ledger");
    void refreshPaymentOrder(orderId, Boolean(returnedOrderId));
  }, [authSession?.token]);

  const timeSources = useMemo(() => [...stocks, ...marketPosts, ...draftItems], [stocks, marketPosts, draftItems]);
  const times = useWechatTimes(authSession, timeSources);
  const enrichedDrafts = useMemo(() => draftItems.map(item => enrichWechatTime(item, times)), [draftItems, times]);
  const orderedStocks = useMemo(() => sortTradesByTime(stocks.map(item => enrichWechatTime(item, times))), [stocks, times]);
  const orderedDemands = useMemo(() => sortTradesByTime(marketPosts.filter(post => post.postType === "DEMAND")
    .map(item => enrichWechatTime(item, times))), [marketPosts, times]);
  const circleSources = useMemo((): CircleSource[] => [
    ...orderedStocks.filter(item=>item.status!=="SOLD_OUT"&&item.status!=="EXPIRED").map(item=>({item,kind:"供应" as const})),
    ...orderedDemands.map(item=>({item,kind:"求购" as const})),
  ].map(({item,kind})=>({id:item.id,kind,title:item.gpuModel||item.title,model:item.gpuModel,city:item.locationCity,
    quantity:item.quantity>0?quantityText(item.quantity,item.quantityUnit):"",mode:tradeModeText(item.tradeMode)})),[orderedStocks,orderedDemands]);
  const ledgerStocks = useMemo(() => orderedStocks.filter(item => (item.tradeMode === "RENTAL") === rental), [orderedStocks, rental]);
  const ledgerDemands = useMemo(() => orderedDemands.filter(item => (item.tradeMode === "RENTAL") === rental), [orderedDemands, rental]);
  const filteredStocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ledgerStocks
      .filter((item) => {
        if (stockCategoryFilter !== "ALL" && item.productCategory !== stockCategoryFilter) return false;
        if (stockCityFilter !== "ALL" && item.locationCity !== stockCityFilter) return false;
        if (stockSourceFilter !== "ALL" && item.source !== stockSourceFilter) return false;
        if (stockSourceContactFilter !== "ALL" && item.sourceContact !== stockSourceContactFilter) return false;
        if (!rental && stockModeFilter !== "ALL" && item.tradeMode !== stockModeFilter) return false;
        if (!matchesPriceFilter(item.priceAmount, stockPriceFilter)) return false;
        if (!matchesDateFilter(createdTimeValue(item.createdAt), stockDateFilter)) return false;
        if (!q) return true;
        return [
          item.title,
          item.gpuModel,
          item.locationCity,
          item.sourceContact,
          item.sourceChatName || "",
          item.sourceSender || "",
          statusText(item.status),
          item.status,
          item.source,
          stockSourceText(item.source),
          item.tradeMode,
          tradeModeText(item.tradeMode),
          item.productCategory,
          productCategoryText(item.productCategory),
          item.priceAmount,
          ...item.configItems.flatMap((config) => [config.label, config.value]),
        ].some((value) => String(value).toLowerCase().includes(q));
      });
  }, [query, stockCategoryFilter, stockCityFilter, stockDateFilter, stockModeFilter, stockPriceFilter, stockSourceContactFilter, stockSourceFilter, ledgerStocks, rental]);

  const stockCityOptions = useMemo(() => {
    const cities: string[] = Array.from(
      new Set<string>(ledgerStocks.map((item) => item.locationCity).filter((city) => city.trim().length > 0)),
    ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
    return [{ label: "全部城市", value: "ALL" }, ...cities.map((city) => ({ label: city, value: city }))];
  }, [ledgerStocks]);

  const stockSourceContactOptions = useMemo(() => {
    const contacts = uniqueSortedLabels(ledgerStocks.map((item) => item.sourceContact).filter(Boolean));
    return [{ label: "全部来源用户", value: "ALL" }, ...contacts.map((contact) => ({ label: contact, value: contact }))];
  }, [ledgerStocks]);

  const filteredMarket = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ledgerDemands
      .filter((post) => {
        if (!rental && marketModeFilter !== "ALL" && post.tradeMode !== marketModeFilter) return false;
        if (marketCategoryFilter !== "ALL" && post.productCategory !== marketCategoryFilter) return false;
        if (marketSourceContactFilter !== "ALL" && post.sourceContact !== marketSourceContactFilter) return false;
        if (!matchesDateFilter(createdTimeValue(post.publishedAt), marketDateFilter)) return false;
        if (!q) return true;
        return [
          post.title,
          post.gpuModel,
          post.locationCity,
          post.sourceContact,
          post.sourceChatName || "",
          post.sourceSender || "",
          post.contactMethod,
          post.tradeMode,
          tradeModeText(post.tradeMode),
          post.productCategory,
          productCategoryText(post.productCategory),
          ...post.configItems.flatMap((config) => [config.label, config.value]),
        ].some((value) => String(value).toLowerCase().includes(q));
      });
  }, [query, marketCategoryFilter, marketDateFilter, marketModeFilter, ledgerDemands, marketSourceContactFilter, rental]);

  const marketSourceContactOptions = useMemo(() => {
    const contacts = uniqueSortedLabels(ledgerDemands.map((post) => post.sourceContact).filter(Boolean));
    return [{ label: "全部来源用户", value: "ALL" }, ...contacts.map((contact) => ({ label: contact, value: contact }))];
  }, [ledgerDemands]);

  const scoredMatches = useMemo(() => generateMatchCandidates(stocks, marketPosts, matchStatuses), [marketPosts, matchStatuses, stocks]);
  const matchCandidates = useMemo(() => {
    const stockById = new Map(orderedStocks.map(item => [item.id, item]));
    const demandById = new Map(orderedDemands.map(item => [item.id, item]));
    return scoredMatches.map(pair => ({ ...pair, stock: stockById.get(pair.stock.id) ?? pair.stock, demand: demandById.get(pair.demand.id) ?? pair.demand }));
  }, [scoredMatches, orderedStocks, orderedDemands]);
  const relatedSource = relatedTarget?.kind === "stock" ? orderedStocks.find(item => item.id === relatedTarget.id)
    : relatedTarget && orderedDemands.find(item => item.id === relatedTarget.id);
  const relatedMatches = useMemo(() => {
    if (!relatedTarget) return [];
    const isStock = relatedTarget.kind === "stock";
    return sortMatchesForView(matchCandidates.filter(pair => (isStock ? pair.stock.id : pair.demand.id) === relatedTarget.id),
      isStock ? "SUPPLY_TO_DEMAND" : "DEMAND_TO_SUPPLY");
  }, [matchCandidates, relatedTarget]);
  const relatedCounts = useMemo(() => {
    const stock = new Map<string, number>();
    const market = new Map<string, number>();
    for (const pair of matchCandidates) {
      stock.set(pair.stock.id, (stock.get(pair.stock.id) ?? 0) + 1);
      market.set(pair.demand.id, (market.get(pair.demand.id) ?? 0) + 1);
    }
    return { stock, market };
  }, [matchCandidates]);
  const filteredMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = matchCandidates
      .filter((candidate) => {
        if (matchView === "RECOMMENDED" && candidate.scoreTotal < 75 && candidate.status !== "CONTACTED") return false;
        if (matchCategoryFilter !== "ALL" && candidate.demand.productCategory !== matchCategoryFilter) return false;
        if (matchModeFilter !== "ALL" && candidate.demand.tradeMode !== matchModeFilter) return false;
        if (matchScoreFilter !== "ALL" && candidate.level !== matchScoreFilter) return false;
        if (matchStatusFilter !== "ALL" && candidate.status !== matchStatusFilter) return false;
        if (!matchesDateFilter(matchSourceTimeValue(candidate), matchDateFilter)) return false;
        if (!q) return true;
        return [
          candidate.demand.title,
          candidate.demand.gpuModel,
          candidate.demand.locationCity,
          candidate.demand.sourceContact,
          candidate.stock.title,
          candidate.stock.gpuModel,
          candidate.stock.locationCity,
          candidate.stock.sourceContact,
          candidate.stock.sourceChatName || "",
          candidate.demand.sourceChatName || "",
          candidate.stock.sourceSender || "",
          candidate.demand.sourceSender || "",
          candidate.reasons.join(" "),
          candidate.riskNotes.join(" "),
          candidate.scoreTotal,
          matchStatusText(candidate.status),
          matchLevelText(candidate.level),
        ].some((value) => String(value).toLowerCase().includes(q));
      });
    return sortMatchesForView(scopeMatchesForView(filtered, matchView), matchView);
  }, [matchCandidates, matchCategoryFilter, matchDateFilter, matchModeFilter, matchScoreFilter, matchStatusFilter, matchView, query]);

  const stockCurrentPage = clampPage(stockPage, totalPagesFor(filteredStocks.length));
  const marketCurrentPage = clampPage(marketPage, totalPagesFor(filteredMarket.length));
  const matchCurrentPage = clampPage(matchPage, totalPagesFor(filteredMatches.length));
  const draftGroups = useMemo(() => {
    const ordered = enrichedDrafts.map(draft => ({ draft, chronology: draftChronology(draft) }))
      .sort((a, b) => compareChronology(a.chronology, b.chronology)).map(({ draft }) => draft);
    const groups: Record<"all" | "missing" | "complete", TradeDraft[]> = { all: ordered, missing: [], complete: [] };
    for (const draft of ordered) groups[tradeDraftMissingFields(draft).length ? "missing" : "complete"].push(draft);
    return groups;
  }, [enrichedDrafts]);
  const pendingGoods = draftItems.filter(item => item.postType === "GOODS" && (item.tradeMode === "RENTAL") === rental).length;
  const pendingDemands = draftItems.filter(item => item.postType === "DEMAND" && (item.tradeMode === "RENTAL") === rental).length;
  function enterLedgerIntake(pending: number) {
    setReviewFilter("all");
    setDraftPage(1);
    setIntakeView(pending ? "review" : "paste");
  }
  const reviewDrafts = draftGroups[reviewFilter];
  const reviewScopes = [["all", "全部"], ["missing", "待补字段"], ["complete", "关键项齐全"]] as const;
  function changeReviewFilter(scope: typeof reviewFilter) {
    setReviewFilter(scope);
    setDraftPage(1);
  }
  const draftCurrentPage = clampPage(draftPage, totalPagesFor(reviewDrafts.length));
  const editingDraft = enrichedDrafts.find(draft => draft.id === editingDraftId);
  const pagedStocks = filteredStocks.slice((stockCurrentPage - 1) * LIST_PAGE_SIZE, stockCurrentPage * LIST_PAGE_SIZE);
  const pagedMarket = filteredMarket.slice((marketCurrentPage - 1) * LIST_PAGE_SIZE, marketCurrentPage * LIST_PAGE_SIZE);
  const pagedMatches = filteredMatches.slice((matchCurrentPage - 1) * LIST_PAGE_SIZE, matchCurrentPage * LIST_PAGE_SIZE);
  const pagedDrafts = reviewDrafts.slice((draftCurrentPage - 1) * LIST_PAGE_SIZE, draftCurrentPage * LIST_PAGE_SIZE);
  const selectedStock = pagedStocks.find((item) => item.id === selectedStockId) ?? pagedStocks[0] ?? null;
  const selectedMarket = pagedMarket.find((item) => item.id === selectedMarketId) ?? pagedMarket[0] ?? null;
  const selectedMatch = pagedMatches.find((item) => item.id === selectedMatchId) ?? pagedMatches[0] ?? null;
  const demandCount = marketPosts.filter((post) => post.postType === "DEMAND").length;
  const verifiedStockCount = ledgerStocks.filter((item) => item.status === "VERIFIED" || item.status === "SELLABLE").length;
  const strongMatchCount = matchCandidates.filter((item) => item.level === "STRONG").length;
  const pasteEntry = (
    <button type="button" className="quick-entry" onClick={() => {
      setInspectorCollapsed(true); setNotice(null); setIntakeView("paste");
    }}><Plus size={16} aria-hidden="true" />粘贴录入</button>
  );
  const chatCommandHint = isMatchCommand(aiText.trim());
  const listSearchBox = (
    <div className="trade-search">
      <Search size={17} aria-hidden="true" />
      <input
        value={query}
        aria-label="搜索记录"
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          setStockPage(1);
          setMarketPage(1);
          setMatchPage(1);
        }}
        placeholder="搜索型号、城市、昵称或群名"
      />
      {query && <button type="button" aria-label="清除搜索" onClick={() => { setQuery(""); setStockPage(1); setMarketPage(1); setMatchPage(1); }}><X size={15} /></button>}
    </div>
  );
  const aiLineCount = aiText.trim() ? aiText.trim().split(/\r?\n/).filter(Boolean).length : 0;
  const activeStockFilterCount = [
    stockCategoryFilter !== "ALL",
    stockCityFilter !== "ALL",
    stockSourceFilter !== "ALL",
    stockSourceContactFilter !== "ALL",
    !rental && stockModeFilter !== "ALL",
    stockPriceFilter !== "ALL",
    stockDateFilter !== "ALL",
  ].filter(Boolean).length;
  const activeMarketFilterCount = [
    marketCategoryFilter !== "ALL",
    !rental && marketModeFilter !== "ALL",
    marketSourceContactFilter !== "ALL",
    marketDateFilter !== "ALL",
  ].filter(Boolean).length;
  const activeMatchFilterCount = [
    matchCategoryFilter !== "ALL",
    matchModeFilter !== "ALL",
    matchScoreFilter !== "ALL",
    matchStatusFilter !== "ALL",
    matchDateFilter !== "ALL",
  ].filter(Boolean).length;
  const importedRpaItemKeys = useMemo(() => new Set(
    [...confirmedRpaItemKeys, ...[...draftItems, ...stocks, ...marketPosts].map((item) => item.sourceItemKey).filter((id): id is string => Boolean(id))],
  ), [confirmedRpaItemKeys, draftItems, stocks, marketPosts]);
  const pendingRpaItemKeys = useMemo(() => new Set(draftItems.map(item => item.sourceItemKey).filter((key): key is string => Boolean(key))), [draftItems]);
  const rpaImportScopeKey = authSession ? JSON.stringify([authSession.token, authSession.user.id, currentWorkspaceId]) : "";
  const rpaImportContext = useRef<{ scopeKey: string; workspaceId: string; snapshot: WorkspaceSnapshot }>({
    scopeKey: rpaImportScopeKey, workspaceId: currentWorkspaceId,
    snapshot: { version: 1, stocks, market: marketPosts, drafts: draftItems, confirmedRpaItemKeys },
  });
  // Async inbox pagination must use the current workspace and edits. Synchronous
  // commits also update this ref before React renders, preventing double imports.
  rpaImportContext.current = {
    scopeKey: rpaImportScopeKey, workspaceId: currentWorkspaceId,
    snapshot: { version: 1, stocks, market: marketPosts, drafts: draftItems, confirmedRpaItemKeys },
  };

  useEffect(() => {
    if (!authSession || !currentWorkspaceId) return;
    const token = authSession.token;
    const sync = startLedgerSync<WorkspaceSnapshot>({
      userId: authSession.user.id, workspaceId: currentWorkspaceId, token,
      isCurrent: () => currentAuthToken.current === token &&
        readStoredSession<AuthSession>(localStorage, AUTH_STORAGE_KEY).session?.token === token,
      readCache: () => ({
        version: 1, stocks: normalizeStocks(loadWorkspaceCollection<StockItem[]>(authSession, "stocks", [])),
        market: normalizeMarketPosts(loadWorkspaceCollection<MarketPost[]>(authSession, "market", [])),
        drafts: loadTradeDrafts(authSession), confirmedRpaItemKeys: loadRpaConfirmedItemKeys(authSession),
      }),
      writeCache: snapshot => persistWorkspaceSnapshot(workspaceCacheId(authSession), snapshot),
      receive: snapshot => {
        const stocks = normalizeStocks(snapshot.stocks), market = normalizeMarketPosts(snapshot.market);
        rpaImportContext.current = { scopeKey: rpaImportScopeKey, workspaceId: currentWorkspaceId, snapshot: { ...snapshot, stocks, market } };
        setStocks(stocks); setMarketPosts(market); setDraftItems(snapshot.drafts); setConfirmedRpaItemKeys(snapshot.confirmedRpaItemKeys);
      },
      status: setLedgerSyncState,
    });
    ledgerSync.current = sync;
    return () => { sync.stop(); ledgerSync.current = null; };
  }, [authSession?.token, currentWorkspaceId]);

  function commitLedger(before: WorkspaceSnapshot, after: WorkspaceSnapshot) {
    if (!ledgerSync.current) throw new Error("工作空间尚未就绪");
    ledgerSync.current.commit(before, after);
  }

  useEffect(() => {
    if (!authSession) return;
    const token = authSession.token;
    const monitor = monitorSession({
      session: authSession,
      currentToken: () => currentAuthToken.current,
      onExpired: () => {
        if (currentAuthToken.current !== token) return;
        currentAuthToken.current = null;
        rpaImportContext.current = { ...rpaImportContext.current, scopeKey: "" };
        // Keep all workspace data, including existing draft edits and imported keys.
        try {
          const stored = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
          if (stored?.token === token) localStorage.removeItem(AUTH_STORAGE_KEY);
        } catch { /* Login is still cleared in memory if storage is unavailable. */ }
        setAuthNotice(SESSION_EXPIRED_NOTICE);
        setAuthSession(null);
      },
    });
    const onVisible = () => { if (document.visibilityState === "visible") monitor.check(); };
    window.addEventListener("focus", monitor.check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      monitor.stop();
      window.removeEventListener("focus", monitor.check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [authSession?.token, authSession?.expiresAt]);

  function saveDraftItems(next: TradeDraft[]): boolean {
    const current = rpaImportContext.current;
    if (!rpaImportScopeKey || current.scopeKey !== rpaImportScopeKey) return false;
    try {
      const snapshot = { ...current.snapshot, drafts: next };
      commitLedger(current.snapshot, snapshot);
      rpaImportContext.current = { scopeKey: rpaImportScopeKey, workspaceId: currentWorkspaceId, snapshot };
      setDraftItems(next);
      return true;
    } catch {
      setNotice({ tone: "warning", text: "本机存储空间不足或暂不可用，操作未保存，原有待确认结果已保留。请释放空间后重试。" });
      return false;
    }
  }

  async function startAlipayPayment(productType: PaymentProductType, productId: string) {
    if (!authSession) {
      setNotice({ tone: "warning", text: "请先登录后再支付。" });
      return;
    }
    const busyKey = `${productType}:${productId}`;
    setPaymentBusyKey(busyKey);
    try {
      const response = await createAlipayPaymentOrder(authSession, productType, productId, preferredPaymentChannel());
      if(currentAuthToken.current!==authSession.token)return;
      if (!response.order || !response.paymentUrl) throw new Error(response.error || "支付宝订单创建失败。");
      localStorage.setItem(pendingPaymentStorageKey(authSession), response.order.id);
      setNotice({ tone: "info", text: "正在跳转支付宝收银台，请完成付款后返回货记。" });
      window.location.assign(response.paymentUrl);
    } catch (error) {
      setNotice({ tone: "warning", text: error instanceof Error ? error.message : "支付宝支付发起失败。" });
    } finally {
      setPaymentBusyKey("");
    }
  }

  async function refreshPaymentOrder(orderId: string, cleanupUrl = false, retryCount = 0) {
    if (!authSession) return;
    try {
      const response = await fetchPaymentOrder(authSession, orderId);
      if (currentAuthToken.current!==authSession.token) return;
      if (!response.order) throw new Error(response.error || "订单状态查询失败。");
      if (cleanupUrl) {
        const url = new URL(window.location.href);
        url.searchParams.delete("payment_order");
        window.history.replaceState(window.history.state, "", url);
      }
      if (response.order.status === "PAID") {
        refreshWallet(n=>n+1);
        setNotice({tone:"success",text:"支付已确认，可在当前空间查看到账积分和会员权益。"});
        localStorage.removeItem(pendingPaymentStorageKey(authSession));
        return;
      }
      if (response.order.status === "CLOSED") {
        localStorage.removeItem(pendingPaymentStorageKey(authSession));
        setNotice({ tone: "warning", text: "这笔支付宝订单已关闭，未入账。" });
        return;
      }
      setNotice({ tone: "info", text: "正在等待支付宝确认付款，请稍后查看账户明细。" });
      if (retryCount < 3) {
        window.setTimeout(() => void refreshPaymentOrder(orderId, false, retryCount + 1), 3000);
      }
    } catch (error) {
      setNotice({ tone: "warning", text: error instanceof Error ? error.message : "订单状态查询失败。" });
    }
  }

  function handleRechargeCredits(productId: string) {
    void startAlipayPayment("CREDIT_PACKAGE", productId);
  }

  function handleUpgradePlan(planCode: MembershipPlanCode) {
    if (planCode === "FREE") {
      setNotice({ tone: "info", text: "当前已是免费版，可直接使用基础功能。" });
      return;
    }
    void startAlipayPayment("MEMBERSHIP_PLAN", planCode);
  }

  function handleLogin(nextSession: AuthSession) {
    persistAuthSession(nextSession);
    currentAuthToken.current = nextSession.token;
    setInspectorCollapsed(true);
    setAiText("");
    setAiParseMessage("");
    setChatMessages([]);
    setAuthNotice("");
    rpaImportContext.current = { ...rpaImportContext.current, scopeKey: "" };
    setStocks(normalizeStocks(loadWorkspaceCollection<StockItem[]>(nextSession, "stocks", [])));
    setMarketPosts(normalizeMarketPosts(loadWorkspaceCollection<MarketPost[]>(nextSession, "market", [])));
    setAccountWallet(null);setWalletError("");
    setDraftItems(loadTradeDrafts(nextSession));
    setConfirmedRpaItemKeys(loadRpaConfirmedItemKeys(nextSession));
    setQuery("");
    setStockPage(1);
    setMarketPage(1);
    setDraftPage(1);
    setAuthSession(nextSession);
    setNotice(null);
  }

  function changeWorkspace(next: AuthSession) {
    if (readStoredSession<AuthSession>(localStorage,AUTH_STORAGE_KEY).session?.token!==authSession?.token) return;
    persistAuthSession(next);
    window.location.hash=next.workspaces.find(w=>w.id===next.currentWorkspaceId)?.type==="ENTERPRISE"?"#account/enterprise":"#input";
    window.location.reload();
  }

  function handleLogout() {
    currentAuthToken.current = null;
    setAuthNotice("");
    rpaImportContext.current = { ...rpaImportContext.current, scopeKey: "" };
    if (authSession?.token) void logoutAuthSession(authSession.token);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    navigateWorkspace("#input", true);
    setAuthSession(null);
  }

  function resetStockFilters() {
    setQuery("");
    setStockCategoryFilter("ALL");
    setStockCityFilter("ALL");
    setStockSourceFilter("ALL");
    setStockSourceContactFilter("ALL");
    setStockModeFilter("ALL");
    setStockPriceFilter("ALL");
    setStockDateFilter("ALL");
    setStockPage(1);
  }

  function resetMarketFilters() {
    setQuery("");
    setMarketCategoryFilter("ALL");
    setMarketModeFilter("ALL");
    setMarketSourceContactFilter("ALL");
    setMarketDateFilter("ALL");
    setMarketPage(1);
  }

  function resetMatchFilters() {
    setQuery("");
    setMatchCategoryFilter("ALL");
    setMatchModeFilter("ALL");
    setMatchScoreFilter("ALL");
    setMatchStatusFilter("ALL");
    setMatchDateFilter("ALL");
    setMatchPage(1);
  }

  function showRelatedMatches(kind: "stock" | "market", item: StockItem | MarketPost) {
    setRelatedTarget({ kind, id: item.id });
  }

  function updateMatchStatus(candidateId: string, status: MatchStatus) {
    const next = { ...matchStatuses, [candidateId]: status };
    setMatchStatuses(next);
    saveMatchStatuses(authSession, next);
    if (relatedTarget) return;
    if ((matchStatusFilter !== "ALL" && matchStatusFilter !== status)
        || (matchView === "RECOMMENDED" && selectedMatch && selectedMatch.scoreTotal < 75 && status !== "CONTACTED")) {
      closeInspector();
    }
    setNotice({ tone: "success", text: `已标记为${matchStatusText(status)}。` });
  }

  function triggerMatchingFromChat(input: string) {
    setMatchPage(1);
    setSelectedMatchId("");
    navigateTo("match");
    setAiText("");
    if (!stocks.length || !demandCount) {
      const text = "需要同时有供应和需求，才能生成匹配机会。先用货记录入一些供需信息。";
      setNotice({ tone: "warning", text: "需要同时有供应和需求，才能生成匹配机会。" });
      setAiParseMessage("匹配未开始：供应或需求不足。");
      setChatMessages((messages) => [
        ...messages,
        { id: `user-${Date.now()}`, role: "user", text: input },
        { id: `assistant-${Date.now() + 1}`, role: "assistant", tone: "warning", text },
      ]);
      return;
    }
    const text = matchCandidates.length
      ? `找到 ${matchCandidates.length} 个匹配机会，其中 ${strongMatchCount} 个为强匹配。`
      : "暂时没有匹配机会。可以补充型号、规格、交付地或数量后再查看。";
    setNotice({
      tone: matchCandidates.length ? "success" : "info",
      text,
    });
    setAiParseMessage("");
    setChatMessages((messages) => [
      ...messages,
      { id: `user-${Date.now()}`, role: "user", text: input },
      { id: `assistant-${Date.now() + 1}`, role: "assistant", tone: matchCandidates.length ? "success" : "info", text },
    ]);
  }

  async function copyMatchSummary(candidate: MatchCandidate, notify: (notice: { tone: NoticeTone; text: string }) => void = setNotice) {
    const text = buildMatchSummary(candidate);
    try {
      await navigator.clipboard.writeText(text);
      notify({ tone: "success", text: "匹配摘要已复制。" });
    } catch {
      notify({ tone: "info", text });
    }
  }

  async function parseAssistantInput() {
    const input = aiText.trim();
    if (!input) {
      setAiParseMessage("请先输入或粘贴需要解析的供需文本。");
      setNotice({ tone: "warning", text: "先粘贴报价或求购原文，再识别供需。" });
      return;
    }
    if (isMatchCommand(input)) {
      triggerMatchingFromChat(input);
      return;
    }
    const overrides: EntryOverrides = {};
    setIsAiParsing(true);
    setNotice(null);
    setAiParseMessage("正在解析为待确认结果...");
    setChatMessages((messages) => [...messages, { id: `user-${Date.now()}`, role: "user", text: input }]);

    try {
      if(pendingAiRequest.current?.token!==authSession.token || pendingAiRequest.current?.text!==input){
        pendingAiRequest.current={token:authSession.token,text:input,id:crypto.randomUUID()};
      }
      const aiResult = await parseWithAiGateway(input, authSession.token,pendingAiRequest.current.id);
      if (currentAuthToken.current !== authSession.token) return;
      refreshWallet(n=>n+1);
      const parsedDrafts = createDraftsFromParsedItems(aiResult.items, "AI", overrides);
      if (!parsedDrafts.length) throw new Error("没有识别到可确认的供需条目");
      const result = appendDrafts(parsedDrafts);
      if (result.failed) return;
      pendingAiRequest.current=null;
      const summary = countDrafts(parsedDrafts);
      setAiText("");
      const parser = aiResult.isMock ? "本地规则" : aiResult.provider === "deepseek" ? "DeepSeek" : "服务端";
      const feedback = `${aiResult.fallbackError ? aiResult.fallbackError + " " : ""}${parser}解析完成，${summary.goods} 条供应、${summary.demands} 条需求${result.mergedCount ? `，合并 ${result.mergedCount} 条重复结果` : ""}。`;
      setAiParseMessage("");
      setNotice({ tone: aiResult.fallbackError ? "warning" : "success", text: feedback });
      setChatMessages((messages) => [
        ...messages,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          tone: aiResult.fallbackError ? "warning" : "success",
          text: feedback,
        },
      ]);
    } catch (error) {
      if(currentAuthToken.current!==authSession.token)return;
      if(error instanceof Error && error.message.includes("货记分不足")){
        setAiParseMessage(error.message);
        return;
      }
      const fallbackDrafts = createDraftsFromParsedItems([parseAiText(input)], "MANUAL", overrides);
      const result = appendDrafts(fallbackDrafts);
      if (result.failed) return;
      setAiParseMessage(error instanceof Error ? `在线识别未完成：${error.message}` : "在线识别暂时不可用。");
      const fallbackText = result.addedCount ? `已按本地规则整理 ${result.addedCount} 条，请对照原文核对。` : "这段原文已经整理过了。";
      setNotice({
        tone: result.addedCount ? "warning" : "info",
        text: fallbackText,
      });
      setChatMessages((messages) => [
        ...messages,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          tone: result.addedCount ? "warning" : "info",
          text: fallbackText,
        },
      ]);
    } finally {
      setIsAiParsing(false);
    }
  }

  function appendDrafts(nextDrafts: TradeDraft[]) {
    const current = rpaImportContext.current;
    if (!rpaImportScopeKey || current.scopeKey !== rpaImportScopeKey) return { addedCount: 0, mergedCount: 0, failed: true };
    const drafts = current.snapshot.drafts;
    const newDrafts = dedupeNewTradeDrafts(nextDrafts, drafts);
    if (newDrafts.length) {
      if (!saveDraftItems([...newDrafts, ...drafts])) return { addedCount: 0, mergedCount: 0, failed: true };
      setDraftPage(1);
    }
    if (nextDrafts.length) {
      setReviewFilter("all");
      setEditingDraftId("");
      setIntakeView("review");
    }
    return { addedCount: newDrafts.length, mergedCount: nextDrafts.length - newDrafts.length, failed: false };
  }

  function updateDraftItem(id: string, patch: Partial<TradeDraft>) {
    saveDraftItems(draftItems.map((item) => (item.id === id ? applyDraftPatch(item, patch) : item)));
  }

  function removeDraftItem(id: string) {
    if (saveDraftItems(draftItems.filter((item) => item.id !== id))) setEditingDraftId("");
  }

  function clearDraftItems() {
    if (!saveDraftItems([])) return;
    setDraftPage(1);
    setReviewFilter("all");
    setEditingDraftId("");
    setNotice({ tone: "info", text: "已清空待确认结果。" });
  }

  function confirmDrafts(ids?: string[]) {
    const selectedIds = ids ? new Set(ids) : null;
    const targetItems = selectedIds ? draftItems.filter((item) => selectedIds.has(item.id)) : draftItems;
    const selected = targetItems;
    if (!selected.length) {
      setNotice({ tone: "warning", text: "没有可保存的待确认结果。" });
      return;
    }
    const current = rpaImportContext.current.snapshot;
    const prepared = buildConfirmedWorkspaceSnapshot(current, selected);
    try {
      commitLedger(current, prepared.snapshot);
    } catch {
      setNotice({ tone: "warning", text: "本机存储空间不足或暂不可用，本次未保存任何供需记录，待确认结果已保留。请释放空间后重试。" });
      return;
    }
    const result = prepared.result;
    rpaImportContext.current = { scopeKey: rpaImportScopeKey, workspaceId: currentWorkspaceId, snapshot: prepared.snapshot };
    setStocks(prepared.snapshot.stocks);
    setMarketPosts(prepared.snapshot.market);
    setDraftItems(prepared.snapshot.drafts);
    setConfirmedRpaItemKeys(prepared.snapshot.confirmedRpaItemKeys);
    setEditingDraftId("");
    resetStockFilters();
    resetMarketFilters();
    const changedCount = result.stockCount + result.marketCount + result.refreshedCount;
    setNotice({
      tone: changedCount ? "success" : "info",
      text: changedCount ? `${saveResultNoticeText(result)} 匹配机会已刷新。` : saveResultNoticeText(result),
    });
    setChatMessages((messages) => [
      ...messages,
      {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        tone: changedCount ? "success" : "info",
        text: saveResultChatText(result),
      },
    ]);
  }

  function importWechatRpaMessage(message: WechatRpaMessage): { addedCount: number; alreadyImported?: boolean } {
    return importWechatRpaMessages([message], false);
  }

  function importWechatRpaMessages(messages: WechatRpaMessage[], bulkOnly = true): { addedCount: number; alreadyImported?: boolean } {
    const current = rpaImportContext.current;
    if (!rpaImportScopeKey || current.scopeKey !== rpaImportScopeKey || current.workspaceId !== currentWorkspaceId) {
      throw new Error("账号或工作空间已切换，本次未加入任何内容，请在当前空间重新操作。");
    }
    const prepared = buildRpaImportSnapshot(current.snapshot, messages, bulkOnly);
    if (!prepared.addedCount) return { addedCount: 0, alreadyImported: true };
    try {
      commitLedger(current.snapshot, prepared.snapshot);
    } catch {
      throw new Error("本机存储暂不可用，本次未加入任何内容，原有待确认结果已保留，请释放空间后重试。");
    }
    rpaImportContext.current = { ...current, snapshot: prepared.snapshot };
    setDraftItems(prepared.snapshot.drafts);
    setDraftPage(1);
    setReviewFilter("all");
    setEditingDraftId("");
    if (bulkOnly) {
      setIntakeView("review");
      setNotice({ tone: "success", text: `已加入 ${prepared.addedCount} 条供需，可以开始核对。` });
    }
    return { addedCount: prepared.addedCount };
  }

  if (!authSession || !currentWorkspace) {
    return <LoginScreen onLogin={handleLogin} sessionNotice={authNotice} />;
  }

  let circleParticipation: CircleParticipation = walletError ? "unavailable" : "loading";
  if (currentWorkspace.type === "ENTERPRISE") circleParticipation = "allowed";
  else if (accountWallet) {
    const expiresAt = Date.parse(accountWallet.membershipExpiresAt ?? "");
    circleParticipation = accountWallet.membershipStatus === "ACTIVE" && expiresAt > Date.now() ? "allowed" : "locked";
  }

  return (
    <div className="app-shell" onKeyDown={event => {
      if (event.key === "Escape" && !event.defaultPrevented && !inspectorCollapsed
          && event.target instanceof HTMLElement && !event.target.closest("dialog, select, input, textarea")) {
        closeInspector();
      }
    }}>
      <a className="skip-navigation" href="#workspace-content" onClick={event => {
        event.preventDefault();
        document.getElementById("workspace-content")?.focus();
      }}>跳到工作区内容</a>
      <div className="workspace-layout" data-page={activeTab}>
        <WorkbenchHeader activeTab={activeTab} onNavigate={navigateTo} messageHref={messageEntry.href} unread={liveCircle.unread} workspace={currentWorkspace.name} maskedPhone={authSession.user.maskedPhone}
          company={currentWorkspace.type==="ENTERPRISE"} onEnterprise={()=>setAccountSection("enterprise")} credits={accountWallet?.creditBalance??null} onCredits={() => { setNotice(null); setAccountSection("credits"); }}
          onAccount={() => { setNotice(null); setAccountSection("overview"); }} onLogout={handleLogout}>
          <WorkspaceSwitcher session={authSession} onSwitch={changeWorkspace} onManage={()=>setAccountSection("enterprise")}/>
          <TradeSearch stocks={orderedStocks} demands={orderedDemands} onChoose={(kind, id, position) => {
            const ordered = kind === "stock" ? orderedStocks : orderedDemands;
            const chosen = ordered[position];
            if (!chosen || chosen.id !== id) return;
            const isRental = chosen.tradeMode === "RENTAL";
            const index = ordered.slice(0, position).filter(item => (item.tradeMode === "RENTAL") === isRental).length;
            navigateWorkspace(`#${kind}${isRental ? "/rental" : ""}`);
            setNotice(null);
            setRelatedTarget(null);
            const page = Math.floor(index / LIST_PAGE_SIZE) + 1;
            if (kind === "stock") {
              resetStockFilters(); setStockPage(page); setSelectedStockId(id);
            } else {
              resetMarketFilters(); setMarketPage(page); setSelectedMarketId(id);
            }
            listScroll.current = 0;
            detailTrigger.current = null;
            searchReturnRow.current = id;
            setInspectorCollapsed(false);
            requestAnimationFrame(() => {
              inspectorRef.current?.focus({ preventScroll: true });
              inspectorRef.current?.scrollIntoView({ block: "nearest" });
            });
          }} />
        </WorkbenchHeader>

        <main className="workspace-main">
          <section id="workspace-content" tabIndex={-1} className="workspace-content">
            <h1 className="sr-only">{activeTab === "input" && intakeView === "paste" ? "粘贴录入" : pageTitles[activeTab]}</h1>
            {activeTab === "input" && intakeView === "paste" && <button type="button" className="back-to-inbox" onClick={() => setIntakeView(messageEntry.last)}>
              <ArrowLeft size={15} />返回消息工作台
            </button>}
          {notice && <InlineNotice tone={notice.tone} text={notice.text} onDismiss={() => setNotice(null)} />}
          {(activeTab === "stock" || activeTab === "market" || activeTab === "match" || (activeTab === "input" && intakeView !== "talk")) &&
            (ledgerSyncState === "offline" ? <p role="status" className="ledger-sync-note">账号资料同步暂未完成，浏览器副本已保留。<button type="button" onClick={() => ledgerSync.current?.refresh()}>重试同步</button></p> :
              (ledgerSyncState === "loading" || ledgerSyncState === "pending") && <p role="status" className="ledger-sync-note">{ledgerSyncState === "pending" ? "正在保存到账号…" : "正在同步账号资料…"}</p>)}
          {(activeTab === "stock" || activeTab === "market") && <div className="view-bar ledger-scope">
            <nav aria-label="交易类型">
              {[false, true].map(isRental => <a key={String(isRental)}
                href={`#${activeTab}${isRental ? "/rental" : ""}`} aria-current={rental === isRental ? "page" : undefined}
                onClick={() => {
                  if (isRental === rental) return;
                  if (activeTab === "stock") resetStockFilters(); else resetMarketFilters();
                  setInspectorCollapsed(true); setRelatedTarget(null); setNotice(null);
                }}>
                {isRental ? (activeTab === "stock" ? "出租货源" : "求租需求") : (activeTab === "stock" ? "出售货源" : "采购需求")}
              </a>)}
            </nav>
          </div>}
          {activeTab === "input" && intakeView !== "paste" && <div className="view-bar">
            <nav aria-label="消息视图">
              <a href={TALK_HASH} aria-current={intakeView === "talk" ? "page" : undefined}
                aria-label={liveCircle.unread ? `同行会话，${liveCircle.unread} 条未读` : undefined}>
                同行会话{liveCircle.unread > 0 && <b className="circle-unread" aria-hidden="true">{liveCircle.unread > 99 ? "99+" : liveCircle.unread}</b>}
              </a>
              <a href="#input/wechat" aria-current={!messageEntry.landing && intakeView !== "talk" ? "page" : undefined}>微信采集</a>
            </nav>
            {!messageEntry.landing && (intakeView === "wechat" || intakeView === "review") && pasteEntry}
          </div>}
          {activeTab === "input" && messageEntry.landing && <p className="message-opening" role="status">正在打开消息…</p>}
          {(activeTab==="circle" || (activeTab==="input" && intakeView==="talk"))&&<React.Fragment key={messageScope}><CircleWorkspace token={authSession.token}
            actor={liveCircle.actor} name={liveCircle.name||authSession.user.maskedPhone} companyName={currentWorkspace.type === "ENTERPRISE" ? currentWorkspace.name : undefined}
            participation={circleParticipation}
            onCheckMembership={() => refreshWallet(n => n + 1)}
            version={liveCircle.version} hash={hash} sources={circleSources} refresh={liveCircle.refresh}/></React.Fragment>}

          {activeTab === "stock" && (
            <div className={`inspector-layout grid ${inspectorCollapsed ? "gap-0 lg:grid-cols-[minmax(0,1fr)_0px]" : "gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_380px]"}`}>
              <div ref={tradeListRef} tabIndex={-1} role="region" aria-label="供应结果" className="trade-list-region min-w-0 space-y-3">
                <FilterPanel
                  search={listSearchBox}
                  title="筛选供应"
                  action={pasteEntry}
                  activeCount={activeStockFilterCount}
                  resultText={query.trim() || activeStockFilterCount ? `找到 ${filteredStocks.length} 条供应` : <><strong>{ledgerStocks.length}</strong> 条{rental ? "出租货源" : "供应"}{verifiedStockCount > 0 && <small>已核实 {verifiedStockCount} 条</small>}</>}
                  isOpen={stockFiltersOpen}
                  onToggle={() => setStockFiltersOpen((open) => !open)}
                  onReset={resetStockFilters}
                >
                  <div className="smart-filter-layout">
                    <FilterPillGroup
                      label="品类"
                      value={stockCategoryFilter}
                      options={[{ label: "全部品类", value: "ALL" }, ...productCategoryOptions]}
                      onChange={(value) => {
                        setStockCategoryFilter(value as ProductCategory | "ALL");
                        setStockPage(1);
                      }}
                    />
                    <FilterPillGroup
                      label="记录日期"
                      value={stockDateFilter}
                      options={dateFilterOptions}
                      onChange={(value) => {
                        setStockDateFilter(value as DateFilter);
                        setStockPage(1);
                      }}
                    />
                    <div className={`${stockFiltersOpen ? "grid" : "hidden"} smart-filter-advanced`}>
                      {!rental && <FilterPillGroup
                        label="交易"
                        value={stockModeFilter}
                        options={[{ label: "全部", value: "ALL" }, ...saleModeOptions]}
                        onChange={(value) => {
                          setStockModeFilter(value as TradeMode | "ALL");
                          setStockPage(1);
                        }}
                      />}
                      <FilterPillGroup
                        label="价格"
                        value={stockPriceFilter}
                        options={stockPriceOptions}
                        onChange={(value) => {
                          setStockPriceFilter(value as PriceFilter);
                          setStockPage(1);
                        }}
                      />
                      <div className="smart-filter-more">
                        <FilterSelect
                          label="城市"
                          compact
                          value={stockCityFilter}
                          options={stockCityOptions}
                          onChange={(value) => {
                            setStockCityFilter(value);
                            setStockPage(1);
                          }}
                        />
                        <FilterSelect
                          label="来源用户"
                          compact
                          value={stockSourceContactFilter}
                          options={stockSourceContactOptions}
                          onChange={(value) => {
                            setStockSourceContactFilter(value);
                            setStockPage(1);
                          }}
                        />
                        <FilterSelect
                          label="录入方式"
                          compact
                          value={stockSourceFilter}
                          options={stockSourceOptions}
                          onChange={(value) => {
                            setStockSourceFilter(value as StockItem["source"] | "ALL");
                            setStockPage(1);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </FilterPanel>
                <TradeDataTable kind="stock" rental={rental}
                  items={pagedStocks}
                  relatedCounts={relatedCounts.stock} onShowMatches={item => showRelatedMatches("stock", item)}
                  selectedId={inspectorCollapsed ? "" : selectedStock?.id ?? ""}
                  onSelect={stock => { setSelectedStockId(stock.id); openInspector(); }}
                />
                {!pagedStocks.length && (query.trim() || activeStockFilterCount
                  ? <EmptyState title="没有找到符合条件的供应" actionLabel="清除搜索和筛选" onAction={resetStockFilters} />
                  : <EmptyState title={rental ? "还没有出租货源" : "供应库里还没有货源"} description={pendingGoods ? `待入库清单里有 ${pendingGoods} 条供应，确认后就会出现在这里。` : rental ? "粘贴设备出租消息，核对型号和租金后即可入库。" : "粘贴供货方的报价或现货消息，核对后即可入库。"}
                      actionLabel={pendingGoods ? "核对待入库供应" : "去录入供应"} onAction={() => enterLedgerIntake(pendingGoods)} />)}
                {filteredStocks.length > LIST_PAGE_SIZE && (
                  <Pagination
                    total={filteredStocks.length}
                    page={stockCurrentPage}
                    onPageChange={page => changeTradePage(setStockPage, page)}
                  />
                )}
              </div>
              <div id="workspace-inspector" ref={inspectorRef} className={`inspector-slot order-first scroll-mt-20 self-start lg:order-none lg:sticky lg:top-20 ${inspectorCollapsed ? "hidden" : ""}`} aria-hidden={inspectorCollapsed}>
                <InspectorBack onBack={closeInspector} />
                <TradeDetailDrawer
                  kind="stock"
                  item={selectedStock}
                  relatedCount={selectedStock ? relatedCounts.stock.get(selectedStock.id) ?? 0 : 0}
                  onShowMatches={showRelatedMatches}
                />
              </div>
            </div>
          )}

          {activeTab === "input" && (
            <div className="space-y-4">
              {!messageEntry.landing && (intakeView === "wechat" || intakeView === "review") && <nav aria-label="微信采集视图" className="capture-sections">
                <a href="#input/wechat" aria-current={intakeView === "wechat" ? "page" : undefined}>采集记录</a>
                <a href="#input/review" aria-current={intakeView === "review" ? "page" : undefined}>待入库 <span>{draftItems.length}</span></a>
              </nav>}

              <React.Fragment key={messageScope}>
                <CaptureInboxPanel visible={!messageEntry.landing && intakeView === "wechat"} token={authSession.token} userId={authSession.user.id} workspaceId={currentWorkspaceId}
                  destination={authSession.user.maskedPhone+" · "+(currentWorkspace.type==="ENTERPRISE"?currentWorkspace.name+"（企业版）":"个人版")} sessionExpiresAt={authSession.expiresAt} importedItemKeys={importedRpaItemKeys} pendingItemKeys={pendingRpaItemKeys}
                  onImport={importWechatRpaMessage} onImportMany={importWechatRpaMessages} />
              </React.Fragment>
              {intakeView === "paste" && (
                <section className="paste-workspace" aria-labelledby="paste-title">
                  <form className="paste-paper" onSubmit={event => {
                    event.preventDefault();
                    if (!isAiParsing && aiText.trim()) void parseAssistantInput();
                  }}>
                    <div className="paste-head">
                      <div><h2 id="paste-title"><label htmlFor="paste-original">聊天原文</label></h2>
                        <p id="paste-help">可一次粘贴多条报价或求购，保留发言人昵称方便核对来源。</p></div>
                      {!aiText.trim() && <button type="button" className="review-link" onClick={() => {
                        setAiText(AI_EXAMPLE_TEXT);
                        document.getElementById("paste-original")?.focus();
                      }}>填入示例</button>}
                    </div>
                    <textarea id="paste-original" aria-label="供需消息原文" aria-describedby="paste-help" placeholder="在此粘贴消息…"
                      value={aiText} readOnly={isAiParsing} onChange={event => setAiText(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }} />
                    <div className="paste-foot">
                      <div className="paste-cost" aria-live="polite">{aiText.trim()
                        ? <><strong>{aiLineCount} 行原文</strong><span>{chatCommandHint ? "查看匹配免费" : (currentWorkspace.type === "ENTERPRISE" ? "企业 Token · 按实际用量记录" : "个人 Token · 按实际用量记录")}</span></>
                        : <span>识别结果将进入待入库清单</span>}</div>
                      <div className="paste-submit">
                        <kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"} + Enter</kbd>
                        <button className="review-primary" type="submit" disabled={isAiParsing || !aiText.trim()}>
                          {isAiParsing ? "正在识别…" : chatCommandHint ? "查看供需匹配" : "识别供需"}<ChevronRight size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </form>
                  {aiParseMessage && <p className="paste-feedback" role="status">{aiParseMessage} {aiParseMessage.includes("货记分不足") && <a className="account-action-link" href="#account/credits">购买货记分</a>}</p>}
                  <div className="paste-options">
                    {chatMessages.length > 0 && <details>
                      <summary>本次录入记录</summary>
                      <ol className="paste-log">{[...chatMessages].reverse().map(message => <li key={message.id}>
                        <span>{message.role === "user" ? "提交原文" : "处理结果"}</span><p>{message.text}</p>
                      </li>)}</ol>
                    </details>}
                    <a href={DEEPSEEK_SETTINGS_HASH} className="review-link"><KeyRound size={14} aria-hidden="true" />AI 用量</a>
                  </div>
                </section>
              )}
              {intakeView === "review" && (
                <section className="review-workspace" aria-labelledby="review-title">
                  <div className="review-head">
                    <h2 className="sr-only" id="review-title" ref={reviewHeading} tabIndex={-1}>核对清单</h2>
                    {draftItems.length > 0 && <>
                      <div className="review-views" role="group" aria-label="按字段完整性筛选">
                        {reviewScopes.map(([key, label]) => <button key={key} type="button" aria-pressed={reviewFilter === key}
                          title={key === "all" ? undefined : "按来源用户、型号、数量和城市检查"} onClick={() => changeReviewFilter(key)}>
                          {label}<span>{draftGroups[key].length}</span>
                        </button>)}
                      </div>
                      <select className="review-mobile-scope" aria-label="筛选待入库记录" value={reviewFilter}
                        onChange={event => changeReviewFilter(event.target.value as typeof reviewFilter)}>
                        {reviewScopes.map(([key, label]) => <option key={key} value={key}>{label} · {draftGroups[key].length}</option>)}
                      </select>
                    </>}
                    {draftItems.length > 0 && <div className="review-batch">
                      {reviewFilter === "all" && <button type="button" className="review-link review-subtle" onClick={() => clearDraftDialog.current?.showModal()}>清空清单</button>}
                      <button type="button" disabled={!reviewDrafts.length} className="review-primary"
                        onClick={() => confirmDrafts(reviewFilter === "all" ? undefined : reviewDrafts.map(draft => draft.id))}>
                        <Check size={15} aria-hidden="true" />{reviewFilter === "all" ? "全部入库" : "筛选结果入库"}（{reviewDrafts.length}）
                      </button>
                    </div>}
                  </div>
                  {draftItems.length ? <>
                    {reviewDrafts.length > 0 ? <>
                      <div className="review-ledger">
                        <div className="review-ledger-labels" aria-hidden="true"><span>产品</span><span>数量与报价</span><span>来源</span><span>操作</span></div>
                        {pagedDrafts.map(item => <DraftReviewItem key={item.id} draft={item}
                          onEdit={() => { setNotice(null); setEditingDraftId(item.id); }} onConfirm={() => confirmDrafts([item.id])} />)}
                      </div>
                      {reviewDrafts.length > LIST_PAGE_SIZE && <Pagination total={reviewDrafts.length} page={draftCurrentPage} onPageChange={page => {
                        setDraftPage(page);
                        requestAnimationFrame(() => reviewHeading.current?.focus());
                      }} />}
                    </> : <div className="draft-empty"><h3>{reviewFilter === "missing" ? "这批记录的关键字段都已填齐" : "尚无字段齐全的记录"}</h3>
                      <button type="button" className="review-link" onClick={() => {setReviewFilter("all"); setDraftPage(1);}}>查看全部 {draftItems.length} 条</button></div>}
                    <dialog ref={clearDraftDialog} className="confirm-dialog" aria-labelledby="clear-drafts-title">
                      <h2 id="clear-drafts-title">清空待入库清单？</h2>
                      <p>将移除当前工作区的 {draftItems.length} 条待入库记录。</p>
                      <div><button type="button" autoFocus onClick={() => clearDraftDialog.current?.close()}>取消</button>
                        <button type="button" className="danger-action" onClick={() => { clearDraftDialog.current?.close(); clearDraftItems(); }}>确认清空</button></div>
                    </dialog>
                  </> : <div className="draft-empty">
                    <h3>当前没有待入库的消息</h3>
                    <p>从微信消息选取记录，或粘贴一段新的报价、求购原文。</p>
                    <div>{matchCandidates.length > 0 && <button type="button" className="review-primary" onClick={() => navigateTo("match")}>查看匹配机会</button>}
                      <button type="button" className={matchCandidates.length > 0 ? "review-link" : "review-primary"} onClick={() => setIntakeView("wechat")}>查看微信消息</button>
                      <button type="button" className="review-link" onClick={() => setIntakeView("paste")}>粘贴原文</button></div>
                  </div>}
                  {editingDraft && <DraftEditor draft={editingDraft} error={notice?.tone === "warning" ? notice.text : ""}
                    onChange={patch => updateDraftItem(editingDraft.id, patch)} onRemove={() => removeDraftItem(editingDraft.id)}
                    onConfirm={() => confirmDrafts([editingDraft.id])} onClose={() => setEditingDraftId("")} />}
                </section>
              )}
            </div>
          )}

          {activeTab === "market" && (
            <div className={`inspector-layout grid ${inspectorCollapsed ? "gap-0 lg:grid-cols-[minmax(0,1fr)_0px]" : "gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_380px]"}`}>
              <div ref={tradeListRef} tabIndex={-1} role="region" aria-label="需求结果" className="trade-list-region min-w-0 space-y-3">
                <FilterPanel
                  search={listSearchBox}
                  title="筛选需求"
                  action={pasteEntry}
                  activeCount={activeMarketFilterCount}
                  resultText={query.trim() || activeMarketFilterCount ? `找到 ${filteredMarket.length} 条需求` : <><strong>{ledgerDemands.length}</strong> 条{rental ? "求租需求" : "需求"}</>}
                  isOpen={marketFiltersOpen}
                  onToggle={() => setMarketFiltersOpen((open) => !open)}
                  onReset={resetMarketFilters}
                >
                  <div className="smart-filter-layout">
                    <FilterPillGroup
                      label="品类"
                      value={marketCategoryFilter}
                      options={[{ label: "全部品类", value: "ALL" }, ...productCategoryOptions]}
                      onChange={(value) => {
                        setMarketCategoryFilter(value as ProductCategory | "ALL");
                        setMarketPage(1);
                      }}
                    />
                    <FilterPillGroup
                      label="记录日期"
                      value={marketDateFilter}
                      options={dateFilterOptions}
                      onChange={(value) => {
                        setMarketDateFilter(value as DateFilter);
                        setMarketPage(1);
                      }}
                    />
                    <div className={`${marketFiltersOpen ? "grid" : "hidden"} smart-filter-advanced`}>
                      {!rental && <FilterPillGroup
                        label="交易"
                        value={marketModeFilter}
                        options={[{ label: "全部", value: "ALL" }, ...saleModeOptions]}
                        onChange={(value) => {
                          setMarketModeFilter(value as TradeMode | "ALL");
                          setMarketPage(1);
                        }}
                      />}
                      <div className="smart-filter-more">
                        <FilterSelect
                          label="来源用户"
                          compact
                          value={marketSourceContactFilter}
                          options={marketSourceContactOptions}
                          onChange={(value) => {
                            setMarketSourceContactFilter(value);
                            setMarketPage(1);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </FilterPanel>
                <TradeDataTable kind="market" rental={rental}
                  items={pagedMarket}
                  relatedCounts={relatedCounts.market} onShowMatches={item => showRelatedMatches("market", item)}
                  selectedId={inspectorCollapsed ? "" : selectedMarket?.id ?? ""}
                  onSelect={post => { setSelectedMarketId(post.id); openInspector(); }}
                />
                {!pagedMarket.length && (query.trim() || activeMarketFilterCount
                  ? <EmptyState title="没有找到符合条件的需求" actionLabel="清除搜索和筛选" onAction={resetMarketFilters} />
                  : <EmptyState title={rental ? "还没有求租需求" : "需求库里还没有采购需求"} description={pendingDemands ? `待入库清单里有 ${pendingDemands} 条需求，确认后就会出现在这里。` : rental ? "粘贴求租消息，核对设备数量和租金预算后即可入库。" : "粘贴买方的求购消息，核对型号和采购数量后即可入库。"}
                      actionLabel={pendingDemands ? "核对待入库需求" : "去录入需求"} onAction={() => enterLedgerIntake(pendingDemands)} />)}
                {filteredMarket.length > LIST_PAGE_SIZE && (
                  <Pagination
                    total={filteredMarket.length}
                    page={marketCurrentPage}
                    onPageChange={page => changeTradePage(setMarketPage, page)}
                  />
                )}
              </div>
              <div id="workspace-inspector" ref={inspectorRef} className={`inspector-slot order-first scroll-mt-20 self-start lg:order-none lg:sticky lg:top-20 ${inspectorCollapsed ? "hidden" : ""}`} aria-hidden={inspectorCollapsed}>
                <InspectorBack onBack={closeInspector} />
                <TradeDetailDrawer
                  kind="market"
                  item={selectedMarket}
                  relatedCount={selectedMarket ? relatedCounts.market.get(selectedMarket.id) ?? 0 : 0}
                  onShowMatches={showRelatedMatches}
                />
              </div>
            </div>
          )}

          {activeTab === "match" && (
            <div className={`inspector-layout grid ${inspectorCollapsed ? "gap-0 lg:grid-cols-[minmax(0,1fr)_0px]" : "gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]"}`}>
              <div ref={tradeListRef} tabIndex={-1} role="region" aria-label="匹配结果" className="trade-list-region min-w-0 space-y-3">
                <MatchViewSwitch value={matchView} onChange={(value) => {
                  setMatchView(value);
                  setMatchPage(1);
                }} />
                <FilterPanel
                  search={listSearchBox}
                  title="筛选匹配"
                  action={strongMatchCount > 0 && <button type="button" className="quick-secondary" onClick={() => {
                    resetMatchFilters(); setMatchView("RECOMMENDED"); setMatchScoreFilter("STRONG"); setInspectorCollapsed(true);
                  }}>查看强匹配 <b>{strongMatchCount}</b></button>}
                  activeCount={activeMatchFilterCount}
                  resultText={query.trim() || activeMatchFilterCount ? `找到 ${filteredMatches.length} 组匹配` : <><strong>{filteredMatches.length}</strong> 个机会</>}
                  isOpen={matchFiltersOpen}
                  onToggle={() => setMatchFiltersOpen((open) => !open)}
                  onReset={resetMatchFilters}
                >
                  {matchFiltersOpen && <div className="smart-filter-layout">
                    <FilterPillGroup
                      label="品类"
                      value={matchCategoryFilter}
                      options={[{ label: "全部品类", value: "ALL" }, ...productCategoryOptions]}
                      onChange={(value) => {
                        setMatchCategoryFilter(value as ProductCategory | "ALL");
                        setMatchPage(1);
                      }}
                    />
                    <FilterPillGroup
                      label="日期"
                      value={matchDateFilter}
                      options={dateFilterOptions}
                      onChange={(value) => {
                        setMatchDateFilter(value as DateFilter);
                        setMatchPage(1);
                      }}
                    />
                    <div className="grid smart-filter-advanced">
                      <FilterPillGroup
                        label="交易"
                        value={matchModeFilter}
                        options={[{ label: "全部大类", value: "ALL" }, ...tradeModeOptions]}
                        onChange={(value) => {
                          setMatchModeFilter(value as TradeMode | "ALL");
                          setMatchPage(1);
                        }}
                      />
                      <div className="smart-filter-more match-filter-more">
                        <FilterSelect
                          label="匹配度"
                          compact
                          value={matchScoreFilter}
                          options={matchScoreOptions}
                          onChange={(value) => {
                            setMatchScoreFilter(value as MatchScoreFilter);
                            setMatchPage(1);
                          }}
                        />
                        <FilterSelect
                          label="跟进状态"
                          compact
                          value={matchStatusFilter}
                          options={matchStatusOptions}
                          onChange={(value) => {
                            setMatchStatusFilter(value as MatchStatusFilter);
                            setMatchPage(1);
                          }}
                        />
                      </div>
                    </div>
                  </div>}
                </FilterPanel>
                <MatchList
                  items={pagedMatches}
                  view={matchView}
                  selectedId={inspectorCollapsed ? "" : selectedMatch?.id ?? ""}
                  onSelect={(candidate) => {
                    setSelectedMatchId(candidate.id);
                    openInspector();
                  }}
                />
                {!pagedMatches.length && (
                  query.trim() || activeMatchFilterCount
                    ? <EmptyState title="没有找到符合条件的匹配" actionLabel="清除搜索和筛选" onAction={resetMatchFilters} />
                    : matchCandidates.length && matchView === "RECOMMENDED"
                      ? <EmptyState title="当前没有推荐机会" actionLabel="查看其他匹配" onAction={() => { setMatchView("DEMAND_TO_SUPPLY"); setMatchPage(1); }} />
                      : <EmptyState title={stocks.length && demandCount ? "暂时没有合适的匹配" : "还缺少可对照的供需资料"}
                          description={stocks.length && demandCount ? "可以补充新的供需消息，入库后系统会自动重新匹配。" : stocks.length ? "已有货源，再录入买方的需求即可开始匹配。" : demandCount ? "已有采购需求，再录入供方的货源即可开始匹配。" : "把货源和采购需求分别入库，系统会按型号、规格等条件自动匹配。"}
                          actionLabel="去整理消息" onAction={() => setIntakeView("wechat")} />
                )}
                {filteredMatches.length > LIST_PAGE_SIZE && (
                  <Pagination
                    total={filteredMatches.length}
                    page={matchCurrentPage}
                    onPageChange={page => changeTradePage(setMatchPage, page)}
                  />
                )}
              </div>
              <div id="workspace-inspector" ref={inspectorRef} className={`inspector-slot order-first scroll-mt-20 self-start lg:order-none lg:sticky lg:top-20 ${inspectorCollapsed ? "hidden" : ""}`} aria-hidden={inspectorCollapsed}>
                <InspectorBack onBack={closeInspector} />
                {!inspectorCollapsed && <React.Fragment key={selectedMatch?.id}><MatchDetailDrawer
                  candidate={selectedMatch}
                  onStatusChange={updateMatchStatus}
                  onCopy={copyMatchSummary}
                  verification={selectedMatch && !inspectorCollapsed && (
                    <React.Fragment key={matchHistoryPrefix(authSession.user.id, currentWorkspaceId, selectedMatch.demand.id, selectedMatch.stock.id)}>
                      <MatchSupplyVerification session={authSession} candidate={selectedMatch} />
                    </React.Fragment>
                  )}
                /></React.Fragment>}
              </div>
            </div>
          )}

          {relatedTarget && relatedSource && activeTab === relatedTarget.kind && <React.Fragment key={relatedTarget.kind + relatedTarget.id}>
            <RelatedMatchesDrawer kind={relatedTarget.kind} source={relatedSource} matches={relatedMatches}
              session={authSession} onClose={() => setRelatedTarget(null)} onStatusChange={updateMatchStatus} onCopy={copyMatchSummary} />
          </React.Fragment>}
          {activeTab === "account" && (accountSection==="enterprise" || (currentWorkspace.type==="ENTERPRISE" && !["credits","ledger"].includes(accountSection))) && <EnterpriseHome session={authSession} onSwitch={changeWorkspace}/>}
          {activeTab === "account" && accountSection!=="enterprise" && (currentWorkspace.type==="PERSONAL" || ["credits","ledger"].includes(accountSection)) && (accountWallet ? (
            <AccountCenter
              session={authSession}
              wallet={accountWallet}
              section={accountSection}
              onProfileSaved={displayName => {
                if (currentAuthToken.current !== authSession.token) return;
                const updated = { ...authSession, user: { ...authSession.user, displayName } };
                setAuthSession(updated);
                try {
                  if (readStoredSession<AuthSession>(localStorage, AUTH_STORAGE_KEY).session?.token === updated.token) persistAuthSession(updated);
                } catch { /* The server already saved the profile. */ }
              }}
              paymentBusyKey={paymentBusyKey}
              onSectionChange={setAccountSection}
              onRecharge={handleRechargeCredits}
              onUpgrade={handleUpgradePlan}
            />
          ) : <section role="status">{walletError || "正在读取钱包…"} {walletError && <button className="account-action-link" onClick={()=>refreshWallet(n=>n+1)}>重新读取</button>}</section>
          )}
          </section>
          <SiteRecordFooter className="px-4 pb-6 md:px-8" />
        </main>
      </div>

      <MobileNavigation activeTab={activeTab} onNavigate={navigateTo} messageHref={messageEntry.href} unread={liveCircle.unread} />
    </div>
  );
}

function AccountCenter({
  session,
  wallet,
  section,
  paymentBusyKey,
  onSectionChange,
  onProfileSaved,
  onRecharge,
  onUpgrade,
}: {
  session: AuthSession;
  wallet: AccountWallet;
  section: AccountSection;
  paymentBusyKey: string;
  onSectionChange: (section: AccountSection) => void;
  onProfileSaved: (displayName: string) => void;
  onRecharge: (productId: string) => void;
  onUpgrade: (planCode: MembershipPlanCode) => void;
}) {
  const currentPlan = membershipPlans.find(plan => plan.code === wallet.planCode) ?? membershipPlans[0];
  const transactions = useMemo(() => [...wallet.transactions].sort((a, b) =>
    compareChronology(tradeChronology(a), tradeChronology(b))), [wallet.transactions]);
  const expiresAt = wallet.membershipExpiresAt ? Date.parse(wallet.membershipExpiresAt) : NaN;
  const expired = wallet.planCode !== "FREE" && (wallet.membershipStatus === "EXPIRED" || expiresAt <= Date.now());
  const workspace = session.workspaces.find(item => item.id === session.currentWorkspaceId);
  const roleName = workspace && { OWNER: "所有者", ADMIN: "管理员", MEMBER: "成员" }[workspace.role];
  const enterpriseWallet = workspace?.type === "ENTERPRISE";
  const rechargeHeading = useRef<HTMLHeadingElement>(null);
  const allSections = [
    { key: "overview", label: "账户概览", icon: UserRound },
    { key: "enterprise", label: "企业工作台", icon: Users },
    { key: "deepseek", label: "AI 用量", icon: KeyRound },
    { key: "credits", label: enterpriseWallet ? "货记分充值" : "会员与充值", icon: WalletCards },
    { key: "ledger", label: "收支明细", icon: ReceiptText },
  ] as const;
  const sectionItems = enterpriseWallet ? allSections.filter(s => ["enterprise", "credits", "ledger"].includes(s.key)) : allSections;

  return (
    <div className="account-center" data-section={section}>
      <aside className="account-rail">
      <section className="account-profile" aria-label="登录账户">
        <div className="account-avatar"><UserRound size={22} aria-hidden="true" /></div>
        <div className="min-w-0">
          <h2 className="account-phone">{session.user.displayName || session.user.maskedPhone}</h2>
          <p className="account-caption">{[workspace?.name, roleName].filter(Boolean).join(" · ")}</p>
        </div>
        {!enterpriseWallet && <span className="account-plan-tag" data-expired={expired || undefined}><ShieldCheck size={14} aria-hidden="true" />{wallet.planName}{expired && " · 已到期"}</span>}
      </section>

      <nav aria-label="个人中心设置" className="account-nav">
        {sectionItems.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" onClick={() => onSectionChange(key)} aria-current={section === key ? "page" : undefined}>
            <Icon size={16} aria-hidden="true" />{label}
          </button>
        ))}
      </nav>
      </aside>
      <label className="account-compact-switch">账户设置
        <select aria-label="账户设置" value={section} onChange={event => onSectionChange(event.target.value as AccountSection)}>
          {sectionItems.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      </label>
      <div className="account-pages">

      {section === "deepseek" && <TokenUsage token={session.token} />}
      {section === "overview" && (
        <>
          <React.Fragment key={session.token}>
            <AccountProfile token={session.token} maskedPhone={session.user.maskedPhone} onSaved={onProfileSaved} />
          </React.Fragment>
          <section className="account-surface account-padding" aria-label="账户用量">
            <h3 className="account-heading">账户概览</h3>
            <div className="account-metrics">
              <AccountMetric label="货记分余额" value={wallet.creditBalance.toLocaleString("zh-CN")} unit="分" action="查看充值套餐" onClick={() => onSectionChange("credits")} />
              <AccountMetric label="AI 用量归属" value={workspace?.type==="ENTERPRISE"?"企业版":"个人版"} action="查看 Token 用量" onClick={() => onSectionChange("deepseek")} />
              <AccountMetric label="会员有效期" value={wallet.membershipExpiresAt ? formatDate(wallet.membershipExpiresAt) : currentPlan.period} action="查看会员权益" onClick={() => onSectionChange("credits")} />
            </div>
          </section>
          <section className="account-surface account-padding">
            <div className="account-heading-row">
              <h3 className="account-heading">最近收支</h3>
              <button type="button" className="account-action-link" onClick={() => onSectionChange("ledger")}>查看全部<ChevronRight size={15} aria-hidden="true" /></button>
            </div>
            <TransactionList transactions={transactions.slice(0, 4)} />
          </section>
        </>
      )}

      {section === "credits" && <>
        <section className="account-surface account-padding" aria-label={enterpriseWallet ? "企业钱包" : "个人钱包"}>
          <div className="account-heading-row">
            <div>
              <h3 className="account-caption">{enterpriseWallet ? "企业货记分余额" : "个人货记分余额"}</h3>
              <p className="account-number">{wallet.creditBalance.toLocaleString("zh-CN")}<small>分</small></p>
            </div>
            <button type="button" className="account-action-link" onClick={() => onSectionChange("ledger")}>收支明细<ChevronRight size={15} aria-hidden="true" /></button>
          </div>
          {wallet.nextGrant && !enterpriseWallet && <p className="account-caption">下次会员发分 · {formatDate(wallet.nextGrant.due)} · {wallet.nextGrant.amount.toLocaleString("zh-CN")} 分</p>}
          {!wallet.paymentReady && <p className="account-caption">当前服务尚未开通支付宝收款。</p>}
        </section>
        {!enterpriseWallet && <section className="account-surface account-padding" aria-labelledby="membership-options">
          <div className="account-heading-row">
            <h3 id="membership-options" className="account-heading">会员方案</h3>
            <button type="button" className="account-action-link" onClick={() => {
              rechargeHeading.current?.focus({ preventScroll: true });
              rechargeHeading.current?.scrollIntoView({ block: "start" });
            }}>只充货记分<ChevronRight size={15} aria-hidden="true" /></button>
          </div>
          <div className="account-offers">
            {membershipPlans.map(plan => {
              const current = wallet.planCode === plan.code && !expired;
              const renewal = wallet.planCode === plan.code && expired;
              const busy = paymentBusyKey === `MEMBERSHIP_PLAN:${plan.code}`;
              return (
                <article key={plan.code} className="account-offer" data-current={current || undefined}>
                  <div className="account-offer-name">
                    <h4>{plan.name}</h4>
                    {(current || renewal) && <span data-expired={renewal || undefined}>{renewal ? "已到期" : "使用中"}</span>}
                  </div>
                  <p className="account-price">{plan.price}<small> / {plan.period}</small></p>
                  <ul className="account-features">
                    {plan.features.map(feature => <li key={feature}><Check size={15} aria-hidden="true" />{feature}</li>)}
                  </ul>
                  <button type="button" disabled={!wallet.paymentReady || current || plan.code === "FREE" || Boolean(paymentBusyKey)} onClick={() => onUpgrade(plan.code)}
                    className={current || plan.code === "FREE" ? "account-secondary" : "primary-button account-pay"}>
                    {current ? "当前方案" : plan.code === "FREE" ? "基础方案" : <><CreditCard size={16} aria-hidden="true" />{busy ? "正在打开支付宝…" : renewal ? "支付宝续费" : "支付宝支付"}</>}
                  </button>
                </article>
              );
            })}
          </div>
        </section>}
        <section className="account-surface account-padding" aria-labelledby="recharge-options">
          <h3 id="recharge-options" ref={rechargeHeading} tabIndex={-1} className="account-heading">{enterpriseWallet ? "企业货记分充值" : "货记分充值"}</h3>
          <p className="account-caption">1 元兑 {creditsPerYuan} 分，可单独购买。AI 解析按每 1 元模型费用扣 {pointsPerCostYuan} 分。</p>
          <div className="account-offers">
            {creditPackagesFor(enterpriseWallet).map(pack => (
              <article key={pack.id} className="account-offer">
                <h4>{pack.title}</h4>
                <p className="account-price">{pack.price}</p>
                <p className="account-offer-amount">到账 <strong>{pack.credits.toLocaleString("zh-CN")}</strong> 分</p>
                <button type="button" disabled={!wallet.paymentReady || Boolean(paymentBusyKey)} onClick={() => onRecharge(pack.id)} className="primary-button account-pay">
                  <CreditCard size={16} aria-hidden="true" />{paymentBusyKey === `CREDIT_PACKAGE:${pack.id}` ? "正在打开支付宝…" : "支付宝支付"}
                </button>
              </article>
            ))}
          </div>
        </section>
      </>}

      {section === "ledger" && (
        <section className="account-surface account-padding">
          <div className="account-heading-row">
            <h3 className="account-heading">收支明细</h3>
            <span className="account-caption">共 {wallet.transactions.length} 笔</span>
          </div>
          <TransactionList transactions={transactions} />
        </section>
      )}
      </div>
    </div>
  );
}

function AccountMetric({ label, value, unit, action, onClick }: { label: string; value: string; unit?: string; action: string; onClick: () => void }) {
  return (
    <div className="account-metric">
      <p className="account-caption">{label}</p>
      <p className="account-number">{value}{unit && <small>{unit}</small>}</p>
      <button type="button" className="account-action-link" onClick={onClick}>{action}<ChevronRight size={14} aria-hidden="true" /></button>
    </div>
  );
}

function TransactionList({ transactions }: { transactions: CreditTransaction[] }) {
  if (!transactions.length) return <p className="account-empty">暂无流水，充值和解析扣分后可在这里查看明细。</p>;
  return (
    <ul className="account-transactions">
      {transactions.map(transaction => (
        <li key={transaction.id}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="account-txn-kind">{creditTransactionTypeText(transaction.type)}</span>
              <strong>{transaction.title}</strong>
            </div>
            <p className="account-caption mt-1"><time dateTime={transaction.createdAt}>{formatMinuteTime(transaction.createdAt)}</time> · 余额 {transaction.balanceAfter} 分</p>
            {transaction.note && <p className="account-caption mt-0.5">{transaction.note}</p>}
          </div>
          <p className="account-txn-amount" data-credit={transaction.amount >= 0 || undefined}>{transaction.amount >= 0 ? "+" : ""}{transaction.amount.toLocaleString("zh-CN",{maximumFractionDigits:7})} <small>分</small></p>
        </li>
      ))}
    </ul>
  );
}

function BrandIcon({ size = "md" }: { size?: "sm" | "md" }) {
  const className = size === "sm" ? "h-8 w-8" : "h-9 w-9";
  return (
    <img
      src="/huoji-icon.png"
      alt="货记"
      className={`${className} shrink-0 rounded-md object-cover shadow-sm`}
    />
  );
}

function LoginScreen({ onLogin, sessionNotice }: { onLogin: (session: AuthSession) => void; sessionNotice?: string }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [debugCode, setDebugCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [captchaConfig, setCaptchaConfig] = useState<CaptchaConfig | null>(null);
  const [captchaStatus, setCaptchaStatus] = useState<CaptchaStatus>("disabled");
  const captchaInstanceRef = useRef<AliyunCaptchaInstance | null>(null);
  const pendingCaptchaRef = useRef(false);
  const phoneRef = useRef("");
  const normalizedPhone = normalizePhoneInput(phone);
  const captchaElementId = "aliyun-captcha-element";
  const captchaButtonId = "aliyun-captcha-trigger";

  useEffect(() => {
    phoneRef.current = normalizedPhone;
  }, [normalizedPhone]);

  useEffect(() => {
    let cancelled = false;
    fetchCaptchaConfig()
      .then((config) => {
        if (cancelled) return;
        setCaptchaConfig(config);
        setCaptchaStatus(config.enabled ? "loading" : "disabled");
      })
      .catch(() => {
        if (!cancelled) {
          setCaptchaConfig({ enabled: false, provider: "none" });
          setCaptchaStatus("disabled");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!captchaConfig?.enabled) return;
    if (!captchaConfig.prefix || !captchaConfig.sceneId) {
      setCaptchaStatus("error");
      setError("安全验证配置不完整，请检查阿里云验证码 2.0 参数。");
      return;
    }

    let cancelled = false;
    setCaptchaStatus("loading");
    window.AliyunCaptchaConfig = {
      region: captchaConfig.region || "cn",
      prefix: captchaConfig.prefix,
    };

    loadAliyunCaptchaScript(captchaConfig.scriptUrl)
      .then(() => {
        if (cancelled) return;
        if (!window.initAliyunCaptcha) throw new Error("阿里云验证码脚本加载失败。");
        window.initAliyunCaptcha({
          SceneId: captchaConfig.sceneId || "",
          mode: captchaConfig.mode || "popup",
          element: `#${captchaElementId}`,
          button: `#${captchaButtonId}`,
          success: (captchaVerifyParam) => {
            pendingCaptchaRef.current = false;
            captchaInstanceRef.current?.hide?.();
            void sendSmsCode(captchaVerifyParam);
          },
          fail: () => {
            pendingCaptchaRef.current = false;
            setIsSending(false);
            setError("安全验证未通过，请重试。");
          },
          getInstance: (instance) => {
            captchaInstanceRef.current = instance;
            setCaptchaStatus("ready");
          },
          slideStyle: { width: 360, height: 40 },
          language: "cn",
          timeout: 5000,
          delayBeforeSuccess: false,
          onError: (errorInfo) => {
            setCaptchaStatus("error");
            setIsSending(false);
            setError(`安全验证加载失败：${errorInfo.msg || errorInfo.code || "请刷新页面重试。"}`);
          },
          onClose: (reason) => {
            if (reason === "userDismiss") {
              pendingCaptchaRef.current = false;
              setIsSending(false);
              setMessage("");
            }
          },
        });
      })
      .catch((loadError) => {
        if (!cancelled) {
          setCaptchaStatus("error");
          setIsSending(false);
          setError(loadError instanceof Error ? loadError.message : "安全验证加载失败，请刷新页面重试。");
        }
      });

    return () => {
      cancelled = true;
      pendingCaptchaRef.current = false;
    };
  }, [captchaConfig?.enabled, captchaConfig?.mode, captchaConfig?.prefix, captchaConfig?.region, captchaConfig?.sceneId, captchaConfig?.scriptUrl]);

  async function sendSmsCode(captchaVerifyParam?: string) {
    const targetPhone = phoneRef.current;
    if (!targetPhone) {
      setError("请输入有效的 11 位手机号。");
      return;
    }
    setIsSending(true);
    setError("");
    setMessage("");
    try {
      const result = await requestSmsCode(targetPhone, captchaVerifyParam);
      if (targetPhone !== phoneRef.current) return;
      setDebugCode(result.debugCode ?? "");
      if (result.debugCode) setCode(result.debugCode);
      setMessage(result.debugCode ? "验证码已生成，可直接登录。" : "验证码已发送。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "验证码发送失败。");
    } finally {
      setIsSending(false);
    }
  }

  async function handleRequestCode() {
    if (!normalizedPhone) {
      setError("请输入有效的 11 位手机号。");
      return;
    }
    setError("");
    setMessage("");
    if (captchaConfig?.enabled) {
      if (captchaStatus === "loading") {
        setError("安全验证组件加载中，请稍后再试。");
        return;
      }
      if (captchaStatus !== "ready" || !captchaInstanceRef.current) {
        setError("安全验证暂不可用，请刷新页面重试。");
        return;
      }
      pendingCaptchaRef.current = true;
      setIsSending(true);
      setMessage("请先完成安全验证。");
      captchaInstanceRef.current.show?.();
      document.getElementById(captchaButtonId)?.click();
      return;
    }

    await sendSmsCode();
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizedPhone || !code.trim()) {
      setError("请输入手机号和验证码。");
      return;
    }
    setIsLoggingIn(true);
    setError("");
    try {
      onLogin(await loginWithSmsCode(normalizedPhone, code.trim()));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败。");
    } finally {
      setIsLoggingIn(false);
    }
  }

  return (
    <div className="login-shell">
      <main className="login-card">
        <div className="login-brand"><BrandIcon /><div><strong>货记</strong><span>硬件供需工作台</span></div></div>
        <form onSubmit={handleLogin}>
          <div className="login-heading"><h1>手机号登录</h1></div>
          {document.querySelector('meta[name="huoji-edition"][content="cloud"]') && <p className="caption-text mb-4">登录 huoij.com 云端账号，采集资料将同步到你选择的个人或企业空间。</p>}
          {document.querySelector('meta[name="huoji-edition"][content="local-test"]') &&
            <p className="caption-text mb-4">本机测试版。获取验证码后，页面会自动填入。账号与采集资料仅保存在这台电脑。</p>}
          {sessionNotice && <p role="status" className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">{sessionNotice}</p>}
          <label className="block">
            <span className="caption-text mb-1 block">手机号</span>
            <div className="field-surface flex items-center gap-2 rounded-md px-3 py-2">
              <Phone className="h-4 w-4 text-neutral-400" />
              <input
                value={phone}
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="请输入 11 位手机号"
                onChange={event => {
                  setPhone(event.target.value);
                  setDebugCode("");
                  setCode("");
                  setMessage("");
                  setError("");
                }}
                className="min-w-0 flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
              />
            </div>
          </label>
          <div className="login-code-row">
            <label className="block">
              <span className="caption-text mb-1 block">短信验证码</span>
              <div className="field-surface flex items-center gap-2 rounded-md px-3 py-2">
                <ShieldCheck className="h-4 w-4 text-neutral-400" />
                <input
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="输入验证码"
                  onChange={(event) => setCode(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                />
              </div>
            </label>
            <button
              type="button"
              onClick={handleRequestCode}
              disabled={isSending || !normalizedPhone}
              className="ghost-button meta-pill self-end rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSending ? "发送中..." : "获取验证码"}
            </button>
          </div>
          {captchaConfig?.enabled && (
            <div className="mt-3">
              <div id={captchaElementId} />
              <button id={captchaButtonId} type="button" className="sr-only" tabIndex={-1}>
                安全验证
              </button>
              <p className="meta-pill rounded-md px-3 py-2 text-xs font-medium text-neutral-500">
                {captchaStatus === "ready" ? "已启用阿里云安全验证。" : captchaStatus === "loading" ? "安全验证加载中。" : "安全验证暂不可用。"}
              </p>
            </div>
          )}
          {debugCode && <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">测试验证码已填入：{debugCode}</p>}
          {message && !debugCode && <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">{message}</p>}
          {error && <p role="alert" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{error}</p>}
          <button
            type="submit"
            disabled={isLoggingIn || !normalizedPhone || !code.trim()}
            className="primary-button mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed"
          >
            <Check className="h-4 w-4" />
            {isLoggingIn ? "正在登录…" : "登录"}
          </button>
        </form>
      </main>
      <SiteRecordFooter className="mt-6" />
    </div>
  );
}

function SiteRecordFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`mx-auto w-full max-w-[1440px] text-center text-xs font-medium text-neutral-400 ${className}`}>
      <a
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noreferrer"
        className="transition hover:text-neutral-700"
      >
        深圳市莫林智链科技有限公司 ICP备案/许可认证号：粤ICP备2026111786号
      </a>
    </footer>
  );
}

function RelatedMatchesDrawer({ kind, source, matches, session, onClose, onStatusChange, onCopy }: {
  kind: "stock" | "market";
  source: StockItem | MarketPost;
  matches: MatchCandidate[];
  session: AuthSession;
  onClose: () => void;
  onStatusChange: (id: string, status: MatchStatus) => void;
  onCopy: (candidate: MatchCandidate, notify: (notice: { tone: NoticeTone; text: string }) => void) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const lastCandidate = useRef<HTMLButtonElement | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [feedback, setFeedback] = useState("");
  const selected = matches.find(pair => pair.id === selectedId);
  const isStock = kind === "stock";
  const title = isStock ? "关联需求" : "关联供应";
  React.useLayoutEffect(() => {
    const node = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    return () => {
      node?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  React.useLayoutEffect(() => {
    if (selectedId) backButton.current?.focus({ preventScroll: true });
    else lastCandidate.current?.focus({ preventScroll: true });
  }, [selectedId]);
  return <dialog className="related-drawer" ref={dialog} aria-labelledby="related-drawer-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className="related-header">
      <h2 id="related-drawer-title">{title} <span>{matches.length}</span></h2>
      <button type="button" autoFocus className="related-close" aria-label="关闭关联匹配" onClick={onClose}><X size={21} /></button>
    </header>
    <section className="related-list-body" hidden={Boolean(selected)}>
      <div className="related-anchor">
        <span className="related-caption">{isStock ? "当前供应" : "当前需求"}</span>
        <h3>{source.title}</h3>
        <p>{[source.sourceContact || source.sourceSender, source.sourceChatName].filter(Boolean).join(" · ")}</p>
        <div className="related-anchor-time"><span>发布时间</span><TradeTime item={source} compact /></div>
      </div>
      <div className="related-list-heading"><h3>{isStock ? "匹配的需求" : "匹配的供应"}</h3><span>按发布时间从近到远</span></div>
      <ul className="related-results">{matches.map(pair => {
        const other = isStock ? pair.demand : pair.stock;
        return <li key={pair.id}>
          <button type="button" className="related-result" onClick={event => {
            lastCandidate.current = event.currentTarget;
            setFeedback("");
            setSelectedId(pair.id);
          }}>
            <span className="related-result-top"><span>{matchLevelText(pair.level)} · {pair.scoreTotal} 分</span>
              {pair.status !== "NEW" && <span>{matchStatusText(pair.status)}</span>}</span>
            <strong className="related-product">{other.title}</strong>
            <span className="related-spec">{[quantityText(other.quantity, other.quantityUnit), other.locationCity, other.sourceContact || other.sourceSender].filter(Boolean).join(" · ")}</span>
            <span className="related-result-bottom"><TradeTime item={other} compact /><span className="related-compare">对照供需 <ChevronRight size={15} /></span></span>
          </button>
        </li>;
      })}</ul>
      {!matches.length && <p className="related-spec">这条记录暂时没有关联匹配。</p>}
    </section>
    {selected && <section className="related-detail-body">
      <button type="button" className="related-back" ref={backButton} onClick={() => { setSelectedId(""); setFeedback(""); }}>
        <ArrowLeft size={16} />返回{title}</button>
      <MatchDetailDrawer candidate={selected}
        onCopy={pair => void onCopy(pair, notice => setFeedback(notice.text))}
        onStatusChange={(id, status) => { onStatusChange(id, status); setFeedback(`已标记为${matchStatusText(status)}。`); }}
        verification={<MatchSupplyVerification session={session} candidate={selected} />} />
      {feedback && <p role="status" className="related-feedback">{feedback}</p>}
    </section>}
  </dialog>;
}

function InspectorBack({ onBack }: { onBack: () => void }) {
  return <div className="trade-inspector-bar">
    <button type="button" onClick={onBack}><ChevronRight size={15} className="rotate-180" aria-hidden="true" />返回列表</button>
  </div>;
}

function MatchViewSwitch({ value, onChange }: { value: MatchView; onChange: (value: MatchView) => void }) {
  const items: Array<{ key: MatchView; label: string }> = [
    { key: "RECOMMENDED", label: "推荐机会" },
    { key: "DEMAND_TO_SUPPLY", label: "需求找供应" },
    { key: "SUPPLY_TO_DEMAND", label: "供应找需求" },
  ];
  return (
    <div role="group" aria-label="匹配方向" className="trade-match-directions">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={value === item.key}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function MatchList({ items, view, selectedId, onSelect }: {
  items: MatchCandidate[];
  view: MatchView;
  selectedId: string;
  onSelect: (item: MatchCandidate) => void;
}) {
  if (!items.length) return null;
  const supplyFirst = view === "SUPPLY_TO_DEMAND";
  return (
    <ul aria-label="匹配机会" className="trade-match-list">
      {items.map(pair => {
        const sides = supplyFirst ? [pair.stock, pair.demand] : [pair.demand, pair.stock];
        const risk = pair.riskNotes[0];
        return <li key={pair.id}>
          <button type="button" className="trade-match-card" aria-label={`对照供需：${sides.map(item => item.title).join("，")}`}
            aria-controls="workspace-inspector" aria-expanded={selectedId === pair.id} onClick={() => onSelect(pair)}>
            <span className="trade-match-pair">
              {sides.map(item => {
                const isStock = "createdAt" in item;
                return <span key={isStock ? "stock" : "market"} className="trade-pair-side">
                  <span className="trade-pair-label">{item.tradeMode === "RENTAL" ? (isStock ? "出租" : "求租") : isStock ? "供应" : "需求"}</span>
                  <strong>{item.title}</strong>
                  <span className="trade-pair-context">{[quantityText(item.quantity, item.quantityUnit), item.locationCity, item.sourceContact].filter(Boolean).join(" · ")}</span>
                  <span className="trade-pair-label">发布</span>
                  <TradeTime item={item} compact />
                </span>;
              })}
            </span>
            <span className="trade-match-footer">
              <span className="trade-match-conclusion">
                <span className="trade-match-rating">{matchLevelText(pair.level)} · {pair.scoreTotal} 分</span>
                <span className={risk ? "trade-risk" : ""}>{risk || pair.scoreDetail.find(detail => detail.label === "型号")?.note}</span>
              </span>
              <span className="trade-match-cta">{pair.status !== "NEW" && <small>{matchStatusText(pair.status)}</small>}对照供需 <ChevronRight size={14} /></span>
            </span>
          </button>
        </li>;
      })}
    </ul>
  );
}

function MatchSupplyVerification({ candidate, session }: { candidate: MatchCandidate; session: AuthSession }) {
  const { demand, stock } = candidate;
  const prefix = matchHistoryPrefix(session.user.id, session.currentWorkspaceId, demand.id, stock.id);
  const [evidence, setEvidence] = useState<VerificationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(false);
  function reload() {
    try {
      setEvidence(readMatchHistory(localStorage, prefix));
      setReadError(false);
    } catch {
      setReadError(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key === null || event.key.startsWith(prefix)) reload();
    }
    window.addEventListener("storage", sync);
    reload();
    return () => window.removeEventListener("storage", sync);
  }, [prefix]);

  function save(entry: VerificationEntry) {
    const active = readStoredSession<AuthSession>(localStorage, AUTH_STORAGE_KEY).session;
    if (active?.user.id !== session.user.id || active?.currentWorkspaceId !== session.currentWorkspaceId) {
      throw new Error("登录已变更，请回到原账号和工作空间后重试。");
    }
    try {
      appendMatchHistory(localStorage, prefix, entry);
    } catch {
      throw new Error("核实记录未保存，请检查浏览器存储空间后重试。");
    }
    reload();
  }
  if (loading) return <p className="caption-text mt-3">正在读取核实记录…</p>;
  if (readError) return (
    <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="alert">
      这笔匹配的核实记录暂时无法读取。 <button type="button" className="underline" onClick={reload}>重新读取</button>
    </div>
  );

  function description(item: MarketPost | StockItem) {
    const fields = item.configItems
      .filter(({ label, value }) => value && ["原文", "品牌", "型号", "容量", "频率", "批次", "颗粒", "料号"].includes(label))
      .map(({ value }) => value);
    return [item.title, item.gpuModel, ...fields].join(" ");
  }
  return <SupplyVerificationPanel
    context={{
      supplyText: description(stock),
      demandText: description(demand),
      supplyQuantity: stock.quantity > 0 ? stock.quantity : undefined,
      demandQuantity: demand.quantity > 0 ? demand.quantity : undefined,
      unit: stock.quantityUnit,
      demandUnit: demand.quantityUnit,
      category: demand.productCategory,
    }}
    source={{
      groupName: stock.sourceChatName,
      sender: stock.sourceSender,
      contact: stock.sourceContact,
      observedAt: stock.sourceObservedAt,
      publishedTimeText: stock.sourceCaptureId ? wechatTimeLabel(stock.sourceSentAt, stock.sourcePublishedTime, stock.sourceObservedAt) : undefined,
      excerpt: configValue(stock.configItems, "原文"),
      sourceRef: stock.sourceMessageId || stock.sourceCaptureId,
    }}
    evidence={evidence}
    onSave={save}
  />;
}

function MatchDetailDrawer({ candidate, onStatusChange, onCopy, verification }: {
  candidate: MatchCandidate | null;
  onStatusChange: (candidateId: string, status: MatchStatus) => void;
  onCopy: (candidate: MatchCandidate) => void;
  verification: React.ReactNode;
}) {
  const [view, setView] = useState<"compare" | "verify">("compare");
  if (!candidate) return null;
  const { demand, stock } = candidate;
  const facts = [
    ["型号", demand.gpuModel, stockSpecText(stock)],
    ["数量", quantityText(demand.quantity, demand.quantityUnit), quantityText(stock.quantity, stock.quantityUnit)],
    [demand.tradeMode === "RENTAL" ? "租金" : "金额", demand.priceAmount ? `预算 ${formatMoney(demand.priceAmount)}` : "预算未记录", stock.priceAmount ? `报价 ${formatMoney(stock.priceAmount)}` : "报价未记录"],
    ["交付地", demand.locationCity, stock.locationCity],
    ["来源", demand.sourceContact || demand.sourceSender, stock.sourceContact || stock.sourceSender],
  ];
  return (
    <aside className="right-inspector trade-inspector surface-card" aria-label="匹配详情">
      <div className="trade-detail-kicker">匹配详情 <span>{matchLevelText(candidate.level)} · {candidate.scoreTotal} 分</span></div>
      <h3 className="trade-inspector-title">{demand.title}</h3>
      <div role="group" aria-label="匹配详情内容" className="trade-detail-tabs">
        <button type="button" aria-pressed={view === "compare"} onClick={() => setView("compare")}>供需对照</button>
        <button type="button" aria-pressed={view === "verify"} onClick={() => setView("verify")}>货源核实</button>
      </div>
      <div hidden={view !== "compare"}>
        <table className="trade-compare-table" aria-label="需求与供应条件对照">
          <thead><tr><th scope="col"><span className="sr-only">条件</span></th><th scope="col">需求条件</th><th scope="col">供应条件</th></tr></thead>
          <tbody><tr className="trade-compare-publication"><th scope="row">发布时间</th>
            <td><TradeTime item={demand} compact /></td><td><TradeTime item={stock} compact /></td>
          </tr>{facts.map(([label, need, offer]) => <tr key={label}>
            <th scope="row">{label}</th><td>{need || "未记录"}</td><td>{offer || "未记录"}</td>
          </tr>)}</tbody>
        </table>
        {candidate.riskNotes.length > 0 && <section className="trade-risk-notes">
          <h4>成交前待核对</h4>
          <ul>{candidate.riskNotes.map(note => <li key={note}>{note}</li>)}</ul>
        </section>}
        <div className="trade-follow-actions">
          <button type="button" className="trade-related" onClick={() => setView("verify")}>去核实货源<ChevronRight size={15} /></button>
          <button type="button" className="trade-copy" onClick={() => onCopy(candidate)}><ClipboardCheck size={15} />复制摘要</button>
        </div>
        <details className="trade-config">
          <summary>匹配依据 <span>{candidate.scoreTotal} 分</span></summary>
          <ul className="trade-score-list">{candidate.scoreDetail.map(detail => (
            <li key={detail.label}><strong>{detail.label}</strong><span>{detail.note}</span><small>{detail.score} / {detail.max}</small></li>
          ))}</ul>
        </details>
        <details className="trade-config">
          <summary>双方来源与原文</summary>
          <MatchTradeCard title="需求" item={demand} /><MatchTradeCard title="供应" item={stock} />
        </details>
      </div>
      <div hidden={view !== "verify"}>{verification}</div>
      <label className="trade-follow-status">跟进状态
        <select value={candidate.status} onChange={event => onStatusChange(candidate.id, event.target.value as MatchStatus)}
          className="field-surface rounded-md px-2 py-1.5 text-sm">
          <option value="NEW">新机会</option><option value="CONTACTED">已联系</option><option value="IGNORED">已忽略</option>
        </select>
      </label>
    </aside>
  );
}

function TradeTime({ item, compact = false }: { item: StockItem | MarketPost; compact?: boolean }) {
  const published = readWechatTime(item.sourceSentAt, item.sourcePublishedTime, item.sourceObservedAt);
  const fromWechat = Boolean(item.sourceCaptureId || item.sourceCaptureMode || item.sourceMessageId || item.sourceItemKey
    || item.sourceObservedAt || item.sourcePublishedTime || item.sourceSentAt);
  const recorded = wechatTimestamp(fromWechat ? item.sourceObservedAt : "createdAt" in item ? item.createdAt : item.publishedAt);
  return <span className="trade-publication" data-known={Boolean(published)} title={published ? `${published.fullLabel}（北京时间）` : undefined}>
    <strong className="trade-publication-value">{published
      ? <><span className="trade-publication-endpoint">{published.value}</span>
        {published.rangeEnd && <> 至 <span className="trade-publication-endpoint">{published.rangeEnd}</span></>}</>
      : fromWechat ? "未识别" : "未提供"}</strong>
    {published && <small className="trade-publication-note">{published.basis}</small>}
    {(!compact || !published) && recorded !== "未识别" &&
      <small className="trade-publication-note">{fromWechat ? "采集于" : "录入于"} {recorded}</small>}
  </span>;
}

function MatchTradeCard({ title, item }: { title: string; item: StockItem | MarketPost }) {
  const excerpt = configValue(item.configItems, "原文");
  return <section className="trade-evidence">
    <p className="trade-pair-label">{title}</p>
    <strong>{item.title}</strong>
    <p className="trade-evidence-source">{[item.sourceContact || item.sourceSender, item.sourceChatName].filter(Boolean).join(" · ") || "来源待核对"}</p>
    {item.sourceSender && item.sourceContact && item.sourceContact !== item.sourceSender && <p className="caption-text">发言人 · {item.sourceSender}</p>}
    <div className="trade-evidence-publication"><span>发布时间</span><TradeTime item={item} compact /></div>
    {"contactMethod" in item && item.contactMethod && <p className="caption-text">联系方式 · {item.contactMethod}</p>}
    {excerpt && <blockquote>{excerpt}</blockquote>}
  </section>;
}

function TradeDataTable<T extends StockItem | MarketPost>({ kind, rental, items, selectedId, onSelect, relatedCounts, onShowMatches }: {
  rental: boolean;
  kind: "stock" | "market";
  items: T[];
  selectedId: string;
  onSelect: (item: T) => void;
  relatedCounts: ReadonlyMap<string, number>;
  onShowMatches: (item: T) => void;
}) {
  if (!items.length) return null;
  const isStock = kind === "stock";
  const amountLabel = rental ? (isStock ? "租金" : "租金预算") : isStock ? "报价" : "预算";
  return (
    <div className="trade-ledger">
      <table aria-label={isStock ? "供应列表" : "需求列表"}>
        <thead><tr><th scope="col">产品 / 交付</th><th scope="col" aria-sort="descending" className="trade-published-heading">发布时间<span aria-hidden="true"> ↓</span></th><th scope="col">数量</th><th scope="col">{amountLabel}</th><th scope="col">来源 / 群聊</th><th scope="col">关联匹配</th></tr></thead>
        <tbody>{items.map(item => {
          const count = relatedCounts.get(item.id) ?? 0;
          const spec = item.gpuModel && !item.title.toLowerCase().includes(item.gpuModel.toLowerCase()) ? item.gpuModel : "";
          const gpuCount = "gpuCount" in item && item.productCategory === "SERVER" && item.gpuCount > 0
            && !item.title.replaceAll(" ", "").includes(`${item.gpuCount}卡`) ? `${item.gpuCount}卡` : "";
          return <tr key={item.id} className={selectedId === item.id ? "is-selected" : ""} onClick={event => {
            event.currentTarget.querySelector("button")?.focus({ preventScroll: true });
            onSelect(item);
          }}>
            <td className="trade-product">
              <button type="button" data-trade-id={item.id} aria-label={`查看${isStock ? "供应" : "需求"}详情：${item.title}`}
                aria-controls="workspace-inspector" aria-expanded={selectedId === item.id}>{item.title}</button>
              <div className="trade-row-meta">{[spec, gpuCount, item.locationCity, tradeModeText(item.tradeMode)].filter(Boolean).join(" · ")}
                {"status" in item && <span className="trade-status" data-status={item.status}>{statusText(item.status)}</span>}
              </div>
            </td>
            <td className="trade-published-cell"><span className="trade-mobile-label">发布时间</span><TradeTime item={item} compact /></td>
            <td className="trade-quantity"><span className="trade-mobile-label">数量</span><strong>{quantityText(item.quantity, item.quantityUnit)}</strong></td>
            <td className="trade-amount"><span className="trade-mobile-label">{amountLabel}</span>
              {item.priceAmount ? <strong>{formatMoney(item.priceAmount)}</strong> : <span className="trade-unknown">未记录</span>}
            </td>
            <td className="trade-source"><div><strong>{item.sourceContact || item.sourceSender || "来源待核对"}</strong>{item.sourceChatName && <span>{item.sourceChatName}</span>}</div></td>
            <td className="trade-counterpart">
              {count ? <button type="button" aria-haspopup="dialog" onClick={event => { event.stopPropagation(); onShowMatches(item); }}
                aria-label={`查看${item.title}的 ${count} 条关联${isStock ? "需求" : "供应"}`}>
                {count} 条{isStock ? "需求" : "供应"} <ChevronRight size={13} aria-hidden="true" />
              </button> : <span>暂无匹配</span>}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}

function TradeDetailDrawer({
  kind,
  item,
  relatedCount,
  onShowMatches,
}: {
  kind: "stock" | "market";
  item: StockItem | MarketPost | null;
  relatedCount: number;
  onShowMatches: (kind: "stock" | "market", item: StockItem | MarketPost) => void;
}) {
  if (!item) {
    return (
      <aside className="right-inspector surface-card h-fit rounded-md p-4">
        <p className="text-sm font-semibold text-neutral-700">未选择记录</p>
        <p className="caption-text mt-1">点击左侧表格中的任意一行，这里会显示完整配置、来源和联系方式。</p>
      </aside>
    );
  }

  const isStock = kind === "stock";
  const sourceContact = item.sourceContact || item.sourceSender;
  const excerpt = configValue(item.configItems, "原文");
  const originFields = new Set(["来源群聊", "原消息发送人", "原消息时间", "消息采集时间", "来源消息ID", "采集方式"]);
  const sourceDetails = item.sourceCaptureId ? item.configItems.filter(field => originFields.has(field.label)) : [];
  const specFields = item.configItems.filter(field => field.label !== "原文" && !sourceDetails.includes(field));
  const model = isStock ? stockSpecText(item as StockItem) : item.gpuModel;
  return (
    <aside className="right-inspector trade-inspector surface-card" aria-label={isStock ? "供应详情" : "需求详情"}>
      <div className="trade-detail-kicker">{isStock ? "供应详情" : "需求详情"} <span>{"status" in item ? statusText(item.status) : productCategoryText(item.productCategory)}</span></div>
      <h3 className="trade-inspector-title">{item.title}</h3>
      <div className="trade-detail-publication"><span>消息发布时间</span><TradeTime item={item} /></div>
      {(!("status" in item)||!["SOLD_OUT","EXPIRED"].includes(item.status))&&<button type="button" className="quick-secondary"
        onClick={()=>navigateWorkspace("#circle/publish/"+encodeURIComponent(item.id)+"/"+kind)}><Radio size={15}/>发布到广场</button>}
      <div className="trade-detail-numbers">
        <div><span>{item.tradeMode === "RENTAL" ? (isStock ? "可租数量" : "求租数量") : isStock ? "供货数量" : "采购数量"}</span><strong>{quantityText(item.quantity, item.quantityUnit)}</strong></div>
        <div><span>{item.tradeMode === "RENTAL" ? (isStock ? "租金" : "租金预算") : isStock ? "报价" : "采购预算"}</span><strong>{item.priceAmount ? formatMoney(item.priceAmount) : "未记录"}</strong></div>
      </div>
      <dl className="trade-detail-fields">
        <dt>型号规格</dt><dd>{model || "待核对"}</dd>
        <dt>交付方式</dt><dd>{[tradeModeText(item.tradeMode), item.locationCity].filter(Boolean).join(" · ")}</dd>
        <dt>来源用户</dt><dd>{sourceContact || "待核对"}</dd>
        {item.sourceSender && item.sourceSender !== sourceContact && <><dt>消息发言人</dt><dd>{item.sourceSender}</dd></>}
        {item.sourceChatName && <><dt>来源群聊</dt><dd>{item.sourceChatName}</dd></>}
        {"contactMethod" in item && !!item.contactMethod && <><dt>联系方式</dt><dd>{item.contactMethod}</dd></>}
      </dl>
      {relatedCount > 0 && <button type="button" aria-haspopup="dialog" className="trade-related" onClick={() => onShowMatches(kind, item)}
        aria-label={`查看关联匹配，共 ${relatedCount} 条${isStock ? "需求" : "供应"}`}>
        查看 {relatedCount} 条匹配{isStock ? "需求" : "供应"} <ChevronRight size={15} />
      </button>}
      {excerpt && <section className="trade-evidence" aria-label="消息原文">
        <h4>消息原文</h4><blockquote>{excerpt}</blockquote>
      </section>}
      <ConfigSheet items={specFields} />
      {sourceDetails.length > 0 && <details className="trade-config">
        <summary>采集记录</summary>
        <dl>{sourceDetails.map((field, i) => <div key={i}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
      </details>}
    </aside>
  );
}


const DraftReviewItem: React.FC<{ draft: TradeDraft; onEdit: () => void; onConfirm: () => void }> = ({ draft, onEdit, onConfirm }) => {
  const missing = tradeDraftMissingFields(draft);
  const title = draft.title || draft.gpuModel || "产品待确认";
  const modelAddsDetail = draft.gpuModel?.trim().toLowerCase().split(/\s+/).some(part => !title.toLowerCase().includes(part));
  const specs = [modelAddsDetail && draft.gpuModel, tradeModeText(draft.tradeMode),
    missing.includes("城市") ? "城市待补" : draft.locationCity, missing.includes("型号") && "型号待补"].filter(Boolean).join(" · ");
  const supply = draft.postType === "GOODS";
  const numericPrice = toOptionalNumber(draft.priceAmount);
  const price = numericPrice ? formatMoney(numericPrice) : draft.priceAmount === "0" ? "" : draft.priceAmount;
  return (
    <article className="review-entry" aria-label={title}>
      <div className="review-product">
        <div><span className={supply ? "review-supply" : "review-demand"}>{supply ? "供应" : "需求"}</span><h3>{title}</h3></div>
        <p>{specs}</p>
      </div>
      <div className="review-commercial">
        <strong className={missing.includes("数量") ? "review-missing" : undefined}>{missing.includes("数量") ? "数量待补" : `${draft.quantity} ${draft.quantityUnit}`}</strong>
        <span>{price ? `${supply ? "报价" : "预算"} ${price}` : supply ? "未提供报价" : "未提供预算"}</span>
      </div>
      <div className="review-source">
        <strong className={missing.includes("来源用户") ? "review-missing" : undefined}>{missing.includes("来源用户") ? "来源用户待补" : draft.sourceContact}</strong>
        <span>{draft.sourceChatName || (draft.sourceCaptureId ? "微信消息" : "粘贴录入")}</span>
        <small className="review-time">{tradeTimeCaption(draft, draftChronology(draft).recorded)}</small>
      </div>
      <div className="review-row-actions">
        <button type="button" className="review-link" onClick={onEdit}>核对</button>
        <button type="button" className="review-row-confirm" onClick={onConfirm}>入库</button>
      </div>
    </article>
  );
};

function DraftEditor({ draft, error, onChange, onRemove, onConfirm, onClose }: {
  draft: TradeDraft; error: string;
  onChange: (patch: Partial<TradeDraft>) => void;
  onRemove: () => void; onConfirm: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [removePending, setRemovePending] = useState(false);
  const missing = tradeDraftMissingFields(draft);
  useEffect(() => {
    const surface = dialog.current;
    const trigger = document.activeElement;
    surface?.showModal();
    return () => {
      surface?.close();
      if (!trigger?.isConnected) document.getElementById("review-title")?.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className="draft-editor" aria-labelledby="draft-editor-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="draft-editor-shell">
      <div className="draft-editor-heading">
        <div><h2 id="draft-editor-title">核对记录</h2><p>编辑的字段会自动保存到清单。</p></div>
        <button type="button" className="review-icon-button" aria-label="关闭核对" onClick={onClose}><X size={19} /></button>
      </div>
      <div className="draft-editor-content">
        <section className="draft-original" aria-labelledby="draft-original-label">
          <h3 id="draft-original-label">消息原文</h3>
          {draft.sourceCaptureId && <div className="draft-evidence-meta">
            <strong>{draft.sourceSender || "发言人未识别"}</strong>
            {draft.sourceChatName && <span>{draft.sourceChatName}</span>}
            <span>{wechatTimeLabel(draft.sourceSentAt, draft.sourcePublishedTime, draft.sourceObservedAt)}</span>
            {draft.sourceObservedAt && <span>采集于 {wechatTimestamp(draft.sourceObservedAt)}</span>}
          </div>}
          <blockquote>{draft.rawText || "这条记录未保存原文。"}</blockquote>
        </section>
        <section className="draft-edit-fields" aria-labelledby="draft-fields-label">
          <h3 id="draft-fields-label">供需信息</h3>
          {missing.length > 0 && <p className="draft-edit-missing">待补 · {missing.join("、")}。可先入库。</p>}
          <div className="draft-fields-grid">
            <SelectField label="供需类型" value={draft.postType} options={[{ label: "供应", value: "GOODS" }, { label: "需求", value: "DEMAND" }]}
              onChange={value => onChange({ postType: value as MarketType })} />
            <TextField label="来源用户" value={draft.sourceContact} placeholder="发言人昵称" onChange={value => onChange({ sourceContact: value })} />
            <div className="draft-field-wide"><TextField label="产品标题" value={draft.title} onChange={value => onChange({ title: value })} /></div>
            <TextField label="型号 / 规格" value={draft.gpuModel} onChange={value => onChange({ gpuModel: value })} />
            <TextField label="城市" value={draft.locationCity} onChange={value => onChange({ locationCity: value })} />
            <TextField label="数量" value={draft.quantity} onChange={value => onChange({ quantity: value })} />
            <TextField label="单位" value={draft.quantityUnit} onChange={value => onChange({ quantityUnit: value })} />
            <TextField label={draft.postType === "GOODS" ? "报价" : "预算"} value={draft.priceAmount} onChange={value => onChange({ priceAmount: value })} />
            <SelectField label="交易方式" value={draft.tradeMode} options={tradeModeOptions} onChange={value => onChange({ tradeMode: value as TradeMode })} />
          </div>
          <details className="draft-more">
            <summary>详细配置与联系方式</summary>
            <div className="draft-fields-grid">
              <SelectField label="产品品类" value={draft.productCategory} options={productCategoryOptions} onChange={value => onChange({ productCategory: value as ProductCategory })} />
              {draft.productCategory !== "MEMORY" && <TextField label="卡数" value={draft.gpuCount} onChange={value => onChange({ gpuCount: value })} />}
              <TextField label="联系方式" value={draft.contactMethod} onChange={value => onChange({ contactMethod: value })} />
            </div>
            <ConfigEditor items={draft.configItems} onChange={configItems => onChange({ configItems })} />
          </details>
        </section>
      </div>
      {error && <p role="alert" className="draft-edit-error">{error}</p>}
      <div className="draft-editor-footer">
        {removePending ? <><span>从待入库清单移除这条记录？</span><div>
          <button type="button" className="review-link" onClick={() => setRemovePending(false)}>取消</button>
          <button type="button" className="review-remove" onClick={onRemove}>确认移除</button>
        </div></> : <><button type="button" className="review-link review-subtle" onClick={() => setRemovePending(true)}>移除记录</button>
          <div><button type="button" className="review-link" onClick={onClose}>返回清单</button>
            <button type="button" className="review-primary" onClick={onConfirm}>确认入库</button></div></>}
      </div>
    </div>
  </dialog>;
}

function InlineNotice({ tone, text, onDismiss }: { tone: NoticeTone; text: string; onDismiss: () => void }) {
  const toneClass: Record<NoticeTone, string> = {
    info: "surface-card-quiet text-neutral-600",
    success: "border border-emerald-200/70 bg-emerald-50/90 text-emerald-800",
    warning: "border border-amber-200/70 bg-amber-50/90 text-amber-800",
  };
  return (
    <div role={tone === "warning" ? "alert" : "status"} className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm font-medium ${toneClass[tone]}`}>
      {tone === "success" ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        title="关闭提示"
        aria-label="关闭提示"
        onClick={onDismiss}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-70 transition hover:bg-white/70 hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="caption-text mb-1 block">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="field-surface w-full rounded-md px-3 py-2 text-neutral-900 outline-none placeholder:text-neutral-400"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="caption-text mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field-surface w-full rounded-md px-3 py-2 text-neutral-900 outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  compact = false,
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <label className="block">
      <span className={compact ? "trade-filter-label" : "caption-text mb-1 block"}>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field-surface h-9 w-full rounded-md px-2 font-medium text-neutral-900 outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterPillGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="smart-filter-group">
      <span className="trade-filter-label">{label}</span>
      <div className="smart-filter-pills" role="group" aria-label={label}>
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`smart-filter-pill ${active ? "is-active" : ""}`}
              aria-pressed={active}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilterPanel({
  search,
  action,
  title,
  activeCount,
  resultText,
  isOpen,
  onToggle,
  onReset,
  children,
}: {
  search: React.ReactNode;
  action?: React.ReactNode;
  title: string;
  activeCount: number;
  resultText: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="trade-tools">
      {search}
      <button type="button" onClick={onToggle} className="trade-filter-toggle" aria-expanded={isOpen}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span>{title}</span>
        {activeCount > 0 && <span className="trade-filter-count">{activeCount}</span>}
      </button>
      {action && <div className="trade-tools-action">{action}</div>}
      {isOpen && <div className="trade-filter-body">
        {children}
      </div>}
      {resultText && <div className="trade-tools-summary">
        <span role="status">{resultText}</span>
        {activeCount > 0 && <button type="button" onClick={onReset}>清除搜索和筛选</button>}
      </div>}
    </div>
  );
}

function Pagination({
  total,
  page,
  onPageChange,
}: {
  total: number;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = totalPagesFor(total);
  const currentPage = clampPage(page, totalPages);
  const start = total > 0 ? (currentPage - 1) * LIST_PAGE_SIZE + 1 : 0;
  const end = Math.min(currentPage * LIST_PAGE_SIZE, total);
  const isFirstPage = currentPage <= 1;
  const isLastPage = currentPage >= totalPages;

  function changePage(nextPage: number) {
    onPageChange(clampPage(nextPage, totalPages));
  }

  return (
    <div className="surface-card-quiet flex flex-col gap-3 rounded-md px-3 py-3 text-sm text-neutral-600 sm:flex-row sm:items-center sm:justify-between">
      <span className="font-medium">
        {total > 0 ? `显示 ${start}-${end} 条，共 ${total} 条` : "暂无符合条件的数据"}
        <span className="ml-2 text-xs text-neutral-400">每页 {LIST_PAGE_SIZE} 条</span>
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isFirstPage}
          onClick={() => changePage(1)}
          className="ghost-button rounded-md px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
        >
          首页
        </button>
        <button
          type="button"
          disabled={isFirstPage}
          onClick={() => changePage(currentPage - 1)}
          className="ghost-button rounded-md px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
        >
          上一页
        </button>
        <span className="px-1 text-xs font-semibold text-neutral-500">
          第 {currentPage} / {totalPages} 页
        </span>
        <button
          type="button"
          disabled={isLastPage}
          onClick={() => changePage(currentPage + 1)}
          className="ghost-button rounded-md px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
        >
          下一页
        </button>
        <button
          type="button"
          disabled={isLastPage}
          onClick={() => changePage(totalPages)}
          className="ghost-button rounded-md px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
        >
          末页
        </button>
      </div>
    </div>
  );
}

function EmptyState({ title, description, actionLabel, onAction }: { title: string; description?: string; actionLabel: string; onAction: () => void }) {
  return (
    <section className="trade-empty">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      <button type="button" onClick={onAction}>{actionLabel}<ChevronRight size={15} /></button>
    </section>
  );
}

function InfoDatum({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md bg-neutral-950/[0.035] px-3 py-2">
      <p className="text-[11px] font-medium text-neutral-400">{label}</p>
      <p className={`mt-0.5 truncate text-sm ${strong ? "font-semibold text-neutral-950" : "font-medium text-neutral-700"}`} title={value}>
        {value}
      </p>
    </div>
  );
}

function ConfigEditor({
  items,
  onChange,
}: {
  items: ConfigItem[];
  onChange: (items: ConfigItem[]) => void;
}) {
  function updateConfigItem(index: number, patch: Partial<ConfigItem>) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function removeConfigItem(index: number) {
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className="mt-4 border-t border-neutral-100 pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-neutral-500">详细配置单</p>
        <button
          type="button"
          onClick={() => onChange([...items, { label: "自定义", value: "" }])}
          className="ghost-button inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
        >
          <Plus className="h-3.5 w-3.5" />
          添加配置
        </button>
      </div>
      <div className="hidden grid-cols-[minmax(104px,0.42fr)_minmax(0,1fr)_32px] gap-2 pb-1 text-xs font-medium text-neutral-400 sm:grid">
        <span>配置项</span>
        <span>内容</span>
        <span />
      </div>
      <div className="grid gap-2">
        {items.map((item, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[minmax(104px,0.42fr)_minmax(0,1fr)_32px]">
            <input
              aria-label={`配置项 ${index + 1}`}
              value={item.label}
              placeholder="配置项"
              onChange={(event) => updateConfigItem(index, { label: event.target.value })}
              className="field-surface w-full rounded-md px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
            />
            <input
              aria-label={`${item.label || "配置"} 内容`}
              value={item.value}
              placeholder="内容"
              onChange={(event) => updateConfigItem(index, { value: event.target.value })}
              className="field-surface w-full rounded-md px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
            />
            <button
              type="button"
              title="删除配置项"
              aria-label={`删除配置项 ${item.label || index + 1}`}
              onClick={() => removeConfigItem(index)}
              className="ghost-button flex h-9 w-9 items-center justify-center rounded-md text-neutral-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfigSheet({ items }: { items: ConfigItem[] }) {
  const visibleItems = items.filter((item) => item.value.trim());
  if (!visibleItems.length) return null;

  return (
    <details className="trade-config">
      <summary>详细配置单 <span>{visibleItems.length} 项</span></summary>
      <dl>
        {visibleItems.map((item, index) => (
          <div key={`${item.label}-${index}`}>
            <dt>{item.label}</dt><dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

const Badge: React.FC<{ children: React.ReactNode; tone?: BadgeTone }> = ({ children, tone = "default" }) => {
  const toneClass: Record<BadgeTone, string> = {
    default: "bg-[#f1f1ef] text-neutral-500",
    blue: "bg-sky-50 text-sky-700",
    green: "bg-emerald-50 text-emerald-700",
    orange: "bg-amber-50 text-amber-700",
    red: "bg-rose-50 text-rose-700",
  };
  return <span className={`rounded-[5px] px-1.5 py-0.5 text-xs font-medium ${toneClass[tone]}`}>{children}</span>;
};

async function parseWithAiGateway(text: string, token: string, requestId:string): Promise<{
  items: ParsedTradeItem[];
  isMock: boolean;
  provider: string;
  model?: string;
  fallbackError?: string;
}> {
  const response = await fetch("/api/structure", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, requestId }),
  });
  const payload = (await response.json()) as AiStructureResponse;
  if (!response.ok) throw new Error(payload.error || "AI 解析接口不可用");

  const data = payload.data;
  const items = Array.isArray(data && "items" in data ? data.items : undefined)
    ? ((data as { items: ParsedTradeItem[] }).items ?? [])
    : data
      ? [data as ParsedTradeItem]
      : [];
  return {
    items: items.filter(Boolean),
    isMock: Boolean(payload.isMock),
    provider: payload.provider ?? "unknown",
    model: payload.model,
    fallbackError: payload.isMock && payload.provider === "local-fallback" ? payload.error : undefined,
  };
}

function draftChronology(draft: TradeDraft) {
  if (draft.createdAt || draft.sourceCaptureId) return tradeChronology(draft);
  // Previous paste drafts recorded their creation timestamp only in this ID.
  const legacyMillis = /^draft-(\d{13})-\d+$/.exec(draft.id)?.[1];
  return tradeChronology(legacyMillis ? { ...draft, createdAt: new Date(Number(legacyMillis)).toISOString() } : draft);
}

function createDraftsFromParsedItems(items: ParsedTradeItem[], source: TradeDraft["source"], overrides: EntryOverrides = {}): TradeDraft[] {
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  return items
    .map((item, index) => {
      const rawText = item.rawText || "";
      const category = overrides.productCategory ?? normalizeProductCategoryValue(item.productCategory ?? `${item.title ?? ""} ${item.model ?? ""} ${rawText}`);
      const postType = overrides.postType ?? normalizeMarketType(item.postType ?? rawText);
      const tradeMode = overrides.tradeMode ?? normalizeTradeModeValue(item.tradeMode ?? rawText);
      const model = item.model || item.gpuModel || parseModelText(`${item.title ?? ""} ${rawText}`, category) || "";
      const locationCity = item.locationCity || parseLocationText(rawText);
      const gpuCount = asDisplayText(item.gpuCount) || (category === "SERVER" ? "8" : "");
      const sourceContact = normalizeSourceContact(item.sourceContact, item.configItems, rawText);
      const configItems = normalizeConfigItems(item.configItems, category, {
        gpuModel: model,
        gpuCount,
        condition: item.condition,
        sourceContact,
        rawText,
      });
      const draft: TradeDraft = {
        id: `draft-${now}-${index}`,
        createdAt,
        postType,
        productCategory: category,
        tradeMode,
        title: item.title || buildDraftTitle(postType, category, model, gpuCount, locationCity),
        gpuModel: model,
        gpuCount,
        quantity: asDisplayText(item.quantity),
        quantityUnit: item.quantityUnit || quantityUnitForCategory(category),
        locationCity: locationCity || "待确认",
        priceAmount: asDisplayText(item.priceAmount),
        contactMethod: item.contactMethod || "站内联系",
        sourceContact,
        configItems,
        source,
        rawText,
      };
      return applyDraftPatch(draft, overrides);
    })
    .filter((item) => item.title || item.gpuModel || item.rawText);
}

function createRpaBatchDrafts(messages: WechatRpaMessage[], importedItemKeys: ReadonlySet<string>): TradeDraft[] {
  const seen = new Set(importedItemKeys);
  const drafts: TradeDraft[] = [];
  for (const message of messages) {
    if (!rpaMessageCanBulkImport(message, seen)) continue;
    const next = createRpaMessageDrafts(message, seen);
    for (const draft of next) {
      if (draft.sourceItemKey) seen.add(draft.sourceItemKey);
      drafts.push(draft);
    }
  }
  return drafts;
}

function buildRpaImportSnapshot(current: WorkspaceSnapshot, messages: WechatRpaMessage[], bulkOnly = true): { snapshot: WorkspaceSnapshot; addedCount: number } {
  const seen = new Set([...current.confirmedRpaItemKeys, ...[...current.drafts, ...current.stocks, ...current.market]
    .map((item) => item.sourceItemKey).filter((key): key is string => Boolean(key))]);
  const next: TradeDraft[] = [];
  if (bulkOnly) {
    next.push(...createRpaBatchDrafts(messages, seen));
  } else {
    for (const message of messages) {
      for (const draft of createRpaMessageDrafts(message, seen)) {
        if (draft.sourceItemKey) seen.add(draft.sourceItemKey);
        next.push(draft);
      }
    }
  }
  return { snapshot: { ...current, drafts: [...next, ...current.drafts] }, addedCount: next.length };
}

function createRpaMessageDrafts(message: WechatRpaMessage, importedItemKeys: ReadonlySet<string>): TradeDraft[] {
  const result = rpaMessageResult(message);
  if (message.status !== "READY" || !result?.items?.length) throw new Error("这条消息尚未解析完成，请稍后重试。");
  const seen = new Set(importedItemKeys);
  return result.items.flatMap((item, index) => {
    if (rpaItemIsImported(message, index, seen)) return [];
    const source = rpaItemSource(message, index);
    const draft = createDraftsFromParsedItems([{
      ...item,
      sourceContact: cleanSourceContact(source.sender) || "未知来源",
      rawText: item.rawText || message.text,
    }], "AI")[0];
    if (!draft) return [];
    const provenance: RpaProvenance = {
      sourceCaptureId: source.captureId,
      sourceItemKey: source.key,
      sourceMessageId: source.messageId,
      sourceChatName: message.chatName,
      sourceSender: source.captureMode === "OCR_SNAPSHOT" ? "未识别（截图识别）" : source.sender,
      sourceSentAt: source.sentAt,
      sourcePublishedTime: source.publishedTime,
      sourceCanLookupPublishedTime: source.canLookupPublishedTime,
      sourceObservedAt: source.observedAt,
      sourceCaptureMode: source.captureMode,
    };
    seen.add(source.key);
    return [{
      ...draft,
      ...provenance,
      id: `draft-rpa-${source.captureId}-${source.sourceItemIndex}`,
      configItems: configWithRpaProvenance(draft.configItems, provenance),
    }];
  });
}

function applyDraftPatch(item: TradeDraft, patch: Partial<TradeDraft>): TradeDraft {
  const productCategory = patch.productCategory ?? item.productCategory;
  const categoryChanged = patch.productCategory && patch.productCategory !== item.productCategory;
  const next: TradeDraft = { ...item, ...patch, productCategory };
  if (categoryChanged) {
    next.quantityUnit = quantityUnitForCategory(productCategory);
    next.configItems = normalizeConfigItems(item.configItems, productCategory, {
      gpuModel: next.gpuModel,
      gpuCount: next.gpuCount,
      sourceContact: next.sourceContact,
      rawText: next.rawText,
    });
  }
  if (!next.title.trim()) {
    next.title = buildDraftTitle(next.postType, productCategory, next.gpuModel, next.gpuCount, next.locationCity);
  }
  return next;
}

function materializeConfirmedDrafts(items: TradeDraft[]): { stockItems: StockItem[]; marketItems: MarketPost[] } {
  const stockItems: StockItem[] = [];
  const marketItems: MarketPost[] = [];
  const now = Date.now();

  items.forEach((item, index) => {
    const title = item.title || buildDraftTitle(item.postType, item.productCategory, item.gpuModel, item.gpuCount, item.locationCity);
    const sourceContact = normalizeSourceContact(item.sourceContact, item.configItems, item.rawText);
    const provenance = rpaProvenance(item);
    const sourceTime = item.sourceSentAt || item.sourceObservedAt;
    const recordTime = sourceTime && Number.isFinite(Date.parse(sourceTime)) ? sourceTime : new Date(now + index).toISOString();
    const configItems = configWithRpaProvenance(normalizeConfigItems(item.configItems, item.productCategory, {
      gpuModel: item.gpuModel,
      gpuCount: item.gpuCount,
      sourceContact,
      rawText: item.rawText,
    }), provenance);
    if (item.postType === "DEMAND") {
      marketItems.push({
        ...provenance,
        id: `confirmed:${item.id}`,
        productCategory: item.productCategory,
        tradeMode: item.tradeMode,
        postType: "DEMAND",
        title,
        gpuModel: item.gpuModel || "待确认",
        quantity: toNumber(item.quantity, 0),
        quantityUnit: item.quantityUnit || quantityUnitForCategory(item.productCategory),
        locationCity: item.locationCity || "待确认",
        priceAmount: toOptionalNumber(item.priceAmount),
        contactMethod: item.contactMethod || "站内联系",
        sourceContact,
        configItems,
        publishedAt: recordTime,
      });
      return;
    }

    stockItems.push({
      ...provenance,
      id: `confirmed:${item.id}`,
      productCategory: item.productCategory,
      title,
      gpuModel: item.gpuModel || "待确认",
      gpuCount: toNumber(item.gpuCount, item.productCategory === "SERVER" ? 8 : 0),
      quantity: toNumber(item.quantity, 0),
      quantityUnit: item.quantityUnit || quantityUnitForCategory(item.productCategory),
      locationCity: item.locationCity || "待确认",
      priceAmount: toOptionalNumber(item.priceAmount),
      condition: configValue(item.configItems, "成色") || "待确认",
      availabilityType: tradeModeText(item.tradeMode),
      tradeMode: item.tradeMode,
      sourceContact,
      configItems,
      status: "UNVERIFIED",
      source: item.source,
      createdAt: recordTime,
    });
  });

  return { stockItems, marketItems };
}

function rpaProvenance(item: RpaProvenance): RpaProvenance {
  if (!item.sourceCaptureId) return {};
  return {
    sourceCaptureId: item.sourceCaptureId,
    sourceItemKey: item.sourceItemKey,
    sourceMessageId: item.sourceMessageId,
    sourceChatName: item.sourceChatName,
    sourceSender: item.sourceSender,
    sourceSentAt: item.sourceSentAt,
    sourcePublishedTime: item.sourcePublishedTime,
    sourceCanLookupPublishedTime: item.sourceCanLookupPublishedTime,
    sourceObservedAt: item.sourceObservedAt,
    sourceCaptureMode: item.sourceCaptureMode,
  };
}

function configWithRpaProvenance(items: ConfigItem[], provenance: RpaProvenance): ConfigItem[] {
  if (!provenance.sourceCaptureId) return items;
  const sourceItems = [
    { label: "来源群聊", value: provenance.sourceChatName || "未识别" },
    { label: "原消息发送人", value: provenance.sourceSender || "未识别" },
    { label: "原消息时间", value: wechatTimeLabel(provenance.sourceSentAt, provenance.sourcePublishedTime, provenance.sourceObservedAt) },
    { label: "消息采集时间", value: wechatTimestamp(provenance.sourceObservedAt) },
    { label: "来源消息ID", value: provenance.sourceMessageId || provenance.sourceCaptureId },
    {
      label: "采集方式",
      value: provenance.sourceCaptureMode === "OCR_SNAPSHOT"
        ? "整屏截图识别，发送人未知，数量/价格待核对"
        : provenance.sourceCaptureMode === "OCR_MESSAGE"
          ? "逐条截图识别，群昵称与消息配对待核对，昵称不代表已核实身份"
          : "微信消息读取",
    },
  ];
  const sourceLabels = new Set(sourceItems.map((item) => item.label));
  return [...items.filter((item) => !sourceLabels.has(item.label)), ...sourceItems];
}

function buildDraftTitle(postType: MarketType, category: ProductCategory, model: string, gpuCount: string, city: string): string {
  const verb = postType === "GOODS" ? "出" : "收";
  const place = city && city !== "待确认" ? city : "";
  if (category === "SERVER") return `${verb}${place}${model || "GPU"} ${gpuCount || "8"}卡服务器`.trim();
  return `${verb}${place}${productCategoryText(category)} ${model || "待确认"}`.trim();
}

function countDrafts(items: TradeDraft[]): { goods: number; demands: number; incomplete: number } {
  return items.reduce(
    (summary, item) => ({
      goods: summary.goods + (item.postType === "GOODS" ? 1 : 0),
      demands: summary.demands + (item.postType === "DEMAND" ? 1 : 0),
      incomplete: summary.incomplete + (tradeDraftMissingFields(item).length ? 1 : 0),
    }),
    { goods: 0, demands: 0, incomplete: 0 },
  );
}

function tradeDraftMissingFields(draft: TradeDraft): string[] {
  const fields: string[] = [];
  if (/^(?:未知来源|未知|未识别|发送人未识别|待确认)?$/.test(asDisplayText(draft.sourceContact).trim())) fields.push("来源用户");
  if (/^(?:未知|未识别|待确认)?$/.test(asDisplayText(draft.gpuModel).trim())) fields.push("型号");
  if (!toNumber(draft.quantity, 0)) fields.push("数量");
  if (/^(?:未知|未识别|待确认)?$/.test(asDisplayText(draft.locationCity).trim())) fields.push("城市");
  return fields;
}

function dedupeNewTradeDrafts(incoming: TradeDraft[], existing: TradeDraft[]): TradeDraft[] {
  const seen = new Set(existing.map(tradeDraftIdentity));
  return incoming.filter((item) => {
    const key = tradeDraftIdentity(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tradeDraftIdentity(item: TradeDraft): string {
  return normalizeIdentity(
    [
      item.postType,
      item.productCategory,
      item.tradeMode,
      item.title,
      item.gpuModel,
      item.sourceContact,
      item.quantity,
      item.quantityUnit,
      item.locationCity,
      item.priceAmount,
      item.contactMethod,
    ].join("|"),
  );
}

function configValue(items: ConfigItem[], label: string): string {
  return items.find((item) => item.label === label)?.value.trim() ?? "";
}

function saveResultNoticeText(result: SaveParsedResult): string {
  const createdCount = result.stockCount + result.marketCount;
  if (!createdCount && !result.refreshedCount) return "没有可保存的变化。";
  const createdText = createdCount ? `新增 ${result.stockCount} 条供应、${result.marketCount} 条需求` : "";
  const refreshedText = result.refreshedCount ? `刷新 ${result.refreshedCount} 条重复的最新时间` : "";
  return `${[createdText, refreshedText].filter(Boolean).join("，")}。`;
}

function saveResultChatText(result: SaveParsedResult): string {
  const parts = [`${result.stockCount} 条进入供应`, `${result.marketCount} 条进入需求`];
  if (result.refreshedCount) {
    parts.push(`${result.refreshedCount} 条重复已刷新为最新时间`);
  }
  return `确认完成：${parts.join("，")}。`;
}

function parseAiText(text: string) {
  const productCategory = parseProductCategory(text);
  const gpuModel = parseModelText(text, productCategory);
  const quantityMatch = text.match(/(\d+(?:\.\d+)?)\s*(台|套|块|张|条|根|片)/);
  const quantity = quantityMatch?.[1] ?? "";
  const price = text.match(/价格?\s*(\d+(?:\.\d+)?)\s*(万)?/)?.[1] ?? "";
  const city = text.match(/(深圳|上海|北京|广州|杭州|香港|苏州|成都)/)?.[1] ?? "";
  const gpuCount = text.match(/(\d+)\s*卡/)?.[1] ?? "8";
  const condition = text.includes("全新") ? "全新" : "待确认";
  const sourceContact = parseSourceContactFromText(text) || "未知来源";
  return {
    postType: normalizeMarketType(text),
    productCategory,
    title: buildParsedTitle(productCategory, gpuModel, gpuCount, city),
    gpuModel,
    gpuCount,
    quantity,
    quantityUnit: quantityMatch?.[2] ?? quantityUnitForCategory(productCategory),
    locationCity: city,
    priceAmount: price ? String(Number(price) * 10000) : "",
    condition,
    availabilityType: text.includes("现货") ? "现货" : "待确认",
    tradeMode: parseTradeMode(text),
    contactMethod: "站内联系",
    sourceContact,
    rawText: text,
    configItems: normalizeConfigItems(extractConfigItems(text, productCategory, gpuModel, gpuCount, condition), productCategory, {
      gpuModel,
      gpuCount,
      condition,
      sourceContact,
      rawText: text,
    }),
  };
}

function isMatchCommand(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (!compact || compact.length > 24 || /[:：\n]/.test(text)) return false;
  if (/(^|[，,。；;])(出|收|求购|找货|现货出|高价收)/.test(text)) return false;
  return /^(帮我|请|给我)?(重新|再|开始|触发|执行|生成)?(供需匹配|匹配供需|匹配|找机会|机会匹配)(一下|看看)?$/.test(compact);
}

const tradeModeOptions: Array<{ label: string; value: TradeMode }> = [
  { label: "现货", value: "SPOT" },
  { label: "期货", value: "FUTURES" },
  { label: "租赁", value: "RENTAL" },
];
const saleModeOptions = tradeModeOptions.filter(option => option.value !== "RENTAL");

const productCategoryOptions: Array<{ label: string; value: ProductCategory }> = [
  { label: "服务器", value: "SERVER" },
  { label: "显卡", value: "GPU_CARD" },
  { label: "内存", value: "MEMORY" },
  { label: "硬盘/SSD", value: "STORAGE" },
  { label: "CPU", value: "CPU" },
  { label: "网络设备", value: "NETWORK" },
  { label: "其他配件", value: "OTHER" },
];

const stockSourceOptions: Array<{ label: string; value: StockItem["source"] | "ALL" }> = [
  { label: "全部录入方式", value: "ALL" },
  { label: "AI解析", value: "AI" },
  { label: "手工录入", value: "MANUAL" },
];

const stockPriceOptions: Array<{ label: string; value: PriceFilter }> = [
  { label: "全部价格", value: "ALL" },
  { label: "有价格", value: "HAS_PRICE" },
  { label: "未填价格", value: "NO_PRICE" },
  { label: "1万以下", value: "UNDER_10000" },
  { label: "1-10万", value: "FROM_10000_TO_100000" },
  { label: "10-50万", value: "FROM_100000_TO_500000" },
  { label: "50万以上", value: "OVER_500000" },
];

const matchScoreOptions: Array<{ label: string; value: MatchScoreFilter }> = [
  { label: "全部匹配度", value: "ALL" },
  { label: "强匹配", value: "STRONG" },
  { label: "可跟进", value: "GOOD" },
  { label: "弱匹配", value: "WEAK" },
];

const matchStatusOptions: Array<{ label: string; value: MatchStatusFilter }> = [
  { label: "全部状态", value: "ALL" },
  { label: "新机会", value: "NEW" },
  { label: "已联系", value: "CONTACTED" },
  { label: "已忽略", value: "IGNORED" },
];

const dateFilterOptions: Array<{ label: string; value: DateFilter }> = [
  { label: "全部日期", value: "ALL" },
  { label: "今天", value: "TODAY" },
  { label: "近3天", value: "LAST_3_DAYS" },
  { label: "近7天", value: "LAST_7_DAYS" },
  { label: "近14天", value: "LAST_14_DAYS" },
  { label: "近30天", value: "LAST_30_DAYS" },
];

const modelAliasGroups: Array<{ key: string; aliases: string[] }> = [
  { key: "RTX5090", aliases: ["RTX 5090", "RTX5090", "5090", "5090D", "RTX5090D", "RTX 5090D"] },
  { key: "RTX4090", aliases: ["RTX 4090", "RTX4090", "4090", "4090D", "RTX4090D", "RTX 4090D"] },
  { key: "PRO6000D", aliases: ["RTX PRO 6000D", "RTXPRO6000D", "PRO6000D", "PRO 6000D", "6000D", "显卡6000D"] },
  { key: "PRO6000", aliases: ["RTX PRO 6000", "RTXPRO6000", "PRO6000", "PRO 6000", "PRO 6000 MAX-Q", "PRO6000MAX-Q", "MAX-Q"] },
  { key: "PRO5000", aliases: ["RTX PRO 5000", "RTXPRO5000", "PRO5000", "PRO 5000"] },
  { key: "H100", aliases: ["H100", "H 100"] },
  { key: "H200", aliases: ["H200", "H 200"] },
  { key: "B200", aliases: ["B200", "B 200"] },
  { key: "B300", aliases: ["B300", "B 300"] },
  { key: "GB300", aliases: ["GB300", "GB 300"] },
  { key: "A100", aliases: ["A100", "A 100"] },
  { key: "A800", aliases: ["A800", "A 800"] },
  { key: "L40S", aliases: ["L40S", "L 40S"] },
];

const cityClusterMap: Record<string, string[]> = {
  深圳: ["深圳", "香港", "国内", "大陆"],
  香港: ["香港", "深圳", "国内", "大陆"],
  上海: ["上海", "国内", "大陆"],
  北京: ["北京", "国内", "大陆"],
  广州: ["广州", "深圳", "国内", "大陆"],
  国内: ["国内", "大陆", "深圳", "香港", "上海", "北京", "广州", "杭州", "苏州", "成都"],
  大陆: ["大陆", "国内", "深圳", "上海", "北京", "广州", "杭州", "苏州", "成都"],
};

function generateMatchCandidates(
  stockItems: StockItem[],
  posts: MarketPost[],
  statuses: Record<string, MatchStatus>,
): MatchCandidate[] {
  const availableStocks = dedupeMatchingRecords(
    stockItems.filter((stock) => stock.status !== "EXPIRED" && stock.status !== "SOLD_OUT"),
    stockIdentity,
    (stock) => stock.createdAt,
  );
  const demands = dedupeMatchingRecords(
    posts.filter((post) => post.postType === "DEMAND"),
    marketIdentity,
    (post) => post.publishedAt,
  );
  const stockProfiles = new Map(availableStocks.map((stock) => [stock.id, buildOntologyProfile(stock)]));
  const demandProfiles = new Map(demands.map((demand) => [demand.id, buildOntologyProfile(demand)]));
  const stocksByCategory = availableStocks.reduce((map, stock) => {
    const list = map.get(stock.productCategory) ?? [];
    list.push(stock);
    map.set(stock.productCategory, list);
    return map;
  }, new Map<ProductCategory, StockItem[]>());

  const candidates: MatchCandidate[] = [];
  demands.forEach((demand) => {
    const demandProfile = demandProfiles.get(demand.id);
    if (!demandProfile) return;
    const scopedStocks = stocksByCategory.get(demand.productCategory) ?? [];
    const scoredForDemand = scopedStocks
      .filter((stock) => !isSameKnownSourceContact(demand.sourceContact, stock.sourceContact))
      .map((stock) => {
        const stockProfile = stockProfiles.get(stock.id);
        if (!stockProfile) return null;
        return scoreSupplyDemandMatch(demand, stock, demandProfile, stockProfile, statuses);
      })
      .filter((candidate): candidate is MatchCandidate => Boolean(candidate))
      .sort((left, right) => right.scoreTotal - left.scoreTotal)
      .slice(0, 8);
    candidates.push(...scoredForDemand);
  });

  return dedupeMatchCandidates(candidates)
    .sort((left, right) => compareMatchCandidate(right, left))
    .slice(0, 3000);
}

function scoreSupplyDemandMatch(
  demand: MarketPost,
  stock: StockItem,
  demandProfile: OntologyProfile,
  stockProfile: OntologyProfile,
  statuses: Record<string, MatchStatus>,
): MatchCandidate | null {
  if (demand.productCategory !== stock.productCategory) return null;
  if ((demand.tradeMode === "RENTAL") !== (stock.tradeMode === "RENTAL")) return null;
  if (isSameKnownSourceContact(demand.sourceContact, stock.sourceContact)) return null;
  const scoreDetail: MatchScoreDetail[] = [];
  const reasons: string[] = [];
  const riskNotes: string[] = [];
  let scoreTotal = 0;

  function add(label: string, score: number, max: number, note: string) {
    const normalizedScore = Math.max(0, Math.min(max, Math.round(score)));
    scoreTotal += normalizedScore;
    scoreDetail.push({ label, score: normalizedScore, max, note });
  }

  add("品类", 15, 15, `${productCategoryText(demand.productCategory)} 对 ${productCategoryText(stock.productCategory)}`);
  reasons.push(`品类一致：${productCategoryText(demand.productCategory)}`);

  const modelScore = modelMatchScore(demandProfile, stockProfile);
  add("型号", modelScore.score, 30, modelScore.note);
  if (modelScore.score >= 24) reasons.push(modelScore.reason);
  if (modelScore.score > 0 && modelScore.score < 24) riskNotes.push(modelScore.note);

  const specScore = specMatchScore(demandProfile, stockProfile, demand.productCategory);
  add("规格", specScore.score, 15, specScore.note);
  if (specScore.matched.length) reasons.push(`规格命中：${specScore.matched.join("、")}`);
  if (specScore.missing.length) riskNotes.push(`规格需确认：${specScore.missing.join("、")}`);

  const tradeScore = tradeModeMatchScore(demand.tradeMode, stock.tradeMode);
  add("交易", tradeScore.score, 10, tradeScore.note);
  if (tradeScore.score >= 8) reasons.push(tradeScore.reason);
  if (tradeScore.risk) riskNotes.push(tradeScore.risk);

  const cityScore = cityMatchScore(demand.locationCity, stock.locationCity);
  add("城市", cityScore.score, 10, cityScore.note);
  if (cityScore.score >= 7) reasons.push(cityScore.reason);
  if (cityScore.risk) riskNotes.push(cityScore.risk);

  const quantityScore = quantityMatchScore(demand, stock);
  add("数量", quantityScore.score, 10, quantityScore.note);
  if (quantityScore.score >= 8) reasons.push(quantityScore.reason);
  if (quantityScore.risk) riskNotes.push(quantityScore.risk);

  const priceScore = demand.tradeMode === "RENTAL"
    ? { score: 0, note: "请核对租金单位和计费周期", reason: "", risk: "租金计费口径待核对" }
    : priceMatchScore(demand.priceAmount, stock.priceAmount);
  add("价格", priceScore.score, 5, priceScore.note);
  if (priceScore.score >= 5) reasons.push(priceScore.reason);
  if (priceScore.risk) riskNotes.push(priceScore.risk);

  const sourceTimeScore = sourceTimeMatchScore(matchSourceMessageTime(demand), matchSourceMessageTime(stock));
  add("时间", sourceTimeScore.score, 5, sourceTimeScore.note);
  if (sourceTimeScore.score >= 4) reasons.push(sourceTimeScore.reason);
  if (sourceTimeScore.risk) riskNotes.push(sourceTimeScore.risk);

  const finalScore = Math.min(100, sourceTimeScore.scoreCap, Math.round(scoreTotal));
  if (finalScore < 58) return null;
  const id = matchCandidateId(demand, stock);
  return {
    id,
    demand,
    stock,
    scoreTotal: finalScore,
    level: matchLevel(finalScore),
    scoreDetail,
    reasons: uniqueReasons(reasons).slice(0, 6),
    riskNotes: uniqueReasons(riskNotes).slice(0, 5),
    status: statuses[id] ?? "NEW",
    updatedAt: latestIsoTime(demand.publishedAt, stock.createdAt),
  };
}

function buildOntologyProfile(item: StockItem | MarketPost): OntologyProfile {
  const category = item.productCategory;
  const text = category === "MEMORY" ? [
    item.title,
    item.gpuModel,
    ...item.configItems
      .filter(({ label }) => !isSourceContactLabel(label) && !/^(来源群聊|原消息发送人|原消息时间|消息采集时间|来源消息ID|采集方式)$/.test(label))
      .map(({ value }) => value),
  ].join(" ") : [
    item.title,
    item.gpuModel,
    item.locationCity,
    item.sourceContact,
    item.tradeMode,
    ...item.configItems.flatMap((config) => [config.label, config.value]),
  ].join(" ");
  const canonicalText = normalizeHardwareText(text);
  const specs = extractOntologySpecs(text, category);
  return {
    category,
    text,
    canonicalText,
    modelKey: resolveModelKey(canonicalText, specs, category),
    tokens: hardwareTokens(canonicalText),
    specs,
  };
}

function normalizeHardwareText(value: string): string {
  return value
    .toUpperCase()
    .replace(/海力士|SK HYNIX|SK海力士/g, "SK")
    .replace(/美光|MICRON/g, "MICRON")
    .replace(/三星|SAMSUNG/g, "SAMSUNG")
    .replace(/希捷|SEAGATE/g, "SEAGATE")
    .replace(/西数|WESTERN DIGITAL|WD/g, "WD")
    .replace(/英伟达|NVIDIA/g, "NVIDIA")
    .replace(/涡轮卡/g, "TURBO")
    .replace(/风扇卡/g, "FAN")
    .replace(/服务器版/g, "SERVER")
    .replace(/工作站版/g, "WORKSTATION")
    .replace(/拆新/g, "OPEN_BOX")
    .replace(/\s+/g, " ")
    .trim();
}

function hardwareTokens(value: string): string[] {
  const matches = value.match(/[A-Z]+\d+[A-Z-]*|\d+(?:\.\d+)?(?:TB|T|GB|G)?|\d{4,5}[A-Z+]?|[A-Z]{2,}|\p{Script=Han}{2,}/gu) ?? [];
  const ignored = new Set(["SPOT", "FUTURES", "RENTAL", "SERVER", "OPEN_BOX", "NVIDIA"]);
  return Array.from(new Set(matches.map((token) => token.replace(/\s+/g, "")).filter((token) => token.length > 1 && !ignored.has(token))));
}

function resolveModelKey(text: string, specs: Record<string, string>, category: ProductCategory): string {
  if (category === "MEMORY") {
    return specs.capacity && specs.frequency ? `${specs.capacity}-${specs.frequency}` : "";
  }
  for (const group of modelAliasGroups) {
    if (group.aliases.some((alias) => text.includes(normalizeHardwareText(alias).replace(/\s+/g, "")) || text.includes(normalizeHardwareText(alias)))) {
      return group.key;
    }
  }
  if (category === "STORAGE") {
    return specs.model || [specs.capacity, specs.interface].filter(Boolean).join("-");
  }
  if (category === "CPU") return specs.model;
  if (category === "NETWORK") return specs.model || specs.speed;
  return specs.model;
}

function extractOntologySpecs(rawText: string, category: ProductCategory): Record<string, string> {
  const text = normalizeHardwareText(rawText);
  const specs: Record<string, string> = {};
  const memoryBrandUnclear = category === "MEMORY" && /白牌|颗粒/.test(rawText);
  const brand = memoryBrandUnclear ? "" : captureBrand(rawText) || (category === "MEMORY" && /(?<![A-Z])SK(?![A-Z])/i.test(rawText) ? "SK" : "");
  if (brand) specs.brand = normalizeHardwareText(brand).replace(/\s+/g, "");
  const compactMemory = category === "MEMORY" ? readCompactMemorySpec(text) : null;
  const capacity = compactMemory?.capacity ?? text.match(/\b\d+(?:\.\d+)?\s*(?:TB|T|GB|G)\b/)?.[0]?.replace(/\s+/g, "");
  const frequency = category === "MEMORY" ? readMemoryFrequency(text) : "";
  const gpuCount = text.match(/\b(\d+)\s*卡\b/)?.[1] ?? text.match(/\b(\d+)\s*GPU\b/)?.[1];
  const storageModel = text.match(/(?:PM9D3A|PM9A3|PM893|PM983A?|PM1743|P5510|P5500|P5520|P5600|P5620|PS1010|S4520|J5300|H5100|R6100|ES3500P|ST\d{8,}[A-Z]*|WUH[A-Z0-9]+|WUS[A-Z0-9]+|MG\d+[A-Z0-9]+)/i)?.[0]?.toUpperCase();
  const cpuModel = text.match(/(?:XEON\s*)?(?:\d{4,5}[A-Z+]?|E-\d{4,5}|E5-\d{4}|W[579]-\d{4,5}X?|EPYC\s*\d{4,5}[A-Z]?)/i)?.[0]?.replace(/\s+/g, "").toUpperCase();

  if (capacity) specs.capacity = category === "MEMORY" ? capacity.replace(/B$/, "") : capacity;
  if (frequency) specs.frequency = frequency;
  if (gpuCount) specs.gpuCount = gpuCount;
  if (/FAN/.test(text)) specs.variant = "FAN";
  if (/TURBO/.test(text)) specs.variant = "TURBO";
  if (/PCB/.test(text)) specs.variant = "PCB";
  if (/MAX-Q|MAXQ/.test(text)) specs.formFactor = "MAX-Q";
  if (/U\.?2/.test(text)) specs.interface = "U.2";
  if (/E1\.?S/.test(text)) specs.interface = "E1.S";
  if (/M\.?2/.test(text)) specs.interface = "M.2";
  if (/SATA/.test(text)) specs.interface = "SATA";
  if (/SAS/.test(text)) specs.interface = "SAS";
  if (/NVME/.test(text)) specs.protocol = "NVME";
  if (/DDR5/.test(text)) specs.memoryGen = "DDR5";
  if (/DDR4/.test(text)) specs.memoryGen = "DDR4";
  if (category === "STORAGE" && storageModel) specs.model = storageModel;
  if (category === "CPU" && cpuModel) specs.model = cpuModel;
  if (category === "NETWORK") {
    specs.speed = text.match(/\b\d+\s*G\b/)?.[0]?.replace(/\s+/g, "") ?? "";
    specs.model = text.match(/(?:CONNECTX-\d|CX\d|Q3400)[A-Z0-9-]*/i)?.[0]?.toUpperCase() ?? "";
  }
  return specs;
}

function modelMatchScore(
  demandProfile: OntologyProfile,
  stockProfile: OntologyProfile,
): { score: number; note: string; reason: string } {
  if (demandProfile.modelKey && stockProfile.modelKey && demandProfile.modelKey === stockProfile.modelKey) {
    if (demandProfile.category === "MEMORY") {
      return { score: 30, note: `容量和频率一致：${demandProfile.modelKey}`, reason: `内存容量和频率一致：${demandProfile.modelKey}` };
    }
    return { score: 30, note: `本体型号一致：${demandProfile.modelKey}`, reason: `型号一致：${demandProfile.modelKey}` };
  }
  const overlap = tokenOverlap(demandProfile.tokens, stockProfile.tokens);
  if (overlap.count >= 2) {
    const score = Math.min(24, 10 + overlap.count * 5);
    return { score, note: `关键词部分重合：${overlap.tokens.join("、")}`, reason: `型号关键词重合：${overlap.tokens.join("、")}` };
  }
  if (overlap.count === 1) {
    return { score: 10, note: `仅命中一个型号关键词：${overlap.tokens[0]}`, reason: `型号关键词命中：${overlap.tokens[0]}` };
  }
  return { score: 0, note: "型号未命中，需要人工判断是否可替代", reason: "型号待确认" };
}

function specMatchScore(
  demandProfile: OntologyProfile,
  stockProfile: OntologyProfile,
  category: ProductCategory,
): { score: number; note: string; matched: string[]; missing: string[] } {
  const weightedKeys: Record<ProductCategory, Array<{ key: string; label: string; weight: number }>> = {
    SERVER: [
      { key: "gpuCount", label: "GPU数量", weight: 6 },
      { key: "capacity", label: "容量", weight: 3 },
      { key: "interface", label: "接口", weight: 3 },
      { key: "brand", label: "品牌", weight: 3 },
    ],
    GPU_CARD: [
      { key: "variant", label: "形态", weight: 6 },
      { key: "capacity", label: "显存", weight: 4 },
      { key: "formFactor", label: "版本", weight: 3 },
      { key: "brand", label: "品牌", weight: 2 },
    ],
    MEMORY: [
      { key: "capacity", label: "容量", weight: 6 },
      { key: "frequency", label: "频率", weight: 5 },
      { key: "memoryGen", label: "代际", weight: 2 },
      { key: "brand", label: "品牌", weight: 2 },
    ],
    STORAGE: [
      { key: "capacity", label: "容量", weight: 5 },
      { key: "interface", label: "接口", weight: 4 },
      { key: "protocol", label: "协议", weight: 3 },
      { key: "brand", label: "品牌", weight: 3 },
    ],
    CPU: [
      { key: "model", label: "型号", weight: 10 },
      { key: "brand", label: "品牌", weight: 5 },
    ],
    NETWORK: [
      { key: "speed", label: "速率", weight: 6 },
      { key: "model", label: "型号", weight: 6 },
      { key: "brand", label: "品牌", weight: 3 },
    ],
    OTHER: [
      { key: "model", label: "型号", weight: 8 },
      { key: "brand", label: "品牌", weight: 4 },
      { key: "capacity", label: "规格", weight: 3 },
    ],
  };
  const matched: string[] = [];
  const missing: string[] = [];
  let score = 0;

  weightedKeys[category].forEach((item) => {
    const demandValue = demandProfile.specs[item.key];
    const stockValue = stockProfile.specs[item.key];
    if (!demandValue || !stockValue) {
      if (demandValue || stockValue) missing.push(item.label);
      return;
    }
    if (demandValue === stockValue) {
      score += item.weight;
      matched.push(`${item.label}${demandValue}`);
      return;
    }
    if (item.key === "brand" && category !== "MEMORY" && /SAMSUNG|SK/.test(`${demandValue}${stockValue}`)) {
      score += Math.floor(item.weight / 2);
      missing.push(`品牌可替代`);
    } else {
      missing.push(`${item.label}不一致`);
    }
  });

  const note = matched.length ? `已命中 ${matched.join("、")}` : "规格信息不足，按弱匹配处理";
  return { score: Math.min(15, score), note, matched, missing };
}

function tradeModeMatchScore(
  demandMode: TradeMode,
  stockMode: TradeMode,
): { score: number; note: string; reason: string; risk?: string } {
  if (demandMode === stockMode) {
    return { score: 10, note: `交易大类一致：${tradeModeText(demandMode)}`, reason: `${tradeModeText(demandMode)}对${tradeModeText(stockMode)}` };
  }
  if (demandMode === "FUTURES" && stockMode === "SPOT") {
    return { score: 8, note: "现货通常可以覆盖期货需求", reason: "现货可优先满足期货需求" };
  }
  if (demandMode === "SPOT" && stockMode === "FUTURES") {
    return { score: 3, note: "需求要现货，供应为期货", reason: "交期需确认", risk: "现货需求遇到期货供应，需确认交付时间" };
  }
  return { score: 0, note: `${tradeModeText(demandMode)} 与 ${tradeModeText(stockMode)} 不一致`, reason: "交易大类不一致", risk: "租赁、现货、期货之间不能默认互相替代" };
}

function cityMatchScore(
  demandCity: string,
  stockCity: string,
): { score: number; note: string; reason: string; risk?: string } {
  const demand = cleanCity(demandCity);
  const stock = cleanCity(stockCity);
  if (!demand || demand === "待确认" || !stock || stock === "待确认") {
    return { score: 4, note: "城市信息不完整", reason: "城市待确认", risk: "交付城市缺失，需要确认物流或面交位置" };
  }
  if (demand === stock) return { score: 10, note: `城市一致：${stock}`, reason: `同城交付：${stock}` };
  if ((cityClusterMap[demand] ?? []).includes(stock) || (cityClusterMap[stock] ?? []).includes(demand)) {
    return { score: 7, note: `${demand} 与 ${stock} 属于常见可交付范围`, reason: `交付城市接近：${demand}/${stock}` };
  }
  return { score: 2, note: `${demand} 与 ${stock} 跨城`, reason: "跨城可聊", risk: `城市不一致：需求 ${demand}，供应 ${stock}` };
}

function quantityMatchScore(
  demand: MarketPost,
  stock: StockItem,
): { score: number; note: string; reason: string; risk?: string } {
  if (!demand.quantity || !stock.quantity) {
    return { score: 4, note: "需求或供应数量缺失", reason: "数量待确认", risk: "数量不完整，可能无法判断是否满足" };
  }
  if (stock.quantity >= demand.quantity) {
    return { score: 10, note: `供应 ${quantityText(stock.quantity, stock.quantityUnit)} 覆盖需求 ${quantityText(demand.quantity, demand.quantityUnit)}`, reason: "数量可覆盖" };
  }
  const ratio = stock.quantity / demand.quantity;
  const score = ratio >= 0.5 ? 6 : 3;
  return {
    score,
    note: `供应 ${quantityText(stock.quantity, stock.quantityUnit)}，需求 ${quantityText(demand.quantity, demand.quantityUnit)}`,
    reason: "可部分满足",
    risk: "供应数量不足，可能需要拼单或补货",
  };
}

function priceMatchScore(
  demandPrice?: number,
  stockPrice?: number,
): { score: number; note: string; reason: string; risk?: string } {
  if (!demandPrice || !stockPrice) {
    return { score: 2, note: "价格或预算缺失", reason: "价格待确认", risk: "价格缺失，联系前需要补问" };
  }
  if (stockPrice <= demandPrice) {
    return { score: 5, note: `供应报价 ${formatMoney(stockPrice)} 不高于预算 ${formatMoney(demandPrice)}`, reason: "价格在预算内" };
  }
  const overRatio = stockPrice / demandPrice;
  if (overRatio <= 1.1) {
    return { score: 3, note: "报价略高于预算", reason: "价格接近", risk: "报价略超预算，可以议价" };
  }
  return { score: 0, note: "报价明显高于预算", reason: "价格偏高", risk: "报价明显超预算" };
}

function sourceTimeMatchScore(
  demandAt: string,
  stockAt: string,
): { score: number; note: string; reason: string; risk?: string; scoreCap: number } {
  const demandTime = createdTimeValue(demandAt);
  const stockTime = createdTimeValue(stockAt);
  if (!demandTime || !stockTime) {
    return {
      score: 2,
      note: "需求或供应时间缺失",
      reason: "时间待确认",
      risk: "来源时间缺失，需确认这条供需是否仍然有效",
      scoreCap: 82,
    };
  }

  const gapHours = Math.abs(demandTime - stockTime) / 36e5;
  const latestAgeHours = Math.max(0, (Date.now() - Math.max(demandTime, stockTime)) / 36e5);
  const staleCap = latestAgeHours > 24 * 30 ? 62 : latestAgeHours > 24 * 14 ? 78 : 100;
  const staleRisk = latestAgeHours > 24 * 14 ? "供需记录整体较旧，需要确认是否仍有效" : "";

  if (gapHours <= 24) {
    return {
      score: 5,
      note: `供需时间接近：相隔 ${formatTimeGap(gapHours)}`,
      reason: "供需发布时间接近",
      risk: staleRisk || undefined,
      scoreCap: staleCap,
    };
  }
  if (gapHours <= 24 * 3) {
    return {
      score: 4,
      note: `供需相隔 ${formatTimeGap(gapHours)}，仍在有效窗口内`,
      reason: "供需时间在 3 天内",
      risk: staleRisk || undefined,
      scoreCap: Math.min(94, staleCap),
    };
  }
  if (gapHours <= 24 * 7) {
    return {
      score: 2,
      note: `供需相隔 ${formatTimeGap(gapHours)}，时效一般`,
      reason: "供需时间偏远",
      risk: staleRisk || "供需时间超过 3 天，联系前需要确认是否还有货/还在收",
      scoreCap: Math.min(82, staleCap),
    };
  }
  if (gapHours <= 24 * 14) {
    return {
      score: 1,
      note: `供需相隔 ${formatTimeGap(gapHours)}，时效偏低`,
      reason: "供需时间较远",
      risk: staleRisk || "供需时间超过 7 天，匹配可信度较低",
      scoreCap: Math.min(72, staleCap),
    };
  }
  return {
    score: 0,
    note: `供需相隔 ${formatTimeGap(gapHours)}，不建议优先跟进`,
    reason: "供需时间过久",
    risk: "供需时间超过 14 天，除非人工确认，否则不建议作为有效机会",
    scoreCap: Math.min(60, staleCap),
  };
}

function matchSourceMessageTime(item: StockItem | MarketPost): string {
  if (item.sourceCaptureId) return item.sourceSentAt || "";
  return "createdAt" in item ? item.createdAt : item.publishedAt;
}

function tokenOverlap(left: string[], right: string[]): { count: number; tokens: string[] } {
  const rightSet = new Set(right);
  const tokens = left.filter((token) => rightSet.has(token));
  return { count: tokens.length, tokens };
}

function dedupeMatchingRecords<T>(
  items: T[],
  identity: (item: T) => string,
  timeValue: (item: T) => string,
): T[] {
  const latestByIdentity = new Map<string, T>();
  items.forEach((item) => {
    const key = identity(item);
    const existing = latestByIdentity.get(key);
    if (!existing || createdTimeValue(timeValue(item)) >= createdTimeValue(timeValue(existing))) {
      latestByIdentity.set(key, item);
    }
  });
  return Array.from(latestByIdentity.values());
}

function dedupeMatchCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
  const bestById = new Map<string, MatchCandidate>();
  candidates.forEach((candidate) => {
    const existing = bestById.get(candidate.id);
    if (!existing || compareMatchCandidate(candidate, existing) > 0) {
      bestById.set(candidate.id, candidate);
    }
  });
  return Array.from(bestById.values());
}

function scopeMatchesForView(candidates: MatchCandidate[], view: MatchView): MatchCandidate[] {
  if (view === "DEMAND_TO_SUPPLY") return topMatchesByGroup(candidates, (candidate) => marketIdentity(candidate.demand), 8);
  if (view === "SUPPLY_TO_DEMAND") return topMatchesByGroup(candidates, (candidate) => stockIdentity(candidate.stock), 8);
  return candidates;
}

function topMatchesByGroup(
  candidates: MatchCandidate[],
  groupKey: (candidate: MatchCandidate) => string,
  limit: number,
): MatchCandidate[] {
  const grouped = new Map<string, MatchCandidate[]>();
  candidates.forEach((candidate) => {
    const key = groupKey(candidate);
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  });
  return Array.from(grouped.values()).flatMap((items) =>
    items.sort((left, right) => compareMatchCandidate(right, left)).slice(0, limit),
  );
}

function sortMatchesForView(candidates: MatchCandidate[], view: MatchView): MatchCandidate[] {
  const dated = candidates.map(candidate => {
    const stock = tradeChronology(candidate.stock), demand = tradeChronology(candidate.demand);
    const chronology = view === "SUPPLY_TO_DEMAND" ? demand : view === "DEMAND_TO_SUPPLY" ? stock
      : compareChronology(stock, demand) <= 0 ? stock : demand;
    return { candidate, chronology };
  });
  return dated.sort((a, b) => compareChronology(a.chronology, b.chronology) || b.candidate.scoreTotal - a.candidate.scoreTotal)
    .map(entry => entry.candidate);
}

function compareMatchCandidate(left: MatchCandidate, right: MatchCandidate): number {
  const timeDelta = matchSourceTimeValue(left) - matchSourceTimeValue(right);
  if (timeDelta !== 0) return timeDelta;
  if (left.scoreTotal !== right.scoreTotal) return left.scoreTotal - right.scoreTotal;
  return createdTimeValue(left.updatedAt) - createdTimeValue(right.updatedAt);
}

function matchSourceTimeValue(candidate: MatchCandidate): number {
  return Math.max(
    createdTimeValue(candidate.demand.publishedAt),
    createdTimeValue(candidate.stock.createdAt),
    createdTimeValue(candidate.updatedAt),
  );
}

function matchCandidateId(demand: MarketPost, stock: StockItem): string {
  return `match:${marketIdentity(demand)}:${stockIdentity(stock)}`;
}

function matchLevel(score: number): MatchScoreLevel {
  if (score >= 90) return "STRONG";
  if (score >= 75) return "GOOD";
  return "WEAK";
}

function matchLevelText(level: MatchScoreLevel): string {
  const map: Record<MatchScoreLevel, string> = {
    STRONG: "强匹配",
    GOOD: "可跟进",
    WEAK: "弱匹配",
  };
  return map[level];
}


function matchStatusText(status: MatchStatus): string {
  const map: Record<MatchStatus, string> = {
    NEW: "新机会",
    CONTACTED: "已联系",
    IGNORED: "已忽略",
  };
  return map[status];
}


function buildMatchSummary(candidate: MatchCandidate): string {
  return [
    `匹配度 ${candidate.scoreTotal}（${matchLevelText(candidate.level)}）`,
    `需求：${candidate.demand.title}，${quantityText(candidate.demand.quantity, candidate.demand.quantityUnit)}，${candidate.demand.locationCity || "城市待确认"}，来源 ${candidate.demand.sourceContact || "未知"}`,
    `供应：${candidate.stock.title}，${quantityText(candidate.stock.quantity, candidate.stock.quantityUnit)}，${candidate.stock.locationCity || "城市待确认"}，来源 ${candidate.stock.sourceContact || "未知"}`,
    `原因：${candidate.reasons.join("；") || "暂无"}`,
    candidate.riskNotes.length ? `需确认：${candidate.riskNotes.join("；")}` : "需确认：暂无明显风险",
  ].join("\n");
}

function latestIsoTime(left: string, right: string): string {
  return new Date(Math.max(createdTimeValue(left), createdTimeValue(right))).toISOString();
}

function uniqueReasons(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function cleanCity(value: string): string {
  return value.replace(/市$/, "").trim();
}

function isSameKnownSourceContact(left: string, right: string): boolean {
  const normalizedLeft = normalizeSourceContactForMatch(left);
  const normalizedRight = normalizeSourceContactForMatch(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function normalizeSourceContactForMatch(value: string): string {
  const normalized = cleanSourceContact(value)
    .replace(/\s+/g, "")
    .replace(/[()（）【】\[\]<>《》]/g, "")
    .toLowerCase();
  if (!normalized || normalized === "未知来源" || normalized === "待确认") return "";
  return normalized;
}

function matchStatusStorageKey(session: AuthSession | null): string {
  return `${MATCH_STATUS_STORAGE_PREFIX}:${workspaceCacheId(session) || "guest"}`;
}

function loadMatchStatuses(session: AuthSession | null): Record<string, MatchStatus> {
  return load<Record<string, MatchStatus>>(matchStatusStorageKey(session), {});
}

function saveMatchStatuses(session: AuthSession | null, statuses: Record<string, MatchStatus>): void {
  if (!session) return;
  localStorage.setItem(matchStatusStorageKey(session), JSON.stringify(statuses));
}

function defaultConfig(category: ProductCategory): ConfigItem[] {
  const labels: Record<ProductCategory, string[]> = {
    SERVER: ["品牌", "整机型号", "GPU", "GPU数量", "CPU", "内存", "硬盘", "网络", "电源", "质保"],
    GPU_CARD: ["品牌", "型号", "显存", "接口", "成色", "质保"],
    MEMORY: ["品牌", "容量", "类型", "频率", "ECC", "成色"],
    STORAGE: ["品牌", "型号", "容量", "接口", "形态", "成色", "质保"],
    CPU: ["品牌", "型号", "代际", "成色", "质保"],
    NETWORK: ["品牌", "型号", "速率", "接口", "成色", "质保"],
    OTHER: ["品牌", "型号", "规格", "成色", "质保"],
  };
  return labels[category].map((label) => ({ label, value: "" }));
}

function extractConfigItems(
  text: string,
  category: ProductCategory,
  gpuModel: string,
  gpuCount: string,
  condition: string,
): ConfigItem[] {
  const values: Record<string, string> = {};
  const brand = captureBrand(text);

  if (brand) values["品牌"] = brand;
  if (category === "SERVER") {
    values["GPU"] = gpuModel;
    values["GPU数量"] = gpuCount ? `${gpuCount}卡` : "";
    values["整机型号"] = captureAfter(text, ["整机型号", "服务器型号"]) || captureModelFamily(text);
    values["CPU"] = captureAfter(text, ["CPU", "处理器"]);
    values["内存"] = captureAfter(text, ["内存", "RAM"]) || captureFirst(text, /\d+\s*(?:TB|T|GB|G)\s*(?:DDR[45])?(?:\s*ECC)?/i);
    values["硬盘"] = captureAfter(text, ["硬盘", "存储", "SSD", "NVMe"]);
    values["网络"] = captureAfter(text, ["网络", "网卡"]) || captureFirst(text, /\d+\s*G\s*(?:IB|以太网|网卡)?/i);
    values["电源"] = captureAfter(text, ["电源"]);
    values["质保"] = captureAfter(text, ["质保", "保修"]);
  }

  if (category === "GPU_CARD") {
    values["型号"] = gpuModel;
    values["显存"] = captureAfter(text, ["显存", "内存"]) || captureFirst(text, /\d+\s*(?:GB|G)\s*(?:GDDR\d|HBM\d?)?/i);
    values["接口"] = captureFirst(text, /\b(?:PCIe|PCIE|SXM|NVL)\b/i);
    values["成色"] = condition === "待确认" ? "" : condition;
    values["质保"] = captureAfter(text, ["质保", "保修"]);
  }

  if (category === "MEMORY") {
    values["容量"] = captureAfter(text, ["容量"]) || captureFirst(text, /\d+\s*(?:GB|G|TB|T)/i);
    values["类型"] = captureAfter(text, ["类型"]) || captureFirst(text, /DDR[45]\s*(?:RDIMM|LRDIMM|DIMM|ECC|REG)?/i);
    values["频率"] = readMemoryFrequency(text);
    values["ECC"] = /ECC|RDIMM|LRDIMM|REG/i.test(text) ? "ECC/REG" : "";
    values["成色"] = condition === "待确认" ? "" : condition;
  }

  if (category === "STORAGE") {
    values["型号"] = captureFirst(text, /(?:PM9D3A|PM9A3|PM893|PM983A?|PM1743|P5510|P5500|P5520|P5600|P5620|PS1010|S4520|J5300|H5100|R6100|ES3500P|ST\d{8,}[A-Z]*|WD[A-Z0-9-]+|WUH[A-Z0-9]+|WUS[A-Z0-9]+|MG\d+[A-Z0-9]+)[A-Z0-9-]*/i);
    values["容量"] = captureFirst(text, /\d+(?:\.\d+)?\s*(?:TB|T|GB|G)/i);
    values["接口"] = captureFirst(text, /NVMe|SATA|SAS|U\.?2|E1\.?S|M\.?2|GEN[45]|PCIe\s?[45]/i);
    values["成色"] = condition === "待确认" ? "" : condition;
  }

  if (category === "CPU") {
    values["品牌"] = /AMD|EPYC/i.test(text) ? "AMD" : /Intel|英特尔|Xeon|至强/i.test(text) ? "Intel" : values["品牌"] ?? "";
    values["型号"] = captureFirst(text, /(?:Xeon\s*)?(?:\d{4,5}[A-Z+]?|E-\d{4,5}|E5-\d{4}|W[579]-\d{4,5}X?|EPYC\s*\d{4,5}[A-Z]?)/i);
    values["成色"] = condition === "待确认" ? "" : condition;
  }

  if (category === "NETWORK") {
    values["型号"] = captureFirst(text, /(?:ConnectX-\d|CX\d|Mellanox|迈络思|Q3400)[A-Z0-9 -]*/i);
    values["速率"] = captureFirst(text, /\d+\s*G/i);
    values["接口"] = captureFirst(text, /IB|以太网|Ethernet|PCIe/i);
    values["成色"] = condition === "待确认" ? "" : condition;
  }

  return defaultConfig(category).map((item) => ({ ...item, value: values[item.label] ?? "" }));
}

function normalizeConfigItems(
  items: unknown,
  category: ProductCategory,
  seed: { gpuModel?: unknown; gpuCount?: unknown; condition?: unknown; sourceContact?: unknown; rawText?: unknown } = {},
): ConfigItem[] {
  const rawItems = Array.isArray(items)
    ? items
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const record = item as Record<string, unknown>;
          const label = asDisplayText(record.label);
          if (!label) return null;
          return { label, value: asDisplayText(record.value) };
        })
        .filter((item): item is ConfigItem => Boolean(item))
    : [];
  const seedValues = seedConfigValues(category, seed);
  const rawByLabel = new Map(rawItems.map((item) => [item.label, item.value]));
  const base = defaultConfig(category);
  const sourceContact = normalizeSourceContact(seed.sourceContact, rawItems, seed.rawText);
  const merged = base.map((item) => {
    const rawValue = rawByLabel.get(item.label);
    const value = rawValue?.trim() ? rawValue : seedValues[item.label] ?? rawValue ?? item.value;
    return { label: item.label, value };
  });
  const extra = rawItems
    .filter((item) => !base.some((baseItem) => baseItem.label === item.label))
    .map((item) => (isSourceContactLabel(item.label) ? { ...item, label: "来源", value: sourceContact } : item));
  const rawText = asDisplayText(seed.rawText);
  const hasSourceLabel = rawItems.some((item) => isSourceContactLabel(item.label));
  const traceItems = [
    ...(sourceContact && !hasSourceLabel ? [{ label: "来源", value: sourceContact }] : []),
    ...(rawText && !rawByLabel.has("原文") ? [{ label: "原文", value: rawText }] : []),
  ];
  return [...merged, ...extra, ...traceItems];
}

function seedConfigValues(
  category: ProductCategory,
  seed: { gpuModel?: unknown; gpuCount?: unknown; condition?: unknown; sourceContact?: unknown; rawText?: unknown },
): Record<string, string> {
  const values: Record<string, string> = {};
  const model = asDisplayText(seed.gpuModel);
  const count = asDisplayText(seed.gpuCount);
  const condition = asDisplayText(seed.condition);

  if (category === "SERVER") {
    if (model) values["GPU"] = model;
    if (count) values["GPU数量"] = `${count}卡`;
  }
  if (category === "GPU_CARD") {
    if (model) values["型号"] = model;
    if (condition && condition !== "待确认") values["成色"] = condition;
  }
  if (category === "MEMORY") {
    if (model) values["类型"] = model;
  }
  if (category === "STORAGE" || category === "CPU" || category === "NETWORK" || category === "OTHER") {
    if (model) values["型号"] = model;
    if (condition && condition !== "待确认") values["成色"] = condition;
  }
  return values;
}

function parseProductCategory(text: string): ProductCategory {
  if (/网卡|交换机|迈络思|Mellanox|ConnectX|Q3400|400g/i.test(text)) return "NETWORK";
  if (/CPU|至强|Xeon|AMD|EPYC|6767P|6776P|6760P|6747P|6740P|8468V|8558P?|6530P?|9554|9655|9555/i.test(text)) return "CPU";
  if (/硬盘|固态|SSD|HDD|NVMe|SATA|U\.?2|E1\.?S|M\.?2|SAS|PM9|PM8|P55|P56|ST\d|WD|WUH|WUS|希捷|西数|东芝|思得|SOLIDIGM|SOLINIGM|大普微|忆联|小海豚|\d+(?:\.\d+)?\s*T/i.test(text)) return "STORAGE";
  if (/内存|DDR\d?|RDIMM|LRDIMM|DIMM|ECC|REG/i.test(text)) return "MEMORY";
  if (/显卡|GPU卡|PCIe卡|PCIE卡|RTX\s?\d{4}|4090|5090|L40S/i.test(text)) return "GPU_CARD";
  if (!/整机|工作站|服务器/.test(text) && readCompactMemorySpec(text)) return "MEMORY";
  return "SERVER";
}

function parseModelText(text: string, category: ProductCategory): string {
  if (category === "MEMORY") {
    const compact = readCompactMemorySpec(text);
    if (compact) return `${compact.capacity} ${compact.frequency}`;
    return (
      text.match(/(DDR[45]\s*(?:\d+G|GB)?\s*(?:RDIMM|LRDIMM|DIMM|ECC|REG)?)/i)?.[1]?.trim() ??
      text.match(/(\d+\s*(?:G|GB)\s*(?:RDIMM|LRDIMM|DIMM|ECC|REG)?)/i)?.[1]?.trim() ??
      "内存"
    );
  }
  if (category === "STORAGE") {
    return (
      text.match(/(?:PM9D3A|PM9A3|PM893|PM983A?|PM1743|P5510|P5500|P5520|P5600|P5620|PS1010|S4520|J5300|H5100|R6100|ES3500P|ST\d{8,}[A-Z]*|WD[A-Z0-9-]+|WUH[A-Z0-9]+|WUS[A-Z0-9]+|MG\d+[A-Z0-9]+)[A-Z0-9-]*(?:\s*\d+(?:\.\d+)?T|\s*\d+G)?/i)?.[0]?.trim() ??
      text.match(/(?:HDD|SSD|NVMe|SATA|SAS|U\.?2|E1\.?S|M\.?2)?\s*\d+(?:\.\d+)?\s*(?:T|TB|G|GB)/i)?.[0]?.trim() ??
      "硬盘/SSD"
    );
  }
  if (category === "CPU") {
    return (
      text.match(/(?:Xeon\s*)?(?:\d{4,5}[A-Z+]?|E-\d{4,5}|E5-\d{4}|W[579]-\d{4,5}X?|EPYC\s*\d{4,5}[A-Z]?)/i)?.[0]?.trim() ??
      "CPU"
    );
  }
  if (category === "NETWORK") {
    return text.match(/(?:ConnectX-\d|CX\d|Mellanox|迈络思|Q3400|400G网卡|200G网卡|交换机)[A-Z0-9 -]*/i)?.[0]?.trim() ?? "网络设备";
  }
  return text.match(/\b(H100|H200|B200|B300|A100|A800|H800|L40S|RTX\s?4090|RTX\s?5090)\b/i)?.[1]?.toUpperCase() ?? "";
}

function buildParsedTitle(category: ProductCategory, model: string, gpuCount: string, city: string): string {
  const place = city || "";
  if (category === "SERVER") return `${place}${model || "GPU"} ${gpuCount || "8"}卡服务器`.trim();
  return `${place}${productCategoryText(category)} ${model || "待确认"}`.trim();
}

function parseTradeMode(text: string): TradeMode {
  if (/租赁|出租|求租|承租|租用|租金|日租|月租|年租/.test(text)) return "RENTAL";
  if (/期货|预订|预售|交期|排产/.test(text)) return "FUTURES";
  return "SPOT";
}

function normalizeTradeModeValue(value: unknown): TradeMode {
  if (value === "SPOT" || value === "FUTURES" || value === "RENTAL") return value;
  return parseTradeMode(asDisplayText(value));
}

function normalizeMarketType(value: unknown): MarketType {
  const text = asDisplayText(value).toUpperCase();
  if (text === "DEMAND" || /收|求购|求租|承租|找/.test(text)) return "DEMAND";
  return "GOODS";
}

function normalizeProductCategoryValue(value: unknown): ProductCategory {
  const text = asDisplayText(value).toUpperCase();
  if (["SERVER", "GPU_CARD", "MEMORY", "STORAGE", "CPU", "NETWORK", "OTHER"].includes(text)) return text as ProductCategory;
  return parseProductCategory(asDisplayText(value));
}

function parseLocationText(text: string): string {
  return text.match(/(深圳|香港|上海|北京|广州|杭州|苏州|成都|国内|大陆|海外|新加坡|泰国)/)?.[1] ?? "";
}

function tradeModeText(mode: TradeMode): string {
  const map: Record<TradeMode, string> = {
    SPOT: "现货",
    FUTURES: "期货",
    RENTAL: "租赁",
  };
  return map[mode];
}

function tradeModeTone(mode: TradeMode): BadgeTone {
  const map: Record<TradeMode, BadgeTone> = {
    SPOT: "green",
    FUTURES: "orange",
    RENTAL: "blue",
  };
  return map[mode];
}

function stockSourceText(source: StockItem["source"]): string {
  const map: Record<StockItem["source"], string> = {
    AI: "AI解析",
    MANUAL: "手工录入",
  };
  return map[source];
}

function matchesPriceFilter(amount: number | undefined, filter: PriceFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "HAS_PRICE") return Boolean(amount && amount > 0);
  if (filter === "NO_PRICE") return !amount || amount <= 0;
  if (!amount || amount <= 0) return false;
  if (filter === "UNDER_10000") return amount < 10000;
  if (filter === "FROM_10000_TO_100000") return amount >= 10000 && amount < 100000;
  if (filter === "FROM_100000_TO_500000") return amount >= 100000 && amount < 500000;
  return amount >= 500000;
}

function matchesDateFilter(timeValue: number, filter: DateFilter): boolean {
  if (filter === "ALL") return true;
  if (!timeValue) return false;
  if (filter === "TODAY") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return timeValue >= start.getTime();
  }
  const daysByFilter: Record<Exclude<DateFilter, "ALL" | "TODAY">, number> = {
    LAST_3_DAYS: 3,
    LAST_7_DAYS: 7,
    LAST_14_DAYS: 14,
    LAST_30_DAYS: 30,
  };
  return timeValue >= Date.now() - daysByFilter[filter] * 24 * 60 * 60 * 1000;
}

function createdTimeValue(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatTimeGap(hours: number): string {
  if (!Number.isFinite(hours)) return "未知";
  if (hours < 1) return "1 小时内";
  if (hours < 24) return `${Math.round(hours)} 小时`;
  const days = hours / 24;
  if (days < 2) return `${days.toFixed(1)} 天`;
  if (days < 10) return `${Math.round(days)} 天`;
  return `${Math.round(days)} 天`;
}

function totalPagesFor(total: number): number {
  return Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
}

function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), totalPages);
}

function upsertStockItems(incoming: StockItem[], existing: StockItem[]): { items: StockItem[]; createdCount: number; refreshedCount: number } {
  const existingByKey = new Map(existing.map((item) => [stockIdentity(item), item]));
  const refreshedById = new Map<string, StockItem>();
  const createdItems: StockItem[] = [];
  const createdKeys = new Set<string>();

  incoming.forEach((item) => {
    const key = stockIdentity(item);
    const matched = existingByKey.get(key);
    if (matched) {
      refreshedById.set(matched.id, {
        ...matched,
        ...rpaProvenance(item),
        configItems: configWithRpaProvenance(matched.configItems, item),
        createdAt: item.createdAt,
      });
      return;
    }
    if (createdKeys.has(key)) return;
    createdKeys.add(key);
    createdItems.push(item);
  });

  return {
    items: [...createdItems, ...existing.map((item) => refreshedById.get(item.id) ?? item)].sort((left, right) => createdTimeValue(right.createdAt) - createdTimeValue(left.createdAt)),
    createdCount: createdItems.length,
    refreshedCount: refreshedById.size,
  };
}

function upsertMarketPosts(incoming: MarketPost[], existing: MarketPost[]): { items: MarketPost[]; createdCount: number; refreshedCount: number } {
  const existingByKey = new Map(existing.map((item) => [marketIdentity(item), item]));
  const refreshedById = new Map<string, MarketPost>();
  const createdItems: MarketPost[] = [];
  const createdKeys = new Set<string>();

  incoming.forEach((item) => {
    const key = marketIdentity(item);
    const matched = existingByKey.get(key);
    if (matched) {
      refreshedById.set(matched.id, {
        ...matched,
        ...rpaProvenance(item),
        configItems: configWithRpaProvenance(matched.configItems, item),
        publishedAt: item.publishedAt,
      });
      return;
    }
    if (createdKeys.has(key)) return;
    createdKeys.add(key);
    createdItems.push(item);
  });

  return {
    items: [...createdItems, ...existing.map((item) => refreshedById.get(item.id) ?? item)].sort((left, right) => createdTimeValue(right.publishedAt) - createdTimeValue(left.publishedAt)),
    createdCount: createdItems.length,
    refreshedCount: refreshedById.size,
  };
}

function stockIdentity(item: StockItem): string {
  if (item.sourceCaptureId) return `rpa:${item.sourceCaptureId}:${item.sourceItemKey || item.id}`;
  return normalizeIdentity(
    [
      item.productCategory,
      item.tradeMode,
      item.title,
      item.gpuModel,
      item.sourceContact,
      item.quantity,
      item.quantityUnit,
      item.locationCity,
      item.priceAmount ?? "",
    ].join("|"),
  );
}

function marketIdentity(item: MarketPost): string {
  if (item.sourceCaptureId) return `rpa:${item.sourceCaptureId}:${item.sourceItemKey || item.id}`;
  return normalizeIdentity(
    [
      item.postType,
      item.productCategory,
      item.tradeMode,
      item.title,
      item.gpuModel,
      item.sourceContact,
      item.quantity,
      item.quantityUnit,
      item.locationCity,
      item.priceAmount ?? "",
      item.contactMethod,
    ].join("|"),
  );
}

function normalizeIdentity(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function productCategoryText(category: ProductCategory): string {
  const map: Record<ProductCategory, string> = {
    SERVER: "服务器",
    GPU_CARD: "显卡",
    MEMORY: "内存",
    STORAGE: "硬盘/SSD",
    CPU: "CPU",
    NETWORK: "网络设备",
    OTHER: "配件",
  };
  return map[category];
}

function quantityUnitForCategory(category: ProductCategory): string {
  const map: Record<ProductCategory, string> = {
    SERVER: "台",
    GPU_CARD: "张",
    MEMORY: "条",
    STORAGE: "个",
    CPU: "颗",
    NETWORK: "个",
    OTHER: "个",
  };
  return map[category];
}

function quantityText(quantity: number, unit: string): string {
  return quantity > 0 ? `${quantity}${unit}` : "数量待确认";
}

function stockSpecText(stock: StockItem): string {
  if (stock.productCategory === "SERVER") return `${stock.gpuModel} / ${stock.gpuCount}卡`;
  return stock.gpuModel;
}

function captureAfter(text: string, labels: string[]): string {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}\\s*[:：]?\\s*([^,，;；\\n]+)`, "i"));
    if (match?.[1]) return cleanConfigValue(match[1]);
  }
  return "";
}

function captureFirst(text: string, pattern: RegExp): string {
  return cleanConfigValue(text.match(pattern)?.[0] ?? "");
}

function captureBrand(text: string): string {
  return (
    captureFirst(
      text,
      /Supermicro|超微|Dell|戴尔|浪潮|HPE|新华三|H3C|联想|Lenovo|NVIDIA|英伟达|ASUS|华硕|Gigabyte|技嘉|MSI|微星|Samsung|三星|SK\s?Hynix|海力士|Micron|美光|Kingston|金士顿|长鑫|Intel|英特尔|AMD|希捷|Seagate|西数|Western\s?Digital|东芝|Toshiba|Solidigm|思得|大普微|忆联|小海豚|迈络思|Mellanox/i,
    ) || ""
  );
}

function captureModelFamily(text: string): string {
  return captureFirst(text, /\b(?:HGX|DGX|SuperServer|PowerEdge|ThinkSystem)[A-Za-z0-9\s-]*/i);
}

function cleanConfigValue(value: string): string {
  return value.replace(/^(是|为|配置|含|带)\s*/, "").trim();
}

function compactConfigValue(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 96 ? `${clean.slice(0, 96)}...` : clean;
}

function asDisplayText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function loadAuthSession(): { session: AuthSession | null; expired: boolean } {
  try { return readStoredSession<AuthSession>(localStorage, AUTH_STORAGE_KEY); }
  catch { return { session: null, expired: false }; }
}

function persistAuthSession(session: AuthSession): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function pendingPaymentStorageKey(session: AuthSession | null): string {
  return `huoji_pending_payment:${session?.user.id ?? "guest"}:${session?.currentWorkspaceId ?? "personal"}`;
}

async function fetchCaptchaConfig(): Promise<CaptchaConfig> {
  const response = await fetch("/api/auth/captcha/config");
  const payload = (await response.json()) as CaptchaConfig & { error?: string };
  if (!response.ok) throw new Error(payload.error || "安全验证配置读取失败。");
  return payload;
}

async function loadAliyunCaptchaScript(scriptUrl?: string): Promise<void> {
  const src = scriptUrl || "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
  const existing = document.querySelector<HTMLScriptElement>(`script[data-huoji-captcha="aliyun"]`);
  if (existing) {
    if (window.initAliyunCaptcha) return;
    await new Promise<void>((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("阿里云验证码脚本加载失败。")), { once: true });
    });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.huojiCaptcha = "aliyun";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("阿里云验证码脚本加载失败。"));
    document.head.appendChild(script);
  });
}

async function requestSmsCode(phone: string, captchaVerifyParam?: string): Promise<SmsRequestResponse> {
  const response = await fetch("/api/auth/sms/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, captchaVerifyParam }),
  });
  const payload = (await response.json()) as SmsRequestResponse;
  if (!response.ok) throw new Error(payload.error || "验证码发送失败。");
  return payload;
}

async function loginWithSmsCode(phone: string, code: string): Promise<AuthSession> {
  const response = await fetch("/api/auth/sms/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code }),
  });
  const payload = (await response.json()) as AuthSession & { error?: string };
  if (!response.ok) throw new Error(payload.error || "登录失败。");
  return payload;
}

async function logoutAuthSession(token: string): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined);
}

async function createAlipayPaymentOrder(
  session: AuthSession,
  productType: PaymentProductType,
  productId: string,
  channel: PaymentChannel,
): Promise<PaymentOrderResponse> {
  const response = await fetch("/api/payments/alipay/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ productType, productId, channel, pricingVersion: productType === "CREDIT_PACKAGE" ? rechargePricingVersion : pricingVersion }),
  });
  const payload = (await response.json()) as PaymentOrderResponse;
  if (!response.ok) throw new Error(payload.error || "支付宝订单创建失败。");
  return payload;
}

async function fetchPaymentOrder(session: AuthSession, orderId: string): Promise<PaymentOrderResponse> {
  const response = await fetch(`/api/payments/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  const payload = (await response.json()) as PaymentOrderResponse;
  if (!response.ok) throw new Error(payload.error || "订单状态查询失败。");
  return payload;
}

function preferredPaymentChannel(): PaymentChannel {
  return window.matchMedia("(max-width: 768px)").matches ? "wap" : "page";
}

function normalizePhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  return /^1[3-9]\d{9}$/.test(digits) ? digits : "";
}

function workspaceCacheId(session: AuthSession | null): string {
  const id = session?.currentWorkspaceId ?? "";
  return id.startsWith("ent_") && session ? id + ":" + session.user.id : id;
}
function workspaceStorageKey(workspaceId: string, collection: WorkspaceCollection): string {
  return `huoji_web_${workspaceId}_${collection}`;
}

function tradeDraftStorageKey(workspaceId: string): string {
  return `huoji_web_${workspaceId}_drafts`;
}

function loadTradeDrafts(session: AuthSession | null): TradeDraft[] {
  if (!session?.currentWorkspaceId) return [];
  const snapshot = loadWorkspaceSnapshot(workspaceCacheId(session));
  if (snapshot) return snapshot.drafts;
  const drafts = load<TradeDraft[]>(tradeDraftStorageKey(workspaceCacheId(session)), []);
  return Array.isArray(drafts) ? drafts : [];
}

function rpaConfirmedItemsStorageKey(workspaceId: string): string {
  return `huoji_web_${workspaceId}_rpa_confirmed_item_keys`;
}

function loadRpaConfirmedItemKeys(session: AuthSession | null): string[] {
  if (!session?.currentWorkspaceId) return [];
  const snapshot = loadWorkspaceSnapshot(workspaceCacheId(session));
  if (snapshot) return snapshot.confirmedRpaItemKeys;
  const ids = load<string[]>(rpaConfirmedItemsStorageKey(workspaceCacheId(session)), []);
  return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
}

function workspaceSnapshotStorageKey(workspaceId: string): string {
  return `huoji_web_${workspaceId}_snapshot_v1`;
}

function loadWorkspaceSnapshot(workspaceId: string): WorkspaceSnapshot | null {
  const snapshot = load<WorkspaceSnapshot | null>(workspaceSnapshotStorageKey(workspaceId), null);
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.stocks) || !Array.isArray(snapshot.market)
      || !Array.isArray(snapshot.drafts) || !Array.isArray(snapshot.confirmedRpaItemKeys)) return null;
  return snapshot;
}

function persistWorkspaceSnapshot(workspaceId: string, snapshot: WorkspaceSnapshot): void {
  if (!workspaceId) throw new Error("工作空间未就绪。");
  localStorage.setItem(workspaceSnapshotStorageKey(workspaceId), JSON.stringify(snapshot));
}

function buildConfirmedWorkspaceSnapshot(current: WorkspaceSnapshot, selected: TradeDraft[]): { snapshot: WorkspaceSnapshot; result: SaveParsedResult } {
  const materialized = materializeConfirmedDrafts(selected);
  const stockResult = upsertStockItems(materialized.stockItems, current.stocks);
  const marketResult = upsertMarketPosts(materialized.marketItems, current.market);
  const confirmedKeys = selected.map((item) => item.sourceItemKey).filter((key): key is string => Boolean(key));
  const selectedIds = new Set(selected.map((item) => item.id));
  return {
    snapshot: {
      version: 1,
      stocks: stockResult.items,
      market: marketResult.items,
      drafts: current.drafts.filter((item) => !selectedIds.has(item.id)),
      confirmedRpaItemKeys: [...new Set([...current.confirmedRpaItemKeys, ...confirmedKeys])],
    },
    result: {
      stockCount: stockResult.createdCount,
      marketCount: marketResult.createdCount,
      refreshedStockCount: stockResult.refreshedCount,
      refreshedMarketCount: marketResult.refreshedCount,
      refreshedCount: stockResult.refreshedCount + marketResult.refreshedCount,
    },
  };
}

function loadWorkspaceCollection<T>(
  session: AuthSession | null,
  collection: WorkspaceCollection,
  fallback: T,
): T {
  const workspaceId = workspaceCacheId(session);
  if (!workspaceId) return fallback;
  const snapshot = loadWorkspaceSnapshot(workspaceId);
  if (snapshot) return snapshot[collection] as T;
  const scopedKey = workspaceStorageKey(workspaceId, collection);
  try {
    const scopedValue = localStorage.getItem(scopedKey);
    if (scopedValue) return JSON.parse(scopedValue) as T;
  } catch {
    return fallback;
  }
  return fallback;
}

function saveWorkspaceCollection<T>(workspaceId: string, collection: WorkspaceCollection, value: T): void {
  if (!workspaceId) return;
  localStorage.setItem(workspaceStorageKey(workspaceId, collection), JSON.stringify(value));
}

function normalizeSourceContact(value: unknown, configItems?: unknown, rawText?: unknown): string {
  return (
    cleanSourceContact(asDisplayText(value)) ||
    cleanSourceContact(sourceContactFromConfig(configItems)) ||
    cleanSourceContact(parseSourceContactFromText(asDisplayText(rawText))) ||
    "未知来源"
  );
}

function sourceContactFromConfig(items: unknown): string {
  if (!Array.isArray(items)) return "";
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const label = asDisplayText(record.label);
    if (isSourceContactLabel(label)) return asDisplayText(record.value);
  }
  return "";
}

function parseSourceContactFromText(text: string): string {
  const match = text.match(/^([^:：\n]{1,80})[:：]\s*(?:\S|$)/m);
  const candidate = cleanSourceContact(match?.[1] ?? "");
  if (/^(出|收|求购|找|找货|价格|数量|型号|城市|联系方式?|联系人)$/.test(candidate)) return "";
  return candidate;
}

function isSourceContactLabel(label: string): boolean {
  return /^(来源|来源用户|说话人|发言人|微信用户)$/.test(label.trim());
}

function cleanSourceContact(value: string): string {
  return value.replace(/[:：]\s*$/, "").trim();
}

function uniqueSortedLabels(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => cleanSourceContact(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "zh-Hans-CN"),
  );
}

function load<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeStocks(items: StockItem[]): StockItem[] {
  return items.map((item) => {
    const productCategory = item.productCategory ?? parseProductCategory(`${item.title} ${item.gpuModel}`);
    const sourceContact = normalizeSourceContact(item.sourceContact, item.configItems, item.title);
    return {
      ...item,
      productCategory,
      tradeMode: normalizeTradeModeValue(item.tradeMode || `${item.title} ${item.availabilityType ?? ""}`),
      quantityUnit: item.quantityUnit ?? quantityUnitForCategory(productCategory),
      sourceContact,
      configItems: normalizeConfigItems(item.configItems, productCategory, {
        gpuModel: item.gpuModel,
        gpuCount: item.gpuCount,
        condition: item.condition,
        sourceContact,
      }),
    };
  });
}

function normalizeMarketPosts(items: MarketPost[]): MarketPost[] {
  return items.map((item) => {
    const productCategory = item.productCategory ?? parseProductCategory(`${item.title} ${item.gpuModel}`);
    const sourceContact = normalizeSourceContact(item.sourceContact, item.configItems, item.title);
    return {
      ...item,
      productCategory,
      tradeMode: normalizeTradeModeValue(item.tradeMode || item.title),
      quantityUnit: item.quantityUnit ?? quantityUnitForCategory(productCategory),
      sourceContact,
      configItems: normalizeConfigItems(item.configItems, productCategory, {
        gpuModel: item.gpuModel,
        sourceContact,
      }),
    };
  });
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function statusText(status: StockItem["status"]): string {
  const map: Record<StockItem["status"], string> = {
    UNVERIFIED: "待核实",
    VERIFIED: "已核实",
    SELLABLE: "供应中",
    EXPIRED: "已失效",
    SOLD_OUT: "已售罄",
  };
  return map[status];
}

function statusTone(status: StockItem["status"]): BadgeTone {
  const map: Record<StockItem["status"], BadgeTone> = {
    UNVERIFIED: "orange",
    VERIFIED: "green",
    SELLABLE: "green",
    EXPIRED: "red",
    SOLD_OUT: "red",
  };
  return map[status];
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("zh-CN", { maximumFractionDigits: 8 });
}

function formatHourTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间待确认";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day} ${hour}:${minute}`;
}

function formatMinuteTime(value: string): string {
  return formatHourTime(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "日期待确认";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDaysIso(days: number): string {
  return addDaysFromIso(new Date().toISOString(), days);
}

function addDaysFromIso(value: string, days: number): string {
  const date = new Date();
  const parsed = new Date(value);
  if (Number.isFinite(parsed.getTime())) date.setTime(parsed.getTime());
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function creditTransactionTypeText(type: CreditTransactionType): string {
  const map: Record<CreditTransactionType, string> = {
    RECHARGE: "充值",
    CONSUME: "消耗",
    GRANT: "赠送",
    REFUND: "退回",
    ADJUST: "调整",
  };
  return map[type];
}
