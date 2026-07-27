/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from "dotenv";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

type PostType = "GOODS" | "DEMAND";
type TradeMode = "SPOT" | "FUTURES" | "RENTAL";
type ProductCategory = "SERVER" | "GPU_CARD" | "MEMORY" | "STORAGE" | "CPU" | "NETWORK" | "OTHER";

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

app.post("/api/structure", async (req, res) => {
  const rawText = asText(req.body?.text);
  if (!rawText) {
    return res.status(400).json({ error: "请先输入需要解析的货源文字。" });
  }

  const provider = String(process.env.AI_PROVIDER ?? "deepseek").toLowerCase();
  if (provider === "deepseek" && process.env.DEEPSEEK_API_KEY) {
    try {
      const startedAt = Date.now();
      const deepseek = await callDeepSeek(rawText);
      return res.json({
        data: deepseek.result,
        isMock: false,
        provider: "deepseek",
        model: deepseek.model,
        tokenUsage: deepseek.tokenUsage,
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      const fallback = mockStructuredExtract(rawText);
      return res.json({
        data: fallback,
        isMock: true,
        provider: "local-fallback",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return res.json({
    data: mockStructuredExtract(rawText),
    isMock: true,
    provider: process.env.DEEPSEEK_API_KEY ? provider : "local-fallback",
    error: process.env.DEEPSEEK_API_KEY ? undefined : "DEEPSEEK_API_KEY is not configured.",
  });
});

async function callDeepSeek(rawText: string): Promise<{
  model: string;
  result: ExtractionEnvelope;
  tokenUsage: unknown;
}> {
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
  const maxTokens = Number(process.env.DEEPSEEK_MAX_TOKENS ?? 12000);
  const payload = {
    model,
    temperature: 0.1,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
    messages: [
      { role: "system", content: DEEPSEEK_SYSTEM_PROMPT },
      { role: "user", content: rawText },
    ],
  };

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`DeepSeek ${response.status}: ${responseText.slice(0, 500)}`);
  }

  const data = JSON.parse(responseText) as {
    model?: string;
    usage?: unknown;
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned an empty completion.");

  return {
    model: data.model ?? model,
    result: normalizeEnvelope(parseJsonObject(content)),
    tokenUsage: data.usage ?? {},
  };
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
      "sourceContact": "说话人名称",
      "rawText": "原文中最相关的一行或几行",
      "confidence": number,
      "configItems": [{"label": "品牌/容量/频率/接口/质保等", "value": "值"}]
    }
  ],
  "warnings": ["无法确定价格或重复消息等提醒"]
}

抽取规则：
1. “出、出售、供应、现货出、含税出、明价出、甩货”是 GOODS；“收、求购、找货、找、现款找、批量收、高价收、天价收”是 DEMAND。
2. “租赁、出租、租用”对应 RENTAL；“期货、小期货、预售、4-6周、8月”对应 FUTURES；“现货、秒发、当天可发”对应 SPOT。
3. 一段消息里有多行 SKU 时拆成多条 item；重复转发的完全相同 SKU 只保留一条。
4. 不要编造未出现的信息；价格如“34X万、12xx、33XXX、25+”不确定时 priceAmount 写 null，并把原价格文本放进 configItems 的“价格线索”。
5. 供应和需求都要抽；不是服务器的内存、硬盘/SSD、CPU、网卡/交换机也要抽，不能只抽 GPU。
`.trim();

function normalizeEnvelope(value: unknown): ExtractionEnvelope {
  const record = isRecord(value) ? value : {};
  const rawItems = Array.isArray(record.items) ? record.items : Array.isArray(value) ? value : [];
  const items = rawItems.map(normalizeItem).filter((item): item is ExtractedTradeItem => Boolean(item));
  return buildEnvelope(items, Array.isArray(record.warnings) ? record.warnings.map(String) : []);
}

function normalizeItem(value: unknown): ExtractedTradeItem | null {
  if (!isRecord(value)) return null;
  const rawText = asText(value.rawText ?? value.raw_text);
  const title = asText(value.title);
  const model = asText(value.model ?? value.gpuModel ?? value.gpu_model);
  const category = normalizeCategory(value.productCategory ?? value.product_category ?? `${title} ${model} ${rawText}`);
  const postType = normalizePostType(value.postType ?? value.post_type ?? rawText);
  if (!title && !model && !rawText) return null;

  return {
    postType,
    tradeMode: normalizeTradeMode(value.tradeMode ?? value.trade_mode ?? rawText),
    productCategory: category,
    title: title || buildTitle(postType, category, model || rawText),
    model: model || parseModelText(rawText || title, category),
    quantity: asNumber(value.quantity),
    quantityUnit: asText(value.quantityUnit ?? value.quantity_unit) || unitForCategory(category),
    locationCity: asText(value.locationCity ?? value.location_city) || parseLocation(`${title} ${rawText}`),
    priceAmount: asNumber(value.priceAmount ?? value.price_amount),
    currency: asText(value.currency) || "CNY",
    condition: asText(value.condition) || parseCondition(`${title} ${rawText}`),
    availabilityType: asText(value.availabilityType ?? value.availability_type) || availabilityText(normalizeTradeMode(rawText)),
    contactMethod: asText(value.contactMethod ?? value.contact_method) || "站内联系",
    sourceContact: asText(value.sourceContact ?? value.source_contact),
    rawText,
    confidence: clampNumber(asNumber(value.confidence), 0.5, 0.99, 0.82),
    configItems: normalizeConfigItems(value.configItems ?? value.config_items, category, `${title} ${model} ${rawText}`),
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

  return buildEnvelope(dedupeItems(items), [
    "当前为本地离线解析。配置 DEEPSEEK_API_KEY 后会调用 DeepSeek 做完整语义抽取。",
  ]);
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
  const title = buildTitle(postType, category, model || line);
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
  if (/高价收|天价收|提价收|批量收|现款找|实单找|找货|求购|收[:：]?|^收|找|需要进/i.test(text)) return "DEMAND";
  if (/现货出|含税出|明价出|特价出|出售|供应|出[:：]?|^出|甩货|可接|库存/i.test(text)) return "GOODS";
  return null;
}

function normalizePostType(value: unknown): PostType {
  const text = asText(value).toUpperCase();
  if (text === "DEMAND" || /收|求购|找/.test(text)) return "DEMAND";
  return "GOODS";
}

function detectCategory(text: string): ProductCategory | null {
  if (/网卡|交换机|迈络思|Mellanox|ConnectX|Q3400|400g/i.test(text)) return "NETWORK";
  if (/CPU|至强|Xeon|AMD|EPYC|6767P|6776P|6760P|6747P|6740P|8468V|8558P?|6530P?|9554|9655|9555/i.test(text)) return "CPU";
  if (/硬盘|固态|SSD|HDD|NVMe|SATA|U\.?2|E1\.?S|M\.?2|SAS|PM9|PM8|P55|P56|ST\d|WD|WUH|WUS|希捷|西数|东芝|思得|SOLIDIGM|SOLINIGM|大普微|忆联|小海豚|\d+(?:\.\d+)?\s*T/i.test(text)) return "STORAGE";
  if (/内存|DDR[45]?|RDIMM|LRDIMM|DIMM|ECC|REG|三星\/SK|三星\/sk|海力士|镁光|长鑫|64G\s*(?:4800|5600|6400|7200)|128G\s*(?:5600|6400|7200)|96G\s*(?:5600|6400)/i.test(text)) return "MEMORY";
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
  if (text === "RENTAL" || /租赁|出租|租用|月租|年租/.test(text)) return "RENTAL";
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

function configFromText(text: string, category: ProductCategory): ConfigItem[] {
  const items: ConfigItem[] = [];
  const brand = firstMatch(text, /三星|Samsung|SK|海力士|Hynix|镁光|Micron|长鑫|华为|Dell|戴尔|浪潮|超微|Supermicro|华勤|H3C|HPE|希捷|西数|东芝|Intel|英特尔|NVIDIA|英伟达|华硕|ASUS|技嘉|MSI/i);
  if (brand) items.push({ label: "品牌", value: brand });
  if (category === "MEMORY") {
    pushMatch(items, "容量", text, /(?:32|48|64|96|128|256)G/i);
    pushMatch(items, "频率", text, /\b(?:2666|2933|3200|4800|5600|6400|7200)\b/);
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

function normalizeConfigItems(value: unknown, category: ProductCategory, rawText: string): ConfigItem[] {
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
  return {
    summary: {
      total: items.length,
      goodsCount: items.filter((item) => item.postType === "GOODS").length,
      demandCount: items.filter((item) => item.postType === "DEMAND").length,
    },
    items,
    warnings,
  };
}

function dedupeItems(items: ExtractedTradeItem[]): ExtractedTradeItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [
      item.postType,
      item.tradeMode,
      item.productCategory,
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

function buildTitle(postType: PostType, category: ProductCategory, model: string): string {
  const verb = postType === "GOODS" ? "出" : "收";
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
  if (process.env.NODE_ENV !== "production") {
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

void startServer();
