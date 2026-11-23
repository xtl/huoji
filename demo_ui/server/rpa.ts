import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import type { Request } from "express";
import { readJsonSnapshot, writeAtomicJson } from "./rpa-persistence";
import { deriveRpaSourceMetadata, findPostdatedLegacyLinks } from "./rpa-source-links";
import { ocrWarnings, unknownSourceWarning } from "../src/rpa-capture-warnings";
import { compareChronology, tradeChronology } from "../src/trade-chronology";
import { improvesPublishedTime, wechatClockMarker, wechatShanghaiDate, type WechatPublishedTime } from "../src/wechat-published-time";
export type { RpaSourceLink, RpaSourceItemAlias } from "./rpa-source-links";

export const RPA_DEFAULT_GROUPS = ["B300真实交易群", "真实货源群"];
interface CaptureGroup { name: string; enabled: boolean }
interface GroupSettings { userId: string; workspaceId: string; groups: CaptureGroup[] }
type SyncGroups = (session: RpaSession, enabled: string[]) => void;
type GroupAction = "add" | "update" | "remove";

export function isRpaGroupName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value
    && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value) && !/^(微信|wechat|weixin)$/iu.test(value);
}

function enabledNames(groups: readonly CaptureGroup[]) { return groups.filter((group) => group.enabled).map((group) => group.name); }
function belongsTo(session: RpaSession, entry: { userId: string; workspaceId: string }) {
  return entry.userId === session.userId && entry.workspaceId === session.currentWorkspaceId;
}
export const RPA_BATCH_LIMIT = 50;
export type RpaStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED" | "DISMISSED";
export type RpaCaptureMode = "UIA_MESSAGE" | "OCR_SNAPSHOT" | "OCR_MESSAGE";
export type RpaCaptureUnit = "TEXT_BUBBLE" | "VIEWPORT_REMAINDER";
export const RPA_OCR_MESSAGE_WARNING = ocrWarnings.message;
const statuses: RpaStatus[] = ["PENDING", "PROCESSING", "READY", "FAILED", "DISMISSED"];

export interface RpaSession { userId: string; currentWorkspaceId: string; expiresAt: number }
export interface RpaParsedResult {
  data: { summary: { total: number; goodsCount: number; demandCount: number }; items: unknown[]; warnings: string[] };
  isMock: boolean;
  provider: string;
  model?: string;
  tokenUsage?: unknown;
}
export interface RpaInputMessage {
  messageId: string; chatName: string; sender: string; sentAt: string | null; observedAt: string; text: string;
  captureMode?: RpaCaptureMode;
  captureUnit?: RpaCaptureUnit;
  publishedTime?: WechatPublishedTime;
}
export interface RpaMessage extends RpaInputMessage {
  id: string; workspaceId: string; userId: string; deviceId: string;
  status: RpaStatus; attempts: number; createdAt: string; updatedAt: string;
  parsedResult?: RpaParsedResult; error?: string;
  source: { channel: "WECHAT_RPA"; chatName: string; sender: string; sentAt: string | null; observedAt: string; messageId: string; deviceId: string; captureMode?: RpaCaptureMode; captureUnit?: RpaCaptureUnit; publishedTime?: WechatPublishedTime };
  reviewFlags: string[];
}

