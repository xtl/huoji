import type { RpaMessage } from "./rpa";
import type { WechatPublishedTime } from "../src/wechat-published-time";

export interface RpaSourceLink {
  itemIndex: number;
  captureId: string;
  sourceItemIndex: number;
  sender: string;
  messageId: string;
  observedAt: string;
  sentAt?: string | null;
  publishedTime?: WechatPublishedTime;
  uniqueTimeSource?: boolean;
  match: "EXACT_BUBBLE";
}
export interface RpaSourceItemAlias { itemIndex: number; keys: string[] }

const compact = (value: string) => value.replace(/\s+/gu, "");
const uncertain = (value: string) => /【OCR待核对|OCR_LOW_CONFIDENCE|OCR_TEXT_UNCERTAIN/u.test(value);
const LINK_WINDOW_MS = 30 * 60_000;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const rawText = (item: unknown) => object(item) && typeof item.rawText === "string" ? item.rawText : "";
const quoted = (line: string) => /引用(?:消息|内容)|转发(?:的)?(?:消息|聊天记录)|合并转发|^\s*[【\[]?(?:回复(?:消息)?|聊天记录)[：:\]】\s]*$|^\s*(?:回复[：:]|[>「『])/u.test(line);

/** Match complete consecutive lines, never an arbitrary substring of a larger line. */
function hasAuthoredBubble(snapshot: string, sender: string, body: string): boolean {
  const lines = snapshot.split(/\r\n|\r|\n/u);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (uncertain(lines[index]) || lines[index].trim() !== sender.trim()) continue;
    // A nickname immediately inside a quote/reply/forward block is not a captured author.
    let quoteContext = false;
    for (let previous = index - 1; previous >= Math.max(0, index - 3); previous -= 1) {
      if (!lines[previous].trim()) break;
      if (quoted(lines[previous])) { quoteContext = true; break; }
    }
    if (quoteContext) continue;
    let captured = "";
    for (let next = index + 1; next < lines.length; next += 1) {
      if (uncertain(lines[next]) || quoted(lines[next])) break;
      captured += compact(lines[next]);
      if (captured === body) return true;
      if (!body.startsWith(captured)) break;
    }
  }
  return false;
}

function timeFitsSnapshot(capture: RpaMessage, snapshotTime: number): boolean {
  const time = capture.publishedTime;
  const latestLabel = time?.kind === "WECHAT_RANGE" ? time.to : time?.kind === "WECHAT_MINUTE" || time?.kind === "WECHAT_MARKER" ? time.at : undefined;
  const bounded = time?.kind === "WECHAT_MINUTE" || time?.kind === "WECHAT_RANGE";
  return (!latestLabel || Date.parse(latestLabel) <= snapshotTime) && (Date.parse(capture.observedAt) <= snapshotTime || bounded);
}

/** Read-only evidence from captured messages; no AI-supplied source link is considered. */
function deriveAllRpaSourceLinks(snapshot: RpaMessage, captures: readonly RpaMessage[]): RpaSourceLink[] {
  // In an unknown-author single bubble, every recognized name is body text.
  // It cannot be treated as an external nickname from a multi-message viewport.
  if (snapshot.captureMode !== "OCR_SNAPSHOT" || !snapshot.deviceId
    || (snapshot.captureUnit ?? snapshot.source?.captureUnit) === "TEXT_BUBBLE") return [];
  const snapshotTime = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(snapshotTime)) return [];
  const candidatesByBody = new Map<string, Array<{ capture: RpaMessage; sourceItemIndex: number; distance: number }>>();
  for (const capture of captures) {
    if (capture.captureMode !== "OCR_MESSAGE" || capture.status !== "READY" || capture.workspaceId !== snapshot.workspaceId || capture.userId !== snapshot.userId || capture.deviceId !== snapshot.deviceId || capture.chatName !== snapshot.chatName) continue;
    const sender = capture.sender.trim();
    if (!sender || /^(未知来源|未知|未识别.*|发送人未识别.*)$/u.test(sender) || uncertain(sender) || uncertain(capture.text) || capture.reviewFlags?.includes("OCR_TEXT_UNCERTAIN")) continue;
    const observed = Date.parse(capture.observedAt);
    const distance = Math.abs(observed - snapshotTime);
    if (!Number.isFinite(observed) || distance > LINK_WINDOW_MS) continue;
    const body = compact(capture.text);
    if (!body) continue;
    const matchingItems = (capture.parsedResult?.data.items ?? []).map((item, index) => ({ text: rawText(item), index })).filter((item) => item.text && !uncertain(item.text) && compact(item.text) === body);
    if (matchingItems.length !== 1) continue;
    const candidates = candidatesByBody.get(body) ?? [];
    candidates.push({ capture, sourceItemIndex: matchingItems[0].index, distance });
    candidatesByBody.set(body, candidates);
  }
  const links: RpaSourceLink[] = [];
  for (const [itemIndex, item] of (snapshot.parsedResult?.data.items ?? []).entries()) {
    const text = rawText(item);
    if (!text || uncertain(text)) continue;
    const body = compact(text);
    const candidates = candidatesByBody.get(body) ?? [];
    // Repeated trading text from different nicknames is not evidence of one author.
    if (new Set(candidates.map(({ capture }) => capture.sender.trim())).size !== 1) continue;
    const matching = candidates.filter(({ capture }) => hasAuthoredBubble(snapshot.text, capture.sender, body));
    matching.sort((left, right) => left.distance - right.distance || left.capture.id.localeCompare(right.capture.id));
    for (const { capture, sourceItemIndex } of matching) {
      // Identical posts can establish an author without identifying one posting time.
      const unique = matching.length === 1 && timeFitsSnapshot(capture, snapshotTime);
      links.push({ itemIndex, captureId: capture.id, sourceItemIndex, sender: capture.sender,
        messageId: capture.messageId, observedAt: capture.observedAt, match: "EXACT_BUBBLE", uniqueTimeSource: unique,
        ...(unique && capture.publishedTime ? { publishedTime: capture.publishedTime } : {}),
        ...(unique && capture.sentAt ? { sentAt: capture.sentAt } : {}),
      });
    }
  }
  return links;
}

