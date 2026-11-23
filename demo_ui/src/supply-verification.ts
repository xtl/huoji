import { readMemoryFrequency } from "./memory-specs";

export interface VerificationContext {
  supplyText: string;
  demandText: string;
  supplyQuantity?: number;
  demandQuantity?: number;
  unit?: string;
  demandUnit?: string;
  category?: string;
}

export interface VerificationEntry {
  id: string;
  recordedAt: string;
  role: "seller" | "buyer";
  confirmedBy: string;
  reply: string;
  holder: "unknown" | "holder" | "intermediary";
  stockQuantity?: number;
  reservableQuantity?: number;
  reservableUntil?: string;
  reservedQuantity?: number;
  reservedUntil?: string;
  packaging: "unknown" | "original" | "white-label";
  batch: string;
  buyerAcceptsPackaging: "unknown" | "yes" | "no";
  acceptedPackaging?: "original" | "white-label";
}

export interface VerificationAssessment {
  sellerQuestion: string;
  buyerQuestion: string;
  stockQuantity?: number;
  activeReservableQuantity?: number;
  activeReservedQuantity: number;
  reservationExpired: boolean;
  shortfall?: number;
  unitsComparable: boolean;
  notices: string[];
  latestStockEntry?: VerificationEntry;
  latestReservableEntry?: VerificationEntry;
  latestReservedEntry?: VerificationEntry;
  latestPackagingEntry?: VerificationEntry;
  latestBatchEntry?: VerificationEntry;
  latestBuyerPackagingEntry?: VerificationEntry;
  latestHolderEntry?: VerificationEntry;
}

export function emptyVerificationEntry(role: VerificationEntry["role"] = "seller"): VerificationEntry {
  return {
    id: crypto.randomUUID(),
    recordedAt: new Date().toISOString(),
    role,
    confirmedBy: "",
    reply: "",
    holder: "unknown",
    packaging: "unknown",
    batch: "",
    buyerAcceptsPackaging: "unknown",
  };
}

export function validateVerificationEntry(entry: VerificationEntry, _context: VerificationContext): string | null {
  if (!entry || typeof entry.id !== "string" || !entry.id || typeof entry.recordedAt !== "string" ||
      !Number.isFinite(Date.parse(entry.recordedAt))) return "缺少有效的记录时间或编号。";
  if (!["seller", "buyer"].includes(entry.role)) return "请选择回复方。";
  if (typeof entry.confirmedBy !== "string" || !entry.confirmedBy.trim() ||
      typeof entry.reply !== "string" || !entry.reply.trim()) return "请填写回复人，并保留对方的回复原文。";
  if (!["unknown", "yes", "no"].includes(entry.buyerAcceptsPackaging) ||
      !["unknown", "holder", "intermediary"].includes(entry.holder) ||
      !["unknown", "original", "white-label"].includes(entry.packaging) ||
      typeof entry.batch !== "string") return "核实记录的选项无效。";

  const quantities = [entry.stockQuantity, entry.reservableQuantity, entry.reservedQuantity];
  if (quantities.some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 0))) {
    return "数量须填写零或正整数。";
  }
  if (entry.role === "buyer" && (quantities.some(value => value !== undefined) ||
      entry.reservedUntil || entry.reservableUntil || entry.packaging !== "unknown" ||
      entry.holder !== "unknown" || entry.batch.trim())) return "请将供方核实信息登记在供方回复中。";
  if (entry.role === "seller" && entry.buyerAcceptsPackaging !== "unknown") return "请单独记录买方对品牌的答复。";
  if (entry.buyerAcceptsPackaging !== "unknown" && !["original", "white-label"].includes(entry.acceptedPackaging)) {
    return "请注明买方答复针对的是原厂条还是白牌条。";
  }
  if (entry.stockQuantity !== undefined && [entry.reservableQuantity, entry.reservedQuantity].some(
    value => value !== undefined && value > entry.stockQuantity,
  )) return "本次回复中的可预留或已预留数量超过现货数量，请核对原文。";
  for (const [until, quantity] of [[entry.reservedUntil, entry.reservedQuantity], [entry.reservableUntil, entry.reservableQuantity]] as const) {
    if (until !== undefined && (typeof until !== "string" || (until && !Number.isFinite(Date.parse(until))))) return "请填写有效的截止时间。";
    if (until && !quantity) return "填写截止时间时，请同时确认对应的数量。";
  }
  return null;
}