export class RpaError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) {
    throw new RpaError(400, `${field} 不能为空，且长度不得超过 ${max}。`);
  }
  return value.trim();
}
function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 40 || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new RpaError(400, `${field} 必须是带时区的有效 ISO 时间。`);
  }
  return new Date(value).toISOString();
}
function observedMinute(value: unknown, observedAt: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00(?:\.0{1,6})?(?:Z|\+00:00)$/.test(value)) {
    throw new RpaError(400, "微信时间标记必须是 UTC 整分钟。");
  }
  const normalized = timestamp(value, "publishedTime");
  if (normalized.slice(0, 16) !== value.slice(0, 16) || normalized > observedAt) {
    throw new RpaError(400, "微信时间标记超出有效日期或晚于采集画面。");
  }
  return normalized;
}
function readPublishedTime(value: unknown, message: RpaInputMessage): WechatPublishedTime | undefined {
  if (effectiveCaptureUnit(message) !== "TEXT_BUBBLE" || !record(value)) {
    throw new RpaError(400, "微信发布时间证据只能关联单个截图文字气泡。");
  }
  if (Object.keys(value).length !== (value.kind === "WECHAT_RANGE" ? 3 : 2)) throw new RpaError(400, "微信发布时间证据字段无效。");
  switch (value.kind) {
    case "WECHAT_MINUTE":
    case "WECHAT_MARKER":
      return { kind: value.kind, at: observedMinute(value.at, message.observedAt) };
    case "WECHAT_CLOCK":
      if (typeof value.clock === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.clock)) return wechatClockMarker(value.clock, message.observedAt);
      break;
    case "WECHAT_DATE": {
      const date = value.date;
      if (typeof date !== "string" || !/^\d{4}-\d\d-\d\d$/.test(date) || date < "0001-01-01") break;
      const day = new Date(`${date}T00:00:00Z`);
      const observedDate = wechatShanghaiDate(message.observedAt);
      if (Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === date && observedDate && date <= observedDate) {
        return { kind: value.kind, date };
      }
      break;
    }
    case "WECHAT_RANGE": {
      const from = observedMinute(value.from, message.observedAt);
      const to = observedMinute(value.to, message.observedAt);
      if (from < to) return { kind: value.kind, from, to };
      break;
    }
  }
  throw new RpaError(400, "微信发布时间证据无效。");
}

function key(workspaceId: string, userId: string, message: RpaInputMessage): string {
  return createHash("sha256").update(JSON.stringify([workspaceId, userId, message.chatName, message.messageId])).digest("hex");
}
function effectiveCaptureUnit(message: RpaInputMessage & { source?: RpaMessage["source"] }): RpaCaptureUnit | undefined {
  const mode = message.captureMode ?? message.source?.captureMode ?? "UIA_MESSAGE";
  if (mode === "UIA_MESSAGE") return undefined;
  return message.captureUnit ?? message.source?.captureUnit ?? (mode === "OCR_MESSAGE" ? "TEXT_BUBBLE" : "VIEWPORT_REMAINDER");
}
function matchesOriginal(existing: RpaMessage, incoming: RpaInputMessage): boolean {
  return existing.text === incoming.text && existing.sender === incoming.sender && existing.sentAt === incoming.sentAt
    && (existing.captureMode ?? existing.source?.captureMode ?? "UIA_MESSAGE") === (incoming.captureMode ?? "UIA_MESSAGE")
    && effectiveCaptureUnit(existing) === effectiveCaptureUnit(incoming);
}
function reviewFlags(text: string): string[] {
  const result: string[] = [];
  if (/改价|调价|降价|涨价|更新|更正|还剩|剩余/.test(text)) result.push("POSSIBLE_UPDATE");
  if (/已售|已出|卖完|售罄|撤单|取消|无货|没货|失效/.test(text)) result.push("POSSIBLE_SOLD_OR_CANCELLED");
  return result;
}

