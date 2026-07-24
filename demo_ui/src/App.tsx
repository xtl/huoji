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
  Send,
  Sparkles,
} from "lucide-react";

type TabKey = "input" | "stock" | "market";
type MarketType = "GOODS" | "DEMAND";
type TradeMode = "SPOT" | "FUTURES" | "RENTAL";
type ProductCategory = "SERVER" | "GPU_CARD" | "MEMORY";

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
  const [marketTypeFilter, setMarketTypeFilter] = useState<MarketType | "ALL">("ALL");
  const [marketCategoryFilter, setMarketCategoryFilter] = useState<ProductCategory | "ALL">("ALL");
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
    if (!q) return stocks;
    return stocks.filter((item) =>
      [
        item.title,
        item.gpuModel,
        item.locationCity,
        item.status,
        ...item.configItems.flatMap((config) => [config.label, config.value]),
      ].some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [query, stocks]);

  const filteredMarket = useMemo(() => {
    const q = query.trim().toLowerCase();
    return marketPosts.filter((post) => {
      if (marketModeFilter !== "ALL" && post.tradeMode !== marketModeFilter) return false;
      if (marketTypeFilter !== "ALL" && post.postType !== marketTypeFilter) return false;
      if (marketCategoryFilter !== "ALL" && post.productCategory !== marketCategoryFilter) return false;
      if (!q) return true;
      return [
        post.title,
        post.gpuModel,
        post.locationCity,
        post.postType,
        post.tradeMode,
        post.productCategory,
        productCategoryText(post.productCategory),
        ...post.configItems.flatMap((config) => [config.label, config.value]),
      ].some((value) => String(value).toLowerCase().includes(q));
    });
  }, [query, marketCategoryFilter, marketModeFilter, marketPosts, marketTypeFilter]);

  function saveStocks(next: StockItem[]) {
    setStocks(next);
    localStorage.setItem("huoji_web_stocks", JSON.stringify(next));
  }

  function saveMarket(next: MarketPost[]) {
    setMarketPosts(next);
    localStorage.setItem("huoji_web_market", JSON.stringify(next));
  }

  function createStock(source: "AI" | "MANUAL") {
    const parsed = source === "AI" ? parseAiText(aiText) : manual;
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
      condition: source === "AI" ? parsed.condition : "待确认",
      availabilityType: source === "AI" ? parsed.availabilityType : "待确认",
      tradeMode: parsed.tradeMode,
      configItems: normalizeConfigItems(parsed.configItems, parsed.productCategory, {
        gpuModel: parsed.gpuModel,
        gpuCount: parsed.gpuCount,
        condition: source === "AI" ? parsed.condition : undefined,
      }),
      status: "UNVERIFIED",
      source,
      createdAt: new Date().toISOString(),
    };
    saveStocks([stock, ...stocks]);
    setActiveTab("stock");
  }

  function publishStock(stock: StockItem) {
    const post: MarketPost = {
      id: `market-${Date.now()}`,
      productCategory: stock.productCategory,
      tradeMode: stock.tradeMode,
      postType: "GOODS",
      title: stock.title,
      gpuModel: stock.gpuModel,
      quantity: stock.quantity,
      quantityUnit: stock.quantityUnit,
      locationCity: stock.locationCity,
      priceAmount: stock.priceAmount,
      contactMethod: "站内联系",
      configItems: stock.configItems,
      publishedAt: new Date().toISOString(),
    };
    saveMarket([post, ...marketPosts]);
    saveStocks(stocks.map((item) => (item.id === stock.id ? { ...item, status: "SELLABLE" } : item)));
    setActiveTab("market");
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
              <p className="text-xs text-slate-500">服务器、显卡、内存供需广场</p>
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
          <NavButton active={activeTab === "input"} icon={<Sparkles />} label="录入货源" onClick={() => setActiveTab("input")} />
          <NavButton active={activeTab === "stock"} icon={<Boxes />} label="我的货源" onClick={() => setActiveTab("stock")} />
          <NavButton active={activeTab === "market"} icon={<Compass />} label="广场" onClick={() => setActiveTab("market")} />
        </nav>

        <section className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            <Metric label="我的货源" value={`${stocks.length}`} />
            <Metric label="广场供应" value={`${marketPosts.filter((post) => post.postType === "GOODS").length}`} />
            <Metric label="广场需求" value={`${marketPosts.filter((post) => post.postType === "DEMAND").length}`} />
          </div>

          {activeTab !== "input" && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索型号、城市、状态"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
          )}

          {activeTab === "input" && (
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="AI 解析货源" icon={<Bot />}>
                <textarea
                  value={aiText}
                  onChange={(event) => setAiText(event.target.value)}
                  className="min-h-40 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 outline-none focus:border-slate-500"
                />
                <button
                  type="button"
                  onClick={() => createStock("AI")}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-3 text-sm font-bold text-white"
                >
                  <Sparkles className="h-4 w-4" />
                  解析并进入确认
                </button>
              </Panel>

              <Panel title="手工录入货源" icon={<Plus />}>
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
            </div>
          )}

          {activeTab === "stock" && (
            <div className="space-y-3">
              {filteredStocks.map((stock) => (
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
                      <ConfigSheet items={stock.configItems} />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => saveStocks(stocks.map((item) => (item.id === stock.id ? { ...item, status: "EXPIRED" } : item)))}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"
                      >
                        标记失效
                      </button>
                      <button
                        type="button"
                        onClick={() => publishStock(stock)}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white"
                      >
                        <Send className="h-4 w-4" />
                        发布广场
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {activeTab === "market" && (
            <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
              <Panel title="发布需求" icon={<Megaphone />}>
                <div className="grid gap-3">
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

              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="grid gap-2 xl:grid-cols-3">
                    <Segmented
                      value={marketCategoryFilter}
                      options={[{ label: "全部品类", value: "ALL" }, ...productCategoryOptions]}
                      onChange={(value) => setMarketCategoryFilter(value as ProductCategory | "ALL")}
                    />
                    <Segmented
                      value={marketModeFilter}
                      options={[{ label: "全部大类", value: "ALL" }, ...tradeModeOptions]}
                      onChange={(value) => setMarketModeFilter(value as TradeMode | "ALL")}
                    />
                    <Segmented
                      value={marketTypeFilter}
                      options={[
                        { label: "全部类型", value: "ALL" },
                        { label: "供应", value: "GOODS" },
                        { label: "需求", value: "DEMAND" },
                      ]}
                      onChange={(value) => setMarketTypeFilter(value as MarketType | "ALL")}
                    />
                  </div>
                </div>
                {filteredMarket.map((post) => (
                  <article key={post.id} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{tradeModeText(post.tradeMode)}</Badge>
                          <Badge>{productCategoryText(post.productCategory)}</Badge>
                          <Badge>{post.postType === "GOODS" ? "供给" : "需求"}</Badge>
                          <h2 className="font-black">{post.title}</h2>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          {post.gpuModel} / {post.quantity}{post.quantityUnit} / {post.locationCity}
                          {post.priceAmount ? ` / ${formatMoney(post.priceAmount)}` : ""}
                        </p>
                        <ConfigSheet items={post.configItems} />
                        <p className="mt-1 text-xs text-slate-500">联系方式：{post.contactMethod}</p>
                      </div>
                      <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold">
                        联系
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-slate-200 bg-white md:hidden">
        <MobileTab active={activeTab === "input"} icon={<Sparkles />} label="录入" onClick={() => setActiveTab("input")} />
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
];

function defaultConfig(category: ProductCategory): ConfigItem[] {
  const labels: Record<ProductCategory, string[]> = {
    SERVER: ["品牌", "整机型号", "GPU", "GPU数量", "CPU", "内存", "硬盘", "网络", "电源", "质保"],
    GPU_CARD: ["品牌", "型号", "显存", "接口", "成色", "质保"],
    MEMORY: ["品牌", "容量", "类型", "频率", "ECC", "成色"],
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

  return defaultConfig(category).map((item) => ({ ...item, value: values[item.label] ?? "" }));
}

function normalizeConfigItems(
  items: unknown,
  category: ProductCategory,
  seed: { gpuModel?: unknown; gpuCount?: unknown; condition?: unknown } = {},
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
  return [...merged, ...extra];
}

function seedConfigValues(
  category: ProductCategory,
  seed: { gpuModel?: unknown; gpuCount?: unknown; condition?: unknown },
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
  return values;
}

function parseProductCategory(text: string): ProductCategory {
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

function tradeModeText(mode: TradeMode): string {
  const map: Record<TradeMode, string> = {
    SPOT: "现货",
    FUTURES: "期货",
    RENTAL: "租赁",
  };
  return map[mode];
}

function productCategoryText(category: ProductCategory): string {
  const map: Record<ProductCategory, string> = {
    SERVER: "服务器",
    GPU_CARD: "显卡",
    MEMORY: "内存",
  };
  return map[category];
}

function quantityUnitForCategory(category: ProductCategory): string {
  const map: Record<ProductCategory, string> = {
    SERVER: "台",
    GPU_CARD: "张",
    MEMORY: "条",
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
      /Supermicro|超微|Dell|戴尔|浪潮|HPE|新华三|联想|Lenovo|NVIDIA|英伟达|ASUS|华硕|Gigabyte|技嘉|MSI|微星|Samsung|三星|SK\s?Hynix|海力士|Micron|美光|Kingston|金士顿/i,
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
    SELLABLE: "可发布",
    EXPIRED: "已失效",
    SOLD_OUT: "已售罄",
  };
  return map[status];
}

function formatMoney(amount: number): string {
  return amount >= 10000 ? `${Math.round(amount / 10000)}万` : `${amount}`;
}
