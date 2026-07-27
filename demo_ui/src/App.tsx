import React, { useMemo, useState } from "react";
import {
  Bot,
  Boxes,
  Check,
  Compass,
  Database,
  Megaphone,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";

type TabKey = "input" | "stock" | "market";
type MarketType = "GOODS" | "DEMAND";
type TradeMode = "SPOT" | "FUTURES" | "RENTAL";
type ProductCategory = "SERVER" | "GPU_CARD" | "MEMORY" | "STORAGE" | "CPU" | "NETWORK" | "OTHER";
type PriceFilter = "ALL" | "HAS_PRICE" | "NO_PRICE" | "UNDER_10000" | "FROM_10000_TO_100000" | "FROM_100000_TO_500000" | "OVER_500000";

const LIST_PAGE_SIZE = 30;

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
  const [aiText, setAiText] = useState("深圳现货 H100 8卡服务器 2台 全新 价格120万");
  const [query, setQuery] = useState("");
  const [marketModeFilter, setMarketModeFilter] = useState<TradeMode | "ALL">("ALL");
  const [marketCategoryFilter, setMarketCategoryFilter] = useState<ProductCategory | "ALL">("ALL");
  const [stockCategoryFilter, setStockCategoryFilter] = useState<ProductCategory | "ALL">("ALL");
  const [stockCityFilter, setStockCityFilter] = useState("ALL");
  const [stockSourceFilter, setStockSourceFilter] = useState<StockItem["source"] | "ALL">("ALL");
  const [stockModeFilter, setStockModeFilter] = useState<TradeMode | "ALL">("ALL");
  const [stockPriceFilter, setStockPriceFilter] = useState<PriceFilter>("ALL");
  const [stockPage, setStockPage] = useState(1);
  const [marketPage, setMarketPage] = useState(1);
  const [isAiParsing, setIsAiParsing] = useState(false);
  const [aiParseMessage, setAiParseMessage] = useState("");
  const [manual, setManual] = useState({
    productCategory: "SERVER" as ProductCategory,
    tradeMode: "SPOT" as TradeMode,
    gpuModel: "H100",
    gpuCount: "8",
    quantity: "1",
    quantityUnit: "台",
    locationCity: "深圳",
    priceAmount: "1200000",
    title: "",
    configItems: defaultConfig("SERVER"),
  });
  const [demand, setDemand] = useState({
    productCategory: "SERVER" as ProductCategory,
    tradeMode: "SPOT" as TradeMode,
    gpuModel: "H200",
    quantity: "4",
    quantityUnit: "台",
    locationCity: "上海",
    budget: "",
    contactMethod: "站内联系",
    configItems: defaultConfig("SERVER"),
  });

  const filteredStocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stocks
      .filter((item) => {
        if (stockCategoryFilter !== "ALL" && item.productCategory !== stockCategoryFilter) return false;
        if (stockCityFilter !== "ALL" && item.locationCity !== stockCityFilter) return false;
        if (stockSourceFilter !== "ALL" && item.source !== stockSourceFilter) return false;
        if (stockModeFilter !== "ALL" && item.tradeMode !== stockModeFilter) return false;
        if (!matchesPriceFilter(item.priceAmount, stockPriceFilter)) return false;
        if (!q) return true;
        return [
          item.title,
          item.gpuModel,
          item.locationCity,
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
  }, [query, stockCategoryFilter, stockCityFilter, stockModeFilter, stockPriceFilter, stockSourceFilter, stocks]);

  const stockCityOptions = useMemo(() => {
    const cities: string[] = Array.from(
      new Set<string>(stocks.map((item) => item.locationCity).filter((city) => city.trim().length > 0)),
    ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
    return [{ label: "全部城市", value: "ALL" }, ...cities.map((city) => ({ label: city, value: city }))];
  }, [stocks]);

  const filteredMarket = useMemo(() => {
    const q = query.trim().toLowerCase();
    return marketPosts
      .filter((post) => post.postType === "DEMAND")
      .filter((post) => {
        if (marketModeFilter !== "ALL" && post.tradeMode !== marketModeFilter) return false;
        if (marketCategoryFilter !== "ALL" && post.productCategory !== marketCategoryFilter) return false;
        if (!q) return true;
        return [
          post.title,
          post.gpuModel,
          post.locationCity,
          post.tradeMode,
          post.productCategory,
          productCategoryText(post.productCategory),
          ...post.configItems.flatMap((config) => [config.label, config.value]),
        ].some((value) => String(value).toLowerCase().includes(q));
      });
  }, [query, marketCategoryFilter, marketModeFilter, marketPosts]);

  const stockCurrentPage = clampPage(stockPage, totalPagesFor(filteredStocks.length));
  const marketCurrentPage = clampPage(marketPage, totalPagesFor(filteredMarket.length));
  const pagedStocks = filteredStocks.slice((stockCurrentPage - 1) * LIST_PAGE_SIZE, stockCurrentPage * LIST_PAGE_SIZE);
  const pagedMarket = filteredMarket.slice((marketCurrentPage - 1) * LIST_PAGE_SIZE, marketCurrentPage * LIST_PAGE_SIZE);

  function saveStocks(next: StockItem[]) {
    setStocks(next);
    localStorage.setItem("huoji_web_stocks", JSON.stringify(next));
  }

  function saveMarket(next: MarketPost[]) {
    setMarketPosts(next);
    localStorage.setItem("huoji_web_market", JSON.stringify(next));
  }

  async function createStock(source: "AI" | "MANUAL") {
    if (source === "AI") {
      if (!aiText.trim()) {
        setAiParseMessage("请先粘贴需要解析的货源文本。");
        return;
      }
      setIsAiParsing(true);
      setAiParseMessage("正在调用 DeepSeek 结构化解析...");
      try {
        const aiResult = await parseWithAiGateway(aiText);
        const materialized = materializeParsedItems(aiResult.items);
        if (!materialized.stockItems.length && !materialized.marketItems.length) {
          throw new Error("没有识别到可入库的供需条目");
        }
        if (materialized.stockItems.length) {
          saveStocks([...materialized.stockItems, ...stocks]);
          setStockPage(1);
        }
        if (materialized.marketItems.length) {
          saveMarket([...materialized.marketItems, ...marketPosts]);
          setMarketPage(1);
        }
        setAiParseMessage(
          `${aiResult.isMock ? "离线解析" : "DeepSeek"}完成：${materialized.stockItems.length} 条供应进入我的货源，${materialized.marketItems.length} 条需求进入广场。`,
        );
        setActiveTab(materialized.stockItems.length ? "stock" : "market");
      } catch (error) {
        const fallback = materializeParsedItems([parseAiText(aiText)]);
        saveStocks([...fallback.stockItems, ...stocks]);
        setStockPage(1);
        setAiParseMessage(error instanceof Error ? `DeepSeek 解析失败，已用本地解析兜底：${error.message}` : "已用本地解析兜底。");
        setActiveTab("stock");
      } finally {
        setIsAiParsing(false);
      }
      return;
    }

    const parsed = manual;
    const stock: StockItem = {
      id: `stock-${Date.now()}`,
      productCategory: parsed.productCategory,
      title: parsed.title || `${productCategoryText(parsed.productCategory)} ${parsed.gpuModel || "待确认"}`,
      gpuModel: parsed.gpuModel || "待确认",
      gpuCount: toNumber(parsed.gpuCount, 8),
      quantity: toNumber(parsed.quantity, 1),
      quantityUnit: parsed.quantityUnit || quantityUnitForCategory(parsed.productCategory),
      locationCity: parsed.locationCity || "待确认",
      priceAmount: toOptionalNumber(parsed.priceAmount),
      condition: "待确认",
      availabilityType: "待确认",
      tradeMode: parsed.tradeMode,
      configItems: normalizeConfigItems(parsed.configItems, parsed.productCategory, {
        gpuModel: parsed.gpuModel,
        gpuCount: parsed.gpuCount,
        condition: undefined,
      }),
      status: "UNVERIFIED",
      source,
      createdAt: new Date().toISOString(),
    };
    saveStocks([stock, ...stocks]);
    setStockPage(1);
    setActiveTab("stock");
  }

  function publishDemand() {
    const post: MarketPost = {
      id: `market-${Date.now()}`,
      productCategory: demand.productCategory,
      tradeMode: demand.tradeMode,
      postType: "DEMAND",
      title: `${tradeModeText(demand.tradeMode)}求购 ${productCategoryText(demand.productCategory)} ${demand.gpuModel}`,
      gpuModel: demand.gpuModel,
      quantity: toNumber(demand.quantity, 1),
      quantityUnit: demand.quantityUnit || quantityUnitForCategory(demand.productCategory),
      locationCity: demand.locationCity,
      priceAmount: toOptionalNumber(demand.budget),
      contactMethod: demand.contactMethod || "站内联系",
      configItems: normalizeConfigItems(demand.configItems, demand.productCategory, {
        gpuModel: demand.gpuModel,
      }),
      publishedAt: new Date().toISOString(),
    };
    saveMarket([post, ...marketPosts]);
    setMarketPage(1);
    setActiveTab("market");
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-white">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-black leading-tight">货记</h1>
              <p className="text-xs text-slate-500">供应管理与需求广场</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 md:flex">
            <Check className="h-4 w-4 text-emerald-600" />
            Web 优先，手机和桌面共用一套体验
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-5 pb-24 md:grid-cols-[220px_1fr] md:px-6 md:pb-8">
        <nav className="hidden rounded-lg border border-slate-200 bg-white p-2 md:block">
          <NavButton active={activeTab === "input"} icon={<Sparkles />} label="货记" onClick={() => setActiveTab("input")} />
          <NavButton active={activeTab === "stock"} icon={<Boxes />} label="我的货源" onClick={() => setActiveTab("stock")} />
          <NavButton active={activeTab === "market"} icon={<Compass />} label="广场" onClick={() => setActiveTab("market")} />
        </nav>

        <section className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            <Metric label="我的供应" value={`${stocks.length}`} />
            <Metric label="需求广场" value={`${marketPosts.filter((post) => post.postType === "DEMAND").length}`} />
          </div>

          {activeTab !== "input" && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setStockPage(1);
                  setMarketPage(1);
                }}
                placeholder="搜索型号、城市、状态、配置"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
          )}

          {activeTab === "stock" && (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
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
                  label="来源"
                  value={stockSourceFilter}
                  options={stockSourceOptions}
                  onChange={(value) => {
                    setStockSourceFilter(value as StockItem["source"] | "ALL");
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
              <div className="mt-3 flex flex-col gap-2 text-xs font-semibold text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <span>已显示 {filteredStocks.length} 条，按录入时间最新在前</span>
                <button
                  type="button"
                  onClick={() => {
                    setStockCategoryFilter("ALL");
                    setStockCityFilter("ALL");
                    setStockSourceFilter("ALL");
                    setStockModeFilter("ALL");
                    setStockPriceFilter("ALL");
                    setStockPage(1);
                  }}
                  className="self-start rounded-md border border-slate-200 px-2 py-1 font-bold text-slate-600 sm:self-auto"
                >
                  清空筛选
                </button>
              </div>
            </div>
          )}

          {activeTab === "input" && (
            <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
              <Panel title="AI 解析供需" icon={<Bot />}>
                <textarea
                  value={aiText}
                  onChange={(event) => setAiText(event.target.value)}
                  className="min-h-72 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 outline-none focus:border-slate-500"
                  placeholder="粘贴微信群聊货源文本，DeepSeek 会按供应/需求、现货/期货/租赁、服务器/显卡/内存/硬盘/CPU/网络设备拆条结构化。"
                />
                {aiParseMessage && (
                  <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{aiParseMessage}</p>
                )}
                <button
                  type="button"
                  onClick={() => createStock("AI")}
                  disabled={isAiParsing}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  <Sparkles className="h-4 w-4" />
                  {isAiParsing ? "解析中..." : "DeepSeek 解析并入库"}
                </button>
              </Panel>

              <Panel title="手工录入供应" icon={<Plus />}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField label="标题" value={manual.title} onChange={(value) => setManual({ ...manual, title: value })} />
                  <SelectField
                    label="交易大类"
                    value={manual.tradeMode}
                    options={tradeModeOptions}
                    onChange={(value) => setManual({ ...manual, tradeMode: value as TradeMode })}
                  />
                  <SelectField
                    label="品类"
                    value={manual.productCategory}
                    options={productCategoryOptions}
                    onChange={(value) =>
                      setManual({
                        ...manual,
                        productCategory: value as ProductCategory,
                        quantityUnit: quantityUnitForCategory(value as ProductCategory),
                        configItems: defaultConfig(value as ProductCategory),
                      })
                    }
                  />
                  <TextField label="型号 / 规格" value={manual.gpuModel} onChange={(value) => setManual({ ...manual, gpuModel: value })} />
                  {manual.productCategory !== "MEMORY" && (
                    <TextField label="卡数" value={manual.gpuCount} onChange={(value) => setManual({ ...manual, gpuCount: value })} />
                  )}
                  <TextField label="数量" value={manual.quantity} onChange={(value) => setManual({ ...manual, quantity: value })} />
                  <TextField label="单位" value={manual.quantityUnit} onChange={(value) => setManual({ ...manual, quantityUnit: value })} />
                  <TextField label="城市" value={manual.locationCity} onChange={(value) => setManual({ ...manual, locationCity: value })} />
                  <TextField label="对外价格" value={manual.priceAmount} onChange={(value) => setManual({ ...manual, priceAmount: value })} />
                </div>
                <ConfigEditor
                  items={manual.configItems}
                  onChange={(configItems) => setManual({ ...manual, configItems })}
                />
                <button
                  type="button"
                  onClick={() => createStock("MANUAL")}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white"
                >
                  <Database className="h-4 w-4" />
                  保存到我的货源
                </button>
              </Panel>

              <Panel title="发布需求到广场" icon={<Megaphone />}>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <SelectField
                    label="交易大类"
                    value={demand.tradeMode}
                    options={tradeModeOptions}
                    onChange={(value) => setDemand({ ...demand, tradeMode: value as TradeMode })}
                  />
                  <SelectField
                    label="品类"
                    value={demand.productCategory}
                    options={productCategoryOptions}
                    onChange={(value) =>
                      setDemand({
                        ...demand,
                        productCategory: value as ProductCategory,
                        quantityUnit: quantityUnitForCategory(value as ProductCategory),
                        configItems: defaultConfig(value as ProductCategory),
                      })
                    }
                  />
                  <TextField label="型号 / 规格" value={demand.gpuModel} onChange={(value) => setDemand({ ...demand, gpuModel: value })} />
                  <TextField label="数量" value={demand.quantity} onChange={(value) => setDemand({ ...demand, quantity: value })} />
                  <TextField label="单位" value={demand.quantityUnit} onChange={(value) => setDemand({ ...demand, quantityUnit: value })} />
                  <TextField label="城市" value={demand.locationCity} onChange={(value) => setDemand({ ...demand, locationCity: value })} />
                  <TextField label="预算上限" value={demand.budget} onChange={(value) => setDemand({ ...demand, budget: value })} />
                  <TextField label="联系方式" value={demand.contactMethod} onChange={(value) => setDemand({ ...demand, contactMethod: value })} />
                </div>
                <ConfigEditor
                  items={demand.configItems}
                  onChange={(configItems) => setDemand({ ...demand, configItems })}
                />
                <button
                  type="button"
                  onClick={publishDemand}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-3 text-sm font-bold text-white"
                >
                  <Megaphone className="h-4 w-4" />
                  发布需求
                </button>
              </Panel>
            </div>
          )}

          {activeTab === "stock" && (
            <div className="space-y-3">
              {pagedStocks.map((stock) => (
                <article key={stock.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-black">{stock.title}</h2>
                        <Badge>{productCategoryText(stock.productCategory)}</Badge>
                        <Badge>{stock.source === "AI" ? "AI解析" : "手工录入"}</Badge>
                        <Badge>{tradeModeText(stock.tradeMode)}</Badge>
                        <Badge>{statusText(stock.status)}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">
                        {stockSpecText(stock)} / {stock.quantity}{stock.quantityUnit} / {stock.locationCity}
                        {stock.priceAmount ? ` / ${formatMoney(stock.priceAmount)}` : ""}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">录入时间：{formatHourTime(stock.createdAt)}</p>
                      <ConfigSheet items={stock.configItems} />
                    </div>
                    <button
                      type="button"
                      onClick={() => saveStocks(stocks.map((item) => (item.id === stock.id ? { ...item, status: "EXPIRED" } : item)))}
                      className="self-start rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 md:self-auto"
                    >
                      标记失效
                    </button>
                  </div>
                </article>
              ))}
              <Pagination
                total={filteredStocks.length}
                page={stockCurrentPage}
                onPageChange={setStockPage}
              />
            </div>
          )}

          {activeTab === "market" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="grid gap-2 xl:grid-cols-2">
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
                </div>
              </div>
              {pagedMarket.map((post) => (
                <article key={post.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>需求</Badge>
                        <Badge>{tradeModeText(post.tradeMode)}</Badge>
                        <Badge>{productCategoryText(post.productCategory)}</Badge>
                        <h2 className="font-black">{post.title}</h2>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">
                        {post.gpuModel} / {post.quantity}{post.quantityUnit} / {post.locationCity}
                        {post.priceAmount ? ` / ${formatMoney(post.priceAmount)}` : ""}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">创建时间：{formatHourTime(post.publishedAt)}</p>
                      <ConfigSheet items={post.configItems} />
                      <p className="mt-1 text-xs text-slate-500">联系方式：{post.contactMethod}</p>
                    </div>
                    <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold">
                      联系
                    </button>
                  </div>
                </article>
              ))}
              <Pagination
                total={filteredMarket.length}
                page={marketCurrentPage}
                onPageChange={setMarketPage}
              />
            </div>
          )}
        </section>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-slate-200 bg-white md:hidden">
        <MobileTab active={activeTab === "input"} icon={<Sparkles />} label="货记" onClick={() => setActiveTab("input")} />
        <MobileTab active={activeTab === "stock"} icon={<Boxes />} label="我的货源" onClick={() => setActiveTab("stock")} />
        <MobileTab active={activeTab === "market"} icon={<Compass />} label="广场" onClick={() => setActiveTab("market")} />
      </nav>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2 font-black">
        {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: "h-5 w-5 text-blue-600" })}
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
      className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-3 text-sm font-bold ${
        active ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: "h-4 w-4" })}
      {label}
    </button>
  );
}