function bindCapturedSource(result: RpaParsedResult, message: RpaMessage): RpaParsedResult {
  const mode = message.captureMode ?? message.source?.captureMode;
  const notes = result.data.warnings;
  if (mode === "OCR_SNAPSHOT") {
    const single = effectiveCaptureUnit(message) === "TEXT_BUBBLE";
    const warnings = single ? notes.filter(note => note !== unknownSourceWarning) : notes;
    return { ...result, data: { ...result.data, warnings: [...new Set([...warnings, single ? ocrWarnings.unknownBubble : ocrWarnings.viewport])] } };
  }
  // A paired or natively read message keeps its captured sender even if the body quotes other names.
  const items = result.data.items.map((item) => {
    if (!record(item)) return item;
    const { source_contact: _untrustedSource, config_items: _legacyConfigs, ...fields } = item;
    const configs = Array.isArray(item.configItems) ? item.configItems : Array.isArray(item.config_items) ? item.config_items : [];
    const configItems = configs.filter((config) => !record(config) || typeof config.label !== "string" || !/^(来源|来源用户|说话人|发言人|微信用户)$/.test(config.label.trim()));
    return { ...fields, sourceContact: message.sender, configItems: [...configItems, { label: "来源", value: message.sender }] };
  });
  const warnings = message.sender && !/^(?:未知|未识别|待确认)/u.test(message.sender)
    ? notes.filter(note => note !== unknownSourceWarning) : [...notes];
  if (mode === "OCR_MESSAGE") warnings.push(ocrWarnings.message);
  return { ...result, data: { ...result.data, items, warnings: [...new Set(warnings)] } };
}

export class RpaInbox {
  private messages: RpaMessage[] = [];
  private running = false;
  private scheduled = false;
  private interrupted = false;
  private processingPromise: Promise<void> = Promise.resolve();
  private readonly defaultGroups: CaptureGroup[];
  private readonly groupFile: string;
  private groupSettings: GroupSettings[] = [];
  constructor(private readonly options: {
    filePath: string; parse: (text: string, message: Readonly<RpaMessage>) => Promise<RpaParsedResult>; allowedGroups?: string[];
    onError?: (error: unknown) => void;
  }) {
    this.defaultGroups = (options.allowedGroups ?? RPA_DEFAULT_GROUPS).map((name) => ({ name, enabled: true }));
    this.groupFile = options.filePath + ".groups.json";
    const settings = readJsonSnapshot(this.groupFile);
    if (settings !== undefined) {
      if (!record(settings) || settings.version !== 1 || !Array.isArray(settings.scopes) ||
          !settings.scopes.every((scope) => record(scope) && typeof scope.userId === "string" && typeof scope.workspaceId === "string"
            && Array.isArray(scope.groups) && scope.groups.every((g) => record(g) && isRpaGroupName(g.name) && typeof g.enabled === "boolean")
            && new Set(scope.groups.map((g) => g.name)).size === scope.groups.length)
          || new Set(settings.scopes.map((s) => JSON.stringify([s.userId, s.workspaceId]))).size !== settings.scopes.length) {
        throw new Error("微信采集群设置损坏，请检查配置文件后重启。");
      }
      this.groupSettings = settings.scopes as GroupSettings[];
    }
    const snapshot = readJsonSnapshot(options.filePath);
    if (snapshot !== undefined) {
      if (!record(snapshot) || snapshot.version !== 1 || !Array.isArray(snapshot.messages) || snapshot.messages.some((message) => !record(message) || typeof message.id !== "string" || typeof message.workspaceId !== "string" || typeof message.userId !== "string" || !statuses.includes(message.status as RpaStatus))) {
        throw new Error("RPA 收件箱存储格式无效，请保留原文件并修复后重启。");
      }
      this.messages = (snapshot.messages as unknown as RpaMessage[]).map((message) => {
        const time = message.publishedTime ?? message.source?.publishedTime;
        if (time?.kind !== "WECHAT_CLOCK") return message;
        const publishedTime = effectiveCaptureUnit(message) === "TEXT_BUBBLE" ? wechatClockMarker(time.clock, message.observedAt) : undefined;
        return { ...message, publishedTime, source: { ...message.source, publishedTime } };
      });
      if (this.messages.some((message) => message.status === "PROCESSING")) {
        this.commit(this.messages.map((message) => message.status === "PROCESSING" ? { ...message, status: "PENDING", updatedAt: new Date().toISOString() } : message));
      }
    }
  }

