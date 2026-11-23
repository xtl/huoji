import { collectorConnection } from "../collector-connection";
import CaptureUsage from "./CaptureUsage";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Download, Inbox, ListPlus, Plus, RefreshCw, RotateCcw } from "lucide-react";
import WechatHistoryBackfill, { type CaptureTool } from "./WechatHistoryBackfill";
import CaptureDialog from "./CaptureDialog";
import { setIntakeView } from "../workspace-navigation";
import type { ManagedGroupList } from "./WechatCollectionGroups";
import { ocrWarnings, unknownSourceWarning } from "../rpa-capture-warnings";
import type { WechatPublishedTime } from "../wechat-published-time";
import { wechatTimeLabel, wechatTimestamp } from "../wechat-time-label";

export interface WechatRpaParsedItem {
  postType?: string;
  tradeMode?: string;
  productCategory?: string;
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
  configItems?: Array<{ label: string; value: string }>;
}

interface ExtractionResult {
  summary?: { total?: number; goodsCount?: number; demandCount?: number };
  items: WechatRpaParsedItem[];
  warnings?: string[];
}

export interface WechatRpaSourceLink {
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

export interface WechatRpaSourceItemAliases {
  itemIndex: number;
  keys: string[];
}

export interface WechatRpaMessage {
  id: string;
  messageId: string;
  deviceId: string;
  chatName: string;
  sender: string;
  sentAt: string | null;
  publishedTime?: WechatPublishedTime;
  observedAt: string;
  text: string;
  captureMode?: "UIA_MESSAGE" | "OCR_SNAPSHOT" | "OCR_MESSAGE";
  captureUnit?: "TEXT_BUBBLE" | "VIEWPORT_REMAINDER";
  source?: { captureMode?: WechatRpaMessage["captureMode"]; captureUnit?: WechatRpaMessage["captureUnit"]; publishedTime?: WechatPublishedTime };
  status: "PENDING" | "PROCESSING" | "READY" | "FAILED" | "DISMISSED";
  provider?: string;
  isMock?: boolean;
  result?: ExtractionResult;
  parsedResult?: { data: ExtractionResult; isMock: boolean; provider: string };
  error?: string;
  reviewFlags?: string[];
  sourceLinks?: WechatRpaSourceLink[];
  sourceItemAliases?: WechatRpaSourceItemAliases[];
}

interface RpaConfig extends ManagedGroupList {
  pollIntervalSeconds?: number;
  pollingIntervalSeconds?: number;
  batchLimit: number;
  sessionExpiresAt: string;
}

interface Props {
  destination: string;
  token: string;
  userId: string;
  workspaceId: string;
  sessionExpiresAt: string;
  importedItemKeys: Set<string>;
  pendingItemKeys: ReadonlySet<string>;
  onImport: (message: WechatRpaMessage) => { addedCount: number; alreadyImported?: boolean };
  onImportMany: (messages: WechatRpaMessage[]) => { addedCount: number; alreadyImported?: boolean };
}

const PAGE_SIZE = 10;
const statusNames: Record<WechatRpaMessage["status"], string> = {
  PENDING: "等待解析",
  PROCESSING: "正在解析",
  READY: "已解析",
  FAILED: "解析失败",
  DISMISSED: "已忽略",
};
const reviewFlagLabels: Record<string, string> = {
  POSSIBLE_UPDATE: "可能包含货源更新，请核对最新数量和价格",
  POSSIBLE_SOLD_OR_CANCELLED: "可能已售出或取消，请确认是否仍有效",
  OCR_REQUIRES_REVIEW: "截图识别结果，请核对来源、数量和价格",
  OCR_TEXT_UNCERTAIN: "部分文字识别不确定，请对照微信核对",
};

// Older records stored these as warnings in addition to their parser metadata.
const legacyParserNotices = new Set([
  "当前为本地离线解析。配置 DEEPSEEK_API_KEY 后会调用 DeepSeek 做完整语义抽取。",
  "当前为本地规则解析，尚未调用真实 AI；请核对后再入库。",
]);
const captureNotices = new Set<string>(Object.values(ocrWarnings));

export function rpaMessageResult(message: WechatRpaMessage): ExtractionResult | undefined {
  return message.parsedResult?.data ?? message.result;
}

function captureMetadata(message: WechatRpaMessage) {
  return { mode: message.captureMode ?? message.source?.captureMode, unit: message.captureUnit ?? message.source?.captureUnit };
}

export function rpaMessageReview(message: WechatRpaMessage) {
  const metadata = message.parsedResult ?? message;
  const result = rpaMessageResult(message);
  const provider = metadata.provider?.toLowerCase();
  const local = metadata.isMock === true || (metadata.isMock !== false && (provider === "mock" || provider === "local-fallback"));
  const method = local ? "本地规则" : provider === "deepseek" ? "DeepSeek" : "未记录";
  const warnings = new Set<string>();
  const { mode, unit } = captureMetadata(message);
  const isSnapshot = mode === "OCR_SNAPSHOT";
  const isOcr = isSnapshot || mode === "OCR_MESSAGE";
  if (isSnapshot) {
    warnings.add(unit === "TEXT_BUBBLE"
      ? "请对照原消息核对这条报价的发言人、数量、单位和价格。"
      : "整屏截图可能包含多条报价，请逐条核对发言人、数量、单位和价格。");
  } else if (mode === "OCR_MESSAGE") {
    warnings.add("请核对截图配对的昵称、数量和价格。");
  }
  const knownSender = Boolean(message.sender?.trim()) && !/^(未知|未识别|发送人未识别)/.test(message.sender);
  const senderBoundToItems = knownSender && Boolean(result?.items?.length) && result.items.every(item => item.sourceContact === message.sender);
  for (const raw of result?.warnings ?? []) {
    if (typeof raw !== "string") continue;
    const note = raw.trim();
    if (!note || legacyParserNotices.has(note) || (isOcr && captureNotices.has(note))) continue;
    if (note === unknownSourceWarning && (isOcr || senderBoundToItems)) continue;
    warnings.add(note);
  }
  for (const flag of message.reviewFlags ?? []) {
    if (flag === "OCR_REQUIRES_REVIEW" && isOcr) continue;
    warnings.add(reviewFlagLabels[flag] ?? "这条消息需要人工核对");
  }
  return { method, warnings: [...warnings] };
}

export function rpaMessageItemKey(messageId: string, index: number): string {
  return `${messageId}:${index}`;
}

export function rpaItemSource(message: WechatRpaMessage, itemIndex: number) {
  // Only server-owned links on the message can establish a canonical source.
  // AI extraction fields never establish sender identity or deduplication keys.
  const { mode, unit } = captureMetadata(message);
  const links = mode === "OCR_SNAPSHOT" && message.status === "READY" && Array.isArray(message.sourceLinks)
    ? message.sourceLinks.filter((link) => link?.itemIndex === itemIndex && link.match === "EXACT_BUBBLE"
      && Number.isInteger(link.sourceItemIndex) && link.sourceItemIndex >= 0
      && typeof link.captureId === "string" && link.captureId.trim()
      && typeof link.sender === "string" && link.sender.trim()
      && typeof link.messageId === "string" && link.messageId.trim()
      && typeof link.observedAt === "string" && Number.isFinite(Date.parse(link.observedAt)))
    : [];
  const link = links.length === 1 ? links[0] : undefined;
  return link ? {
    key: rpaMessageItemKey(link.captureId, link.sourceItemIndex),
    captureId: link.captureId,
    sourceItemIndex: link.sourceItemIndex,
    messageId: link.messageId,
    sender: link.sender,
    observedAt: link.observedAt,
    sentAt: link.sentAt ?? null,
    publishedTime: link.publishedTime,
    canLookupPublishedTime: link.uniqueTimeSource === true,
    captureMode: "OCR_MESSAGE" as const,
    linked: true,
  } : {
    key: rpaMessageItemKey(message.id, itemIndex),
    captureId: message.id,
    sourceItemIndex: itemIndex,
    messageId: message.messageId,
    sender: mode === "OCR_SNAPSHOT" ? "未知来源" : message.sender || "未知来源",
    observedAt: message.observedAt,
    sentAt: !mode || mode === "UIA_MESSAGE" ? message.sentAt : null,
    publishedTime: mode === "OCR_MESSAGE" || unit === "TEXT_BUBBLE" ? message.publishedTime ?? message.source?.publishedTime : undefined,
    canLookupPublishedTime: mode !== "OCR_SNAPSHOT" || unit === "TEXT_BUBBLE",
    captureMode: mode,
    linked: false,
  };
}

export function rpaItemIsImported(message: WechatRpaMessage, itemIndex: number, importedItemKeys: ReadonlySet<string>): boolean {
  const aliases = Array.isArray(message.sourceItemAliases) ? message.sourceItemAliases : [];
  const importedAlias = aliases.some((entry) => Number.isInteger(entry?.itemIndex) && entry.itemIndex >= 0
    && entry.itemIndex === itemIndex && Array.isArray(entry.keys)
    && entry.keys.some((key) => typeof key === "string" && key.trim().length > 0 && importedItemKeys.has(key)));
  return importedAlias || importedItemKeys.has(rpaItemSource(message, itemIndex).key) || importedItemKeys.has(rpaMessageItemKey(message.id, itemIndex));
}

export function rpaMessageCanBulkImport(message: WechatRpaMessage, importedItemKeys: ReadonlySet<string> = new Set()): boolean {
  const result = rpaMessageResult(message);
  const { mode, unit } = captureMetadata(message);
  if (message.status !== "READY" || typeof message.text !== "string" || !message.text.trim()
      || !Array.isArray(result?.items) || !result.items.length || unit === "VIEWPORT_REMAINDER") return false;
  const complete = mode === "OCR_MESSAGE" || mode === "UIA_MESSAGE" || mode === undefined
    || (mode === "OCR_SNAPSHOT" && unit === "TEXT_BUBBLE");
  return complete && result.items.some((_, index) => !rpaItemIsImported(message, index, importedItemKeys));
}

interface RpaMessagePage {
  items?: WechatRpaMessage[];
  messages?: WechatRpaMessage[];
  total: number;
  page?: number;
  pageSize?: number;
}

class RpaListChanged extends Error {}

/** Verify two complete reads before handing one stable batch to the parent. */
export async function collectStableRpaReadyMessages(
  loadPage: (page: number, pageSize: number) => Promise<RpaMessagePage>,
  signal: AbortSignal,
  onProgress: (text: string) => void = () => {},
): Promise<WechatRpaMessage[]> {
  const assertActive = () => { if (signal.aborted) throw new DOMException("Aborted", "AbortError"); };
  async function readAll(attempt: number, verification: boolean) {
    const collected: WechatRpaMessage[] = [];
    const ids = new Set<string>();
    let expectedTotal: number | undefined;
    for (let page = 1; ; page += 1) {
      assertActive();
      const response = await loadPage(page, 100);
      assertActive();
      const items = response.items ?? response.messages;
      if (!Number.isSafeInteger(response.total) || response.total < 0 || !Array.isArray(items)
          || (response.page !== undefined && response.page !== page) || (response.pageSize !== undefined && response.pageSize !== 100)) {
        throw new Error("采集列表返回不完整，本次未加入任何结果，请刷新后重试。");
      }
      if (expectedTotal === undefined) expectedTotal = response.total;
      if (response.total !== expectedTotal) throw new RpaListChanged();
      const expectedCount = Math.min(100, Math.max(0, expectedTotal - (page - 1) * 100));
      if (items.length !== expectedCount) throw new RpaListChanged();
      for (const item of items) {
        if (!item || typeof item.id !== "string" || !item.id || item.status !== "READY" || ids.has(item.id)) throw new RpaListChanged();
        ids.add(item.id);
        collected.push(item);
      }
      onProgress(`${verification ? "正在核对" : "正在收齐"}全部群的文字消息：第 ${page}/${Math.max(1, Math.ceil(expectedTotal / 100))} 页${attempt > 1 ? `（第 ${attempt} 次尝试）` : ""}`);
      if (collected.length === expectedTotal) return collected;
    }
  }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const messages = await readAll(attempt, false);
      const verified = await readAll(attempt, true);
      assertActive();
      if (messages.length !== verified.length || messages.some((message, index) => message.id !== verified[index].id)) throw new RpaListChanged();
      return verified;
    } catch (reason) {
      assertActive();
      if (!(reason instanceof RpaListChanged)) throw reason;
      if (attempt === 3) throw new Error("采集列表持续变化，本次未加入任何结果。请稍候再试。");
      onProgress("采集列表有更新，正在重新读取。");
    }
  }
  return [];
}