function dateCode(text: string): string | undefined {
  const match = /(?:^|[^a-z0-9])DC\s*[-:]?\s*(\d{2,4})(?![a-z0-9])/i.exec(text);
  return match ? `DC${match[1]}` : undefined;
}

const shareableUnitPattern = /^(?:台|条|根|张|块|套|片|个|箱|件|颗|只|对|卡|盘|组|批|架|米|卷|包|公斤|kg|pcs?)$/i;

export function suggestSellerFields(reply: string, unit?: string): Partial<VerificationEntry> {
  if (!reply.trim() ||
      /[?？否]|没|未|不|无|非|大概|可能|预计|约有|听说|上次|昨天|之前|应该|待定|期货|在路上|别人|另一|其他客户|转报|售完|取消/.test(reply)) return {};
  const suggestions: Partial<VerificationEntry> = {};
  const clauses = reply.split(/[，,。；;！!\n]+/).map(clause => clause.trim());
  const white = /白牌/.test(reply);
  const original = /原厂(?:内存)?条|原装(?:内存)?条/.test(reply) || clauses.includes("原厂");
  if (white !== original) suggestions.packaging = white ? "white-label" : "original";
  const batches = new Set(Array.from(reply.matchAll(/(?:^|[^a-z0-9])DC\s*[-:]?\s*(\d{2,4})(?![a-z0-9])/gi), hit => `DC${hit[1]}`));
  if (batches.size === 1) suggestions.batch = [...batches][0];

  // Require a single explicit amount for each fact; times and available-to-hold offers never establish a reservation.
  const stockValues = new Set<number>();
  const offerValues = new Set<number>();
  for (const clause of clauses) {
    const stock = /^(?:现货(?:还有|有)?|库存(?:还有|有)?|还有现货)\s*(\d{1,8})\s*(条|根|片|张|块|套|台|件|个|颗)$/.exec(clause)
      ?? /^(\d{1,8})\s*(条|根|片|张|块|套|台|件|个|颗)\s*(?:都在|均在|都在库|均在库|现货|在库)$/.exec(clause);
    const offer = /^(?:目前|最多|这笔单)?(?:只能|可以|可|能)(?:锁|预留)\s*(\d{1,8})\s*(条|根|片|张|块|套|台|件|个|颗)(?:\s*到.*)?$/.exec(clause);
    if (stock && (!unit || stock[2] === unit.trim())) stockValues.add(Number(stock[1]));
    if (offer && (!unit || offer[2] === unit.trim())) offerValues.add(Number(offer[1]));
  }
  if (stockValues.size === 1) suggestions.stockQuantity = [...stockValues][0];
  if (offerValues.size === 1) suggestions.reservableQuantity = [...offerValues][0];
  return suggestions;
}

function isMemory(context: VerificationContext): boolean {
  if (context.category && context.category !== "OTHER") return context.category === "MEMORY";
  return /内存条|DDR[345]|[LRU]?DIMM|颗粒|(?:SK|海力士|镁光|三星)\s*\d{1,3}\s*G/i.test(context.demandText);
}