function preferredLinks(links: readonly RpaSourceLink[]): RpaSourceLink[] {
  const seen = new Set<number>();
  return links.filter((link) => { if (seen.has(link.itemIndex)) return false; seen.add(link.itemIndex); return true; });
}
export function deriveRpaSourceLinks(snapshot: RpaMessage, captures: readonly RpaMessage[]): RpaSourceLink[] {
  return preferredLinks(deriveAllRpaSourceLinks(snapshot, captures));
}

const contextKey = (message: RpaMessage) => JSON.stringify([message.workspaceId, message.userId, message.deviceId, message.chatName]);

/** Old imported items can point to a bubble without retaining the originating screenshot ID. */
export function findPostdatedLegacyLinks(selected: readonly RpaMessage[], scoped: readonly RpaMessage[]): Set<string> {
  const byContext = new Map<string, Array<{ capture: RpaMessage; observed: number; body: string }>>();
  for (const capture of selected) {
    if (capture.captureMode !== "OCR_MESSAGE") continue;
    const key = contextKey(capture);
    const group = byContext.get(key) ?? [];
    group.push({ capture, observed: Date.parse(capture.observedAt), body: compact(capture.text) });
    byContext.set(key, group);
  }
  const withheld = new Set<string>();
  if (byContext.size === 0) return withheld;
  for (const snapshot of scoped) {
    if (snapshot.captureMode !== "OCR_SNAPSHOT" || (snapshot.captureUnit ?? snapshot.source?.captureUnit) === "TEXT_BUBBLE") continue;
    const candidates = byContext.get(contextKey(snapshot));
    if (!candidates) continue;
    const snapshotTime = Date.parse(snapshot.observedAt);
    for (const { capture, observed, body } of candidates) {
      if (withheld.has(capture.id) || Math.abs(observed - snapshotTime) > LINK_WINDOW_MS || timeFitsSnapshot(capture, snapshotTime)) continue;
      if (hasAuthoredBubble(snapshot.text, capture.sender, body)) withheld.add(capture.id);
    }
  }
  return withheld;
}

/** Bidirectional item aliases use every strictly validated pair, including repeated canonical captures. */
export function deriveRpaSourceMetadata(captures: readonly RpaMessage[]) {
  const metadata = new Map<RpaMessage, { sourceLinks: RpaSourceLink[]; sourceItemAliases: RpaSourceItemAlias[] }>();
  const candidates = new Map<string, RpaMessage[]>();
  const byId = new Map<string, RpaMessage>();
  for (const message of captures) {
    const context = contextKey(message);
    byId.set(`${context}\0${message.id}`, message);
    if (message.captureMode !== "OCR_MESSAGE" || message.status !== "READY") continue;
    const entries = candidates.get(context) ?? []; entries.push(message); candidates.set(context, entries);
  }
  type AliasNode = { parent: string; rank: number; itemKey: string; owner: RpaMessage; itemIndex: number };
  const nodes = new Map<string, AliasNode>();
  const add = (message: RpaMessage, itemIndex: number) => {
    const itemKey = `${message.id}:${itemIndex}`;
    const key = `${contextKey(message)}\0${itemKey}`;
    if (!nodes.has(key)) nodes.set(key, { parent: key, rank: 0, itemKey, owner: message, itemIndex });
    return key;
  };
  const root = (key: string): string => {
    const node = nodes.get(key)!;
    if (node.parent !== key) node.parent = root(node.parent);
    return node.parent;
  };
  for (const snapshot of captures) {
    if (snapshot.captureMode !== "OCR_SNAPSHOT") continue;
    const all = deriveAllRpaSourceLinks(snapshot, candidates.get(contextKey(snapshot)) ?? []);
    metadata.set(snapshot, { sourceLinks: preferredLinks(all), sourceItemAliases: [] });
    for (const link of all) {
      const canonical = byId.get(`${contextKey(snapshot)}\0${link.captureId}`);
      if (!canonical) continue;
      const left = add(snapshot, link.itemIndex); const right = add(canonical, link.sourceItemIndex);
      const leftRoot = root(left); const rightRoot = root(right);
      if (leftRoot !== rightRoot) {
        const leftNode = nodes.get(leftRoot)!; const rightNode = nodes.get(rightRoot)!;
        if (leftNode.rank < rightNode.rank) leftNode.parent = rightRoot;
        else { rightNode.parent = leftRoot; if (leftNode.rank === rightNode.rank) leftNode.rank += 1; }
      }
    }
  }
  const components = new Map<string, AliasNode[]>();
  for (const [key, node] of nodes) { const component = root(key); const entries = components.get(component) ?? []; entries.push(node); components.set(component, entries); }
  for (const entries of components.values()) {
    const keys = [...new Set(entries.map((entry) => entry.itemKey))].sort();
    for (const entry of entries) {
      const value = metadata.get(entry.owner) ?? { sourceLinks: [], sourceItemAliases: [] };
      value.sourceItemAliases.push({ itemIndex: entry.itemIndex, keys: [...keys] }); metadata.set(entry.owner, value);
    }
  }
  for (const value of metadata.values()) value.sourceItemAliases.sort((left, right) => left.itemIndex - right.itemIndex);
  return metadata;
}
