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

interface StockItem {
  id: string;
  title: string;
  gpuModel: string;
  gpuCount: number;
  quantity: number;
  locationCity: string;
  priceAmount?: number;
  condition?: string;
  availabilityType?: string;
  tradeMode: TradeMode;
  status: "UNVERIFIED" | "VERIFIED" | "SELLABLE" | "EXPIRED" | "SOLD_OUT";
  source: "AI" | "MANUAL";
  createdAt: string;
}

interface MarketPost {
  id: string;
  tradeMode: TradeMode;
  postType: MarketType;
  title: string;
  gpuModel: string;
  quantity: number;
  locationCity: string;
  priceAmount?: number;
  contactMethod: string;
  publishedAt: string;
}

const initialStocks: StockItem[] = [
  {
    id: "stock-demo-1",
    title: "Supermicro H100 8卡整机",
    gpuModel: "H100",
    gpuCount: 8,
    quantity: 2,
    locationCity: "深圳",
    priceAmount: 1200000,
    condition: "全新",
    availabilityType: "现货",
    tradeMode: "SPOT",
    status: "SELLABLE",
    source: "AI",
    createdAt: new Date().toISOString(),
  },
];

const initialMarket: MarketPost[] = [
  {
    id: "market-demo-1",
    tradeMode: "SPOT",
    postType: "DEMAND",
    title: "求购 H200 8卡服务器 4台",
    gpuModel: "H200",
    quantity: 4,
    locationCity: "上海",
    priceAmount: 0,
    contactMethod: "站内联系",
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
  const [manual, setManual] = useState({
    tradeMode: "SPOT" as TradeMode,
    gpuModel: "H100",
    gpuCount: "8",
    quantity: "1",
    locationCity: "深圳",
    priceAmount: "1200000",
    title: "",
  });
  const [demand, setDemand] = useState({
    tradeMode: "SPOT" as TradeMode,
    gpuModel: "H200",
    quantity: "4",
    locationCity: "上海",
    budget: "",
    contactMethod: "站内联系",
  });

  const filteredStocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stocks;
    return stocks.filter((item) =>
      [item.title, item.gpuModel, item.locationCity, item.status].some((value) =>
        String(value).toLowerCase().includes(q),
      ),
    );
  }, [query, stocks]);

  const filteredMarket = useMemo(() => {
    const q = query.trim().toLowerCase();
    return marketPosts.filter((post) => {
      if (marketModeFilter !== "ALL" && post.tradeMode !== marketModeFilter) return false;
      if (marketTypeFilter !== "ALL" && post.postType !== marketTypeFilter) return false;
      if (!q) return true;
      return [post.title, post.gpuModel, post.locationCity, post.postType, post.tradeMode].some((value) =>
        String(value).toLowerCase().includes(q),
      );
    });
  }, [query, marketModeFilter, marketPosts, marketTypeFilter]);

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
      title: parsed.title || `${parsed.gpuModel || "GPU"} ${parsed.gpuCount || "8"}卡货源`,
      gpuModel: parsed.gpuModel || "待确认",
      gpuCount: toNumber(parsed.gpuCount, 8),
      quantity: toNumber(parsed.quantity, 1),
      locationCity: parsed.locationCity || "待确认",
      priceAmount: toOptionalNumber(parsed.priceAmount),
      condition: source === "AI" ? parsed.condition : "待确认",
      availabilityType: source === "AI" ? parsed.availabilityType : "待确认",
      tradeMode: parsed.tradeMode,
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
      tradeMode: stock.tradeMode,
      postType: "GOODS",
      title: stock.title,
      gpuModel: stock.gpuModel,
      quantity: stock.quantity,
      locationCity: stock.locationCity,
      priceAmount: stock.priceAmount,
      contactMethod: "站内联系",
      publishedAt: new Date().toISOString(),
    };
    saveMarket([post, ...marketPosts]);
    saveStocks(stocks.map((item) => (item.id === stock.id ? { ...item, status: "SELLABLE" } : item)));
    setActiveTab("market");
  }

  function publishDemand() {
    const post: MarketPost = {
      id: `market-${Date.now()}`,
      tradeMode: demand.tradeMode,
      postType: "DEMAND",
      title: `${tradeModeText(demand.tradeMode)}求购 ${demand.gpuModel} ${demand.quantity}台`,
      gpuModel: demand.gpuModel,
      quantity: toNumber(demand.quantity, 1),
      locationCity: demand.locationCity,
      priceAmount: toOptionalNumber(demand.budget),
      contactMethod: demand.contactMethod || "站内联系",
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
              <p className="text-xs text-slate-500">GPU 货源记录与供需广场</p>
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
                    label="发布大类"
                    value={manual.tradeMode}
                    options={tradeModeOptions}
                    onChange={(value) => setManual({ ...manual, tradeMode: value as TradeMode })}
                  />
                  <TextField label="GPU 型号" value={manual.gpuModel} onChange={(value) => setManual({ ...manual, gpuModel: value })} />
                  <TextField label="卡数" value={manual.gpuCount} onChange={(value) => setManual({ ...manual, gpuCount: value })} />
                  <TextField label="数量" value={manual.quantity} onChange={(value) => setManual({ ...manual, quantity: value })} />
                  <TextField label="城市" value={manual.locationCity} onChange={(value) => setManual({ ...manual, locationCity: value })} />
                  <TextField label="对外价格" value={manual.priceAmount} onChange={(value) => setManual({ ...manual, priceAmount: value })} />
                </div>
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
                        <Badge>{stock.source === "AI" ? "AI解析" : "手工录入"}</Badge>
                        <Badge>{tradeModeText(stock.tradeMode)}</Badge>
                        <Badge>{statusText(stock.status)}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">
                        {stock.gpuModel} / {stock.gpuCount}卡 / {stock.quantity}台 / {stock.locationCity}
                        {stock.priceAmount ? ` / ${formatMoney(stock.priceAmount)}` : ""}
                      </p>
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
                    label="发布大类"
                    value={demand.tradeMode}
                    options={tradeModeOptions}
                    onChange={(value) => setDemand({ ...demand, tradeMode: value as TradeMode })}
                  />
                  <TextField label="GPU 型号" value={demand.gpuModel} onChange={(value) => setDemand({ ...demand, gpuModel: value })} />
                  <TextField label="数量" value={demand.quantity} onChange={(value) => setDemand({ ...demand, quantity: value })} />
                  <TextField label="城市" value={demand.locationCity} onChange={(value) => setDemand({ ...demand, locationCity: value })} />
                  <TextField label="预算上限" value={demand.budget} onChange={(value) => setDemand({ ...demand, budget: value })} />
                  <TextField label="联系方式" value={demand.contactMethod} onChange={(value) => setDemand({ ...demand, contactMethod: value })} />
                </div>
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
                  <div className="grid gap-2 md:grid-cols-2">
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
                          <Badge>{post.postType === "GOODS" ? "供给" : "需求"}</Badge>
                          <h2 className="font-black">{post.title}</h2>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          {post.gpuModel} / {post.quantity}台 / {post.locationCity}
                          {post.priceAmount ? ` / ${formatMoney(post.priceAmount)}` : ""}
                        </p>
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
  const gpuModel = text.match(/\b(H100|H200|B200|B300|A100|A800|H800|L40S)\b/i)?.[1]?.toUpperCase() ?? "";
  const quantity = text.match(/(\d+(?:\.\d+)?)\s*(台|套|块)/)?.[1] ?? "1";
  const price = text.match(/价格?\s*(\d+(?:\.\d+)?)\s*(万)?/)?.[1] ?? "";
  const city = text.match(/(深圳|上海|北京|广州|杭州|香港|苏州|成都)/)?.[1] ?? "";
  const gpuCount = text.match(/(\d+)\s*卡/)?.[1] ?? "8";
  return {
    title: `${city || ""}${gpuModel || "GPU"} ${gpuCount}卡货源`.trim(),
    gpuModel,
    gpuCount,
    quantity,
    locationCity: city,
    priceAmount: price ? String(Number(price) * 10000) : "",
    condition: text.includes("全新") ? "全新" : "待确认",
    availabilityType: text.includes("现货") ? "现货" : "待确认",
    tradeMode: parseTradeMode(text),
  };
}

const tradeModeOptions: Array<{ label: string; value: TradeMode }> = [
  { label: "现货", value: "SPOT" },
  { label: "期货", value: "FUTURES" },
  { label: "租赁", value: "RENTAL" },
];

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

function load<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeStocks(items: StockItem[]): StockItem[] {
  return items.map((item) => ({
    ...item,
    tradeMode: item.tradeMode ?? parseTradeMode(`${item.title} ${item.availabilityType ?? ""}`),
  }));
}

function normalizeMarketPosts(items: MarketPost[]): MarketPost[] {
  return items.map((item) => ({
    ...item,
    tradeMode: item.tradeMode ?? parseTradeMode(item.title),
  }));
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
