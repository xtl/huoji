import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  Bot,
  Boxes,
  Check,
  CircleOff,
  ClipboardCheck,
  Compass,
  Database,
  MessageCircle,
  Plus,
  RotateCcw,
  Search,
  SendHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

type TabKey = "input" | "stock" | "market";
type MarketType = "GOODS" | "DEMAND";
type TradeMode = "SPOT" | "FUTURES" | "RENTAL";
type ProductCategory = "SERVER" | "GPU_CARD" | "MEMORY" | "STORAGE" | "CPU" | "NETWORK" | "OTHER";
type PriceFilter = "ALL" | "HAS_PRICE" | "NO_PRICE" | "UNDER_10000" | "FROM_10000_TO_100000" | "FROM_100000_TO_500000" | "OVER_500000";
type BadgeTone = "default" | "blue" | "green" | "orange" | "red";
type NoticeTone = "info" | "success" | "warning";

const LIST_PAGE_SIZE = 30;
const AI_EXAMPLE_TEXT = "深圳现货 H100 8卡服务器 2台 全新 价格120万";
const pageMeta: Record<TabKey, { title: string; crumb: string }> = {
  input: { title: "货记", crumb: "录入" },
  stock: { title: "供应", crumb: "供应" },
  market: { title: "需求", crumb: "需求" },
};

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

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("input");
  const [stocks, setStocks] = useState<StockItem[]>(() =>
    normalizeStocks(load("huoji_web_stocks", initialStocks)),
  );
  const [marketPosts, setMarketPosts] = useState<MarketPost[]>(() =>
    normalizeMarketPosts(load("huoji_web_market", initialMarket)),
  );
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
  const [stockPage, setStockPage] = useState(1);
  const [marketPage, setMarketPage] = useState(1);
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

  const stockCurrentPage = clampPage(stockPage, totalPagesFor(filteredStocks.length));
  const marketCurrentPage = clampPage(marketPage, totalPagesFor(filteredMarket.length));
  const draftCurrentPage = clampPage(draftPage, totalPagesFor(draftItems.length));
  const pagedStocks = filteredStocks.slice((stockCurrentPage - 1) * LIST_PAGE_SIZE, stockCurrentPage * LIST_PAGE_SIZE);
  const pagedMarket = filteredMarket.slice((marketCurrentPage - 1) * LIST_PAGE_SIZE, marketCurrentPage * LIST_PAGE_SIZE);
  const pagedDrafts = draftItems.slice((draftCurrentPage - 1) * LIST_PAGE_SIZE, draftCurrentPage * LIST_PAGE_SIZE);
  const demandCount = marketPosts.filter((post) => post.postType === "DEMAND").length;
  const verifiedStockCount = stocks.filter((item) => item.status === "VERIFIED" || item.status === "SELLABLE").length;
  const activePage = pageMeta[activeTab];
  const activeSummary =
    activeTab === "input"
      ? `${stocks.length} 条供应 / ${demandCount} 条需求 / ${draftItems.length} 待确认`
      : activeTab === "stock"
        ? `${filteredStocks.length} 条供应`
        : `${filteredMarket.length} 条需求`;
  const aiLineCount = aiText.trim() ? aiText.trim().split(/\r?\n/).filter(Boolean).length : 0;
  const draftSummary = draftItems.reduce(
    (summary, item) => ({
      goods: summary.goods + (item.postType === "GOODS" ? 1 : 0),
      demands: summary.demands + (item.postType === "DEMAND" ? 1 : 0),
      incomplete: summary.incomplete + (tradeDraftIssue(item) ? 1 : 0),
    }),
    { goods: 0, demands: 0, incomplete: 0 },
  );
  const saveableDraftCount = draftItems.length - draftSummary.incomplete;

  function saveStocks(next: StockItem[]) {
    setStocks(next);
    localStorage.setItem("huoji_web_stocks", JSON.stringify(next));
  }

  function saveMarket(next: MarketPost[]) {
    setMarketPosts(next);
    localStorage.setItem("huoji_web_market", JSON.stringify(next));
  }

  function updateStockStatus(stockId: string, status: StockItem["status"]) {
    saveStocks(stocks.map((item) => (item.id === stockId ? { ...item, status } : item)));
    setNotice({ tone: "success", text: status === "EXPIRED" ? "已标记为失效货源。" : "已恢复为供应中。" });
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

  function confirmDrafts(ids?: string[], options: { validOnly?: boolean } = {}) {
    const selectedIds = ids ? new Set(ids) : null;
    const targetItems = selectedIds ? draftItems.filter((item) => selectedIds.has(item.id)) : draftItems;
    const selected = options.validOnly ? targetItems.filter((item) => !tradeDraftIssue(item)) : targetItems;
    if (!selected.length) {
      setNotice({ tone: "warning", text: options.validOnly ? "没有字段完整的待确认结果可保存。" : "没有可保存的待确认结果。" });
      return;
    }
    const invalid = selected.find(tradeDraftIssue);
    if (invalid) {
      setNotice({ tone: "warning", text: tradeDraftIssue(invalid) ?? "请先补齐必填字段。" });
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

  return (
    <div className="min-h-screen bg-[#fbfbfa] text-neutral-950">
      <div className="mx-auto grid min-h-screen max-w-[1440px] md:grid-cols-[248px_1fr]">
        <aside className="hidden border-r border-neutral-200/80 bg-[#f7f7f5] px-3 py-4 md:block">
          <div className="mb-5 flex items-center gap-2 px-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-900 text-white shadow-sm">
              <Database className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold leading-tight">货记</h1>
              <p className="truncate text-xs text-neutral-500">AI 硬件供需台账</p>
            </div>
          </div>

          <nav className="space-y-1">
            <NavButton active={activeTab === "input"} icon={<Sparkles />} label="货记" onClick={() => setActiveTab("input")} />
            <NavButton active={activeTab === "stock"} icon={<Boxes />} label="供应" onClick={() => setActiveTab("stock")} />
            <NavButton active={activeTab === "market"} icon={<Compass />} label="需求" onClick={() => setActiveTab("market")} />
          </nav>

          <div className="mt-6 space-y-2 border-t border-neutral-200/80 pt-4">
            <SideMetric label="我的供应" value={`${stocks.length}`} />
            <SideMetric label="已核实" value={`${verifiedStockCount}`} />
            <SideMetric label="需求" value={`${demandCount}`} />
          </div>
        </aside>

        <main className="min-w-0 pb-24 md:pb-8">
          <header className="sticky top-0 z-30 border-b border-neutral-200/70 bg-[#fbfbfa]/90 backdrop-blur">
            <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-8">
              <div className="min-w-0">
                <p className="mb-1 text-xs font-medium text-neutral-500">货记 / {activePage.crumb}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-xl font-semibold tracking-normal text-neutral-950 md:text-2xl">{activePage.title}</h2>
                  <span className="rounded-[5px] bg-[#f1f1ef] px-2 py-0.5 text-xs font-medium text-neutral-500">{activeSummary}</span>
                </div>
              </div>
              <div className="hidden items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 shadow-sm md:flex">
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                本地原型运行中
              </div>
            </div>
          </header>

          <section className="mx-auto max-w-6xl space-y-4 px-4 py-5 md:px-8 md:py-7">

          {notice && <InlineNotice tone={notice.tone} text={notice.text} onDismiss={() => setNotice(null)} />}

          {activeTab !== "input" && (
            <div className="group flex items-center gap-2 rounded-md border border-transparent bg-white px-3 py-2 shadow-[0_0_0_1px_rgba(15,15,15,0.06)] transition hover:shadow-[0_0_0_1px_rgba(15,15,15,0.12)] focus-within:shadow-[0_0_0_1px_rgba(15,15,15,0.22)]">
              <Search className="h-4 w-4 text-neutral-400 transition group-focus-within:text-neutral-700" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setStockPage(1);
                  setMarketPage(1);
                }}
                placeholder="搜索型号、城市、来源用户、状态、配置"
                className="w-full bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
              />
            </div>
          )}

          {activeTab === "stock" && (
            <div className="rounded-md bg-white p-3 shadow-[0_0_0_1px_rgba(15,15,15,0.06)]">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                <FilterSelect
                  label="品类"
                  value={stockCategoryFilter}
                  options={[{ label: "全部品类", value: "ALL" }, ...productCategoryOptions]}
                  onChange={(value) => {
                    setStockCategoryFilter(value as ProductCategory | "ALL");
                    setStockPage(1);
                  }}
                />
                <FilterSelect
                  label="城市"
                  value={stockCityFilter}
                  options={stockCityOptions}
                  onChange={(value) => {
                    setStockCityFilter(value);
                    setStockPage(1);
                  }}
                />
                <FilterSelect
                  label="录入方式"
                  value={stockSourceFilter}
                  options={stockSourceOptions}
                  onChange={(value) => {
                    setStockSourceFilter(value as StockItem["source"] | "ALL");
                    setStockPage(1);
                  }}
                />
                <FilterSelect
                  label="来源用户"
                  value={stockSourceContactFilter}
                  options={stockSourceContactOptions}
                  onChange={(value) => {
                    setStockSourceContactFilter(value);
                    setStockPage(1);
                  }}
                />
                <FilterSelect
                  label="交易大类"
                  value={stockModeFilter}
                  options={[{ label: "全部大类", value: "ALL" }, ...tradeModeOptions]}
                  onChange={(value) => {
                    setStockModeFilter(value as TradeMode | "ALL");
                    setStockPage(1);
                  }}
                />
                <FilterSelect
                  label="价格"
                  value={stockPriceFilter}
                  options={stockPriceOptions}
                  onChange={(value) => {
                    setStockPriceFilter(value as PriceFilter);
                    setStockPage(1);
                  }}
                />
              </div>
              <div className="mt-3 flex flex-col gap-2 text-xs font-medium text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
                <span>已显示 {filteredStocks.length} 条，按录入时间最新在前，来源用户必填</span>
                <button
                  type="button"
                  onClick={resetStockFilters}
                  className="inline-flex items-center gap-1 self-start rounded-md px-2 py-1 font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 sm:self-auto"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  清空筛选
                </button>
              </div>
            </div>
          )}

          {activeTab === "input" && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]">
              <Panel title="AI 录入助手" icon={<Bot />}>
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-md bg-[#f7f7f5] p-3">
                  {chatMessages.map((message) => (
                    <ChatBubble key={message.id} message={message} />
                  ))}
                </div>

                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="green">AI 自动识别</Badge>
                    <span className="text-xs font-medium text-neutral-400">类型、交易大类、品类会在待确认结果里生成</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-neutral-400">{aiLineCount ? `${aiLineCount} 行文本` : "空白输入"}</span>
                    <div className="flex items-center gap-1">
                      <ToolbarButton icon={<Sparkles />} label="示例" onClick={() => setAiText(AI_EXAMPLE_TEXT)} />
                      <ToolbarButton icon={<Trash2 />} label="清空" onClick={() => setAiText("")} />
                    </div>
                  </div>
                  <textarea
                    value={aiText}
                    onChange={(event) => setAiText(event.target.value)}
                    className="min-h-36 w-full resize-y rounded-md border border-transparent bg-[#f7f7f5] p-3 text-sm leading-6 text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:bg-neutral-100 focus:bg-white focus:shadow-[0_0_0_1px_rgba(15,15,15,0.18)]"
                    placeholder="直接发一句，或粘贴整段微信群聊。AI 会自动识别供应/需求、现货/期货/租赁，以及服务器/显卡/内存/硬盘等品类。"
                  />
                  {aiParseMessage && (
                    <p className="rounded-md bg-[#f7f7f5] px-3 py-2 text-xs font-medium text-neutral-600">{aiParseMessage}</p>
                  )}
                  <button
                    type="button"
                    onClick={parseAssistantInput}
                    disabled={isAiParsing}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                  >
                    <SendHorizontal className="h-4 w-4" />
                    {isAiParsing ? "解析中..." : "发送并生成待确认"}
                  </button>
                </div>
              </Panel>

              <Panel title="待确认结果" icon={<ClipboardCheck />}>
                <div className="mb-3 flex flex-col gap-2 border-b border-neutral-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="green">供应 {draftSummary.goods}</Badge>
                    <Badge tone="orange">需求 {draftSummary.demands}</Badge>
                    <Badge tone="blue">可保存 {saveableDraftCount}</Badge>
                    <Badge tone={draftSummary.incomplete ? "orange" : "default"}>缺字段 {draftSummary.incomplete}</Badge>
                  </div>
                  {draftItems.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={clearDraftItems}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        清空
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmDrafts(undefined, { validOnly: true })}
                        disabled={!saveableDraftCount}
                        className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                      >
                        <Check className="h-3.5 w-3.5" />
                        保存完整项
                      </button>
                    </div>
                  )}
                </div>

                {!draftItems.length ? (
                  <AssistantEmptyState />
                ) : (
                  <div className="space-y-4">
                    <p className="rounded-md bg-[#f7f7f5] px-3 py-2 text-xs font-medium text-neutral-500">
                      完整条目可直接批量保存；缺字段的条目不会丢，补齐来源用户、型号、数量或城市后就能保存。当前显示第 {draftCurrentPage} 页。
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
            </div>
          )}

          {activeTab === "stock" && (
            <div className="space-y-3">
              {pagedStocks.map((stock) => (
                <article
                  key={stock.id}
                  className="group rounded-md bg-white p-4 shadow-[0_0_0_1px_rgba(15,15,15,0.06)] transition hover:bg-[#fdfdfc] hover:shadow-[0_0_0_1px_rgba(15,15,15,0.12)]"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold text-neutral-950">{stock.title}</h2>
                        <Badge tone="blue">{productCategoryText(stock.productCategory)}</Badge>
                        <Badge tone={stock.source === "AI" ? "green" : "default"}>{stock.source === "AI" ? "AI解析" : "手工录入"}</Badge>
                        <Badge tone={tradeModeTone(stock.tradeMode)}>{tradeModeText(stock.tradeMode)}</Badge>
                        <Badge tone={statusTone(stock.status)}>{statusText(stock.status)}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-neutral-600">
                        {stockSpecText(stock)} / {stock.quantity}{stock.quantityUnit} / {stock.locationCity}
                        {stock.priceAmount ? ` / ${formatMoney(stock.priceAmount)}` : ""}
                      </p>
                      <p className="mt-1 text-xs font-medium text-neutral-500">来源用户：{stock.sourceContact}</p>
                      <p className="mt-1 text-xs font-medium text-neutral-400">录入时间：{formatHourTime(stock.createdAt)}</p>
                      <ConfigSheet items={stock.configItems} />
                    </div>
                    <button
                      type="button"
                      onClick={() => updateStockStatus(stock.id, stock.status === "EXPIRED" ? "SELLABLE" : "EXPIRED")}
                      className="inline-flex items-center gap-1 self-start rounded-md px-3 py-2 text-sm font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 md:self-auto"
                    >
                      {stock.status === "EXPIRED" ? <RotateCcw className="h-4 w-4" /> : <CircleOff className="h-4 w-4" />}
                      {stock.status === "EXPIRED" ? "恢复供应" : "标记失效"}
                    </button>
                  </div>
                </article>
              ))}
              {!pagedStocks.length && <EmptyState title="暂无符合条件的货源" actionLabel="去货记" onAction={() => setActiveTab("input")} />}
              {filteredStocks.length > 0 && (
                <Pagination
                  total={filteredStocks.length}
                  page={stockCurrentPage}
                  onPageChange={setStockPage}
                />
              )}
            </div>
          )}

          {activeTab === "market" && (
            <div className="space-y-3">
              <div className="rounded-md bg-white p-3 shadow-[0_0_0_1px_rgba(15,15,15,0.06)]">
                <div className="grid gap-2 xl:grid-cols-3">
                  <Segmented
                    value={marketCategoryFilter}
                    options={[{ label: "全部品类", value: "ALL" }, ...productCategoryOptions]}
                    onChange={(value) => {
                      setMarketCategoryFilter(value as ProductCategory | "ALL");
                      setMarketPage(1);
                    }}
                  />
                  <Segmented
                    value={marketModeFilter}
                    options={[{ label: "全部大类", value: "ALL" }, ...tradeModeOptions]}
                    onChange={(value) => {
                      setMarketModeFilter(value as TradeMode | "ALL");
                      setMarketPage(1);
                    }}
                  />
                  <FilterSelect
                    label="来源用户"
                    value={marketSourceContactFilter}
                    options={marketSourceContactOptions}
                    onChange={(value) => {
                      setMarketSourceContactFilter(value);
                      setMarketPage(1);
                    }}
                  />
                </div>
                <div className="mt-3 flex flex-col gap-2 text-xs font-medium text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
                  <span>已显示 {filteredMarket.length} 条需求，按创建时间最新在前，来源用户必填</span>
                  <button
                    type="button"
                    onClick={resetMarketFilters}
                    className="inline-flex items-center gap-1 self-start rounded-md px-2 py-1 font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 sm:self-auto"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    清空筛选
                  </button>
                </div>
              </div>
              {pagedMarket.map((post) => (
                <article
                  key={post.id}
                  className="group rounded-md bg-white p-4 shadow-[0_0_0_1px_rgba(15,15,15,0.06)] transition hover:bg-[#fdfdfc] hover:shadow-[0_0_0_1px_rgba(15,15,15,0.12)]"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="orange">需求</Badge>
                        <Badge tone={tradeModeTone(post.tradeMode)}>{tradeModeText(post.tradeMode)}</Badge>
                        <Badge tone="blue">{productCategoryText(post.productCategory)}</Badge>
                        <h2 className="font-semibold text-neutral-950">{post.title}</h2>
                      </div>
                      <p className="mt-2 text-sm text-neutral-600">
                        {post.gpuModel} / {post.quantity}{post.quantityUnit} / {post.locationCity}
                        {post.priceAmount ? ` / ${formatMoney(post.priceAmount)}` : ""}
                      </p>
                      <p className="mt-1 text-xs font-medium text-neutral-500">来源用户：{post.sourceContact}</p>
                      <p className="mt-1 text-xs font-medium text-neutral-400">创建时间：{formatHourTime(post.publishedAt)}</p>
                      <ConfigSheet items={post.configItems} />
                      <p className="mt-1 text-xs text-neutral-500">联系方式：{post.contactMethod}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNotice({ tone: "info", text: `联系方式：${post.contactMethod}` })}
                      className="inline-flex items-center gap-1 self-start rounded-md px-3 py-2 text-sm font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 md:self-auto"
                    >
                      <MessageCircle className="h-4 w-4" />
                      联系
                    </button>
                  </div>
                </article>
              ))}
              {!pagedMarket.length && <EmptyState title="暂无符合条件的需求" actionLabel="去货记" onAction={() => setActiveTab("input")} />}
              {filteredMarket.length > 0 && (
                <Pagination
                  total={filteredMarket.length}
                  page={marketCurrentPage}
                  onPageChange={setMarketPage}
                />
              )}
            </div>
          )}
          </section>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-neutral-200 bg-white/95 shadow-[0_-8px_24px_rgba(15,15,15,0.05)] backdrop-blur md:hidden">
        <MobileTab active={activeTab === "input"} icon={<Sparkles />} label="货记" onClick={() => setActiveTab("input")} />
        <MobileTab active={activeTab === "stock"} icon={<Boxes />} label="供应" onClick={() => setActiveTab("stock")} />
        <MobileTab active={activeTab === "market"} icon={<Compass />} label="需求" onClick={() => setActiveTab("market")} />
      </nav>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-md bg-white p-4 shadow-[0_0_0_1px_rgba(15,15,15,0.06)] transition hover:shadow-[0_0_0_1px_rgba(15,15,15,0.12)]">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-800">
        {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: "h-4 w-4 text-neutral-500" })}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition ${
        active ? "bg-neutral-200/70 text-neutral-950" : "text-neutral-600 hover:bg-neutral-200/50 hover:text-neutral-950"
      }`}
    >
      {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: "h-4 w-4 text-neutral-500" })}
      {label}
    </button>
  );
}

function MobileTab({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 px-2 py-2 text-xs font-medium transition ${
        active ? "text-neutral-950" : "text-neutral-500"
      }`}
    >
      {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: "h-5 w-5" })}
      {label}
    </button>
  );
}

function SideMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs transition hover:bg-neutral-200/50">
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
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
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
      <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-[#f1f1ef] text-neutral-400">
        <ClipboardCheck className="h-4 w-4" />
      </div>
      <p className="text-sm font-medium text-neutral-600">暂无待确认结果</p>
      <p className="mt-1 text-xs font-medium text-neutral-400">发送一段供需文本后，结果会先出现在这里。</p>
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
  const issue = tradeDraftIssue(draft);
  const missingFields = tradeDraftMissingFields(draft);
  return (
    <section className="border-t border-neutral-100 pt-4 first:border-t-0 first:pt-0">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
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
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={`text-xs font-medium ${issue ? "text-amber-600" : "text-neutral-400"}`}>
              {issue ? "补齐字段后可保存" : "字段完整，可保存"}
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
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={Boolean(issue)}
            className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            <Check className="h-3.5 w-3.5" />
            {issue ? "补齐后保存" : "保存"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
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

      <details className="mt-3 border-t border-neutral-100 pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-neutral-500">详细配置单</summary>
        <ConfigEditor items={draft.configItems} onChange={(configItems) => onChange({ configItems })} />
      </details>
    </section>
  );
};

function InlineNotice({ tone, text, onDismiss }: { tone: NoticeTone; text: string; onDismiss: () => void }) {
  const toneClass: Record<NoticeTone, string> = {
    info: "bg-white text-neutral-600 shadow-[0_0_0_1px_rgba(15,15,15,0.06)]",
    success: "bg-emerald-50 text-emerald-800 shadow-[0_0_0_1px_rgba(5,150,105,0.16)]",
    warning: "bg-amber-50 text-amber-800 shadow-[0_0_0_1px_rgba(217,119,6,0.16)]",
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
      <span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-transparent bg-[#f7f7f5] px-3 py-2 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:bg-neutral-100 focus:bg-white focus:shadow-[0_0_0_1px_rgba(15,15,15,0.18)]"
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
      <span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-transparent bg-[#f7f7f5] px-3 py-2 text-sm text-neutral-900 outline-none transition hover:bg-neutral-100 focus:bg-white focus:shadow-[0_0_0_1px_rgba(15,15,15,0.18)]"
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
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-transparent bg-[#f7f7f5] px-2 text-sm font-medium text-neutral-900 outline-none transition hover:bg-neutral-100 focus:bg-white focus:shadow-[0_0_0_1px_rgba(15,15,15,0.18)]"
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
    <div className="flex flex-col gap-3 rounded-md bg-white px-3 py-3 text-sm text-neutral-600 shadow-[0_0_0_1px_rgba(15,15,15,0.06)] sm:flex-row sm:items-center sm:justify-between">
      <span className="font-medium">
        {total > 0 ? `显示 ${start}-${end} 条，共 ${total} 条` : "暂无符合条件的数据"}
        <span className="ml-2 text-xs text-neutral-400">每页 {LIST_PAGE_SIZE} 条</span>
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isFirstPage}
          onClick={() => changePage(1)}
          className="rounded-md px-2 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
        >
          首页
        </button>
        <button
          type="button"
          disabled={isFirstPage}
          onClick={() => changePage(currentPage - 1)}
          className="rounded-md px-2 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
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
          className="rounded-md px-2 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
        >
          下一页
        </button>
        <button
          type="button"
          disabled={isLastPage}
          onClick={() => changePage(totalPages)}
          className="rounded-md px-2 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
        >
          末页
        </button>
      </div>
    </div>
  );
}

function EmptyState({ title, actionLabel, onAction }: { title: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="rounded-md bg-white px-4 py-10 text-center shadow-[0_0_0_1px_rgba(15,15,15,0.06)]">
      <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-[#f1f1ef] text-neutral-400">
        <Search className="h-4 w-4" />
      </div>
      <p className="text-sm font-medium text-neutral-600">{title}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-3 inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
      >
        <Plus className="h-4 w-4" />
        {actionLabel}
      </button>
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
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
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
              className="w-full rounded-md border border-transparent bg-[#f7f7f5] px-3 py-2 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:bg-neutral-100 focus:bg-white focus:shadow-[0_0_0_1px_rgba(15,15,15,0.18)]"
            />
            <input
              aria-label={`${item.label || "配置"} 内容`}
              value={item.value}
              placeholder="内容"
              onChange={(event) => updateConfigItem(index, { value: event.target.value })}
              className="w-full rounded-md border border-transparent bg-[#f7f7f5] px-3 py-2 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:bg-neutral-100 focus:bg-white focus:shadow-[0_0_0_1px_rgba(15,15,15,0.18)]"
            />
            <button
              type="button"
              title="删除配置项"
              aria-label={`删除配置项 ${item.label || index + 1}`}
              onClick={() => removeConfigItem(index)}
              className="flex h-9 w-9 items-center justify-center rounded-md text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-900"
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
    <div className="mt-3 border-t border-neutral-100 pt-3">
      <p className="mb-1 text-xs font-semibold text-neutral-500">详细配置单</p>
      <dl className="grid gap-x-5 sm:grid-cols-2 xl:grid-cols-3">
        {visibleItems.map((item, index) => (
          <div key={`${item.label}-${index}`} className="grid grid-cols-[72px_1fr] gap-2 border-b border-neutral-100 py-2 text-sm">
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

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div
      className="grid gap-1 rounded-md bg-[#f1f1ef] p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-[5px] px-2 py-2 text-xs font-medium transition ${
            value === option.value ? "bg-white text-neutral-950 shadow-sm" : "text-neutral-500 hover:bg-white/60 hover:text-neutral-900"
          }`}
        >
          {option.label}
        </button>
      ))}
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
        quantity: asDisplayText(item.quantity) || "1",
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
        quantity: toNumber(item.quantity, 1),
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
      quantity: toNumber(item.quantity, 1),
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
      incomplete: summary.incomplete + (tradeDraftIssue(item) ? 1 : 0),
    }),
    { goods: 0, demands: 0, incomplete: 0 },
  );
}

function tradeDraftIssue(draft: TradeDraft): string | null {
  const missingFields = tradeDraftMissingFields(draft);
  if (missingFields.length) return `请补齐：${missingFields.join("、")}`;
  return null;
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
  const quantity = quantityMatch?.[1] ?? "1";
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
