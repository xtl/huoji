import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  Boxes,
  Building2,
  Check,
  ClipboardCheck,
  Compass,
  CreditCard,
  GitCompareArrows,
  LogOut,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Phone,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  SendHorizontal,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";

type TabKey = "input" | "stock" | "market" | "match" | "account";
type MarketType = "GOODS" | "DEMAND";
type TradeMode = "SPOT" | "FUTURES" | "RENTAL";
type ProductCategory = "SERVER" | "GPU_CARD" | "MEMORY" | "STORAGE" | "CPU" | "NETWORK" | "OTHER";
type PriceFilter = "ALL" | "HAS_PRICE" | "NO_PRICE" | "UNDER_10000" | "FROM_10000_TO_100000" | "FROM_100000_TO_500000" | "OVER_500000";
type BadgeTone = "default" | "blue" | "green" | "orange" | "red";
type NoticeTone = "info" | "success" | "warning";
type WorkspaceType = "PERSONAL" | "ENTERPRISE";
type WorkspaceCollection = "stocks" | "market";
type CaptchaStatus = "disabled" | "loading" | "ready" | "error";
type AccountSection = "overview" | "membership" | "credits" | "ledger";
type MembershipPlanCode = "FREE" | "PRO_MONTHLY" | "PRO_YEARLY";
type CreditTransactionType = "RECHARGE" | "CONSUME" | "GRANT" | "REFUND" | "ADJUST";
type MatchStatus = "NEW" | "CONTACTED" | "IGNORED";
type MatchScoreLevel = "STRONG" | "GOOD" | "WEAK";
type MatchView = "RECOMMENDED" | "DEMAND_TO_SUPPLY" | "SUPPLY_TO_DEMAND";
type MatchScoreFilter = "ALL" | MatchScoreLevel;
type MatchStatusFilter = "ALL" | MatchStatus;

const LIST_PAGE_SIZE = 30;
const AUTH_STORAGE_KEY = "huoji_auth_session";
const ACCOUNT_STORAGE_PREFIX = "huoji_account_wallet";
const MATCH_STATUS_STORAGE_PREFIX = "huoji_match_statuses";
const AI_EXAMPLE_TEXT = "深圳现货 H100 8卡服务器 2台 全新 价格120万";

interface ConfigItem {
  label: string;
  value: string;
}

interface StockItem {
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

interface MarketPost {
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

interface TradeDraft {
  id: string;
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

interface AuthSession {
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
  planCode: MembershipPlanCode;
  planName: string;
  membershipStatus: "ACTIVE" | "FREE" | "EXPIRED";
  membershipExpiresAt?: string;
  creditBalance: number;
  monthlyAiParseCount: number;
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

const initialStocks: StockItem[] = [
  {
    id: "stock-demo-1",
    productCategory: "SERVER",
    title: "Supermicro H100 8卡整机",
    gpuModel: "H100",
    gpuCount: 8,
    quantity: 2,
    quantityUnit: "台",
    locationCity: "深圳",
    priceAmount: 1200000,
    condition: "全新",
    availabilityType: "现货",
    tradeMode: "SPOT",
    configItems: [
      { label: "品牌", value: "Supermicro" },
      { label: "整机型号", value: "HGX H100 8-GPU" },
      { label: "GPU", value: "H100" },
      { label: "GPU数量", value: "8卡" },
      { label: "CPU", value: "双路 Intel Xeon" },
      { label: "内存", value: "2TB DDR5 ECC" },
      { label: "硬盘", value: "8 * 3.84T NVMe" },
      { label: "网络", value: "双口 200G IB" },
      { label: "电源", value: "冗余电源" },
      { label: "质保", value: "三年" },
    ],
    status: "SELLABLE",
    source: "AI",
    sourceContact: "演示微信群-小林",
    createdAt: new Date().toISOString(),
  },
];

const initialMarket: MarketPost[] = [
  {
    id: "market-demo-1",
    productCategory: "SERVER",
    tradeMode: "SPOT",
    postType: "DEMAND",
    title: "求购 H200 8卡服务器 4台",
    gpuModel: "H200",
    quantity: 4,
    quantityUnit: "台",
    locationCity: "上海",
    priceAmount: 0,
    contactMethod: "站内联系",
    sourceContact: "演示微信群-采购A",
    configItems: [
      { label: "品牌", value: "不限" },
      { label: "整机型号", value: "HGX H200" },
      { label: "GPU", value: "H200" },
      { label: "GPU数量", value: "8卡" },
      { label: "CPU", value: "双路" },
      { label: "内存", value: "2TB 以上" },
      { label: "硬盘", value: "NVMe" },
      { label: "网络", value: "200G IB" },
      { label: "电源", value: "" },
      { label: "质保", value: "原厂优先" },
    ],
    publishedAt: new Date().toISOString(),
  },
];

const membershipPlans: Array<{
  code: MembershipPlanCode;
  name: string;
  price: string;
  period: string;
  badge: string;
  features: string[];
}> = [
  {
    code: "FREE",
    name: "免费版",
    price: "¥0",
    period: "长期",
    badge: "当前可用",
    features: ["每日 10 次 AI 解析", "单次最多 50 条", "基础供应/需求管理", "基础筛选"],
  },
  {
    code: "PRO_MONTHLY",
    name: "个人 Pro 月卡",
    price: "¥39",
    period: "30 天",
    badge: "高频使用",
    features: ["每日 300 次 AI 解析", "单次最多 1000 条", "高级筛选与导出", "批量入库优先"],
  },
  {
    code: "PRO_YEARLY",
    name: "个人 Pro 年卡",
    price: "¥399",
    period: "365 天",
    badge: "更划算",
    features: ["包含月卡全部权益", "赠送 3000 货记分", "后续经营报表优先体验", "企业版折扣预留"],
  },
];

const creditPackages: Array<{ id: string; title: string; price: string; credits: number; bonus: number; label: string }> = [
  { id: "credits_100", title: "轻量包", price: "¥10", credits: 100, bonus: 0, label: "临时解析够用" },
  { id: "credits_600", title: "常用包", price: "¥50", credits: 500, bonus: 100, label: "多送 100 分" },
  { id: "credits_1500", title: "批量包", price: "¥100", credits: 1000, bonus: 500, label: "适合批量群记录" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("input");
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => loadAuthSession());
  const currentWorkspace = authSession?.workspaces.find((workspace) => workspace.id === authSession.currentWorkspaceId) ?? null;
  const currentWorkspaceId = currentWorkspace?.id ?? "";
  const [stocks, setStocks] = useState<StockItem[]>(() =>
    normalizeStocks(loadWorkspaceCollection(authSession, "stocks", "huoji_web_stocks", initialStocks)),
  );
  const [marketPosts, setMarketPosts] = useState<MarketPost[]>(() =>
    normalizeMarketPosts(loadWorkspaceCollection(authSession, "market", "huoji_web_market", initialMarket)),
  );
  const [accountWallet, setAccountWallet] = useState<AccountWallet>(() => loadAccountWallet(authSession));
  const [accountSection, setAccountSection] = useState<AccountSection>("overview");
  const [aiText, setAiText] = useState(AI_EXAMPLE_TEXT);
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
  const [stockFiltersOpen, setStockFiltersOpen] = useState(false);
  const [marketFiltersOpen, setMarketFiltersOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [stockPage, setStockPage] = useState(1);
  const [marketPage, setMarketPage] = useState(1);
  const [matchPage, setMatchPage] = useState(1);
  const [selectedStockId, setSelectedStockId] = useState("");
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [matchView, setMatchView] = useState<MatchView>("RECOMMENDED");
  const [matchCategoryFilter, setMatchCategoryFilter] = useState<ProductCategory | "ALL">("ALL");
  const [matchModeFilter, setMatchModeFilter] = useState<TradeMode | "ALL">("ALL");
  const [matchScoreFilter, setMatchScoreFilter] = useState<MatchScoreFilter>("ALL");
  const [matchStatusFilter, setMatchStatusFilter] = useState<MatchStatusFilter>("ALL");
  const [matchFiltersOpen, setMatchFiltersOpen] = useState(false);
  const [matchStatuses, setMatchStatuses] = useState<Record<string, MatchStatus>>(() => loadMatchStatuses(authSession));
  const [draftItems, setDraftItems] = useState<TradeDraft[]>([]);
  const [draftPage, setDraftPage] = useState(1);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "assistant-welcome",
      role: "assistant",
      text: "把微信群货源、求购、租赁信息直接发给我。我会自动识别类型、交易大类和品类，先拆成待确认结果，不会自动入库。",
    },
  ]);
  const [isAiParsing, setIsAiParsing] = useState(false);
  const [aiParseMessage, setAiParseMessage] = useState("");
  const [notice, setNotice] = useState<NoticeState | null>(null);

  useEffect(() => {
    if (!authSession) return;
    setStocks(normalizeStocks(loadWorkspaceCollection(authSession, "stocks", "huoji_web_stocks", initialStocks)));
    setMarketPosts(normalizeMarketPosts(loadWorkspaceCollection(authSession, "market", "huoji_web_market", initialMarket)));
    setAccountWallet(loadAccountWallet(authSession));
    setDraftItems([]);
    setQuery("");
    setStockPage(1);
    setMarketPage(1);
    setMatchPage(1);
    setDraftPage(1);
    setAccountSection("overview");
    setMatchStatuses(loadMatchStatuses(authSession));
  }, [authSession?.currentWorkspaceId]);

  const filteredStocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stocks
      .filter((item) => {
        if (stockCategoryFilter !== "ALL" && item.productCategory !== stockCategoryFilter) return false;
        if (stockCityFilter !== "ALL" && item.locationCity !== stockCityFilter) return false;
        if (stockSourceFilter !== "ALL" && item.source !== stockSourceFilter) return false;
        if (stockSourceContactFilter !== "ALL" && item.sourceContact !== stockSourceContactFilter) return false;
        if (stockModeFilter !== "ALL" && item.tradeMode !== stockModeFilter) return false;
        if (!matchesPriceFilter(item.priceAmount, stockPriceFilter)) return false;
        if (!q) return true;
        return [
          item.title,
          item.gpuModel,
          item.locationCity,
          item.sourceContact,
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
      })
      .sort((left, right) => createdTimeValue(right.createdAt) - createdTimeValue(left.createdAt));
  }, [query, stockCategoryFilter, stockCityFilter, stockModeFilter, stockPriceFilter, stockSourceContactFilter, stockSourceFilter, stocks]);