  private groupsFor(session: RpaSession) {
    return this.groupSettings.find((entry) => belongsTo(session, entry))?.groups ?? this.defaultGroups;
  }
  enabledGroups(session: RpaSession) { return enabledNames(this.groupsFor(session)); }
  groupConfig(session: RpaSession) {
    const managedGroups = this.groupsFor(session).map((g) => ({ ...g }));
    return { managedGroups, allowedGroups: enabledNames(managedGroups) };
  }

  editGroup(session: RpaSession, action: GroupAction, body: unknown, syncGroups?: SyncGroups) {
    if (!record(body) || !isRpaGroupName(body.name)) throw new RpaError(400, "请输入微信独立群聊窗口的完整群名，最多 200 个字符。");
    const keys = action === "update" ? ["name", "enabled"] : ["name"];
    if (Object.keys(body).some((k) => !keys.includes(k)) || (action === "update" && typeof body.enabled !== "boolean")) {
      throw new RpaError(400, "群管理参数无效。");
    }
    const name = body.name;
    const previous = this.groupsFor(session);
    const existing = previous.find((g) => g.name === name);
    let groups: CaptureGroup[];
    if (action === "add") {
      if (existing) throw new RpaError(409, "该群已在采集群列表中。");
      groups = [...previous, { name, enabled: true }];
    } else {
      if (!existing) throw new RpaError(404, "采集群不存在。");
      if (action === "update" && existing.enabled === body.enabled) return this.groupConfig(session);
      groups = action === "remove" ? previous.filter((g) => g !== existing)
        : previous.map((g) => g === existing ? { name, enabled: body.enabled === true } : g);
    }
    return this.saveGroups(session, previous, groups, syncGroups);
  }

  selectGroups(session: RpaSession, body: unknown, syncGroups?: SyncGroups) {
    if (!record(body) || !Array.isArray(body.selected) || !Array.isArray(body.previous) ||
        ![body.selected, body.previous].every(names => names.length <= 100 && names.every(isRpaGroupName) && new Set(names).size === names.length)) {
      throw new RpaError(400, "请选择有效的群窗口。");
    }
    const previous = this.groupsFor(session);
    const enabled = enabledNames(previous);
    if (enabled.length !== body.previous.length || !enabled.every(name => (body.previous as string[]).includes(name))) {
      throw new RpaError(409, "采集群已在其他页面更新，请刷新后重新选择。");
    }
    const selected = new Set<string>(body.selected);
    const groups = previous.map(group => ({name: group.name, enabled: selected.delete(group.name)}));
    for (const name of selected) groups.push({name, enabled:true});
    return this.saveGroups(session, previous, groups, syncGroups);
  }

  private saveGroups(session: RpaSession, previous: CaptureGroup[], groups: CaptureGroup[], syncGroups?: SyncGroups) {
    const next = this.groupSettings.filter((s) => !belongsTo(session, s));
    next.push({ userId: session.userId, workspaceId: session.currentWorkspaceId, groups });
    syncGroups?.(session, enabledNames(groups));
    try { writeAtomicJson(this.groupFile, { version: 1, scopes: next }); }
    catch {
      syncGroups?.(session, enabledNames(previous));
      throw new RpaError(503, "采集群设置保存失败，请稍后重试。");
    }
    this.groupSettings = next;
    return this.groupConfig(session);
  }