async function rpaRequest<T>(token: string, url: string, method = "GET", signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` }, signal });
  if (response.status === 401) throw new Error("登录已过期，请重新登录后连接微信采集。");
  if (response.status === 404) throw new Error("当前服务器尚未提供微信采集，请更新服务器后刷新。");
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(payload?.error || "微信采集暂时无法连接，请稍后刷新。");
  return payload as T;
}

function timeLabel(value: string | null | undefined): string {
  if (!value) return "未识别";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString("zh-CN", { hour12: false }) : value;
}

function collectorDeviceId(userId: string, workspaceId: string): string {
  const key = `huoji_wechat_rpa_device_id:${userId}:${workspaceId}`;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = `wechat_${crypto.randomUUID()}`;
  localStorage.setItem(key, id);
  return id;
}

export default function WechatRpaInbox({ destination, token, userId, workspaceId, sessionExpiresAt, importedItemKeys, pendingItemKeys, onImport, onImportMany }: Props) {
  const [config, setConfig] = useState<RpaConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [toolPanel, setToolPanel] = useState<CaptureTool | null>(null);
  const [bulkDialog, setBulkDialog] = useState(false);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const [messages, setMessages] = useState<WechatRpaMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("ALL");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [bulkBusy, setBulkBusy] = useState<"PAGE" | "ALL" | null>(null);
  const [bulkProgress, setBulkProgress] = useState("");
  const [bulkError, setBulkError] = useState("");
  const bulkController = useRef<AbortController | null>(null);
  const bulkLocked = useRef(false);
  const scope = `${token}\u0000${userId}\u0000${workspaceId}`;
  const currentScope = useRef(scope);
  const importMany = useRef(onImportMany);
  const currentImportedKeys = useRef(importedItemKeys);
  currentScope.current = scope;
  importMany.current = onImportMany;
  currentImportedKeys.current = importedItemKeys;
  const groups = config?.allowedGroups ?? [];
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pollSeconds = Math.max(5, config?.pollIntervalSeconds ?? config?.pollingIntervalSeconds ?? 10);
  const expiresAt = config?.sessionExpiresAt || sessionExpiresAt;
  const secureOrigin = window.location.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  const pageBulkCount = messages.filter((message) => rpaMessageCanBulkImport(message, importedItemKeys)).length;

  useLayoutEffect(() => {
    setConfig(null);
    setToolPanel(null);
    setBulkDialog(false);
    bulkController.current?.abort();
    bulkController.current = null;
    bulkLocked.current = false;
    setBulkBusy(null);
    setBulkProgress("");
    setBulkError("");
    setError("");
    setNotice("");
    setMessages([]);
    setTotal(0);
    setPage(1);
    setStatus("ALL");
    setBusyId("");
    function openRequestedHistory() {
      if (window.location.hash !== "#input/wechat/history" ||
          !document.querySelector('meta[name="huoji-edition"][content="cloud"]')) return;
      setToolPanel("history");
    }
    openRequestedHistory();
    window.addEventListener("hashchange", openRequestedHistory);
    return () => {
      window.removeEventListener("hashchange", openRequestedHistory);
      bulkController.current?.abort();
      bulkController.current = null;
      bulkLocked.current = false;
    };
  }, [token, userId, workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    const requestScope = scope;
    setConfigError("");
    void rpaRequest<RpaConfig>(token, "/api/rpa/config", "GET", controller.signal)
      .then((result) => { if (!controller.signal.aborted && currentScope.current === requestScope) setConfig(result); })
      .catch((reason) => { if (!controller.signal.aborted && currentScope.current === requestScope) setConfigError(reason instanceof Error ? reason.message : "采集配置读取失败。"); });
    return () => controller.abort();
  }, [token, userId, workspaceId, refreshVersion]);

  useEffect(() => {
    if (bulkBusy) return;
    const controller = new AbortController();
    const requestScope = scope;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function fetchMessages() {
      try {
        const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
        if (status !== "ALL") query.set("status", status);
        const result = await rpaRequest<{ items?: WechatRpaMessage[]; messages?: WechatRpaMessage[]; total: number }>(
          token, `/api/rpa/messages?${query}`, "GET", controller.signal,
        );
        if (controller.signal.aborted || currentScope.current !== requestScope) return;
        const lastPage = Math.max(1, Math.ceil((result.total ?? 0) / PAGE_SIZE));
        if (page > lastPage) { setPage(lastPage); return; }
        setMessages(result.items ?? result.messages ?? []);
        setTotal(result.total ?? 0);
        setError("");
      } catch (reason) {
        if (!controller.signal.aborted && currentScope.current === requestScope) setError(reason instanceof Error ? reason.message : "采集记录读取失败。");
      } finally {
        if (!controller.signal.aborted && currentScope.current === requestScope) {
          setLoading(false);
          timer = setTimeout(() => void fetchMessages(), pollSeconds * 1000);
        }
      }
    }
    setLoading(true);
    void fetchMessages();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [token, userId, workspaceId, page, status, pollSeconds, refreshVersion, bulkBusy]);

  async function updateMessage(id: string, action: "retry" | "dismiss") {
    if (bulkLocked.current || busyId) return;
    const requestScope = scope;
    setBusyId(id);
    setNotice("");
    try {
      await rpaRequest(token, `/api/rpa/messages/${encodeURIComponent(id)}/${action}`, "POST");
      if (currentScope.current !== requestScope) return;
      setRefreshVersion((value) => value + 1);
      setNotice(action === "retry" ? "已重新提交解析。" : "已忽略这条消息。");
    } catch (reason) {
      if (currentScope.current === requestScope) setError(reason instanceof Error ? reason.message : "操作失败，请重试。");
    } finally { if (currentScope.current === requestScope) setBusyId(""); }
  }

  function importMessage(message: WechatRpaMessage) {
    if (bulkLocked.current || busyId) return;
    try {
      const result = onImport(message);
      setNotice(result.alreadyImported ? "这条消息已经整理过了。" : "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加入待入库清单失败，请重试。");
    }
  }

  async function importBulk(mode: "PAGE" | "ALL") {
    if (bulkLocked.current || busyId || loading) return;
    const controller = new AbortController();
    const requestScope = scope;
    bulkController.current = controller;
    bulkLocked.current = true;
    setBulkBusy(mode);
    setBulkError("");
    setNotice("");
    setBulkProgress(mode === "ALL" ? "正在收齐全部群的已解析完整文字消息…" : "正在检查本页文字消息…");
    try {
      const collected = mode === "PAGE" ? messages : await collectStableRpaReadyMessages(
        (page, pageSize) => {
          if (currentScope.current !== requestScope) { controller.abort(); throw new DOMException("Aborted", "AbortError"); }
          return rpaRequest<RpaMessagePage>(token, `/api/rpa/messages?status=READY&page=${page}&pageSize=${pageSize}`, "GET", controller.signal);
        }, controller.signal,
        (progress) => { if (!controller.signal.aborted && currentScope.current === requestScope) setBulkProgress(progress); },
      );
      if (controller.signal.aborted || currentScope.current !== requestScope || bulkController.current !== controller) return;
      const candidates = collected.filter((message) => rpaMessageCanBulkImport(message, currentImportedKeys.current));
      if (!candidates.length) {
        setNotice("暂无可批量加入的新消息。已处理的内容会自动跳过，整屏截图可逐条核对。");
        return;
      }
      const result = importMany.current(candidates);
      setNotice(result.addedCount > 0 ? `待入库清单新增 ${result.addedCount} 条，请核对后保存。` : "这些消息已处理，可在待入库清单或供需记录中查看。");
    } catch (reason) {
      if (!controller.signal.aborted && currentScope.current === requestScope) setBulkError(reason instanceof Error ? reason.message : "批量加入失败，本次未加入任何结果，请重试。");
    } finally {
      if (bulkController.current === controller) {
        bulkController.current = null;
        bulkLocked.current = false;
        if (currentScope.current === requestScope) { setBulkBusy(null); setBulkProgress(""); }
      }
    }
  }

  function cancelBulk() {
    bulkController.current?.abort();
    bulkController.current = null;
    bulkLocked.current = false;
    setBulkBusy(null);
    setBulkProgress("");
    setNotice("本次批量已取消，未加入任何结果。");
  }

  function changeListView(nextStatus: string, nextPage: number) {
    setMessages([]);
    setLoading(true);
    setNotice("");
    setError("");
    setBulkError("");
    if (status !== nextStatus) setTotal(0);
    setStatus(nextStatus);
    setPage(nextPage);
    if (status === nextStatus && page !== nextPage) {
      listHeading.current?.focus({ preventScroll: true });
      listHeading.current?.scrollIntoView({ block: "start" });
    }
  }

  async function downloadConfig() {
    if (bulkLocked.current) return;
    const requestScope = scope;
    try {
      if (!secureOrigin) throw new Error("请通过 HTTPS 打开货记后下载连接配置。");
      const latest = await rpaRequest<RpaConfig>(token, "/api/rpa/config");
      if (currentScope.current !== requestScope) return;
      if (!Number.isFinite(Date.parse(latest.sessionExpiresAt)) || Date.parse(latest.sessionExpiresAt) <= Date.now()) throw new Error("登录已过期，请重新登录后下载连接配置。");
      setConfig(latest);
      const deviceId = collectorDeviceId(userId, workspaceId);
      const configuration = collectorConnection({ deviceId, apiBaseUrl: window.location.origin,
        token, scope: {userId, workspaceId}, groups: latest.allowedGroups,
        pollIntervalSeconds: Math.max(5, latest.pollIntervalSeconds ?? latest.pollingIntervalSeconds ?? 10), batchSize: latest.batchLimit ?? 50 });
      const url = URL.createObjectURL(new Blob([JSON.stringify(configuration, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "wechat-rpa.config.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("连接配置已下载，请保存到采集器所在电脑。");
    } catch (reason) { if (currentScope.current === requestScope) setError(reason instanceof Error ? reason.message : "连接配置下载失败。"); }
  }

  return (
    <section className="capture-inbox" aria-label="微信采集收件箱">
      <div className="capture-toolbar">
        <div className="capture-list-heading">
          <h2 ref={listHeading} tabIndex={-1}>{loading && !messages.length ? "读取中…" : error ? "采集消息" : <><b>{total.toLocaleString("zh-CN")}</b> 条消息</>}</h2>
        </div>
        <div className="capture-tools">
          <React.Fragment key={scope}><WechatHistoryBackfill token={token} userId={userId} workspaceId={workspaceId}
            destination={destination} tool={toolPanel} onTool={next => {
              if (window.location.hash === "#input/wechat/history") window.history.replaceState(window.history.state, "", "#input/wechat");
              setToolPanel(next);
            }} disabled={Boolean(bulkBusy)} managedGroups={config?.managedGroups} configError={configError}
            onGroupChange={result => {
              setConfig(previous => previous ? { ...previous, managedGroups: result.managedGroups, allowedGroups: result.allowedGroups } : previous);
              setRefreshVersion(value => value + 1);
            }}
            connection={<section className="capture-connection">
              <h3>连接采集电脑</h3>
              <ol><li>在电脑微信中，将每个采集群打开为独立窗口。</li><li>下载连接配置，在本机采集器中使用。</li><li>到「管理采集群」校准新增群的窗口。</li></ol>
              <button type="button" onClick={downloadConfig} disabled={!config || !secureOrigin || Boolean(bulkBusy)} className="capture-action">
                <Download size={15} />下载采集配置</button>
              <p>配置含登录凭证，有效至 {timeLabel(expiresAt)}。在这台采集电脑上重新登录同一账号并打开微信采集页，即可自动更新已连接的空间。</p>
              {!secureOrigin && <p className="capture-alert">请通过 HTTPS 打开货记后下载配置。</p>}
              {configError && <p className="capture-alert" role="alert">{configError} 请关闭窗口后刷新消息。</p>}
              {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="capture-alert">{error}</p>}
            </section>} /></React.Fragment>
        </div>
        <div className="capture-list-controls">
          <label className="capture-filter"><select aria-label="消息状态" value={status}
            disabled={Boolean(bulkBusy) || Boolean(busyId)} onChange={event => changeListView(event.target.value, 1)}>
            <option value="ALL">全部状态</option>
            {Object.entries(statusNames).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
          </select><ChevronDown size={13} aria-hidden="true" /></label>
          <button type="button" title={`刷新消息 · 每 ${pollSeconds} 秒自动更新`} aria-label="刷新消息"
            disabled={loading || Boolean(bulkBusy) || Boolean(busyId)} onClick={() => setRefreshVersion(value => value + 1)} className="capture-refresh">
            <RefreshCw size={15} aria-hidden="true" className={loading ? "motion-safe:animate-spin" : ""} /></button>
          {(total > 0 || status !== "ALL" || bulkBusy) && <button type="button" className="capture-primary" aria-haspopup="dialog"
            disabled={Boolean(bulkBusy) || Boolean(busyId) || loading} onClick={() => setBulkDialog(true)}>
            <ListPlus size={15} aria-hidden="true" />批量加入清单</button>}
        </div>
      </div>
      <React.Fragment key={scope}>
        <CaptureUsage token={token} destination={destination} enterprise={workspaceId.startsWith("ent_")} refresh={refreshVersion}/>
      </React.Fragment>
      {bulkDialog && <CaptureDialog title="批量加入待入库清单" onDismiss={() => setBulkDialog(false)}>
        <p className="capture-bulk-help">选择要整理的范围。完整文字消息会加入待入库清单，已处理的消息会自动跳过。整屏截图需逐条核对。</p>
        <button type="button" className="capture-scope" disabled={loading || Boolean(busyId)}
          onClick={() => { setBulkDialog(false); void importBulk("ALL"); }}><span><strong>所有采集群</strong><small>包括所有页中已解析的消息</small></span><ChevronRight size={16} /></button>
        <button type="button" className="capture-scope" disabled={loading || Boolean(busyId) || pageBulkCount === 0}
          onClick={() => { setBulkDialog(false); void importBulk("PAGE"); }}><span><strong>仅当前页</strong><small>本页有 {pageBulkCount} 条消息可加入</small></span><ChevronRight size={16} /></button>
      </CaptureDialog>}
      {bulkBusy && <div className="capture-progress"><span role="status">{bulkProgress || "正在整理消息…"}</span>
        <button type="button" onClick={cancelBulk}>取消本次批量</button></div>}
      {bulkError && <p role="alert" className="capture-banner capture-error">{bulkError}</p>}
      {error && <p role="alert" className="capture-banner capture-error">{error}</p>}
      {notice && <p role="status" className="capture-banner">{notice}</p>}
      {!messages.length && !loading && !error && <div className="capture-empty">
        <Inbox size={30} strokeWidth={1.4} aria-hidden="true" />
        <h3>{status === "ALL" ? "还没有采集消息" : "没有符合此状态的消息"}</h3>
        {status === "ALL" ? <>
          <p>{groups.length ? "可补采已启用群的近期消息。" : "先添加采集群并连接电脑微信。"}</p>
          <button className="capture-action" type="button" onClick={() => setToolPanel(groups.length ? "history" : "groups")}>{groups.length ? "补采群消息" : "添加采集群"}</button>
          <button className="capture-tool" type="button" onClick={() => setToolPanel("connection")}>连接设置</button>
        </> : <button className="capture-action" type="button" onClick={() => changeListView("ALL", 1)}>查看全部消息</button>}
      </div>}
      {loading && !messages.length && <p role="status" className="capture-empty">正在读取消息…</p>}
      {messages.length > 0 && <div className="capture-ledger">
        <div aria-hidden="true" className="capture-columns"><span>产品与原消息</span><span>发言人 / 群聊</span><span>微信时间</span><span>处理</span></div>
        <div>{messages.map(message => <React.Fragment key={message.id}><CaptureMessage message={message} importedItemKeys={importedItemKeys} pendingItemKeys={pendingItemKeys}
          busy={Boolean(busyId) || Boolean(bulkBusy)} onImport={importMessage} onUpdate={updateMessage} /></React.Fragment>)}</div>
      </div>}
      {pageCount > 1 && <nav aria-label="采集消息分页" className="capture-pages"><span>第 {page} / {pageCount} 页</span>
        <button type="button" onClick={() => changeListView(status, page - 1)} disabled={page <= 1 || loading || Boolean(bulkBusy) || Boolean(busyId)}><ChevronLeft size={15} />上一页</button>
        <button type="button" onClick={() => changeListView(status, page + 1)} disabled={page >= pageCount || loading || Boolean(bulkBusy) || Boolean(busyId)}>下一页<ChevronRight size={15} /></button>
      </nav>}
    </section>
  );
}

function CaptureMessage({ message, importedItemKeys, pendingItemKeys, busy, onImport, onUpdate }: {
  message: WechatRpaMessage;
  importedItemKeys: ReadonlySet<string>;
  pendingItemKeys: ReadonlySet<string>;
  busy: boolean;
  onImport: (message: WechatRpaMessage) => void;
  onUpdate: (id: string, action: "retry" | "dismiss") => Promise<void>;
}) {
  const result = rpaMessageResult(message);
  const items = result?.items ?? [];
  const imported = items.length > 0 && items.every((_, index) => rpaItemIsImported(message, index, importedItemKeys));
  const { mode, unit } = captureMetadata(message);
  const isSnapshot = mode === "OCR_SNAPSHOT";
  const isUnknownBubble = isSnapshot && unit === "TEXT_BUBBLE";
  const itemSources = items.map((_, index) => rpaItemSource(message, index));
  const linkedCount = itemSources.filter(source => source.linked).length;
  const { method, warnings } = rpaMessageReview(message);
  const showMethod = message.status === "READY" || (message.status === "DISMISSED" && Boolean(result));
  let sender = message.sender || "发送人未识别";
  if (isSnapshot) {
    const captureLabel = isUnknownBubble ? "单条截图" : "整屏截图";
    const linkedSenders = [...new Set(itemSources.filter(source => source.linked).map(source => source.sender))];
    sender = linkedCount ? captureLabel + " · " + linkedSenders.join("、") + "（" + linkedCount + " 条已关联）" : captureLabel + " · 发送人未识别";
  }

  const hasSupply = items.some(item => item.postType === "GOODS");
  const hasDemand = items.some(item => item.postType === "DEMAND");
  const [expanded, setExpanded] = useState(false);
  const detailsId = React.useId();
  const products = [...new Set(items.map(item => (item.title || item.model || item.gpuModel || "").trim()).filter(Boolean))];
  const title = products.length ? products.slice(0, 2).join("、") + (products.length > 2 ? ` 等 ${products.length} 种` : "")
    : items.length ? "产品待核对" : message.text.trim().split(/\r?\n/)[0] || "消息内容待核对";
  const published = isSnapshot && !isUnknownBubble ? "见逐项时间" : wechatTimeLabel(
    !mode || mode === "UIA_MESSAGE" ? message.sentAt : null, message.publishedTime ?? message.source?.publishedTime, message.observedAt);
  const time = compactCaptureTime(published);
  const needsTradeCheck = message.reviewFlags?.includes("POSSIBLE_SOLD_OR_CANCELLED");
  const hasDraft = imported && items.some((_, index) => rpaItemIsImported(message, index, pendingItemKeys));
  const status = message.status === "READY" && imported && !hasDraft ? "已入库" : statusNames[message.status];
  const canAdd = message.status === "READY" && !imported && items.length > 0;
  return <article className="capture-message" data-expanded={expanded}>
    <div className="capture-row">
      <div className="capture-subject">
        <div className="capture-title">
          {hasSupply && <span className="capture-kind is-supply">供应</span>}
          {hasDemand && <span className="capture-kind is-demand">需求</span>}
          <h3><button type="button" title={title} aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => !value)}>
            <span>{title}</span><ChevronDown size={14} aria-hidden="true" /></button></h3>
        </div>
        {items.length > 0 && <p className="capture-excerpt">{message.text}</p>}
        {message.status === "FAILED" && message.error && <p className="capture-parse-error">{message.error} {message.error.includes("货记分不足") && <a href="#account/credits">购买货记分</a>}</p>}
        {(warnings.length > 0 || needsTradeCheck) && <button type="button" aria-expanded={expanded} aria-controls={detailsId} className="capture-warning"
          onClick={() => setExpanded(value => !value)}>{needsTradeCheck ? "可能已售出或取消" : `${warnings.length} 项待核对`}<ChevronRight size={12} /></button>}
      </div>
      <div className="capture-origin"><strong title={sender}>{sender}</strong><span title={message.chatName}>{message.chatName}</span></div>
      <div className="capture-time" title={published} aria-label={published}><span>{time.value}</span>{time.precision && <small>{time.precision}</small>}</div>
      <div className="capture-row-action">
        {canAdd ? <button type="button" aria-label="加入待入库清单" onClick={() => onImport(message)} disabled={busy}><Plus size={14} />加入清单</button>
          : hasDraft && message.status === "READY" ? <button type="button" className="queued-message" onClick={() => setIntakeView("review")} aria-label="已加入，查看待入库清单"><Check size={14} />待入库</button>
          : message.status === "FAILED" ? <button type="button" disabled={busy} onClick={() => void onUpdate(message.id, "retry")}><RotateCcw size={13} />重试解析</button>
          : <span className="capture-read-status">{imported && message.status === "READY" && <Check size={13} />}{status}</span>}
      </div>
    </div>
    {expanded && <div id={detailsId} className="capture-expanded">
      <section><h4>微信原文</h4><p className="capture-raw">{message.text}</p>
        <p className="capture-evidence-time">{published} · 采集于 {wechatTimestamp(message.observedAt)}（北京时间）</p>
      </section>
      <section><h4>解析结果{items.length > 1 && ` · ${items.length} 条`}</h4>
        {showMethod && <p className="capture-method">{method === "未记录" ? "解析方式未记录" : method}</p>}
        {items.length > 0 ? <ul className="capture-parsed">{items.map((item, index) => {
          const source = itemSources[index];
          return <li key={index}><strong>{item.postType === "DEMAND" ? "需求" : item.postType === "GOODS" ? "供应" : "类型待确认"} · {item.title || item.model || item.gpuModel || "产品待核对"}</strong>
            <p>来源 · {source.linked ? source.sender + "（已关联逐条消息）" : isSnapshot ? "待核对" : mode === "OCR_MESSAGE" ? source.sender + "（截图识别昵称，待核对）" : source.sender}</p>
            {isSnapshot && !isUnknownBubble && <p>{wechatTimeLabel(source.sentAt, source.publishedTime, source.observedAt)}</p>}
          </li>;
        })}</ul> : <p>{message.status === "PENDING" || message.status === "PROCESSING" ? status : "暂无可入库的供需条目。"}</p>}
        {warnings.length > 0 && <ul aria-label="待核对事项" className="capture-cautions">{warnings.map(note => <li key={note}>{note}</li>)}</ul>}
      </section>
      {message.status !== "DISMISSED" && <button type="button" disabled={busy} className="capture-ignore" onClick={() => void onUpdate(message.id, "dismiss")}>忽略这条消息</button>}
    </div>}
  </article>;
}

// Keep date markers and ranges distinct from an exact publication time.
function compactCaptureTime(label: string): { value: string; precision?: string } {
  const match = /^(微信发布|微信时间标记|微信日期标记) (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?(（分钟）)?$/.exec(label);
  if (!match) return { value: label === "微信发布时间未识别" ? "时间待核对" : label.replace(/^微信发布时间范围 /, "范围 ") };
  const [, kind, day, clock, minute] = match;
  const today = wechatTimestamp(new Date().toISOString()).slice(0, 10);
  const date = day === today ? "今天" : day.slice(0, 4) === today.slice(0, 4) ? day.slice(5) : day;
  return { value: clock ? date + " " + clock : date, precision: kind === "微信发布" ? minute ? "精确到分钟" : undefined : kind === "微信日期标记" ? "日期标记" : "时间标记" };
}