// Outgoing questions contain only recognized product attributes, never copied contacts or chat text.
function productReference(text: string, memory: boolean): string {
  if (!memory) {
    const model = /(?:^|[^a-z0-9])((?:[HAB][1238]00|L40S|RTX\s*(?:4090|5090)))(?![a-z0-9])/i.exec(text);
    return model ? `这批 ${model[1].toUpperCase()}` : "这批货";
  }
  const sk = /(?:^|[^a-z0-9])SK(?:\s*HYNIX)?(?![a-z])|海力士/i.test(text);
  const capacity = /(?:^|[^\d])(8|16|24|32|48|64|96|128|192|256|512)\s*G(?:B)?(?![a-z])/i.exec(text)?.[1];
  const speed = readMemoryFrequency(text);
  const specs = [sk && "SK", capacity && `${capacity}G`, speed].filter(Boolean).join(" ");
  return specs ? `这批 ${specs} 内存` : "这批内存";
}

export function assessVerification(
  context: VerificationContext,
  entries: readonly VerificationEntry[] = [],
  now: Date = new Date(),
): VerificationAssessment {
  const unitsComparable = Boolean(context.unit?.trim() && context.unit.trim() === context.demandUnit?.trim());
  const result: VerificationAssessment = {
    sellerQuestion: "", buyerQuestion: "", activeReservedQuantity: 0, reservationExpired: false, unitsComparable, notices: [],
  };
  const timeline = entries.filter(entry => !validateVerificationEntry(entry, context) && Date.parse(entry.recordedAt) <= now.getTime());
  timeline.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));

  const holderByRespondent = new Map<string, VerificationEntry["holder"]>();
  let holderConfirmedLock = false;
  for (const entry of timeline) {
    if (entry.role === "buyer") {
      if (entry.buyerAcceptsPackaging !== "unknown" && entry.acceptedPackaging === result.latestPackagingEntry?.packaging) {
        result.latestBuyerPackagingEntry = entry;
      }
      continue;
    }
    const respondent = entry.confirmedBy.trim();
    if (entry.holder !== "unknown") {
      result.latestHolderEntry = entry;
      holderByRespondent.set(respondent, entry.holder);
      if (entry.holder === "intermediary" && respondent === result.latestReservedEntry?.confirmedBy.trim()) holderConfirmedLock = false;
    }
    if (entry.stockQuantity !== undefined) result.latestStockEntry = entry;
    if (entry.reservableQuantity !== undefined) result.latestReservableEntry = entry;
    if (entry.reservedQuantity !== undefined) {
      result.latestReservedEntry = entry;
      holderConfirmedLock = holderByRespondent.get(respondent) === "holder";
    }
    if (entry.batch.trim()) result.latestBatchEntry = entry;
    if (entry.packaging !== "unknown") {
      if (entry.packaging !== result.latestPackagingEntry?.packaging) result.latestBuyerPackagingEntry = undefined;
      result.latestPackagingEntry = entry;
    }
  }

  const { latestStockEntry: stock, latestReservedEntry: reserved, latestReservableEntry: offer } = result;
  result.stockQuantity = stock?.stockQuantity;
  result.reservationExpired = Boolean(reserved?.reservedQuantity && reserved.reservedUntil && Date.parse(reserved.reservedUntil) <= now.getTime());
  const activeReservation = reserved?.reservedQuantity && reserved.reservedUntil && !result.reservationExpired;
  const conflictingStock = activeReservation && stock?.stockQuantity !== undefined && reserved.reservedQuantity > stock.stockQuantity;
  if (conflictingStock) result.notices.push("现货回复与已预留数量有冲突，请供方复核。");
  if (activeReservation && !conflictingStock && holderConfirmedLock) result.activeReservedQuantity = reserved.reservedQuantity;
  if (activeReservation && !holderConfirmedLock) result.notices.push("已记录预留说法，仍需直接持货方确认本单预留的数量和截止时间。");
  if (offer && (!offer.reservableUntil || Date.parse(offer.reservableUntil) > now.getTime())) {
    result.activeReservableQuantity = offer.reservableQuantity;
  }
  if (result.reservationExpired) result.notices.push("这笔需求的预留已到期，请重新确认数量和截止时间。");
  if (reserved?.reservedQuantity && !reserved.reservedUntil) result.notices.push("供方提到已预留，截止时间待确认。");
  if (result.activeReservableQuantity && !result.activeReservedQuantity) result.notices.push("供方提到可以预留，实际锁货仍待确认。");
  if (result.latestHolderEntry?.holder === "intermediary") result.notices.push("当前为转报货源，持货方仍待直接确认。");
  const demandQuantity = context.demandQuantity;
  if (Number.isFinite(demandQuantity) && demandQuantity > 0) {
    if (unitsComparable) result.shortfall = Math.max(0, demandQuantity - result.activeReservedQuantity);
    else result.notices.push("供需数量单位待核对，暂不计算缺口。");
  }

  const memory = isMemory(context);
  const expectedBatch = dateCode(context.demandText);
  const batch = result.latestBatchEntry?.batch;
  const batchCode = /^\d{2,4}$/.test(batch?.trim() ?? "") ? `DC${batch.trim()}` : dateCode(batch ?? "");
  const batchMismatch = expectedBatch && batch && batchCode !== expectedBatch;
  const packaging = result.latestPackagingEntry?.packaging;
  const accepted = result.latestBuyerPackagingEntry?.buyerAcceptsPackaging;
  const shareableUnit = shareableUnitPattern.test(context.unit?.trim() ?? "") ? context.unit.trim() : "";
  const questions: string[] = [];
  if (result.latestHolderEntry?.holder !== "holder") questions.push("您是直接持货方吗？如是转报，方便请持货方确认吗？");
  if (memory && !packaging) {
    const listed = suggestSellerFields(context.supplyText).packaging;
    if (listed) questions.push(`原消息提到${listed === "white-label" ? "白牌" : "原厂条"}，请确认这批实物是否一致。`);
    else questions.push("是原厂内存条还是白牌颗粒条？");
  }
  if (accepted === "no") {
    const rejected = packaging === "white-label" ? "白牌" : "原厂条";
    result.notices.push(`买方已回复不接受${rejected}，请另找符合要求的货源。`);
    questions.push("这批的品牌不符合本单要求，还有其他品牌的货源吗？");
  }
  if (expectedBatch && !batch) questions.push(`这批货的批次是 ${expectedBatch} 吗？`);
  if (batchMismatch) {
    questions.push(`能否提供 ${expectedBatch} 批次？`);
    result.notices.push(`需求指定 ${expectedBatch}，供方回复的批次与需求尚未核对一致。`);
  }
  if (!batchMismatch && accepted !== "no") {
    if (result.stockQuantity === undefined) {
      const listing = Number.isSafeInteger(context.supplyQuantity) && context.supplyQuantity > 0 && shareableUnit
        ? `原记录为 ${context.supplyQuantity}${shareableUnit}，` : "";
      questions.push(`${listing}目前实际有多少现货？`);
    }
    if (result.stockQuantity !== 0 && (!result.activeReservedQuantity || conflictingStock)) {
      const askForQuantity = unitsComparable && shareableUnit && demandQuantity > 0 ? `需求为 ${demandQuantity}${shareableUnit}。` : "";
      questions.push(`${askForQuantity}请确认已为这笔单预留的数量和截止时间。`);
    } else if (result.activeReservedQuantity && result.shortfall) {
      const missing = shareableUnit ? `还差 ${result.shortfall}${shareableUnit}，` : "";
      questions.push(`这笔单${missing}能追加预留吗？请确认追加数量和截止时间。`);
    }
  }
  if (questions.length) result.sellerQuestion = `您好，想核实${productReference(context.demandText, memory)}。${questions.join("")}`;
  if (memory && packaging === "white-label" && !accepted) {
    result.buyerQuestion = "这批是白牌内存条，请问您是否接受，还是只收原厂条？";
  }
  return result;
}