  const stockCityOptions = useMemo(() => {
    const cities: string[] = Array.from(
      new Set<string>(stocks.map((item) => item.locationCity).filter((city) => city.trim().length > 0)),
    ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
    return [{ label: "全部城市", value: "ALL" }, ...cities.map((city) => ({ label: city, value: city }))];
  }, [stocks]);

  const stockSourceContactOptions = useMemo(() => {
    const contacts = uniqueSortedLabels(stocks.map((item) => item.sourceContact).filter(Boolean));
    return [{ label: "全部来源用户", value: "ALL" }, ...contacts.map((contact) => ({ label: contact, value: contact }))];
  }, [stocks]);

  const filteredMarket = useMemo(() => {
    const q = query.trim().toLowerCase();
    return marketPosts
      .filter((post) => post.postType === "DEMAND")
      .filter((post) => {
        if (marketModeFilter !== "ALL" && post.tradeMode !== marketModeFilter) return false;
        if (marketCategoryFilter !== "ALL" && post.productCategory !== marketCategoryFilter) return false;
        if (marketSourceContactFilter !== "ALL" && post.sourceContact !== marketSourceContactFilter) return false;
        if (!q) return true;
        return [
          post.title,
          post.gpuModel,
          post.locationCity,
          post.sourceContact,
          post.contactMethod,
          post.tradeMode,
          post.productCategory,
          productCategoryText(post.productCategory),
          ...post.configItems.flatMap((config) => [config.label, config.value]),
        ].some((value) => String(value).toLowerCase().includes(q));
      })
      .sort((left, right) => createdTimeValue(right.publishedAt) - createdTimeValue(left.publishedAt));
  }, [query, marketCategoryFilter, marketModeFilter, marketPosts, marketSourceContactFilter]);

  const marketSourceContactOptions = useMemo(() => {
    const contacts = uniqueSortedLabels(marketPosts.filter((post) => post.postType === "DEMAND").map((post) => post.sourceContact).filter(Boolean));
    return [{ label: "全部来源用户", value: "ALL" }, ...contacts.map((contact) => ({ label: contact, value: contact }))];
  }, [marketPosts]);

  const matchCandidates = useMemo(() => generateMatchCandidates(stocks, marketPosts, matchStatuses), [marketPosts, matchStatuses, stocks]);
  const filteredMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return matchCandidates
      .filter((candidate) => {
        if (matchView === "RECOMMENDED" && candidate.scoreTotal < 75 && candidate.status !== "CONTACTED") return false;
        if (matchCategoryFilter !== "ALL" && candidate.demand.productCategory !== matchCategoryFilter) return false;
        if (matchModeFilter !== "ALL" && candidate.demand.tradeMode !== matchModeFilter) return false;
        if (matchScoreFilter !== "ALL" && candidate.level !== matchScoreFilter) return false;
        if (matchStatusFilter !== "ALL" && candidate.status !== matchStatusFilter) return false;
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
          candidate.reasons.join(" "),
          candidate.riskNotes.join(" "),
          candidate.scoreTotal,
          matchStatusText(candidate.status),
          matchLevelText(candidate.level),
        ].some((value) => String(value).toLowerCase().includes(q));
      })
      .sort((left, right) => {
        if (right.scoreTotal !== left.scoreTotal) return right.scoreTotal - left.scoreTotal;
        return createdTimeValue(right.updatedAt) - createdTimeValue(left.updatedAt);
      });
  }, [matchCandidates, matchCategoryFilter, matchModeFilter, matchScoreFilter, matchStatusFilter, matchView, query]);

  const stockCurrentPage = clampPage(stockPage, totalPagesFor(filteredStocks.length));
  const marketCurrentPage = clampPage(marketPage, totalPagesFor(filteredMarket.length));
  const matchCurrentPage = clampPage(matchPage, totalPagesFor(filteredMatches.length));
  const draftCurrentPage = clampPage(draftPage, totalPagesFor(draftItems.length));
  const pagedStocks = filteredStocks.slice((stockCurrentPage - 1) * LIST_PAGE_SIZE, stockCurrentPage * LIST_PAGE_SIZE);
  const pagedMarket = filteredMarket.slice((marketCurrentPage - 1) * LIST_PAGE_SIZE, marketCurrentPage * LIST_PAGE_SIZE);
  const pagedMatches = filteredMatches.slice((matchCurrentPage - 1) * LIST_PAGE_SIZE, matchCurrentPage * LIST_PAGE_SIZE);
  const pagedDrafts = draftItems.slice((draftCurrentPage - 1) * LIST_PAGE_SIZE, draftCurrentPage * LIST_PAGE_SIZE);
  const selectedStock = filteredStocks.find((item) => item.id === selectedStockId) ?? pagedStocks[0] ?? null;
  const selectedMarket = filteredMarket.find((item) => item.id === selectedMarketId) ?? pagedMarket[0] ?? null;
  const selectedMatch = filteredMatches.find((item) => item.id === selectedMatchId) ?? pagedMatches[0] ?? null;
  const demandCount = marketPosts.filter((post) => post.postType === "DEMAND").length;
  const verifiedStockCount = stocks.filter((item) => item.status === "VERIFIED" || item.status === "SELLABLE").length;
  const strongMatchCount = matchCandidates.filter((item) => item.level === "STRONG").length;
  const listSearchBox = (
    <div className="surface-card group flex items-center gap-2 rounded-md px-3 py-2.5">
      <Search className="h-4 w-4 text-neutral-400 transition group-focus-within:text-neutral-700" />
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setStockPage(1);
          setMarketPage(1);
          setMatchPage(1);
        }}
        placeholder="搜索型号、城市、来源用户、状态、配置"
        className="w-full bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
      />
    </div>
  );
  const aiLineCount = aiText.trim() ? aiText.trim().split(/\r?\n/).filter(Boolean).length : 0;
  const activeStockFilterCount = [
    stockCategoryFilter !== "ALL",
    stockCityFilter !== "ALL",
    stockSourceFilter !== "ALL",
    stockSourceContactFilter !== "ALL",
    stockModeFilter !== "ALL",
    stockPriceFilter !== "ALL",
  ].filter(Boolean).length;
  const activeMarketFilterCount = [
    marketCategoryFilter !== "ALL",
    marketModeFilter !== "ALL",
    marketSourceContactFilter !== "ALL",
  ].filter(Boolean).length;
  const activeMatchFilterCount = [
    matchCategoryFilter !== "ALL",
    matchModeFilter !== "ALL",
    matchScoreFilter !== "ALL",
    matchStatusFilter !== "ALL",
  ].filter(Boolean).length;
  const draftSummary = draftItems.reduce(
    (summary, item) => ({
      goods: summary.goods + (item.postType === "GOODS" ? 1 : 0),
      demands: summary.demands + (item.postType === "DEMAND" ? 1 : 0),
      incomplete: summary.incomplete + (tradeDraftMissingFields(item).length ? 1 : 0),
    }),
    { goods: 0, demands: 0, incomplete: 0 },
  );
  const saveableDraftCount = draftItems.length;

  function saveStocks(next: StockItem[]) {
    setStocks(next);
    saveWorkspaceCollection(currentWorkspaceId, "stocks", next);
  }

  function saveMarket(next: MarketPost[]) {
    setMarketPosts(next);
    saveWorkspaceCollection(currentWorkspaceId, "market", next);
  }

  function saveAccountWallet(next: AccountWallet) {
    setAccountWallet(next);
    saveAccountWalletForSession(authSession, next);
  }

  function appendCreditTransaction(wallet: AccountWallet, transaction: Omit<CreditTransaction, "id" | "createdAt" | "balanceAfter">): AccountWallet {
    const nextBalance = Math.max(0, wallet.creditBalance + transaction.amount);
    return {
      ...wallet,
      creditBalance: nextBalance,
      transactions: [
        {
          ...transaction,
          id: `txn_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          balanceAfter: nextBalance,
        },
        ...wallet.transactions,
      ].slice(0, 80),
    };
  }

  function handleRechargeCredits(pack: (typeof creditPackages)[number]) {
    const totalCredits = pack.credits + pack.bonus;
    const nextWallet = appendCreditTransaction(accountWallet, {
      type: "RECHARGE",
      title: `${pack.title}充值`,
      amount: totalCredits,
      note: `${pack.price} · 支付接入前模拟入账`,
    });
    saveAccountWallet(nextWallet);
    setNotice({ tone: "success", text: `已模拟充值 ${totalCredits} 货记分。` });
  }

  function handleUpgradePlan(planCode: MembershipPlanCode) {
    if (planCode === "FREE") {
      setNotice({ tone: "info", text: "当前已支持免费版，Pro 支付接入后可正式开通。" });
      return;
    }
    const plan = membershipPlans.find((item) => item.code === planCode);
    if (!plan) return;
    const expiresAt = addDaysIso(planCode === "PRO_YEARLY" ? 365 : 30);
    const bonus = planCode === "PRO_YEARLY" ? 3000 : 300;
    const upgradedWallet = appendCreditTransaction(
      {
        ...accountWallet,
        planCode,
        planName: plan.name,
        membershipStatus: "ACTIVE",
        membershipExpiresAt: expiresAt,
      },
      {
        type: "GRANT",
        title: `${plan.name}权益赠送`,
        amount: bonus,
        note: "支付接入前模拟开通",
      },
    );
    saveAccountWallet(upgradedWallet);
    setNotice({ tone: "success", text: `已模拟开通 ${plan.name}，赠送 ${bonus} 货记分。` });
  }

  function consumeCredits(amount: number, title: string, note?: string): boolean {
    if (accountWallet.creditBalance < amount) {
      setAccountSection("credits");
      setActiveTab("account");
      setNotice({ tone: "warning", text: `货记分不足，本次需要 ${amount} 分。请先充值后再解析。` });
      return false;
    }
    const nextWallet = appendCreditTransaction(
      {
        ...accountWallet,
        monthlyAiParseCount: accountWallet.monthlyAiParseCount + 1,
      },
      {
        type: "CONSUME",
        title,
        amount: -amount,
        note,
      },
    );
    saveAccountWallet(nextWallet);
    return true;
  }

  function handleLogin(nextSession: AuthSession) {
    persistAuthSession(nextSession);
    setStocks(normalizeStocks(loadWorkspaceCollection(nextSession, "stocks", "huoji_web_stocks", initialStocks)));
    setMarketPosts(normalizeMarketPosts(loadWorkspaceCollection(nextSession, "market", "huoji_web_market", initialMarket)));
    setAccountWallet(loadAccountWallet(nextSession));
    setDraftItems([]);
    setQuery("");
    setStockPage(1);
    setMarketPage(1);
    setDraftPage(1);
    setAuthSession(nextSession);
    setNotice({ tone: "success", text: "已进入个人空间。" });
  }

  function handleLogout() {
    if (authSession?.token) void logoutAuthSession(authSession.token);
    localStorage.removeItem(AUTH_STORAGE_KEY);
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
    setStockPage(1);
  }

  function resetMarketFilters() {
    setQuery("");
    setMarketCategoryFilter("ALL");
    setMarketModeFilter("ALL");
    setMarketSourceContactFilter("ALL");
    setMarketPage(1);
  }

  function resetMatchFilters() {
    setQuery("");
    setMatchCategoryFilter("ALL");
    setMatchModeFilter("ALL");
    setMatchScoreFilter("ALL");
    setMatchStatusFilter("ALL");
    setMatchPage(1);
  }

  function updateMatchStatus(candidateId: string, status: MatchStatus) {
    const next = { ...matchStatuses, [candidateId]: status };
    setMatchStatuses(next);
    saveMatchStatuses(authSession, next);
    setNotice({ tone: "success", text: `已标记为${matchStatusText(status)}。` });
  }

  async function copyMatchSummary(candidate: MatchCandidate) {
    const text = buildMatchSummary(candidate);
    try {
      await navigator.clipboard?.writeText(text);
      setNotice({ tone: "success", text: "匹配摘要已复制。" });
    } catch {
      setNotice({ tone: "info", text });
    }
  }

  function saveParsedItems(materialized: { stockItems: StockItem[]; marketItems: MarketPost[] }): SaveParsedResult {
    const stockResult = upsertStockItems(materialized.stockItems, stocks);
    const marketResult = upsertMarketPosts(materialized.marketItems, marketPosts);
    if (materialized.stockItems.length) {
      saveStocks(stockResult.items);
      resetStockFilters();
    }
    if (materialized.marketItems.length) {
      saveMarket(marketResult.items);
      resetMarketFilters();
    }
    return {
      stockCount: stockResult.createdCount,
      marketCount: marketResult.createdCount,
      refreshedStockCount: stockResult.refreshedCount,
      refreshedMarketCount: marketResult.refreshedCount,
      refreshedCount: stockResult.refreshedCount + marketResult.refreshedCount,
    };
  }

  async function parseAssistantInput() {
    const input = aiText.trim();
    if (!input) {
      setAiParseMessage("请先输入或粘贴需要解析的供需文本。");
      setNotice({ tone: "warning", text: "货记输入为空。" });
      return;
    }
    const creditCost = aiParseCreditCost(input);
    if (!consumeCredits(creditCost, "AI 解析供需文本", `${input.split(/\r?\n/).filter(Boolean).length || 1} 行文本`)) {
      setAiParseMessage(`货记分不足，本次解析需要 ${creditCost} 分。`);
      return;
    }

    const overrides: EntryOverrides = {};
    setIsAiParsing(true);
    setNotice(null);
    setAiParseMessage("正在解析为待确认结果...");
    setChatMessages((messages) => [...messages, { id: `user-${Date.now()}`, role: "user", text: input }]);

    try {
      const aiResult = await parseWithAiGateway(input);
      const parsedDrafts = createDraftsFromParsedItems(aiResult.items, "AI", overrides);
      if (!parsedDrafts.length) throw new Error("没有识别到可确认的供需条目");
      const result = appendDrafts(parsedDrafts);
      const summary = countDrafts(parsedDrafts);
      setAiText("");
      setAiParseMessage(
        `${aiResult.isMock ? "离线解析" : "DeepSeek"}完成：${summary.goods} 条供应、${summary.demands} 条需求进入待确认${result.mergedCount ? `，合并 ${result.mergedCount} 条重复待确认` : ""}。`,
      );
      setNotice({ tone: "success", text: `已生成 ${result.addedCount} 条待确认结果。` });
      setChatMessages((messages) => [
        ...messages,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          tone: "success",
          text: `我拆出了 ${summary.goods} 条供应、${summary.demands} 条需求。先检查右侧字段，确认后再保存。`,
        },
      ]);
    } catch (error) {
      const fallbackDrafts = createDraftsFromParsedItems([parseAiText(input)], "MANUAL", overrides);
      const result = appendDrafts(fallbackDrafts);
      setAiParseMessage(error instanceof Error ? `DeepSeek 解析失败，已用本地解析生成待确认：${error.message}` : "已用本地解析生成待确认。");
      setNotice({
        tone: result.addedCount ? "warning" : "info",
        text: result.addedCount ? `本地兜底生成 ${result.addedCount} 条待确认结果。` : "本地兜底没有新增待确认结果。",
      });
      setChatMessages((messages) => [
        ...messages,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          tone: result.addedCount ? "warning" : "info",
          text: result.addedCount ? `DeepSeek 没跑通，我先用本地规则拆了 ${result.addedCount} 条，你可以继续改字段。` : "这段内容和现有待确认结果重复，暂时没有新增。",
        },
      ]);
    } finally {
      setIsAiParsing(false);
    }
  }

  function appendDrafts(nextDrafts: TradeDraft[]) {
    const newDrafts = dedupeNewTradeDrafts(nextDrafts, draftItems);
    if (newDrafts.length) {
      setDraftItems([...newDrafts, ...draftItems]);
      setDraftPage(1);
    }
    return { addedCount: newDrafts.length, mergedCount: nextDrafts.length - newDrafts.length };
  }

  function updateDraftItem(id: string, patch: Partial<TradeDraft>) {
    setDraftItems((items) => items.map((item) => (item.id === id ? applyDraftPatch(item, patch) : item)));
  }

  function removeDraftItem(id: string) {
    setDraftItems((items) => items.filter((item) => item.id !== id));
  }

  function clearDraftItems() {
    setDraftItems([]);
    setDraftPage(1);
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
    const result = saveParsedItems(materializeConfirmedDrafts(selected));
    setDraftItems(draftItems.filter((item) => !selected.some((saved) => saved.id === item.id)));
    setDraftPage(1);
    const changedCount = result.stockCount + result.marketCount + result.refreshedCount;
    setNotice({
      tone: changedCount ? "success" : "info",
      text: saveResultNoticeText(result),
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

  if (!authSession || !currentWorkspace) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <div className={`app-workbench mx-auto grid min-h-screen max-w-[1440px] ${sidebarCollapsed ? "md:grid-cols-[72px_1fr]" : "md:grid-cols-[248px_1fr]"}`}>
        <aside className={`sidebar-surface hidden py-4 md:block ${sidebarCollapsed ? "px-2" : "px-3"}`}>
          <div className={`mb-5 flex items-center gap-2 px-2 ${sidebarCollapsed ? "justify-center" : "justify-between"}`}>
            <div className="flex min-w-0 items-center gap-2">
              <BrandIcon size="sm" />
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <h1 className="truncate text-[15px] font-semibold leading-tight text-neutral-950">货记</h1>
                  <p className="caption-text truncate">供需情报工作台</p>
                </div>
              )}
            </div>
            {!sidebarCollapsed && (
              <button
                type="button"
                title="收起左侧栏"
                aria-label="收起左侧栏"
                onClick={() => setSidebarCollapsed(true)}
                className="sidebar-toggle ghost-button flex h-8 w-8 items-center justify-center rounded-md"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
          </div>

          {sidebarCollapsed ? (
            <button
              type="button"
              title="展开左侧栏"
              aria-label="展开左侧栏"
              onClick={() => setSidebarCollapsed(false)}
              className="sidebar-toggle ghost-button mx-auto mb-4 flex h-9 w-9 items-center justify-center rounded-md"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          ) : (
            <WorkspaceSwitcher currentWorkspace={currentWorkspace} />
          )}

          <nav className="space-y-1">
            <NavButton compact={sidebarCollapsed} active={activeTab === "input"} icon={<Sparkles />} label="货记" onClick={() => setActiveTab("input")} />
            <NavButton compact={sidebarCollapsed} active={activeTab === "stock"} icon={<Boxes />} label="供应" onClick={() => setActiveTab("stock")} />
            <NavButton compact={sidebarCollapsed} active={activeTab === "market"} icon={<Compass />} label="需求" onClick={() => setActiveTab("market")} />
            <NavButton compact={sidebarCollapsed} active={activeTab === "match"} icon={<GitCompareArrows />} label="匹配" onClick={() => setActiveTab("match")} />
            <NavButton compact={sidebarCollapsed} active={activeTab === "account"} icon={<WalletCards />} label="个人中心" onClick={() => setActiveTab("account")} />
          </nav>

          {!sidebarCollapsed && (
          <div className="mt-6 space-y-2 border-t border-neutral-200/80 pt-4">
            <SideMetric label="我的供应" value={`${stocks.length}`} />
            <SideMetric label="已核实" value={`${verifiedStockCount}`} />
            <SideMetric label="需求" value={`${demandCount}`} />
            <SideMetric label="强匹配" value={`${strongMatchCount}`} />
            <SideMetric label="货记分" value={`${accountWallet.creditBalance}`} />
          </div>
          )}
        </aside>

        <main className="min-w-0 pb-32 md:pb-8">
          <header className="topbar-surface sticky top-0 z-30">
            <div className="flex items-center justify-end gap-3 px-4 py-3 md:px-8">
              <div className="flex shrink-0 items-center gap-2">
                <div className="surface-card-quiet caption-text hidden items-center gap-2 rounded-md px-3 py-1.5 sm:flex">
                  <UserRound className="h-3.5 w-3.5 text-neutral-500" />
                  {authSession.user.maskedPhone}
                </div>
                <button
                  type="button"
                  title="个人中心"
                  aria-label="个人中心"
                  onClick={() => setActiveTab("account")}
                  className="surface-card-quiet ghost-button flex h-9 w-9 items-center justify-center rounded-md"
                >
                  <WalletCards className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="退出登录"
                  aria-label="退出登录"
                  onClick={handleLogout}
                  className="surface-card-quiet ghost-button flex h-9 w-9 items-center justify-center rounded-md"
                >
                  <LogOut className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title={inspectorCollapsed ? "打开右侧栏" : "收起右侧栏"}
                  aria-label={inspectorCollapsed ? "打开右侧栏" : "收起右侧栏"}
                  onClick={() => setInspectorCollapsed((collapsed) => !collapsed)}
                  className={`surface-card-quiet ghost-button hidden h-9 w-9 items-center justify-center rounded-md lg:flex ${inspectorCollapsed ? "" : "is-active"}`}
                >
                  {inspectorCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </header>

          <section className="mx-auto max-w-none space-y-5 px-4 py-5 md:px-8 md:py-7">

          {notice && <InlineNotice tone={notice.tone} text={notice.text} onDismiss={() => setNotice(null)} />}

          {activeTab === "stock" && (
            <div className={`inspector-layout grid ${inspectorCollapsed ? "gap-0 lg:grid-cols-[minmax(0,1fr)_0px]" : "gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_380px]"}`}>
              <div className="min-w-0 space-y-3">
                {listSearchBox}
                <FilterPanel
                  title="筛选供应"
                  activeCount={activeStockFilterCount}
                  resultText={`已显示 ${filteredStocks.length} 条，按录入时间最新在前`}
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
                    <div className={`${stockFiltersOpen ? "grid" : "hidden"} smart-filter-advanced`}>
                      <FilterPillGroup
                        label="交易"
                        value={stockModeFilter}
                        options={[{ label: "全部大类", value: "ALL" }, ...tradeModeOptions]}
                        onChange={(value) => {
                          setStockModeFilter(value as TradeMode | "ALL");
                          setStockPage(1);
                        }}
                      />
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
                <StockDataTable
                  items={pagedStocks}
                  selectedId={selectedStock?.id ?? ""}
                  onSelect={(stock) => setSelectedStockId(stock.id)}
                />
                {!pagedStocks.length && <EmptyState title="暂无符合条件的货源" actionLabel="去货记" onAction={() => setActiveTab("input")} />}
                {filteredStocks.length > 0 && (
                  <Pagination
                    total={filteredStocks.length}
                    page={stockCurrentPage}
                    onPageChange={setStockPage}
                  />
                )}
              </div>
              <div className={`inspector-slot hidden lg:block ${inspectorCollapsed ? "is-collapsed" : ""}`} aria-hidden={inspectorCollapsed}>
                <TradeDetailDrawer
                  kind="stock"
                  item={selectedStock}
                />
              </div>
            </div>
          )}

          {activeTab === "input" && (
            <div className="space-y-3 md:space-y-4">
              <div className={`inspector-layout grid ${inspectorCollapsed ? "gap-0 lg:grid-cols-[minmax(0,1fr)_0px]" : "gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]"}`}>
                <Panel title="智能货记" icon={<Bot />}>
                  <div className="smart-chat-history space-y-2 overflow-y-auto rounded-md bg-[#f3f2ee]/80 p-3">
                    {chatMessages.map((message) => (
                      <ChatBubble key={message.id} message={message} />
                    ))}
                  </div>

                  <div className="mt-3 space-y-3">
                    <div className="smart-chip-row">
                      <SmartChip label="类型" value="自动判断" />
                      <SmartChip label="品类" value="自动归类" />
                      <SmartChip label="重复" value="更新时间" />
                      <SmartChip label="缺字段" value="可先入库" />
                    </div>
                    <textarea
                      value={aiText}
                      onChange={(event) => setAiText(event.target.value)}
                      className="smart-input field-surface min-h-32 w-full resize-y rounded-md p-4 text-neutral-900 outline-none placeholder:text-neutral-400 md:min-h-36"
                      placeholder="粘贴微信群聊天记录，或直接输入一条供需信息。"
                    />
                    {aiParseMessage && (
                      <p className="meta-pill rounded-md px-3 py-2">{aiParseMessage}</p>
                    )}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="caption-text text-neutral-400">{aiLineCount ? `${aiLineCount} 行文本，AI 会自动拆分多条记录` : "等待输入"}</span>
                      <div className="flex items-center gap-1">
                        <ToolbarButton icon={<Sparkles />} label="示例" onClick={() => setAiText(AI_EXAMPLE_TEXT)} />
                        <ToolbarButton icon={<Trash2 />} label="清空" onClick={() => setAiText("")} />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={parseAssistantInput}
                      disabled={isAiParsing}
                      className="primary-button inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-medium disabled:cursor-not-allowed"
                    >
                      <SendHorizontal className="h-4 w-4" />
                      {isAiParsing ? "AI 正在解析..." : "智能解析"}
                    </button>
                  </div>
                </Panel>

                <div className={`inspector-slot hidden lg:block ${inspectorCollapsed ? "is-collapsed" : ""}`} aria-hidden={inspectorCollapsed}>
                <aside className="right-inspector grid h-fit gap-3">
                  <SmartStatusBar
                    supplyCount={stocks.length}
                    demandCount={demandCount}
                    draftCount={draftItems.length}
                    incompleteCount={draftSummary.incomplete}
                  />
                  <Panel title="AI 解析结果" icon={<ClipboardCheck />}>
                    <div className="mb-3 flex flex-col gap-3 border-b border-neutral-100 pb-3">
                      <SmartResultSummary
                        goods={draftSummary.goods}
                        demands={draftSummary.demands}
                        incomplete={draftSummary.incomplete}
                        total={draftItems.length}
                      />
                      {draftItems.length > 0 && (
                        <div className="grid grid-cols-[1fr_auto] gap-2">
                          <button
                            type="button"
                            onClick={() => confirmDrafts()}
                            disabled={!saveableDraftCount}
                            className="primary-button inline-flex items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed"
                          >
                            <Check className="h-4 w-4" />
                            一键入库
                          </button>
                          <button
                            type="button"
                            onClick={clearDraftItems}
                            className="ghost-button inline-flex items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            清空
                          </button>
                        </div>
                      )}
                    </div>

                    {!draftItems.length ? (
                      <AssistantEmptyState />
                    ) : (
                      <div className="space-y-4">
                        <p className="meta-pill rounded-md px-3 py-2">
                          可以直接保存；缺字段会以“待确认 / 未知来源”保留，后续再补也不会丢。当前显示第 {draftCurrentPage} 页。
                        </p>
                        {pagedDrafts.map((draft, index) => (
                          <DraftReviewItem
                            key={draft.id}
                            draft={draft}
                            index={(draftCurrentPage - 1) * LIST_PAGE_SIZE + index}
                            onChange={(patch) => updateDraftItem(draft.id, patch)}
                            onRemove={() => removeDraftItem(draft.id)}
                            onConfirm={() => confirmDrafts([draft.id])}
                          />
                        ))}
                        {draftItems.length > LIST_PAGE_SIZE && (
                          <Pagination
                            total={draftItems.length}
                            page={draftCurrentPage}
                            onPageChange={setDraftPage}
                          />
                        )}
                      </div>
                    )}
                  </Panel>
                </aside>
                </div>
              </div>
            </div>
          )}

          {activeTab === "market" && (
            <div className={`inspector-layout grid ${inspectorCollapsed ? "gap-0 lg:grid-cols-[minmax(0,1fr)_0px]" : "gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_380px]"}`}>
              <div className="min-w-0 space-y-3">
                {listSearchBox}
                <FilterPanel
                  title="筛选需求"
                  activeCount={activeMarketFilterCount}
                  resultText={`已显示 ${filteredMarket.length} 条需求，按创建时间最新在前`}
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
                    <div className={`${marketFiltersOpen ? "grid" : "hidden"} smart-filter-advanced`}>
                      <FilterPillGroup
                        label="交易"
                        value={marketModeFilter}
                        options={[{ label: "全部大类", value: "ALL" }, ...tradeModeOptions]}
                        onChange={(value) => {
                          setMarketModeFilter(value as TradeMode | "ALL");
                          setMarketPage(1);
                        }}
                      />
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
                <MarketDataTable
                  items={pagedMarket}
                  selectedId={selectedMarket?.id ?? ""}
                  onSelect={(post) => setSelectedMarketId(post.id)}
                />
                {!pagedMarket.length && <EmptyState title="暂无符合条件的需求" actionLabel="去货记" onAction={() => setActiveTab("input")} />}
                {filteredMarket.length > 0 && (
                  <Pagination
                    total={filteredMarket.length}
                    page={marketCurrentPage}
                    onPageChange={setMarketPage}
                  />
                )}
              </div>
              <div className={`inspector-slot hidden lg:block ${inspectorCollapsed ? "is-collapsed" : ""}`} aria-hidden={inspectorCollapsed}>
                <TradeDetailDrawer
                  kind="market"
                  item={selectedMarket}
                />
              </div>
            </div>
          )}

          {activeTab === "match" && (
            <div className={`inspector-layout grid ${inspectorCollapsed ? "gap-0 lg:grid-cols-[minmax(0,1fr)_0px]" : "gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]"}`}>
              <div className="min-w-0 space-y-3">
                {listSearchBox}
                <MatchViewSwitch value={matchView} onChange={(value) => {
                  setMatchView(value);
                  setMatchPage(1);
                }} />
                <FilterPanel
                  title="筛选匹配"
                  activeCount={activeMatchFilterCount}
                  resultText={`已生成 ${matchCandidates.length} 个机会，当前显示 ${filteredMatches.length} 个`}
                  isOpen={matchFiltersOpen}
                  onToggle={() => setMatchFiltersOpen((open) => !open)}
                  onReset={resetMatchFilters}
                >
                  <div className="smart-filter-layout">
                    <FilterPillGroup
                      label="品类"
                      value={matchCategoryFilter}
                      options={[{ label: "全部品类", value: "ALL" }, ...productCategoryOptions]}
                      onChange={(value) => {
                        setMatchCategoryFilter(value as ProductCategory | "ALL");
                        setMatchPage(1);
                      }}
                    />
                    <div className={`${matchFiltersOpen ? "grid" : "hidden"} smart-filter-advanced`}>
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
                  </div>
                </FilterPanel>
                <MatchDataTable
                  items={pagedMatches}
                  selectedId={selectedMatch?.id ?? ""}
                  onSelect={(candidate) => setSelectedMatchId(candidate.id)}
                />
                {!pagedMatches.length && <EmptyState title="暂无匹配机会" actionLabel="去货记" onAction={() => setActiveTab("input")} />}
                {filteredMatches.length > 0 && (
                  <Pagination
                    total={filteredMatches.length}
                    page={matchCurrentPage}
                    onPageChange={setMatchPage}
                  />
                )}
              </div>
              <div className={`inspector-slot hidden lg:block ${inspectorCollapsed ? "is-collapsed" : ""}`} aria-hidden={inspectorCollapsed}>
                <MatchDetailDrawer
                  candidate={selectedMatch}
                  onStatusChange={updateMatchStatus}
                  onCopy={copyMatchSummary}
                />
              </div>
            </div>
          )}

          {activeTab === "account" && (
            <AccountCenter
              session={authSession}
              wallet={accountWallet}
              section={accountSection}
              onSectionChange={setAccountSection}
              onRecharge={handleRechargeCredits}
              onUpgrade={handleUpgradePlan}
            />
          )}
          </section>
        </main>
      </div>

      <nav className="mobile-tabbar fixed inset-x-3 bottom-3 z-40 grid grid-cols-5 rounded-md px-1.5 py-1.5 md:hidden">
        <MobileTab active={activeTab === "input"} icon={<Sparkles />} label="货记" onClick={() => setActiveTab("input")} />
        <MobileTab active={activeTab === "stock"} icon={<Boxes />} label="供应" onClick={() => setActiveTab("stock")} />
        <MobileTab active={activeTab === "market"} icon={<Compass />} label="需求" onClick={() => setActiveTab("market")} />
        <MobileTab active={activeTab === "match"} icon={<GitCompareArrows />} label="匹配" onClick={() => setActiveTab("match")} />
        <MobileTab active={activeTab === "account"} icon={<WalletCards />} label="我的" onClick={() => setActiveTab("account")} />
      </nav>
    </div>
  );
}

function AccountCenter({
  session,
  wallet,
  section,
  onSectionChange,
  onRecharge,
  onUpgrade,
}: {
  session: AuthSession;
  wallet: AccountWallet;
  section: AccountSection;
  onSectionChange: (section: AccountSection) => void;
  onRecharge: (pack: (typeof creditPackages)[number]) => void;
  onUpgrade: (planCode: MembershipPlanCode) => void;
}) {
  const currentPlan = membershipPlans.find((plan) => plan.code === wallet.planCode) ?? membershipPlans[0];
  const sectionItems: Array<{ key: AccountSection; label: string; icon: React.ReactNode }> = [
    { key: "overview", label: "账户概览", icon: <UserRound /> },
    { key: "membership", label: "会员中心", icon: <ShieldCheck /> },
    { key: "credits", label: "货记分", icon: <WalletCards /> },
    { key: "ledger", label: "订单与流水", icon: <ReceiptText /> },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="surface-card h-fit rounded-md p-2">
        <div className="mb-2 rounded-md bg-neutral-950/[0.025] px-3 py-3">
          <p className="text-sm font-semibold text-neutral-950">{session.user.maskedPhone}</p>
          <p className="caption-text mt-1">个人版 · 所有者</p>
        </div>
        <nav className="grid gap-1">
          {sectionItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onSectionChange(item.key)}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition ${
                section === item.key ? "bg-neutral-950 text-white" : "text-neutral-600 hover:bg-neutral-950/5 hover:text-neutral-950"
              }`}
            >
              {React.cloneElement(item.icon as React.ReactElement<{ className?: string }>, { className: "h-4 w-4" })}
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 space-y-4">
        {section === "overview" && (
          <>
            <section className="surface-card rounded-md p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="caption-text">账户</p>
                  <h3 className="mt-1 text-2xl font-semibold text-neutral-950">{session.user.maskedPhone}</h3>
                  <p className="mt-1 text-sm text-neutral-500">个人空间已开通，企业空间权限预留中。</p>
                </div>
                <Badge tone={wallet.membershipStatus === "ACTIVE" ? "green" : "default"}>{wallet.planName}</Badge>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <AccountMetric label="货记分余额" value={`${wallet.creditBalance}`} helper="AI 解析和增值功能消耗" tone="green" />
                <AccountMetric label="本月 AI 解析" value={`${wallet.monthlyAiParseCount}`} helper="解析成功或本地兜底都会计入" tone="blue" />
                <AccountMetric label="会员有效期" value={wallet.membershipExpiresAt ? formatDate(wallet.membershipExpiresAt) : "免费版"} helper={currentPlan.period} tone="orange" />
              </div>
            </section>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="会员权益" icon={<ShieldCheck />}>
                <p className="text-sm text-neutral-600">当前方案：<strong className="text-neutral-950">{wallet.planName}</strong></p>
                <ul className="mt-3 grid gap-2">
                  {currentPlan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-sm text-neutral-700">
                      <Check className="h-4 w-4 text-emerald-600" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title="最近流水" icon={<ReceiptText />}>
                <TransactionList transactions={wallet.transactions.slice(0, 4)} />
              </Panel>
            </div>
          </>
        )}

        {section === "membership" && (
          <section className="grid gap-3 lg:grid-cols-3">
            {membershipPlans.map((plan) => (
              <div key={plan.code} className={`interactive-card rounded-md p-4 ${wallet.planCode === plan.code ? "ring-2 ring-neutral-950/80" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Badge tone={plan.code === "FREE" ? "default" : "blue"}>{plan.badge}</Badge>
                    <h3 className="mt-3 text-lg font-semibold text-neutral-950">{plan.name}</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-semibold text-neutral-950">{plan.price}</p>
                    <p className="caption-text">{plan.period}</p>
                  </div>
                </div>
                <ul className="mt-4 grid gap-2">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2 text-sm text-neutral-700">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => onUpgrade(plan.code)}
                  className={`mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                    wallet.planCode === plan.code ? "ghost-button surface-card-quiet" : "primary-button"
                  }`}
                >
                  <CreditCard className="h-4 w-4" />
                  {wallet.planCode === plan.code ? "当前方案" : "模拟开通"}
                </button>
              </div>
            ))}
          </section>
        )}

        {section === "credits" && (
          <>
            <section className="surface-card rounded-md p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="caption-text">货记分余额</p>
                  <p className="mt-1 text-3xl font-semibold text-neutral-950">{wallet.creditBalance}</p>
                </div>
                <p className="max-w-xl text-sm text-neutral-500">货记分用于 AI 解析、批量入库、后续导出和广场刷新等增值能力。当前支付未接入，充值按钮为模拟入账。</p>
              </div>
            </section>
            <section className="grid gap-3 md:grid-cols-3">
              {creditPackages.map((pack) => (
                <div key={pack.id} className="interactive-card rounded-md p-4">
                  <Badge tone="green">{pack.label}</Badge>
                  <h3 className="mt-3 text-lg font-semibold text-neutral-950">{pack.title}</h3>
                  <p className="mt-1 text-sm text-neutral-500">{pack.credits} 分{pack.bonus ? ` + ${pack.bonus} 赠送` : ""}</p>
                  <p className="mt-4 text-2xl font-semibold text-neutral-950">{pack.price}</p>
                  <button
                    type="button"
                    onClick={() => onRecharge(pack)}
                    className="primary-button mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium"
                  >
                    <Plus className="h-4 w-4" />
                    模拟充值
                  </button>
                </div>
              ))}
            </section>
          </>
        )}

        {section === "ledger" && (
          <Panel title="订单与流水" icon={<ReceiptText />}>
            <TransactionList transactions={wallet.transactions} />
          </Panel>
        )}
      </div>
    </div>
  );
}

function AccountMetric({ label, value, helper, tone }: { label: string; value: string; helper: string; tone: BadgeTone }) {
  return (
    <div className={`smart-metric smart-metric-${tone} min-h-[86px] items-start p-3`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <span className="text-xs font-medium text-neutral-500">{helper}</span>
    </div>
  );
}

function TransactionList({ transactions }: { transactions: CreditTransaction[] }) {
  if (!transactions.length) {
    return (
      <div className="surface-card-quiet rounded-md p-4 text-sm text-neutral-500">
        暂无流水。充值、会员开通和 AI 消耗会记录在这里。
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      {transactions.map((transaction) => (
        <div key={transaction.id} className="grid gap-2 rounded-md border border-neutral-950/[0.06] bg-white/70 px-3 py-2 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={transaction.amount >= 0 ? "green" : "orange"}>{creditTransactionTypeText(transaction.type)}</Badge>
              <p className="truncate text-sm font-semibold text-neutral-950">{transaction.title}</p>
            </div>
            <p className="caption-text mt-1">{formatMinuteTime(transaction.createdAt)} · 余额 {transaction.balanceAfter}{transaction.note ? ` · ${transaction.note}` : ""}</p>
          </div>
          <p className={`text-sm font-semibold ${transaction.amount >= 0 ? "text-emerald-700" : "text-amber-700"}`}>
            {transaction.amount >= 0 ? "+" : ""}{transaction.amount}
          </p>
        </div>
      ))}
    </div>
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

function LoginScreen({ onLogin }: { onLogin: (session: AuthSession) => void }) {
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
    <div className="app-shell flex min-h-screen items-center justify-center px-4 py-8 text-neutral-950">
      <main className="grid w-full max-w-5xl gap-4 md:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.75fr)]">
        <section className="surface-card rounded-md p-5 md:p-6">
          <div className="mb-6 flex items-center gap-2">
            <BrandIcon />
            <div>
              <h1 className="section-title">货记</h1>
              <p className="caption-text">AI 硬件供需台账</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="surface-card-quiet rounded-md p-3">
              <div className="mb-2 flex items-center gap-2">
                <UserRound className="h-4 w-4 text-neutral-500" />
                <span className="text-sm font-semibold text-neutral-900">个人空间</span>
                <Badge tone="green">当前开放</Badge>
              </div>
              <p className="caption-text">手机号登录后自动创建个人空间，供应、需求和待确认结果按空间隔离保存。</p>
            </div>
            <div className="surface-card-quiet rounded-md p-3 opacity-80">
              <div className="mb-2 flex items-center gap-2">
                <Building2 className="h-4 w-4 text-neutral-500" />
                <span className="text-sm font-semibold text-neutral-900">企业空间</span>
                <Badge>架构预留</Badge>
              </div>
              <p className="caption-text">企业成员、角色权限、企业货源池和审批流先按 workspace 体系预留，不影响个人版使用。</p>
            </div>
          </div>
        </section>

        <form onSubmit={handleLogin} className="surface-card rounded-md p-5 md:p-6">
          <div className="mb-5">
            <h2 className="section-title">手机号登录</h2>
            <p className="caption-text mt-1">登录后进入你的个人空间。</p>
          </div>
          <label className="block">
            <span className="caption-text mb-1 block">手机号</span>
            <div className="field-surface flex items-center gap-2 rounded-md px-3 py-2">
              <Phone className="h-4 w-4 text-neutral-400" />
              <input
                value={phone}
                inputMode="tel"
                placeholder="请输入 11 位手机号"
                onChange={(event) => setPhone(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
              />
            </div>
          </label>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="caption-text mb-1 block">短信验证码 / 临时通用码</span>
              <div className="field-surface flex items-center gap-2 rounded-md px-3 py-2">
                <ShieldCheck className="h-4 w-4 text-neutral-400" />
                <input
                  value={code}
                  inputMode="numeric"
                  placeholder="验证码或 11111111"
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
          {debugCode && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">原型验证码：{debugCode}</p>}
          {message && !debugCode && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">{message}</p>}
          {error && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{error}</p>}
          <button
            type="submit"
            disabled={isLoggingIn || !normalizedPhone || !code.trim()}
            className="primary-button mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium disabled:cursor-not-allowed"
          >
            <Check className="h-4 w-4" />
            {isLoggingIn ? "登录中..." : "进入个人空间"}
          </button>
        </form>
      </main>
    </div>
  );
}

function MatchViewSwitch({ value, onChange }: { value: MatchView; onChange: (value: MatchView) => void }) {
  const items: Array<{ key: MatchView; label: string; helper: string }> = [
    { key: "RECOMMENDED", label: "推荐机会", helper: "优先看 75 分以上" },
    { key: "DEMAND_TO_SUPPLY", label: "需求找供应", helper: "从需求反查库存" },
    { key: "SUPPLY_TO_DEMAND", label: "供应找需求", helper: "从货源反查买家" },
  ];

  return (
    <div className="match-switch surface-card-quiet grid gap-2 rounded-md p-1.5 md:grid-cols-3">
      {items.map((item) => {
        const active = value === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={`rounded-md px-3 py-2 text-left transition ${active ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-white/80 hover:text-neutral-950"}`}
          >
            <span className="block text-sm font-semibold">{item.label}</span>
            <span className={`mt-0.5 block text-xs font-medium ${active ? "text-white/64" : "text-neutral-400"}`}>{item.helper}</span>
          </button>
        );
      })}
    </div>
  );
}

function MatchDataTable({
  items,
  selectedId,
  onSelect,
}: {
  items: MatchCandidate[];
  selectedId: string;
  onSelect: (item: MatchCandidate) => void;
}) {
  return (
    <div className="surface-card overflow-hidden rounded-md">
      <div className="grid gap-2 p-2 md:hidden">
        {items.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => onSelect(candidate)}
            className={`match-mobile-card rounded-md p-3 text-left ${selectedId === candidate.id ? "is-selected" : ""}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <ScoreBadge candidate={candidate} />
                  <Badge tone="blue">{productCategoryText(candidate.demand.productCategory)}</Badge>
                  <Badge tone={tradeModeTone(candidate.demand.tradeMode)}>{tradeModeText(candidate.demand.tradeMode)}</Badge>
                </div>
                <p className="truncate text-sm font-semibold text-neutral-950">{candidate.demand.title}</p>
                <p className="mt-0.5 truncate text-xs text-neutral-500">可匹配：{candidate.stock.title}</p>
              </div>
              <Badge tone={matchStatusTone(candidate.status)}>{matchStatusText(candidate.status)}</Badge>
            </div>
            <p className="mt-2 line-clamp-2 text-xs font-medium text-neutral-500">{candidate.reasons.slice(0, 2).join("，") || "等待补充匹配原因"}</p>
          </button>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="huoji-table min-w-[1060px]">
          <thead>
            <tr>
              <th className="w-[110px]">匹配度</th>
              <th>需求</th>
              <th>供应</th>
              <th className="w-[94px]">城市</th>
              <th className="w-[96px]">数量</th>
              <th className="w-[96px]">交易</th>
              <th className="w-[98px]">状态</th>
              <th className="w-[118px]">更新时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map((candidate) => (
              <tr
                key={candidate.id}
                onClick={() => onSelect(candidate)}
                className={selectedId === candidate.id ? "is-selected" : ""}
              >
                <td><ScoreBadge candidate={candidate} /></td>
                <td>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-neutral-950">{candidate.demand.title}</p>
                    <p className="truncate text-xs text-neutral-500">{candidate.demand.sourceContact}</p>
                  </div>
                </td>
                <td>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-neutral-950">{candidate.stock.title}</p>
                    <p className="truncate text-xs text-neutral-500">{candidate.stock.sourceContact}</p>
                  </div>
                </td>
                <td>{candidate.stock.locationCity || candidate.demand.locationCity || "待确认"}</td>
                <td>{quantityText(candidate.stock.quantity, candidate.stock.quantityUnit)} / {quantityText(candidate.demand.quantity, candidate.demand.quantityUnit)}</td>
                <td><Badge tone={tradeModeTone(candidate.demand.tradeMode)}>{tradeModeText(candidate.demand.tradeMode)}</Badge></td>
                <td><Badge tone={matchStatusTone(candidate.status)}>{matchStatusText(candidate.status)}</Badge></td>
                <td>{formatHourTime(candidate.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > 0 && (
        <div className="border-t border-neutral-100 px-3 py-2 text-xs font-medium text-neutral-400">
          点击任意机会查看匹配解释。当前页 {items.length} 条。
        </div>
      )}
    </div>
  );
}

function ScoreBadge({ candidate }: { candidate: MatchCandidate }) {
  return (
    <span className={`score-badge score-badge-${candidate.level.toLowerCase()}`}>
      <strong>{candidate.scoreTotal}</strong>
      <span>{matchLevelText(candidate.level)}</span>
    </span>
  );
}

function MatchDetailDrawer({
  candidate,
  onStatusChange,
  onCopy,
}: {
  candidate: MatchCandidate | null;
  onStatusChange: (candidateId: string, status: MatchStatus) => void;
  onCopy: (candidate: MatchCandidate) => void;
}) {
  if (!candidate) {
    return (
      <aside className="right-inspector surface-card hidden h-fit rounded-md p-4 lg:block">
        <p className="text-sm font-semibold text-neutral-700">暂无匹配机会</p>
        <p className="caption-text mt-1">系统会用本体规则把需求和供应自动归一化，再生成可解释的匹配结果。</p>
      </aside>
    );
  }

  return (
    <aside className="right-inspector surface-card hidden h-fit rounded-md p-4 lg:block">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone="orange">需求</Badge>
        <Badge tone="green">供应</Badge>
        <Badge tone="blue">{productCategoryText(candidate.demand.productCategory)}</Badge>
        <Badge tone={tradeModeTone(candidate.demand.tradeMode)}>{tradeModeText(candidate.demand.tradeMode)}</Badge>
      </div>
      <div className="score-hero rounded-md p-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="caption-text">综合匹配度</p>
            <p className="mt-1 text-3xl font-semibold text-neutral-950">{candidate.scoreTotal}</p>
          </div>
          <Badge tone={matchLevelTone(candidate.level)}>{matchLevelText(candidate.level)}</Badge>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-950/10">
          <div className="h-full rounded-full bg-neutral-950" style={{ width: `${candidate.scoreTotal}%` }} />
        </div>
      </div>

      <section className="mt-4">
        <p className="mb-2 text-xs font-semibold text-neutral-500">为什么匹配</p>
        <div className="grid gap-2">
          {candidate.reasons.map((reason) => (
            <div key={reason} className="flex gap-2 rounded-md bg-emerald-50/80 px-3 py-2 text-sm font-medium text-emerald-800">
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{reason}</span>
            </div>
          ))}
        </div>
      </section>

      {candidate.riskNotes.length > 0 && (
        <section className="mt-4">
          <p className="mb-2 text-xs font-semibold text-neutral-500">需要确认</p>
          <div className="grid gap-2">
            {candidate.riskNotes.map((note) => (
              <div key={note} className="flex gap-2 rounded-md bg-amber-50/85 px-3 py-2 text-sm font-medium text-amber-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{note}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-4 grid gap-2">
        <MatchTradeCard title="需求" item={candidate.demand} />
        <MatchTradeCard title="供应" item={candidate.stock} />
      </section>

      <section className="mt-4 border-t border-neutral-100 pt-3">
        <p className="mb-2 text-xs font-semibold text-neutral-500">打分明细</p>
        <div className="grid gap-2">
          {candidate.scoreDetail.map((detail) => (
            <div key={detail.label} className="score-detail-row">
              <div className="flex items-center justify-between gap-2 text-xs font-medium">
                <span className="text-neutral-600">{detail.label}</span>
                <span className="text-neutral-400">{detail.score}/{detail.max}</span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">{detail.note}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onStatusChange(candidate.id, "CONTACTED")}
          className="primary-button inline-flex items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-medium"
        >
          <MessageCircle className="h-4 w-4" />
          已联系
        </button>
        <button
          type="button"
          onClick={() => onCopy(candidate)}
          className="ghost-button surface-card-quiet inline-flex items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-medium"
        >
          <ClipboardCheck className="h-4 w-4" />
          复制摘要
        </button>
        <button
          type="button"
          onClick={() => onStatusChange(candidate.id, "NEW")}
          className="ghost-button surface-card-quiet inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium"
        >
          新机会
        </button>
        <button
          type="button"
          onClick={() => onStatusChange(candidate.id, "IGNORED")}
          className="ghost-button surface-card-quiet inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium"
        >
          忽略
        </button>
      </div>
    </aside>
  );
}

function MatchTradeCard({ title, item }: { title: string; item: StockItem | MarketPost }) {
  const isStock = "createdAt" in item;
  return (
    <div className="rounded-md bg-neutral-950/[0.03] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-neutral-500">{title}</p>
        <span className="caption-text">{formatHourTime(isStock ? item.createdAt : item.publishedAt)}</span>
      </div>
      <p className="text-sm font-semibold text-neutral-950">{item.title}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <InfoDatum label="规格" value={isStock ? stockSpecText(item) : (item.gpuModel || "待确认")} />
        <InfoDatum label="数量" value={quantityText(item.quantity, item.quantityUnit)} />
        <InfoDatum label="城市" value={item.locationCity || "待确认"} />
        <InfoDatum label={isStock ? "价格" : "预算"} value={item.priceAmount ? formatMoney(item.priceAmount) : "待确认"} strong={Boolean(item.priceAmount)} />
        <InfoDatum label="来源用户" value={item.sourceContact || "未知来源"} />
        {!isStock && <InfoDatum label="联系方式" value={(item as MarketPost).contactMethod || "站内联系"} />}
      </div>
    </div>
  );
}

function StockDataTable({
  items,
  selectedId,
  onSelect,
}: {
  items: StockItem[];
  selectedId: string;
  onSelect: (item: StockItem) => void;
}) {
  return (
    <div className="surface-card overflow-hidden rounded-md">
      <div className="overflow-x-auto">
        <table className="huoji-table min-w-[980px]">
          <thead>
            <tr>
              <th className="w-[84px]">品类</th>
              <th>型号 / 规格</th>
              <th className="w-[96px]">数量</th>
              <th className="w-[88px]">城市</th>
              <th className="w-[88px]">交易</th>
              <th className="w-[118px]">价格</th>
              <th className="w-[150px]">来源用户</th>
              <th className="w-[86px]">状态</th>
              <th className="w-[118px]">录入时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map((stock) => (
              <tr
                key={stock.id}
                onClick={() => onSelect(stock)}
                className={selectedId === stock.id ? "is-selected" : ""}
              >
                <td><Badge tone="blue">{productCategoryText(stock.productCategory)}</Badge></td>
                <td>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-neutral-950">{stock.title}</p>
                    <p className="truncate text-xs text-neutral-500">{stockSpecText(stock)}</p>
                  </div>
                </td>
                <td>{quantityText(stock.quantity, stock.quantityUnit)}</td>
                <td>{stock.locationCity || "待确认"}</td>
                <td><Badge tone={tradeModeTone(stock.tradeMode)}>{tradeModeText(stock.tradeMode)}</Badge></td>
                <td className="font-semibold text-neutral-900">{stock.priceAmount ? formatMoney(stock.priceAmount) : "待确认"}</td>
                <td className="max-w-[150px] truncate" title={stock.sourceContact}>{stock.sourceContact}</td>
                <td><Badge tone={statusTone(stock.status)}>{statusText(stock.status)}</Badge></td>
                <td>{formatHourTime(stock.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > 0 && (
        <div className="border-t border-neutral-100 px-3 py-2 text-xs font-medium text-neutral-400">
          点击任意行查看完整配置。当前页 {items.length} 条。
        </div>
      )}
    </div>
  );
}

function MarketDataTable({
  items,
  selectedId,
  onSelect,
}: {
  items: MarketPost[];
  selectedId: string;
  onSelect: (item: MarketPost) => void;
}) {
  return (
    <div className="surface-card overflow-hidden rounded-md">
      <div className="overflow-x-auto">
        <table className="huoji-table min-w-[920px]">
          <thead>
            <tr>
              <th className="w-[84px]">品类</th>
              <th>需求型号 / 规格</th>
              <th className="w-[96px]">数量</th>
              <th className="w-[88px]">城市</th>
              <th className="w-[88px]">交易</th>
              <th className="w-[118px]">预算</th>
              <th className="w-[150px]">来源用户</th>
              <th className="w-[88px]">联系</th>
              <th className="w-[118px]">创建时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map((post) => (
              <tr
                key={post.id}
                onClick={() => onSelect(post)}
                className={selectedId === post.id ? "is-selected" : ""}
              >
                <td><Badge tone="blue">{productCategoryText(post.productCategory)}</Badge></td>
                <td>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-neutral-950">{post.title}</p>
                    <p className="truncate text-xs text-neutral-500">{post.gpuModel || "规格待确认"}</p>
                  </div>
                </td>
                <td>{quantityText(post.quantity, post.quantityUnit)}</td>
                <td>{post.locationCity || "待确认"}</td>
                <td><Badge tone={tradeModeTone(post.tradeMode)}>{tradeModeText(post.tradeMode)}</Badge></td>
                <td className="font-semibold text-neutral-900">{post.priceAmount ? formatMoney(post.priceAmount) : "待确认"}</td>
                <td className="max-w-[150px] truncate" title={post.sourceContact}>{post.sourceContact}</td>
                <td className="max-w-[88px] truncate" title={post.contactMethod}>{post.contactMethod || "站内"}</td>
                <td>{formatHourTime(post.publishedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > 0 && (
        <div className="border-t border-neutral-100 px-3 py-2 text-xs font-medium text-neutral-400">
          点击任意行查看需求详情。当前页 {items.length} 条。
        </div>
      )}
    </div>
  );
}

function TradeDetailDrawer({
  kind,
  item,
}: {
  kind: "stock" | "market";
  item: StockItem | MarketPost | null;
}) {
  if (!item) {
    return (
      <aside className="right-inspector surface-card hidden h-fit rounded-md p-4 lg:block">
        <p className="text-sm font-semibold text-neutral-700">未选择记录</p>
        <p className="caption-text mt-1">点击左侧表格中的任意一行，这里会显示完整配置、来源和联系方式。</p>
      </aside>
    );
  }

  const isStock = kind === "stock";
  const title = item.title;
  const category = productCategoryText(item.productCategory);
  const mode = tradeModeText(item.tradeMode);
  const sourceContact = item.sourceContact;
  const time = isStock ? formatHourTime((item as StockItem).createdAt) : formatHourTime((item as MarketPost).publishedAt);
  const quantity = quantityText(item.quantity, item.quantityUnit);
  const model = isStock ? stockSpecText(item as StockItem) : ((item as MarketPost).gpuModel || "待确认");
  const priceLabel = isStock ? "价格" : "预算";
  const price = item.priceAmount ? formatMoney(item.priceAmount) : "待确认";

  return (
    <aside className="right-inspector surface-card hidden h-fit rounded-md p-4 lg:block">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={isStock ? "green" : "orange"}>{isStock ? "供应" : "需求"}</Badge>
        <Badge tone="blue">{category}</Badge>
        <Badge tone={tradeModeTone(item.tradeMode)}>{mode}</Badge>
      </div>
      <h3 className="section-title">{title}</h3>
      <p className="caption-text mt-1 text-neutral-400">{time}</p>

      <div className="mt-4 grid gap-2">
        <InfoDatum label="规格" value={model} />
        <InfoDatum label="数量" value={quantity} />
        <InfoDatum label="城市" value={item.locationCity || "待确认"} />
        <InfoDatum label={priceLabel} value={price} strong={Boolean(item.priceAmount)} />
        <InfoDatum label="来源用户" value={sourceContact || "未知来源"} />
        {!isStock && <InfoDatum label="联系方式" value={(item as MarketPost).contactMethod || "站内联系"} />}
        {isStock && <InfoDatum label="状态" value={statusText((item as StockItem).status)} />}
      </div>

      <ConfigSheet items={item.configItems} />
    </aside>
  );
}

function WorkspaceSwitcher({ currentWorkspace }: { currentWorkspace: WorkspaceSummary }) {
  return (
    <div className="mb-5 space-y-1 border-y border-neutral-200/80 py-3">
      <button type="button" className="surface-card-quiet flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left">
        <UserRound className="h-4 w-4 shrink-0 text-neutral-500" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-neutral-900">{currentWorkspace.name}</span>
          <span className="block text-xs font-medium text-neutral-400">个人版 · {currentWorkspace.role === "OWNER" ? "所有者" : "成员"}</span>
        </span>
      </button>
      <button
        type="button"
        disabled
        className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2.5 py-2 text-left opacity-60"
      >
        <Building2 className="h-4 w-4 shrink-0 text-neutral-500" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-neutral-700">企业空间</span>
          <span className="block text-xs font-medium text-neutral-400">企业版 · 待开通</span>
        </span>
      </button>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="surface-card rounded-md p-3 md:p-4">
      <div className="mb-3 flex items-center gap-2 text-neutral-800">
        {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: "h-4 w-4 text-neutral-500" })}
        <h2 className="section-title text-[15px]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SmartStatusBar({
  supplyCount,
  demandCount,
  draftCount,
  incompleteCount,
}: {
  supplyCount: number;
  demandCount: number;
  draftCount: number;
  incompleteCount: number;
}) {
  const statusText = draftCount
    ? `已拆解 ${draftCount} 条，${incompleteCount ? `${incompleteCount} 条待补` : "可直接入库"}`
    : "等待聊天记录";
  return (
    <div className="smart-status surface-card rounded-md p-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="smart-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-md">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-950">智能识别已开启</p>
          <p className="caption-text truncate">{statusText}</p>
        </div>
      </div>
      <div className="smart-metrics">
        <SmartMetric label="供应" value={supplyCount} tone="green" />
        <SmartMetric label="需求" value={demandCount} tone="orange" />
        <SmartMetric label="待入库" value={draftCount} tone="blue" />
      </div>
    </div>
  );
}

function SmartMetric({ label, value, tone }: { label: string; value: number; tone: BadgeTone }) {
  return (
    <div className={`smart-metric smart-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SmartChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="smart-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function SmartResultSummary({
  goods,
  demands,
  incomplete,
  total,
}: {
  goods: number;
  demands: number;
  incomplete: number;
  total: number;
}) {
  if (!total) {
    return (
      <div className="smart-result-empty rounded-md p-3">
        <p className="text-sm font-semibold text-neutral-800">等待解析结果</p>
        <p className="caption-text mt-1">AI 会把多条聊天记录拆成供应和需求。</p>
      </div>
    );
  }
  return (
    <div className="smart-result rounded-md p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-neutral-950">AI 已完成拆解</p>
          <p className="caption-text mt-1">
            {goods} 条供应，{demands} 条需求{incomplete ? `，${incomplete} 条信息不完整` : "，字段完整"}
          </p>
        </div>
        <Badge tone={incomplete ? "orange" : "green"}>{incomplete ? "可先入库" : "可入库"}</Badge>
      </div>
    </div>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
  compact = false,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`mb-1 flex w-full items-center rounded-md text-sm font-medium transition ${
        active ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-neutral-950/5 hover:text-neutral-950"
      } ${compact ? "h-10 justify-center px-0" : "gap-2 px-2.5 py-2"}`}
    >
      {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: `h-4 w-4 ${active ? "text-white" : "text-neutral-500"}` })}
      {!compact && label}
    </button>
  );
}

function MobileTab({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 px-2 py-2 text-xs font-medium transition ${
        active ? "rounded-md bg-neutral-950 text-white" : "text-neutral-500"
      }`}
    >
      {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: "h-5 w-5" })}
      {label}
    </button>
  );
}

function SideMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs transition hover:bg-neutral-950/5">
      <span className="font-medium text-neutral-500">{label}</span>
      <span className="font-semibold text-neutral-800">{value}</span>
    </div>
  );
}

function ToolbarButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ghost-button inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
    >
      {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: "h-3.5 w-3.5" })}
      {label}
    </button>
  );
}

const ChatBubble: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const isUser = message.role === "user";
  const toneClass: Record<NoticeTone, string> = {
    info: "bg-white text-neutral-600",
    success: "bg-emerald-50 text-emerald-800",
    warning: "bg-amber-50 text-amber-800",
  };
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-md px-3 py-2 text-sm leading-6 shadow-[0_0_0_1px_rgba(15,15,15,0.05)] ${
          isUser ? "bg-neutral-900 text-white" : toneClass[message.tone ?? "info"]
        }`}
      >
        {message.text}
      </div>
    </div>
  );
};

function AssistantEmptyState() {
  return (
    <div className="px-4 py-10 text-center">
      <div className="meta-pill mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-md text-neutral-400">
        <ClipboardCheck className="h-4 w-4" />
      </div>
      <p className="text-sm font-medium text-neutral-600">暂无待确认结果</p>
      <p className="caption-text mt-1 text-neutral-400">发送一段供需文本后，结果会先出现在这里。</p>
    </div>
  );
}

const DraftReviewItem: React.FC<{
  draft: TradeDraft;
  index: number;
  onChange: (patch: Partial<TradeDraft>) => void;
  onRemove: () => void;
  onConfirm: () => void;
}> = ({
  draft,
  index,
  onChange,
  onRemove,
  onConfirm,
}) => {
  const missingFields = tradeDraftMissingFields(draft);
  const hasMissingFields = missingFields.length > 0;
  return (
    <section className="surface-card-quiet rounded-md p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={draft.postType === "GOODS" ? "green" : "orange"}>{draft.postType === "GOODS" ? "供应" : "需求"}</Badge>
            <Badge tone={tradeModeTone(draft.tradeMode)}>{tradeModeText(draft.tradeMode)}</Badge>
            <Badge tone="blue">{productCategoryText(draft.productCategory)}</Badge>
            <Badge tone={draft.sourceContact && draft.sourceContact !== "未知来源" ? "default" : "orange"}>
              来源 {draft.sourceContact && draft.sourceContact !== "未知来源" ? draft.sourceContact : "待确认"}
            </Badge>
            <span className="text-xs font-medium text-neutral-400">#{index + 1}</span>
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-neutral-900">{draft.title || `${productCategoryText(draft.productCategory)} ${draft.gpuModel}`}</p>
          <div className="mt-2 grid gap-2 text-xs text-neutral-600 sm:grid-cols-4">
            <InfoDatum label="规格" value={draft.gpuModel || "待确认"} />
            <InfoDatum label="数量" value={draft.quantity ? `${draft.quantity}${draft.quantityUnit || ""}` : "待确认"} />
            <InfoDatum label="城市" value={draft.locationCity || "待确认"} />
            <InfoDatum label={draft.postType === "GOODS" ? "价格" : "预算"} value={draft.priceAmount || "待确认"} strong={Boolean(draft.priceAmount)} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`text-xs font-medium ${hasMissingFields ? "text-amber-600" : "text-neutral-400"}`}>
              {hasMissingFields ? "信息不完整，可先保存" : "字段完整，可保存"}
            </span>
            {missingFields.map((field) => (
              <Badge key={field} tone="orange">{`缺${field}`}</Badge>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRemove}
            className="ghost-button inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="primary-button inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium"
          >
            <Check className="h-3.5 w-3.5" />
            保存
          </button>
        </div>
      </div>

      <details className="mt-3 border-t border-neutral-100 pt-3">
        <summary className="caption-text cursor-pointer font-semibold text-neutral-500">展开编辑字段和详细配置</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <SelectField
            label="类型"
            value={draft.postType}
            options={[
              { label: "供应", value: "GOODS" },
              { label: "需求", value: "DEMAND" },
            ]}
            onChange={(value) => onChange({ postType: value as MarketType })}
          />
          <SelectField
            label="交易大类"
            value={draft.tradeMode}
            options={tradeModeOptions}
            onChange={(value) => onChange({ tradeMode: value as TradeMode })}
          />
          <SelectField
            label="品类"
            value={draft.productCategory}
            options={productCategoryOptions}
            onChange={(value) => onChange({ productCategory: value as ProductCategory })}
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField label="标题" value={draft.title} placeholder="可留空，自动生成标题" onChange={(value) => onChange({ title: value })} />
          <TextField label="来源用户" value={draft.sourceContact} placeholder="微信群发言人" onChange={(value) => onChange({ sourceContact: value })} />
          <TextField label="型号 / 规格" value={draft.gpuModel} placeholder="H100 / 64G 5600 / PM9D3A" onChange={(value) => onChange({ gpuModel: value })} />
          {draft.productCategory !== "MEMORY" && (
            <TextField label="卡数" value={draft.gpuCount} onChange={(value) => onChange({ gpuCount: value })} />
          )}
          <TextField label="数量" value={draft.quantity} onChange={(value) => onChange({ quantity: value })} />
          <TextField label="单位" value={draft.quantityUnit} onChange={(value) => onChange({ quantityUnit: value })} />
          <TextField label="城市" value={draft.locationCity} placeholder="深圳 / 香港 / 上海" onChange={(value) => onChange({ locationCity: value })} />
          <TextField
            label={draft.postType === "GOODS" ? "对外价格" : "预算上限"}
            value={draft.priceAmount}
            onChange={(value) => onChange({ priceAmount: value })}
          />
          <TextField label="联系方式" value={draft.contactMethod} onChange={(value) => onChange({ contactMethod: value })} />
        </div>
        <ConfigEditor items={draft.configItems} onChange={(configItems) => onChange({ configItems })} />
      </details>
    </section>
  );
};

function InlineNotice({ tone, text, onDismiss }: { tone: NoticeTone; text: string; onDismiss: () => void }) {
  const toneClass: Record<NoticeTone, string> = {
    info: "surface-card-quiet text-neutral-600",
    success: "border border-emerald-200/70 bg-emerald-50/90 text-emerald-800",
    warning: "border border-amber-200/70 bg-amber-50/90 text-amber-800",
  };
  return (
    <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm font-medium ${toneClass[tone]}`}>
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
      <span className={compact ? "sr-only" : "caption-text mb-1 block"}>{label}</span>
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
      <div className="smart-filter-pills" role="listbox" aria-label={label}>
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`smart-filter-pill ${active ? "is-active" : ""}`}
              aria-selected={active}
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
  title,
  activeCount,
  resultText,
  isOpen,
  onToggle,
  onReset,
  children,
}: {
  title: string;
  activeCount: number;
  resultText: string;
  isOpen: boolean;
  onToggle: () => void;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="filter-panel surface-card rounded-md p-2.5 sm:p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggle}
          className="ghost-button inline-flex min-h-9 items-center gap-2 rounded-md px-2.5 text-sm font-medium text-neutral-800"
          aria-expanded={isOpen}
        >
          <SlidersHorizontal className="h-4 w-4 text-neutral-500" />
          <span>{title}</span>
          {activeCount > 0 && (
            <span className="rounded-md bg-neutral-900 px-1.5 py-0.5 text-[11px] font-semibold text-white">{activeCount}</span>
          )}
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <span className="hidden truncate text-xs font-medium text-neutral-500 sm:block">{resultText}</span>
          <button
            type="button"
            onClick={onReset}
            disabled={activeCount === 0}
            className="ghost-button inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs font-medium disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">清空</span>
          </button>
        </div>
      </div>
      <div className="mt-2 block truncate px-2 text-xs font-medium text-neutral-500 sm:hidden">{resultText}</div>
      <div className="filter-panel-body mt-3">
        {children}
      </div>
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

function EmptyState({ title, actionLabel, onAction }: { title: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="surface-card rounded-md px-4 py-10 text-center">
      <div className="meta-pill mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-md text-neutral-400">
        <Search className="h-4 w-4" />
      </div>
      <p className="text-sm font-medium text-neutral-600">{title}</p>
      <button
        type="button"
        onClick={onAction}
        className="ghost-button mt-3 inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium"
      >
        <Plus className="h-4 w-4" />
        {actionLabel}
      </button>
    </div>
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
          <div key={`${item.label}-${index}`} className="grid gap-2 sm:grid-cols-[minmax(104px,0.42fr)_minmax(0,1fr)_32px]">
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
    <div className="mt-4 border-t border-neutral-100 pt-3">
      <p className="mb-2 text-xs font-semibold text-neutral-500">详细配置单</p>
      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {visibleItems.map((item, index) => (
          <div key={`${item.label}-${index}`} className="grid grid-cols-[72px_1fr] gap-2 rounded-md bg-neutral-950/[0.025] px-2 py-2 text-sm">
            <dt className="font-medium text-neutral-400">{item.label}</dt>
            <dd className="break-words text-neutral-800" title={item.value.length > 96 ? item.value : undefined}>
              {compactConfigValue(item.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
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

async function parseWithAiGateway(text: string): Promise<{
  items: ParsedTradeItem[];
  isMock: boolean;
  provider: string;
  model?: string;
}> {
  const response = await fetch("/api/structure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
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
  };
}

function createDraftsFromParsedItems(items: ParsedTradeItem[], source: TradeDraft["source"], overrides: EntryOverrides = {}): TradeDraft[] {
  const now = Date.now();
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
    if (item.postType === "DEMAND") {
      marketItems.push({
        id: `market-confirm-${now}-${index}`,
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
        configItems: normalizeConfigItems(item.configItems, item.productCategory, {
          gpuModel: item.gpuModel,
          gpuCount: item.gpuCount,
          sourceContact,
          rawText: item.rawText,
        }),
        publishedAt: new Date(now + index).toISOString(),
      });
      return;
    }

    stockItems.push({
      id: `stock-confirm-${now}-${index}`,
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
      configItems: normalizeConfigItems(item.configItems, item.productCategory, {
        gpuModel: item.gpuModel,
        gpuCount: item.gpuCount,
        sourceContact,
        rawText: item.rawText,
      }),
      status: "UNVERIFIED",
      source: item.source,
      createdAt: new Date(now + index).toISOString(),
    });
  });

  return { stockItems, marketItems };
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
  if (!draft.sourceContact.trim() || draft.sourceContact === "未知来源") fields.push("来源用户");
  if (!draft.gpuModel.trim()) fields.push("型号");
  if (!toNumber(draft.quantity, 0)) fields.push("数量");
  if (!draft.locationCity.trim() || draft.locationCity === "待确认") fields.push("城市");
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

const tradeModeOptions: Array<{ label: string; value: TradeMode }> = [
  { label: "现货", value: "SPOT" },
  { label: "期货", value: "FUTURES" },
  { label: "租赁", value: "RENTAL" },
];

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
  const availableStocks = stockItems.filter((stock) => stock.status !== "EXPIRED" && stock.status !== "SOLD_OUT");
  const demands = posts.filter((post) => post.postType === "DEMAND");
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

  return candidates
    .sort((left, right) => {
      if (right.scoreTotal !== left.scoreTotal) return right.scoreTotal - left.scoreTotal;
      return createdTimeValue(right.updatedAt) - createdTimeValue(left.updatedAt);
    })
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

  const priceScore = priceMatchScore(demand.priceAmount, stock.priceAmount);
  add("价格", priceScore.score, 5, priceScore.note);
  if (priceScore.score >= 5) reasons.push(priceScore.reason);
  if (priceScore.risk) riskNotes.push(priceScore.risk);

  const recencyScore = recencyMatchScore(stock.createdAt);
  add("时效", recencyScore.score, 5, recencyScore.note);
  if (recencyScore.score >= 4) reasons.push(recencyScore.reason);

  const finalScore = Math.min(100, Math.round(scoreTotal));
  if (finalScore < 58) return null;
  const id = matchCandidateId(demand.id, stock.id);
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
  const text = [
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
  for (const group of modelAliasGroups) {
    if (group.aliases.some((alias) => text.includes(normalizeHardwareText(alias).replace(/\s+/g, "")) || text.includes(normalizeHardwareText(alias)))) {
      return group.key;
    }
  }
  if (category === "MEMORY") {
    return [specs.capacity, specs.frequency].filter(Boolean).join("-");
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
  const brand = captureBrand(rawText);
  if (brand) specs.brand = normalizeHardwareText(brand).replace(/\s+/g, "");
  const capacity = text.match(/\b\d+(?:\.\d+)?\s*(?:TB|T|GB|G)\b/)?.[0]?.replace(/\s+/g, "");
  const frequency = text.match(/\b(?:DDR[45]\s*)?(\d{4,5})\s*(?:MHZ|MT\/S|M)?\b/)?.[1];
  const gpuCount = text.match(/\b(\d+)\s*卡\b/)?.[1] ?? text.match(/\b(\d+)\s*GPU\b/)?.[1];
  const storageModel = text.match(/(?:PM9D3A|PM9A3|PM893|PM983A?|PM1743|P5510|P5500|P5520|P5600|P5620|PS1010|S4520|J5300|H5100|R6100|ES3500P|ST\d{8,}[A-Z]*|WUH[A-Z0-9]+|WUS[A-Z0-9]+|MG\d+[A-Z0-9]+)/i)?.[0]?.toUpperCase();
  const cpuModel = text.match(/(?:XEON\s*)?(?:\d{4,5}[A-Z+]?|E-\d{4,5}|E5-\d{4}|W[579]-\d{4,5}X?|EPYC\s*\d{4,5}[A-Z]?)/i)?.[0]?.replace(/\s+/g, "").toUpperCase();

  if (capacity) specs.capacity = capacity;
  if (frequency && !capacity?.startsWith(frequency)) specs.frequency = frequency;
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
    if (item.key === "brand" && /SAMSUNG|SK/.test(`${demandValue}${stockValue}`)) {
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

function recencyMatchScore(value: string): { score: number; note: string; reason: string } {
  const ageHours = Math.max(0, (Date.now() - createdTimeValue(value)) / 36e5);
  if (ageHours <= 24) return { score: 5, note: "24 小时内录入", reason: "供应很新" };
  if (ageHours <= 24 * 7) return { score: 3, note: "7 天内录入", reason: "供应较新" };
  return { score: 1, note: "录入时间较久", reason: "时效一般" };
}

function tokenOverlap(left: string[], right: string[]): { count: number; tokens: string[] } {
  const rightSet = new Set(right);
  const tokens = left.filter((token) => rightSet.has(token));
  return { count: tokens.length, tokens };
}

function matchCandidateId(demandId: string, stockId: string): string {
  return `match:${demandId}:${stockId}`;
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

function matchLevelTone(level: MatchScoreLevel): BadgeTone {
  const map: Record<MatchScoreLevel, BadgeTone> = {
    STRONG: "green",
    GOOD: "blue",
    WEAK: "orange",
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

function matchStatusTone(status: MatchStatus): BadgeTone {
  const map: Record<MatchStatus, BadgeTone> = {
    NEW: "blue",
    CONTACTED: "green",
    IGNORED: "default",
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
  return `${MATCH_STATUS_STORAGE_PREFIX}:${session?.currentWorkspaceId ?? "guest"}`;
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
    values["频率"] = captureAfter(text, ["频率"]) || captureFirst(text, /\b\d{4,5}\s*(?:MHz|MT\/s|M)?\b/i);
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
  return "SERVER";
}

function parseModelText(text: string, category: ProductCategory): string {
  if (category === "MEMORY") {
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
  if (/租赁|出租|租用|月租|年租/.test(text)) return "RENTAL";
  if (/期货|预订|预售|交期|排产/.test(text)) return "FUTURES";
  return "SPOT";
}

function normalizeTradeModeValue(value: unknown): TradeMode {
  if (value === "SPOT" || value === "FUTURES" || value === "RENTAL") return value;
  return parseTradeMode(asDisplayText(value));
}

function normalizeMarketType(value: unknown): MarketType {
  const text = asDisplayText(value).toUpperCase();
  if (text === "DEMAND" || /收|求购|找/.test(text)) return "DEMAND";
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

function createdTimeValue(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
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
      refreshedById.set(matched.id, { ...matched, createdAt: item.createdAt });
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
      refreshedById.set(matched.id, { ...matched, publishedAt: item.publishedAt });
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

function loadAuthSession(): AuthSession | null {
  const session = load<AuthSession | null>(AUTH_STORAGE_KEY, null);
  if (!session?.token || !session.currentWorkspaceId || !Array.isArray(session.workspaces)) return null;
  return session;
}

function persistAuthSession(session: AuthSession): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function loadAccountWallet(session: AuthSession | null): AccountWallet {
  const key = accountWalletStorageKey(session);
  const wallet = load<AccountWallet | null>(key, null);
  if (wallet && typeof wallet.creditBalance === "number" && Array.isArray(wallet.transactions)) {
    return {
      ...createDefaultAccountWallet(),
      ...wallet,
      transactions: wallet.transactions,
    };
  }
  const defaultWallet = createDefaultAccountWallet();
  if (session) saveAccountWalletForSession(session, defaultWallet);
  return defaultWallet;
}

function createDefaultAccountWallet(): AccountWallet {
  return {
    planCode: "FREE",
    planName: "免费版",
    membershipStatus: "FREE",
    creditBalance: 128,
    monthlyAiParseCount: 0,
    transactions: [
      {
        id: "txn_welcome",
        type: "GRANT",
        title: "新账号初始化赠送",
        amount: 128,
        balanceAfter: 128,
        createdAt: new Date().toISOString(),
        note: "用于体验 AI 解析",
      },
    ],
  };
}

function saveAccountWalletForSession(session: AuthSession | null, wallet: AccountWallet): void {
  if (!session) return;
  localStorage.setItem(accountWalletStorageKey(session), JSON.stringify(wallet));
}

function accountWalletStorageKey(session: AuthSession | null): string {
  return `${ACCOUNT_STORAGE_PREFIX}:${session?.user.id ?? "guest"}`;
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

function normalizePhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  return /^1[3-9]\d{9}$/.test(digits) ? digits : "";
}

function workspaceStorageKey(workspaceId: string, collection: WorkspaceCollection): string {
  return `huoji_web_${workspaceId}_${collection}`;
}

function loadWorkspaceCollection<T>(
  session: AuthSession | null,
  collection: WorkspaceCollection,
  legacyKey: string,
  fallback: T,
): T {
  const workspaceId = session?.currentWorkspaceId;
  if (!workspaceId) return fallback;
  const scopedKey = workspaceStorageKey(workspaceId, collection);
  try {
    const scopedValue = localStorage.getItem(scopedKey);
    if (scopedValue) return JSON.parse(scopedValue) as T;
    const legacyValue = localStorage.getItem(legacyKey);
    if (legacyValue) {
      localStorage.setItem(scopedKey, legacyValue);
      return JSON.parse(legacyValue) as T;
    }
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
      tradeMode: item.tradeMode ?? parseTradeMode(`${item.title} ${item.availabilityType ?? ""}`),
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
      tradeMode: item.tradeMode ?? parseTradeMode(item.title),
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
  return amount >= 10000 ? `${Math.round(amount / 10000)}万` : `${amount}`;
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
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function aiParseCreditCost(text: string): number {
  const lineCount = Math.max(1, text.split(/\r?\n/).filter((line) => line.trim()).length);
  if (lineCount > 200) return 10;
  if (lineCount > 80) return 5;
  if (lineCount > 20) return 3;
  return 1;
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