  ingest(session: RpaSession, body: unknown) {
    if (!record(body)) throw new RpaError(400, "请求必须是 JSON 对象。");
    const deviceId = requiredText(body.deviceId, "deviceId", 128);
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > RPA_BATCH_LIMIT) {
      throw new RpaError(400, `每批必须包含 1–${RPA_BATCH_LIMIT} 条消息。`);
    }
    let textLength = 0;
    const allowedGroups = new Set(this.enabledGroups(session));
    const incoming = body.messages.map((item): RpaInputMessage => {
      if (!record(item)) throw new RpaError(400, "消息格式无效。");
      if (item.captureMode !== undefined && item.captureMode !== "UIA_MESSAGE" && item.captureMode !== "OCR_SNAPSHOT" && item.captureMode !== "OCR_MESSAGE") throw new RpaError(400, "captureMode 无效。");
      const captureMode = item.captureMode ?? "UIA_MESSAGE";
      if (item.captureUnit !== undefined && item.captureUnit !== "TEXT_BUBBLE" && item.captureUnit !== "VIEWPORT_REMAINDER") throw new RpaError(400, "captureUnit 无效。");
      if (item.captureUnit !== undefined && captureMode === "UIA_MESSAGE") throw new RpaError(400, "UIA 消息不能携带截图采集单元。");
      if (captureMode === "OCR_MESSAGE" && item.captureUnit === "VIEWPORT_REMAINDER") throw new RpaError(400, "已配对昵称的截图消息必须是单个文字气泡。");
      if (captureMode !== "UIA_MESSAGE" && item.sentAt !== null) throw new RpaError(400, "截图消息的原始发送时间尚未识别，sentAt 必须为 null。");
      const message: RpaInputMessage = {
        messageId: requiredText(item.messageId, "messageId", 256),
        chatName: requiredText(item.chatName, "chatName", 200),
        sender: item.captureMode === "OCR_SNAPSHOT" ? "未识别（截图识别）" : requiredText(item.sender, "sender", 200),
        sentAt: item.sentAt === null ? null : timestamp(item.sentAt, "sentAt"),
        observedAt: timestamp(item.observedAt, "observedAt"),
        text: requiredText(item.text, "text", 20_000),
        captureMode: item.captureMode === "OCR_SNAPSHOT" || item.captureMode === "OCR_MESSAGE" ? item.captureMode : "UIA_MESSAGE",
        captureUnit: captureMode === "UIA_MESSAGE" ? undefined : (item.captureUnit ?? (captureMode === "OCR_MESSAGE" ? "TEXT_BUBBLE" : "VIEWPORT_REMAINDER")) as RpaCaptureUnit,
      };
      if (item.publishedTime !== undefined) message.publishedTime = readPublishedTime(item.publishedTime, message);
      if (message.chatName !== item.chatName || !allowedGroups.has(message.chatName)) throw new RpaError(403, "该群未在当前账号已启用的采集白名单中。");
      textLength += message.text.length;
      return message;
    });
    if (textLength > 200_000) throw new RpaError(413, "每批消息正文总长度不得超过 200000 字符。");
    const next = [...this.messages];
    const lookup = new Map(next.map((message, index) => [key(message.workspaceId, message.userId, message), index]));
    let changed = false;
    const accepted: Array<{ id: string; messageId: string; status: RpaStatus; duplicate: boolean }> = [];
    let pendingCount = next.filter((message) => message.workspaceId === session.currentWorkspaceId && message.userId === session.userId && (message.status === "PENDING" || message.status === "PROCESSING")).length;
    for (const message of incoming) {
      const messageKey = key(session.currentWorkspaceId, session.userId, message);
      const index = lookup.get(messageKey);
      if (index !== undefined) {
        const existing = next[index];
        if (!matchesOriginal(existing, message)) throw new RpaError(409, "同一消息编号的内容发生冲突，请保留原编号并检查采集器。");
        // OCR IDs hash the content; a later observation may be an independent repost.
        if (existing.userId === session.userId && existing.deviceId === deviceId && existing.observedAt === message.observedAt
          && message.publishedTime && improvesPublishedTime(existing.publishedTime, message.publishedTime)) {
          next[index] = { ...existing, publishedTime: message.publishedTime, source: { ...existing.source, publishedTime: message.publishedTime }, updatedAt: new Date().toISOString() };
          changed = true;
        }
        accepted.push({ id: existing.id, messageId: message.messageId, status: existing.status, duplicate: true });
        continue;
      }
      if (++pendingCount > 1000) throw new RpaError(429, "当前账号待解析消息已达 1000 条，请等待处理或忽略部分消息后继续。");
      const now = new Date().toISOString();
      const created: RpaMessage = {
        ...message, id: `rpa_${randomUUID()}`, workspaceId: session.currentWorkspaceId, userId: session.userId,
        deviceId, status: "PENDING", attempts: 0, createdAt: now, updatedAt: now,
        source: { channel: "WECHAT_RPA", chatName: message.chatName, sender: message.sender, sentAt: message.sentAt, observedAt: message.observedAt, messageId: message.messageId, deviceId, captureMode: message.captureMode, captureUnit: message.captureUnit },
        reviewFlags: [...reviewFlags(message.text), ...(message.captureMode === "OCR_SNAPSHOT" || message.captureMode === "OCR_MESSAGE" ? ["OCR_REQUIRES_REVIEW"] : []), ...(message.text.includes("【OCR待核对") ? ["OCR_TEXT_UNCERTAIN"] : [])],
      };
      if (message.publishedTime) created.source.publishedTime = message.publishedTime;
      lookup.set(messageKey, next.length);
      next.push(created);
      changed = true;
      accepted.push({ id: created.id, messageId: created.messageId, status: created.status, duplicate: false });
    }
    if (changed) this.commit(next);
    this.kick();
    return { success: true, accepted, acceptedCount: accepted.filter((item) => !item.duplicate).length, duplicateCount: accepted.filter((item) => item.duplicate).length };
  }

  list(session: RpaSession, query: { status?: unknown; page?: unknown; pageSize?: unknown }) {
    if (query.status && !statuses.includes(query.status as RpaStatus)) throw new RpaError(400, "消息状态无效。");
    const page = positiveInteger(query.page, 1, 1_000_000);
    const pageSize = positiveInteger(query.pageSize, 30, 100);
    const scoped = this.messages.filter((message) => belongsTo(session, message));
    // Keep the previous insertion order (newest capture first) for exact ties.
    const filtered = scoped.filter((message) => !query.status || message.status === query.status).reverse().map((message) => {
      const unit = effectiveCaptureUnit(message);
      const chronology = tradeChronology({
        sourceSentAt: unit === undefined ? message.sentAt ?? message.source?.sentAt : null,
        sourcePublishedTime: unit === "TEXT_BUBBLE" ? message.publishedTime ?? message.source?.publishedTime : undefined,
        sourceObservedAt: message.observedAt ?? message.source?.observedAt,
        createdAt: message.createdAt,
      });
      return { message, chronology };
    });
    filtered.sort((a, b) => compareChronology(a.chronology, b.chronology));
    const metadata = deriveRpaSourceMetadata(scoped);
    const items = filtered.slice((page - 1) * pageSize, page * pageSize).map(({ message }) => publicMessage(message, metadata));
    return { success: true, items, messages: items, page, pageSize, total: filtered.length };
  }

  publicationTimes(session: RpaSession, ids: unknown) {
    if (typeof ids !== "string" || ids.length > RPA_BATCH_LIMIT * 129) throw new RpaError(400, "请输入有效的采集记录编号。");
    const values = ids.split(",");
    if (values.length > RPA_BATCH_LIMIT || values.some((id) => !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) {
      throw new RpaError(400, "每次可查询 1–50 个有效采集记录编号。");
    }
    const wanted = new Set(values);
    const scoped = this.messages.filter((m) => m.userId === session.userId && m.workspaceId === session.currentWorkspaceId);
    const selected = scoped.filter((m) => wanted.has(m.id));
    const knownBubble = (m: RpaMessage) => m.status === "READY" && (m.captureMode ?? m.source?.captureMode) === "OCR_MESSAGE";
    const bodyKey = (m: RpaMessage) => JSON.stringify([m.deviceId, m.chatName, m.sender, m.text.replace(/\s+/gu, "")]);
    // Older snapshot-derived records may retain a preferred captureId without
    // recording whether the author had posted the same text more than once.
    const counts = new Map(selected.filter(knownBubble).map((m) => [bodyKey(m), 0]));
    if (counts.size > 0) {
      for (const message of scoped) {
        if (!knownBubble(message)) continue;
        const key = bodyKey(message);
        if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
      }
    }
    const postdated = findPostdatedLegacyLinks(selected, scoped);
    const items = selected.map((message) => {
      const native = (message.captureMode ?? message.source?.captureMode ?? "UIA_MESSAGE") === "UIA_MESSAGE";
      const sentAt = native ? message.sentAt : null;
      const repeated = knownBubble(message) && (counts.get(bodyKey(message)) ?? 0) > 1;
      return { id: message.id, sentAt, publishedTime: message.publishedTime,
        ...(repeated ? { repeatedContent: true } : {}), ...(postdated.has(message.id) ? { legacyTimeAmbiguous: true } : {}) };
    });
    return { items };
  }

  transition(session: RpaSession, id: string, action: "retry" | "dismiss") {
    const current = this.messages.find((message) => message.id === id && belongsTo(session, message));
    if (!current) throw new RpaError(404, "消息不存在。");
    if (action === "retry" && current.status !== "FAILED" && current.status !== "DISMISSED") throw new RpaError(409, "仅失败或已忽略的消息可以重试。");
    const updated: RpaMessage = { ...current, status: action === "retry" ? "PENDING" : "DISMISSED", error: undefined, updatedAt: new Date().toISOString() };
    this.commit(this.messages.map((message) => message.id === id ? updated : message));
    if (action === "retry") this.kick();
    return { success: true, item: publicMessage(updated, deriveRpaSourceMetadata(this.messages)) };
  }

  resumeAfterRecharge(workspaceId:string) {
    const waiting=(message:RpaMessage)=>message.workspaceId===workspaceId && message.status==="FAILED" && message.error?.includes("当前空间货记分不足");
    if(!this.messages.some(waiting))return;
    this.commit(this.messages.map(message=>waiting(message)?{...message,status:"PENDING",error:undefined,updatedAt:new Date().toISOString()}:message));
    this.kick();
  }

  kick(): void {
    if (this.running || this.scheduled) return;
    if (this.interrupted) {
      this.commit(this.messages.map((message) => message.status === "PROCESSING" ? { ...message, status: "PENDING", updatedAt: new Date().toISOString() } : message));
      this.interrupted = false;
    }
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      this.processingPromise = this.drain().catch((error) => { this.interrupted = true; this.options.onError?.(error); });
    });
  }

  /** Used by isolated tests; ingestion itself never waits for the parser. */
  async whenIdle(): Promise<void> {
    if (this.scheduled) await new Promise<void>((resolve) => setImmediate(resolve));
    await this.processingPromise;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (true) {
        const pending = this.messages.find((message) => message.status === "PENDING");
        if (!pending) break;
        this.replace(pending.id, { ...pending, status: "PROCESSING", attempts: pending.attempts + 1, updatedAt: new Date().toISOString() });
        let parsedResult: RpaParsedResult | undefined;
        let failure: string | undefined;
        const captureMode = pending.captureMode ?? pending.source?.captureMode;
        try { parsedResult = bindCapturedSource(await this.options.parse(captureMode === "OCR_SNAPSHOT" ? pending.text : `${pending.sender}:\n${pending.text}`, pending), pending); }
        catch (error) { failure = error instanceof Error ? error.message : "AI 解析失败。"; }
        const current = this.messages.find((message) => message.id === pending.id)!;
        if (current.status !== "PROCESSING") continue;
        this.replace(current.id, { ...current, status: failure ? "FAILED" : "READY", parsedResult, error: failure?.slice(0, 1000), updatedAt: new Date().toISOString() });
      }
    } finally { this.running = false; }
  }

  private replace(id: string, replacement: RpaMessage): void {
    this.commit(this.messages.map((message) => message.id === id ? replacement : message));
  }
  private commit(messages: RpaMessage[]): void {
    writeAtomicJson(this.options.filePath, { version: 1, messages });
    this.messages = messages;
  }
}