function MobileTab({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 px-2 py-2 text-xs font-bold ${active ? "text-blue-600" : "text-slate-500"}`}
    >
      {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: "h-5 w-5" })}
      {label}
    </button>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-500"
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
      <span className="mb-1 block text-xs font-bold text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-500"
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
      <span className="mb-1 block text-xs font-black text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-sm font-semibold outline-none focus:border-slate-500"
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
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
      <span className="font-semibold">
        {total > 0 ? `显示 ${start}-${end} 条，共 ${total} 条` : "暂无符合条件的数据"}
        <span className="ml-2 text-xs text-slate-400">每页 {LIST_PAGE_SIZE} 条</span>
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isFirstPage}
          onClick={() => changePage(1)}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          首页
        </button>
        <button
          type="button"
          disabled={isFirstPage}
          onClick={() => changePage(currentPage - 1)}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          上一页
        </button>
        <span className="px-1 text-xs font-black text-slate-500">
          第 {currentPage} / {totalPages} 页
        </span>
        <button
          type="button"
          disabled={isLastPage}
          onClick={() => changePage(currentPage + 1)}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          下一页
        </button>
        <button
          type="button"
          disabled={isLastPage}
          onClick={() => changePage(totalPages)}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          末页
        </button>
      </div>
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
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-black text-slate-500">详细配置单</p>
        <span className="text-xs font-semibold text-slate-400">按当前品类保存</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item, index) => (
          <label key={`${item.label}-${index}`} className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">{item.label}</span>
            <input
              value={item.value}
              onChange={(event) =>
                onChange(items.map((config, configIndex) => (configIndex === index ? { ...config, value: event.target.value } : config)))
              }
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function ConfigSheet({ items }: { items: ConfigItem[] }) {
  const visibleItems = items.filter((item) => item.value.trim());
  if (!visibleItems.length) return null;

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="mb-1 text-xs font-black text-slate-500">详细配置单</p>
      <dl className="grid gap-x-5 sm:grid-cols-2 xl:grid-cols-3">
        {visibleItems.map((item, index) => (
          <div key={`${item.label}-${index}`} className="grid grid-cols-[72px_1fr] gap-2 border-b border-slate-100 py-2 text-sm">
            <dt className="font-bold text-slate-500">{item.label}</dt>
            <dd className="break-words text-slate-800">{item.value}</dd>
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
      className="grid gap-1 rounded-lg bg-slate-100 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2 py-2 text-xs font-black ${
            value === option.value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{children}</span>;
}

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

function materializeParsedItems(items: ParsedTradeItem[]): { stockItems: StockItem[]; marketItems: MarketPost[] } {
  const stockItems: StockItem[] = [];
  const marketItems: MarketPost[] = [];
  const now = Date.now();

  items.forEach((item, index) => {
    const rawText = item.rawText || "";
    const category = normalizeProductCategoryValue(item.productCategory ?? `${item.title ?? ""} ${item.model ?? ""} ${rawText}`);
    const postType = normalizeMarketType(item.postType ?? rawText);
    const tradeMode = normalizeTradeModeValue(item.tradeMode ?? rawText);
    const model = item.model || item.gpuModel || parseModelText(`${item.title ?? ""} ${rawText}`, category) || "待确认";
    const quantity = toNumber(item.quantity, 1);
    const quantityUnit = item.quantityUnit || quantityUnitForCategory(category);
    const locationCity = item.locationCity || parseLocationText(rawText) || "待确认";
    const configItems = normalizeConfigItems(item.configItems, category, {
      gpuModel: model,
      gpuCount: item.gpuCount,
      condition: item.condition,
      sourceContact: item.sourceContact,
      rawText,
    });
    const title = item.title || buildParsedTitle(category, model, String(item.gpuCount ?? ""), locationCity);

    if (postType === "DEMAND") {
      marketItems.push({
        id: `market-ai-${now}-${index}`,
        productCategory: category,
        tradeMode,
        postType: "DEMAND",
        title,
        gpuModel: model,
        quantity,
        quantityUnit,
        locationCity,
        priceAmount: toOptionalNumber(item.priceAmount),
        contactMethod: item.contactMethod || item.sourceContact || "站内联系",
        configItems,
        publishedAt: new Date(now + index).toISOString(),
      });
      return;
    }

    stockItems.push({
      id: `stock-ai-${now}-${index}`,
      productCategory: category,
      title,
      gpuModel: model,
      gpuCount: toNumber(item.gpuCount, category === "SERVER" ? 8 : 0),
      quantity,
      quantityUnit,
      locationCity,
      priceAmount: toOptionalNumber(item.priceAmount),
      condition: item.condition || "待确认",
      availabilityType: item.availabilityType || tradeModeText(tradeMode),
      tradeMode,
      configItems,
      status: "UNVERIFIED",
      source: "AI",
      createdAt: new Date(now + index).toISOString(),
    });
  });

  return { stockItems, marketItems };
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
  return {
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
    configItems: extractConfigItems(text, productCategory, gpuModel, gpuCount, condition),
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
  { label: "全部来源", value: "ALL" },
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
  const merged = base.map((item) => {
    const rawValue = rawByLabel.get(item.label);
    const value = rawValue?.trim() ? rawValue : seedValues[item.label] ?? rawValue ?? item.value;
    return { label: item.label, value };
  });
  const extra = rawItems.filter((item) => !base.some((baseItem) => baseItem.label === item.label));
  const sourceContact = asDisplayText(seed.sourceContact);
  const rawText = asDisplayText(seed.rawText);
  const traceItems = [
    ...(sourceContact && !rawByLabel.has("来源") ? [{ label: "来源", value: sourceContact }] : []),
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

function asDisplayText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
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
    return {
      ...item,
      productCategory,
      tradeMode: item.tradeMode ?? parseTradeMode(`${item.title} ${item.availabilityType ?? ""}`),
      quantityUnit: item.quantityUnit ?? quantityUnitForCategory(productCategory),
      configItems: normalizeConfigItems(item.configItems, productCategory, {
        gpuModel: item.gpuModel,
        gpuCount: item.gpuCount,
        condition: item.condition,
      }),
    };
  });
}

function normalizeMarketPosts(items: MarketPost[]): MarketPost[] {
  return items.map((item) => {
    const productCategory = item.productCategory ?? parseProductCategory(`${item.title} ${item.gpuModel}`);
    return {
      ...item,
      productCategory,
      tradeMode: item.tradeMode ?? parseTradeMode(item.title),
      quantityUnit: item.quantityUnit ?? quantityUnitForCategory(productCategory),
      configItems: normalizeConfigItems(item.configItems, productCategory, {
        gpuModel: item.gpuModel,
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

function formatMoney(amount: number): string {
  return amount >= 10000 ? `${Math.round(amount / 10000)}万` : `${amount}`;
}

function formatHourTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间待确认";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day} ${hour}:00`;
}