function publicMessage(message: RpaMessage, metadata: ReturnType<typeof deriveRpaSourceMetadata>) {
  const { workspaceId: _workspace, userId: _user, sourceLinks: _untrustedLinks, sourceItemAliases: _untrustedAliases, ...result } = message as RpaMessage & { sourceLinks?: unknown; sourceItemAliases?: unknown };
  const evidence = metadata.get(message);
  return { ...result, ...(message.captureMode === "OCR_SNAPSHOT" ? { sourceLinks: evidence?.sourceLinks ?? [] } : {}), sourceItemAliases: evidence?.sourceItemAliases ?? [] };
}
function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) throw new RpaError(400, "分页参数无效。");
  return number;
}

export function createRpaRouter(options: {
  inbox: RpaInbox;
  readSession: (authorization: unknown, res: import("express").Response) => RpaSession | null;
  baseUrl: (request: Request) => string;
  syncGroups?: SyncGroups;
}) {
  const router = Router();
  router.use((request, response, next) => {
    const session = options.readSession(request.headers.authorization,response);
    if (!session || session.expiresAt <= Date.now()) { response.status(401).json({ error: "登录已失效，请重新登录并重新下载采集配置。" }); return; }
    response.locals.rpaSession = session;
    next();
  });
  router.get("/config", (request, response) => {
    const session = response.locals.rpaSession as RpaSession;
    const groups = options.inbox.groupConfig(session);
    response.set("Cache-Control", "no-store").json({ success: true, enabled: true, scope: { userId: session.userId, workspaceId: session.currentWorkspaceId }, ...groups, defaultGroups: groups.allowedGroups, pollingIntervalSeconds: 10, batchLimit: RPA_BATCH_LIMIT, sessionExpiresAt: new Date(session.expiresAt).toISOString(), importUrl: `${options.baseUrl(request)}/api/rpa/messages` });
  });
  router.get("/groups", (_request, response) => {
    response.set("Cache-Control", "no-store").json(options.inbox.groupConfig(response.locals.rpaSession));
  });
  router.post("/groups/selection", (request, response) => {
    try { response.json(options.inbox.selectGroups(response.locals.rpaSession, request.body, options.syncGroups)); }
    catch (error) { sendError(response, error); }
  });
  for (const [method, action] of [["post", "add"], ["patch", "update"], ["delete", "remove"]] as const) {
    router[method]("/groups", (request, response) => {
      try { response.json(options.inbox.editGroup(response.locals.rpaSession, action, request.body, options.syncGroups)); }
      catch (error) { sendError(response, error); }
    });
  }
  router.get("/messages", (request, response) => {
    try { response.json(options.inbox.list(response.locals.rpaSession, request.query)); }
    catch (error) { sendError(response, error); }
  });
  router.get("/publication-times", (request, response) => {
    try { response.set("Cache-Control", "no-store").json(options.inbox.publicationTimes(response.locals.rpaSession, request.query.ids)); }
    catch (error) { sendError(response, error); }
  });
  router.post("/messages", (request, response) => {
    try { response.status(202).json(options.inbox.ingest(response.locals.rpaSession, request.body)); }
    catch (error) { sendError(response, error); }
  });
  for (const action of ["retry", "dismiss"] as const) {
    router.post(`/messages/:id/${action}`, (request, response) => {
      try { response.json(options.inbox.transition(response.locals.rpaSession, String(request.params.id), action)); }
      catch (error) { sendError(response, error); }
    });
  }
  return router;
}

function sendError(response: import("express").Response, error: unknown): void {
  if (error instanceof RpaError) { response.status(error.status).json({ error: error.message }); return; }
  console.error("[货记 RPA] persistence error:", error instanceof Error ? error.message : "unknown");
  response.status(503).json({ error: "收件箱保存失败，请稍后重试；本批消息未确认接收。" });
}
