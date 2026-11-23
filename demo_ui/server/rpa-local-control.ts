import * as fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn as spawnProcess, type ChildProcess } from "node:child_process";
import { Router, type Request, type Response } from "express";
import { collectorConnection } from "../src/collector-connection";
import { RealtimeCapture } from "./rpa-realtime";
import { RPA_DEFAULT_GROUPS, RpaError, isRpaGroupName, type RpaSession } from "./rpa";
import { readJsonSnapshot, writeAtomicJson } from "./rpa-persistence";

type Status = "RUNNING" | "RESTORING" | "COMPLETED" | "CANCELLED" | "FAILED";
type Scope = { userId: string; workspaceId: string };
const datePresets = [1, 3, 7] as const;
type DatePreset = typeof datePresets[number];
const maxDatePages = 200;
const dateTimeoutPerGroupMs = 25 * 60_000; // 20 minutes to scan plus time for restoration
const dateStops = ["DATE_BOUNDARY_REACHED", "TOP_REACHED", "PAGE_LIMIT", "TIME_LIMIT", "SCROLL_UNVERIFIED", "CANCELLED"] as const;
type DateStop = typeof dateStops[number];
// Worker diagnostics can contain OCR text, paths and tokens after the code.
// Only known codes and our own descriptions may cross the API boundary.
const failureMessages = {
  OCR_WINDOW_NOT_FOUND: "未找到独立群聊窗口。请在电脑微信将这个群单独打开，再重试。",
  OCR_WINDOW_NOT_UNIQUE: "无法唯一定位独立群聊窗口。请确认只打开了一个同名群窗口。",
  OCR_WINDOW_MINIMIZED: "群窗口已最小化。请还原窗口后重试。",
  OCR_WINDOW_CHANGED: "校准期间群窗口已变化，请保持该独立窗口打开并重试。",
  OCR_DESKTOP_UNAVAILABLE: "无法访问当前桌面。请解锁采集电脑后重试。",
  OCR_WINDOW_ENUMERATION_FAILED: "无法列出微信窗口，请检查电脑微信是否已打开。",
  OCR_NOT_CALIBRATED: "群窗口的截图区域尚未校准，请先完成校准。",
  OCR_PROFILE_INVALID: "群窗口的截图区域配置无效，请重新校准。",
  OCR_CALIBRATION_NO_TEMPLATE: "当前窗口尺寸没有可复用的截图区域。请将独立窗口调到已校准的尺寸后重试，或按采集器说明配置实测区域。",
  OCR_CALIBRATION_AMBIGUOUS: "匹配到多套不同的截图区域，请按采集器说明为该群配置实测区域。",
  OCR_TITLE_MISMATCH: "截图标题与群名不一致。请核对独立窗口标题和校准区域。",
  OCR_DEPENDENCIES_MISSING: "截图校准组件未安装，请检查本机采集器环境。",
  BACKFILL_WINDOW_RESIZED: "群窗口尺寸与采集校准不一致。请恢复校准时的大小，或重新校准。",
  BACKFILL_TITLE_MISMATCH: "画面中的群名未通过核对。请检查群窗口标题和截图校准区域。",
  BACKFILL_TARGET_UNAVAILABLE: "采集器无法定位群窗口。请检查独立窗口和桌面解锁状态。",
  BACKFILL_TARGET_CHANGED: "采集过程中群窗口已发生变化。请保持该群的独立窗口打开。",
  BACKFILL_PROCESS_CHANGED: "微信进程已发生变化。请重新打开独立群窗口后重试。",
  BACKFILL_LATEST_NOT_STABLE: "下翻时未能确认最新画面已经稳定。",
  BACKFILL_SCROLL_UNRESPONSIVE: "群聊天区域未响应上翻，请检查群窗口。",
  BACKFILL_SCROLL_MESSAGE_FAILED: "微信窗口未能接收滚动操作，请检查群窗口。",
  BACKFILL_SCROLL_CHILD_MISMATCH: "无法定位群窗口内的消息区域，请检查窗口和校准。",
  BACKFILL_WHEEL_SCROLL_DISABLED: "系统滚轮滚动已关闭，请检查鼠标滚轮设置。",
  BACKFILL_RESTORE_UNVERIFIED: "下翻后未能核实最新消息位置，请查看该群聊天底部。",
  BACKFILL_RESTORE_FAILED: "回到最新消息时遇到错误，请查看该群聊天底部。",
  BACKFILL_RESTORE_CAPTURE_OR_SCROLL_FAILED: "返回时无法读取或滚动群窗口，请查看聊天底部。",
  WGC_WINDOW_NOT_UNIQUE: "截图时无法唯一定位微信窗口。请检查群的独立窗口。",
  WGC_WINDOW_CHANGED: "截图时群窗口发生变化。请保持独立窗口打开。",
  WGC_DESKTOP_UNAVAILABLE: "截图时无法访问桌面，请确保采集电脑已解锁。",
  WGC_TIMEOUT: "等待微信窗口截图超时，请还原窗口后重试。",
  WGC_NO_FRAME: "未收到微信窗口画面，请还原窗口后重试。",
  WGC_INVALID_FRAME: "收到的微信窗口画面无效，请还原窗口后重试。",
  WGC_CAPTURE_FAILED: "读取微信窗口画面失败，请还原窗口后重试。",
  WGC_DEPENDENCIES_MISSING: "窗口截图组件缺失，请检查本机采集器安装。",
  WGC_CHILD_START_FAILED: "窗口截图进程未能启动，请检查本机采集器环境。",
  CAPTURE_LOCK_BUSY: "另一个采集任务正在使用微信窗口，请稍后重试。",
} as const;
type FailureCode = keyof typeof failureMessages;
function failureCode(value: unknown): FailureCode | undefined {
  if (typeof value !== "string") return;
  const code = value.split(":", 1)[0];
  if (Object.hasOwn(failureMessages, code)) return code as FailureCode;
}
interface GroupProgress {
  chatName: string; pagesRequested: number; pagesCompleted: number; queued: number; uploaded: number;
  skippedScreens: number; status?: Status; returnedToLatest?: boolean;
  targetReached?: boolean; messagesCounted?: number; undatedSkipped?: number; fallbackScreens?: number; stopReason?: DateStop;
  scrollAttempted?: boolean; failureCode?: FailureCode; restoreFailureCode?: FailureCode;
}
export interface LocalBackfillJob {
  id: string; status: Status; startedAt: string; updatedAt: string; finishedAt?: string;
  pagesRequested: number; pagesCompleted: number; groupIndex: number; groupCount: number;
  chatName?: string; queued: number; uploaded: number; skippedScreens: number; returnedToLatest?: boolean;
  cancelRequested: boolean; error?: string; groups: GroupProgress[]; restoreRequired?: boolean;
  days?: DatePreset; rangeStart?: string; rangeEnd?: string; targetReached?: boolean; messagesCounted?: number; undatedSkipped?: number; fallbackScreens?: number;
}
interface TerminalEvent {
  status: Status; returnedToLatest: boolean; dateRangeIncomplete: boolean;
  restoreRequired?: boolean; failureCode?: FailureCode;
}

function failureDescription(job: LocalBackfillJob, terminal?: TerminalEvent): string {
  const group = job.groups.find((entry) => entry.failureCode || entry.restoreFailureCode);
  if (group) {
    const reasons = [];
    if (group.failureCode) reasons.push(failureMessages[group.failureCode]);
    if (group.restoreFailureCode && group.restoreFailureCode !== group.failureCode) reasons.push(`返回时遇到的问题：${failureMessages[group.restoreFailureCode]}`);
    return `「${group.chatName}」${reasons.join("")}`;
  }
  if (terminal?.failureCode) return failureMessages[terminal.failureCode];
  return "采集器未提供可核实的失败原因，请检查微信独立群窗口后重试。";
}
interface StoredJob { version: 1; scope: Scope; job: LocalBackfillJob }
interface ConnectionConfig extends Record<string, unknown> { scope: Scope; apiBaseUrl: string; token: string; groups: string[]; upload: { enabled: true } }
export class LocalControlError extends RpaError {}
const active = (status: Status) => status === "RUNNING" || status === "RESTORING";
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const sameScope = (left: Scope, right: Scope) => left.userId === right.userId && left.workspaceId === right.workspaceId;
const asScope = (session: RpaSession): Scope => ({ userId: session.userId, workspaceId: session.currentWorkspaceId });
const isFile = (file: string) => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const jsonFile = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const now = () => new Date().toISOString();
const isDatePreset = (value: unknown): value is DatePreset => datePresets.some((days) => days === value);
const isDateStop = (value: unknown): value is DateStop => dateStops.some((reason) => reason === value);
const sameNames = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((name) => right.includes(name));
const groupArgument = (name: string) => name.startsWith("-") ? [`--group=${name}`] : ["--group", name];

interface Calibration { schemaVersion: 1; profiles: Record<string, unknown> }
interface LocalConnection {
  available: boolean; connectionRefreshRequired: boolean; calibrationAvailable: boolean;
  groups: string[]; uncalibratedGroups: string[]; reason?: string;
}
function validProfile(value: unknown): value is Record<string, unknown> {
  if (!object(value)) return false;
  const size = value.windowSize;
  if (!Array.isArray(size) || size.length !== 2 || !size.every((n) => Number.isSafeInteger(n) && n >= 100)) return false;
  const region = (r: unknown): r is number[] => Array.isArray(r) && r.length === 4 && r.every(Number.isSafeInteger)
    && r[0] >= 0 && r[0] < r[2] && r[2] <= size[0] && r[1] >= 0 && r[1] < r[3] && r[3] <= size[1];
  const a = value.titleRegion, b = value.messageRegion;
  return region(a) && region(b) && (a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1])
    && (value.incomingBubbleLeft === undefined || Number.isSafeInteger(value.incomingBubbleLeft) && Number(value.incomingBubbleLeft) >= 0 && Number(value.incomingBubbleLeft) < size[0]);
}

function dateWindow(event: Record<string, unknown>, job: LocalBackfillJob) {
  if (!job.days || job.rangeStart || typeof event.rangeStart !== "string" || typeof event.rangeEnd !== "string") return {};
  // Accept only UTC instants from the collector. Never copy arbitrary stdout into the job record.
  const utcInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/;
  if (!utcInstant.test(event.rangeStart) || !utcInstant.test(event.rangeEnd)) return {};
  const start = Date.parse(event.rangeStart), end = Date.parse(event.rangeEnd);
  if (end - start !== job.days * 86_400_000) return {};
  return { rangeStart: new Date(start).toISOString(), rangeEnd: new Date(end).toISOString() };
}

export class LocalBackfillController {
  private readonly live = new RealtimeCapture();
  readonly paths: { python: string; collector: string; connection: string; calibration: string; jobs: string; cancelDirectory: string; cwd: string };
  private stored: StoredJob | null = null;
  private child: ChildProcess | null = null;
  private calibrating = false;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private storageHealthy = true;
  private readonly origin: string;

  constructor(private readonly options: {
    repositoryDirectory: string; localOrigin: string; runtime?: string; uploadOrigin?: string;
    readSession: (authorization: unknown) => RpaSession | null;
    enabledGroups?: (session: RpaSession) => readonly string[];
    spawn?: typeof spawnProcess; timeoutMs?: number; restoreGraceMs?: number;
    writeConnection?: typeof writeAtomicJson;
  }) {
    const origin = new URL(options.localOrigin);
    if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("本机控制地址无效。");
    this.origin = options.uploadOrigin ?? origin.origin;
    const cwd = path.join(path.resolve(options.repositoryDirectory), "apps", "wechat-rpa");
    this.paths = { cwd, python: path.join(cwd, ".venv", "Scripts", "python.exe"), collector: path.join(cwd, "collector.py"), connection: path.join(cwd, "connection.local.json"), calibration: path.join(cwd, ".data", "calibration.json"), jobs: path.join(path.resolve(options.repositoryDirectory), "demo_ui", ".data", "rpa-local", "backfill-job.json"), cancelDirectory: path.join(cwd, ".data", "backfill-control") };
    if (options.runtime) {
      this.paths.python = path.join(options.runtime, "python", "python.exe");
      this.paths.collector = path.join(options.runtime, "collector", "collector.py");
      fs.mkdirSync(cwd, { recursive: true });
    }
    try {
      const restored = readJsonSnapshot(this.paths.jobs);
      if (restored === undefined) return;
      if (!object(restored) || restored.version !== 1 || !object(restored.scope) || typeof restored.scope.userId !== "string" || typeof restored.scope.workspaceId !== "string" || !object(restored.job) || typeof restored.job.id !== "string" || !/^backfill_[0-9a-f-]{36}$/.test(restored.job.id) || !["RUNNING", "RESTORING", "COMPLETED", "CANCELLED", "FAILED"].includes(String(restored.job.status))) throw new Error("invalid state");
      this.stored = restored as unknown as StoredJob;
      this.stored.job.skippedScreens ??= 0;
      for (const group of this.stored.job.groups) group.skippedScreens ??= 0;
      if (active(this.stored.job.status)) {
        this.writeCancel(this.stored.job.id);
        this.save({ ...this.stored, job: { ...this.stored.job, status: "FAILED", cancelRequested: true, returnedToLatest: false, finishedAt: now(), updatedAt: now(), error: "本机服务已重启，已请求旧任务取消；无法确认已返回最新消息，请检查微信窗口。" } });
      }
    } catch { this.storageHealthy = false; }
  }

  private profilePath(session: RpaSession) {
    const id = createHash("sha256").update(JSON.stringify([this.origin, session.userId, session.currentWorkspaceId])).digest("hex");
    return path.join(this.paths.cwd, ".data", "connections", id, "connection.json");
  }

  private connectionPath(session: RpaSession) {
    const profile = this.profilePath(session);
    return isFile(profile) ? profile : this.paths.connection;
  }

  private needsBinding(session: RpaSession) {
    if (isFile(this.profilePath(session))) return false;
    if (!isFile(this.paths.connection)) return true;
    // A legacy connection already belonging to this user keeps its original queue.
    // A different user's credentials, groups and device settings are never copied.
    try {
      const legacy = jsonFile(this.paths.connection);
      return object(legacy) && object(legacy.scope) && !sameScope(legacy.scope as Scope, asScope(session));
    } catch { return false; }
  }

  private connectionConfig(session: RpaSession): ConnectionConfig {
    const file = this.connectionPath(session);
    if (!isFile(file)) throw new LocalControlError(409, "尚未连接本机采集器，请先保存当前账号的连接配置。");
    let config: unknown;
    try { config = jsonFile(file); } catch { throw new LocalControlError(409, "本机连接配置无法读取，请重新下载连接配置。"); }
    if (!object(config) || !object(config.scope) || typeof config.scope.userId !== "string" || !config.scope.userId.trim()
        || typeof config.scope.workspaceId !== "string" || !config.scope.workspaceId.trim()) throw new LocalControlError(409, "本机连接配置缺少账号信息，请重新下载连接配置。");
    if (!sameScope(config.scope as Scope, asScope(session))) throw new LocalControlError(403, "当前登录账号与本机采集连接账号不一致，无法控制该微信采集器。");
    try {
      if (typeof config.apiBaseUrl !== "string") throw new Error("invalid URL");
      const url = new URL(config.apiBaseUrl);
      if (url.origin !== this.origin || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("wrong origin");
    } catch { throw new LocalControlError(409, "本机连接地址与当前服务不一致，请从当前本机地址重新下载配置。"); }
    if (typeof config.token !== "string" || !config.token.trim() || /[\r\n]/.test(config.token)
        || !object(config.upload) || config.upload.enabled !== true) throw new LocalControlError(409, "本机连接尚未启用上传，请重新下载连接配置。");
    const configuredGroups = config.groups;
    if (!Array.isArray(configuredGroups) || !configuredGroups.every(isRpaGroupName) || new Set(configuredGroups).size !== configuredGroups.length) throw new LocalControlError(409, "本机连接的群名列表无效，请重新下载连接配置。");
    const connectedSession = this.options.readSession(`Bearer ${config.token}`);
    if (connectedSession && connectedSession.expiresAt > Date.now() && !sameScope(asScope(connectedSession), config.scope as Scope)) throw new LocalControlError(409, "本机连接凭证与配置账号不一致，请重新下载当前账号的连接配置。");
    return config as ConnectionConfig;
  }

  private enabledGroups(session: RpaSession) { return this.options.enabledGroups?.(session) ?? RPA_DEFAULT_GROUPS; }

  private busy() { return this.calibrating || Boolean(this.child || this.stored && active(this.stored.job.status)); }

  private calibration(): Calibration {
    if (!fs.existsSync(this.paths.calibration)) return { schemaVersion: 1, profiles: {} };
    try {
      const file = jsonFile(this.paths.calibration);
      if (object(file) && file.schemaVersion === 1 && object(file.profiles) && Object.keys(file).every((key) => ["schemaVersion", "profiles"].includes(key))) {
        return { schemaVersion: 1, profiles: file.profiles };
      }
    } catch { /* Report a safe configuration error without leaking paths. */ }
    throw new LocalControlError(409, "本机截图校准文件无法读取，请检查文件后重试。");
  }

  syncGroups(session: RpaSession, names: readonly string[]): void {
    if (!isFile(this.connectionPath(session))) return;
    let config: ConnectionConfig;
    try { config = this.connectionConfig(session); } catch (error) {
      if (error instanceof LocalControlError && error.status === 403) return;
      throw error;
    }
    if (sameNames(config.groups, names)) return;
    if (this.busy()) throw new LocalControlError(409, "本机正在采集或校准，请在任务结束后更改采集群。");
    this.writeConfig(this.connectionPath(session), { ...config, groups: [...names] });
  }

  private writeConfig(file: string, config: ConnectionConfig) {
    try { (this.options.writeConnection ?? writeAtomicJson)(file, config); }
    catch { throw new LocalControlError(503, "本机连接更新未保存，原配置已保留，请检查存储后重试。"); }
  }

  private connection(session: RpaSession): LocalConnection {
    const unavailable = (reason: string, connectionRefreshRequired = false): LocalConnection => ({
      available: false, connectionRefreshRequired, reason, groups: [], uncalibratedGroups: [], calibrationAvailable: false,
    });
    let config: ConnectionConfig;
    try { config = this.connectionConfig(session); }
    catch (error) {
      if (error instanceof LocalControlError && error.status !== 403) return unavailable(error.message);
      throw error;
    }
    if (!isFile(this.paths.python) || !isFile(this.paths.collector)) return unavailable("本机采集器或 Python 环境尚未安装完成。");
    if (!this.storageHealthy) return unavailable("历史补采任务记录无法保存或读取，请检查本机存储后重启服务。");
    const connectedSession = this.options.readSession(`Bearer ${config.token}`);
    if (!connectedSession || connectedSession.expiresAt <= Date.now()) return unavailable("本机连接凭证已过期或已退出，请更新当前账号连接后补采。", true);
    const names = this.enabledGroups(session);
    if (!sameNames(config.groups, names)) return unavailable("本机连接的采集群与当前设置不同，请更新连接后重试。", true);
    if (!names.length) return unavailable("尚未启用采集群，请先在采集群管理中启用。");
    let calibration: Calibration;
    try { calibration = this.calibration(); } catch (error) { return unavailable((error as LocalControlError).message); }
    const inline = object(config.capture) && object(config.capture.profiles) ? config.capture.profiles : {};
    const profiles = { ...inline, ...calibration.profiles };
    const groups = names.filter((name) => Object.hasOwn(profiles, name) && validProfile(profiles[name]));
    return { available: groups.length > 0, connectionRefreshRequired: false, calibrationAvailable: !this.busy(),
      groups, uncalibratedGroups: names.filter((name) => !groups.includes(name)),
      ...(!groups.length ? { reason: "已启用的群尚未校准，请在采集群管理中校准独立窗口。" } : {}) };
  }

  capability(session: RpaSession) {
    const connection = this.connection(session);
    const job = this.stored && sameScope(this.stored.scope, asScope(session)) ? structuredClone(this.stored.job) : null;
    return { enabled: true, ...connection, maxPages: 30, defaultPages: 5, daysOptions: datePresets, maxDatePages, job };
  }

  connectionStatus(session: RpaSession) {
    const realtime = this.live.status(this.profilePath(session));
    const desktopPicker = !!this.options.runtime;
    if (this.needsBinding(session)) return { enabled: true, available: false, connectionRequired: true, desktopPicker,
      groups: [], uncalibratedGroups: [], job: null, calibrationAvailable: false, realtime };
    return { ...this.capability(session), connectionRequired: false, desktopPicker, realtime };
  }

  windowChoices(): Promise<string[]> {
    if (!this.options.runtime) throw new LocalControlError(404, "此版本未启用窗口选择。");
    const worker = path.join(path.dirname(this.paths.collector), "window_choices.py");
    return new Promise((resolve, reject) => execFile(this.paths.python, ["-B", worker], {
      windowsHide: true, timeout: 8000, maxBuffer: 128 * 1024, encoding: "utf8"
    }, (error, output) => {
      try {
        if (error) throw error;
        const names: unknown = JSON.parse(output);
        if (!Array.isArray(names) || names.length > 100 || !names.every(isRpaGroupName)) throw new Error();
        resolve(names);
      } catch { reject(new LocalControlError(503, "无法读取微信窗口，请打开电脑微信后重试。")); }
    }));
  }

  realtime(session: RpaSession, action: "start" | "stop", body: unknown) {
    if (!object(body) || Object.keys(body).length) throw new LocalControlError(400, "使用当前登录空间的采集设置。");
    const scope = this.profilePath(session);
    const current = this.live.status(scope);
    if (current.occupied) throw new LocalControlError(409, "本机正在为其他空间实时采集，请在原空间停止后再开始。");
    if (action === "stop") {
      this.live.stop();
    } else if (!current.running) {
      const connection = this.connection(session);
      if (!connection.available || this.busy()) throw new LocalControlError(409, connection.reason || "请等待当前任务结束后开始实时采集。");
      const file = this.connectionPath(session);
      this.live.start(scope, () => (this.options.spawn ?? spawnProcess)(this.paths.python, [
        "-u", "-X", "utf8", this.paths.collector, "--config", file, "--calibration", this.paths.calibration,
        "collect", "--supervised", "--upload"
      ], {cwd: this.paths.cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"]}), () => {
        const config = this.connectionConfig(session);
        const bound = this.options.readSession("Bearer " + config.token);
        return !!bound && bound.expiresAt > Date.now() && sameScope(asScope(bound), asScope(session));
      });
    }
    return this.connectionStatus(session);
  }

  stopRealtime() {
    this.live.stop();
    if (this.child && this.stored && active(this.stored.job.status)) this.writeCancel(this.stored.job.id);
  }

  connect(session: RpaSession, authorization: unknown, body: unknown) {
    if (!object(body) || Object.keys(body).length) throw new LocalControlError(400, "连接目标由登录账号和当前空间确定。");
    if (!this.needsBinding(session)) return this.refreshConnection(session, authorization, {});
    const match = typeof authorization === "string" && authorization.match(/^Bearer\s+(\S+)$/i);
    const signedIn = match && this.options.readSession(authorization);
    if (!match || !signedIn || signedIn.expiresAt <= Date.now() || !sameScope(asScope(signedIn), asScope(session))) {
      throw new LocalControlError(401, "请重新登录后连接采集器。");
    }
    if (!isFile(this.paths.python) || !isFile(this.paths.collector)) throw new LocalControlError(409, "本机尚未安装采集器。");
    const config = collectorConnection({
      apiBaseUrl: this.origin, token: match[1], scope: asScope(signedIn), deviceId: "wechat_" + randomUUID(),
      groups: this.enabledGroups(signedIn), statePath: "queue.sqlite3",
    });
    this.writeConfig(this.profilePath(signedIn), config);
    return this.connectionStatus(signedIn);
  }

  refreshConnection(session: RpaSession, authorization: unknown, body: unknown) {
    if (body !== undefined && (!object(body) || Object.keys(body).length !== 0)) throw new LocalControlError(400, "更新连接不接受账号、凭证或配置参数。");
    const match = typeof authorization === "string" ? authorization.match(/^Bearer\s+(\S+)$/i) : null;
    const currentSession = match ? this.options.readSession(authorization) : null;
    if (!currentSession || currentSession.expiresAt <= Date.now() || !sameScope(asScope(currentSession), asScope(session))) throw new LocalControlError(401, "登录已失效，请重新登录后更新连接。");
    if (this.busy()) throw new LocalControlError(409, "本机正在采集或校准，请在任务结束后更新连接。");
    const config = this.connectionConfig(currentSession);
    this.writeConfig(this.connectionPath(currentSession), { ...config, token: match![1], groups: [...this.enabledGroups(currentSession)] });
    return {
      ...this.capability(currentSession), refreshed: true,
      message: "当前账号连接已更新，下次补采和实时采集的下一轮检查将使用新配置。",
    };
  }

  async calibrate(session: RpaSession, authorization: unknown, body: unknown) {
    if (!object(body) || Object.keys(body).length !== 1 || !isRpaGroupName(body.name)) throw new LocalControlError(400, "请提供要校准的完整群名。");
    if (this.busy()) throw new LocalControlError(409, "本机正在采集或校准，请等待任务完成。");
    const name = body.name;
    const connection = this.connection(session);
    if (!connection.calibrationAvailable) throw new LocalControlError(409, connection.reason || "本机采集器暂不可用于校准。");
    if (!this.enabledGroups(session).includes(name)) throw new LocalControlError(400, "只能校准已启用的群。");
    const original = this.calibration();
    const config = this.connectionConfig(session);
    this.calibrating = true;
    try {
      const profile = await this.probeCalibration(name, this.connectionPath(session));
      const activeSession = this.options.readSession(authorization);
      if (!activeSession || activeSession.expiresAt <= Date.now() || !sameScope(asScope(activeSession), asScope(session))) throw new LocalControlError(401, "登录状态已变化，请重新登录后校准。");
      if (JSON.stringify(this.connectionConfig(activeSession)) !== JSON.stringify(config)
        || !this.enabledGroups(activeSession).includes(name) || JSON.stringify(this.calibration()) !== JSON.stringify(original)) {
        throw new LocalControlError(409, "校准期间采集配置已更新，请重新校准。");
      }
      writeAtomicJson(this.paths.calibration, { ...original, profiles: { ...original.profiles, [name]: profile } });
    } finally { this.calibrating = false; }
    return this.capability(session);
  }

  private probeCalibration(name: string, connectionFile: string): Promise<Record<string, unknown>> {
    const args = ["-X", "utf8", this.paths.collector, "--config", connectionFile,
      "--calibration", this.paths.calibration, "calibrate", ...groupArgument(name)];
    return new Promise((resolve, reject) => {
      const child = (this.options.spawn ?? spawnProcess)(this.paths.python, args, {
        cwd: this.paths.cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      const timer = setTimeout(() => {
        this.terminateJobTree(child);
        reject(new LocalControlError(503, "校准超时，请保持独立群窗口打开后重试。"));
      }, 60_000);
      timer.unref?.();
      let output = "";
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        if (output.length <= 16_384) output = (output + chunk).slice(0, 16_385);
      });
      child.once("error", () => { clearTimeout(timer); reject(new LocalControlError(503, "未能启动校准进程，请检查本机采集器。")); });
      child.once("close", (code) => {
        clearTimeout(timer);
        let value: unknown;
        try { if (output.length <= 16_384) value = JSON.parse(output); } catch { /* Never return worker diagnostics. */ }
        if (object(value)) {
          if (code === 0 && validProfile(value.profile)) {
            const { windowSize, titleRegion, messageRegion, incomingBubbleLeft } = value.profile;
            resolve({ windowSize, titleRegion, messageRegion, ...(incomingBubbleLeft !== undefined ? { incomingBubbleLeft } : {}) });
            return;
          }
          const failure = failureCode(value.error);
          if (failure) {
            let message = failureMessages[failure] as string;
            if (failure === "OCR_CALIBRATION_NO_TEMPLATE" && Array.isArray(value.availableSizes)) {
              const sizes = value.availableSizes.slice(0, 8).filter((s: unknown) => Array.isArray(s) && s.length === 2 && s.every((n) => Number.isInteger(n) && n >= 100 && n <= 32_768));
              if (sizes.length) message += ` 已校准尺寸：${sizes.map((s: number[]) => s.join(" × ")).join("、")} 像素。`;
            }
            reject(new LocalControlError(409, message)); return;
          }
        }
        reject(new LocalControlError(503, "无法核实该群的截图区域，请检查独立窗口或已有的截图校准配置。"));
      });
    });
  }

  start(session: RpaSession, body: unknown): LocalBackfillJob {
    const connection = this.connection(session);
    if (!connection.available) throw new LocalControlError(503, connection.reason!);
    if (this.busy()) throw new LocalControlError(409, "本机正在采集或校准，请等待任务完成。");
    if (!object(body) || Object.keys(body).some((key) => !["pages", "days", "groups"].includes(key)) || ("days" in body) === ("pages" in body)) throw new LocalControlError(400, "请选择一种补采范围，可按天数或页数补采。");
    if ("days" in body && !isDatePreset(body.days)) throw new LocalControlError(400, "补采天数可选 1、3 或 7 天。");
    if ("pages" in body && (!Number.isInteger(body.pages) || Number(body.pages) < 1 || Number(body.pages) > 30)) throw new LocalControlError(400, "补采页数须为 1–30 的整数。");
    const groups = body.groups === undefined ? [...connection.groups] : body.groups;
    if (!Array.isArray(groups) || !groups.length || groups.some((group) => typeof group !== "string" || !connection.groups.includes(group)) || new Set(groups).size !== groups.length) throw new LocalControlError(400, "只能选择已启用且已校准的群，且不能重复。");
    const days = isDatePreset(body.days) ? body.days : undefined;
    const pages = days ? maxDatePages : Number(body.pages);
    const dateProgress = days ? { targetReached: false, messagesCounted: 0, undatedSkipped: 0, fallbackScreens: 0 } : {};
    const progress = { pagesRequested: pages, pagesCompleted: 0, queued: 0, uploaded: 0, skippedScreens: 0, ...dateProgress };
    const startedAt = now();
    const job: LocalBackfillJob = {
      id: `backfill_${randomUUID()}`, status: "RUNNING", startedAt, updatedAt: startedAt, days,
      groupIndex: 0, groupCount: groups.length, cancelRequested: false, ...progress,
      groups: groups.map((chatName) => ({ chatName, ...progress })),
    };
    this.save({ version: 1, scope: asScope(session), job });
    const args = ["-X", "utf8", this.paths.collector, "--config", this.connectionPath(session), ...(isFile(this.paths.calibration) ? ["--calibration", this.paths.calibration] : []), "backfill", ...(days ? ["--days", String(days)] : ["--pages", String(pages)])];
    for (const group of groups) args.push(...groupArgument(group));
    args.push("--upload", "--cancel-file", this.cancelPath(job.id));
    let child: ChildProcess;
    try { child = (this.options.spawn ?? spawnProcess)(this.paths.python, args, { cwd: this.paths.cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" } }); }
    catch { this.finish("FAILED", false, "历史补采进程未能启动，请检查本机采集器环境。", false); throw new LocalControlError(503, "历史补采进程未能启动，请检查本机采集器环境。"); }
    this.child = child;
    let buffer = "";
    let terminal: TerminalEvent | undefined;
    let settled = false;
    const settle = (code: number | null, timedOut = false) => {
      if (settled) return;
      settled = true;
      if (this.timeout) clearTimeout(this.timeout);
      this.child = null;
      if (timedOut) { this.finish("FAILED", false, "历史补采超时且未能在恢复宽限内退出，已请求终止本次进程树；无法确认已返回最新消息，请检查微信窗口。"); return; }
      if (days && terminal?.returnedToLatest && (terminal.dateRangeIncomplete || terminal.status === "COMPLETED" && !this.stored?.job.targetReached)) {
        this.finish("FAILED", true, "部分群的扫描未能确认覆盖所选时段，已保留本次采集结果。", terminal.restoreRequired);
        return;
      }
      if (code === 0 && terminal && terminal.status !== "FAILED" && (terminal.returnedToLatest || terminal.status === "CANCELLED" && terminal.restoreRequired === false)) {
        this.finish(terminal.status, terminal.returnedToLatest, undefined, terminal.restoreRequired);
      } else {
        this.finish("FAILED", terminal?.returnedToLatest === true, failureDescription(this.stored!.job, terminal), terminal?.restoreRequired);
      }
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (settled) return;
      buffer += chunk;
      if (buffer.length > 65_536) { buffer = ""; return; }
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        try {
          const event = JSON.parse(line);
          const final = this.progress(event);
          if (final) terminal = final;
        } catch { /* Ignore non-event output; never expose raw output or stderr. */ }
      }
    });
    child.stderr?.on("data", () => { /* Drain but never retain or echo chat content or credentials. */ });
    child.once("error", () => settle(null));
    child.once("close", (code) => settle(code));
    this.timeout = setTimeout(() => {
      if (settled) return;
      try { this.writeCancel(job.id); } catch {}
      if (this.stored) {
        try { this.save({ ...this.stored, job: { ...this.stored.job, status: "RESTORING", cancelRequested: true, updatedAt: now(), error: "历史补采已超时，正在取消并尝试返回最新消息。" } }); }
        catch { this.storageHealthy = false; }
      }
      this.timeout = setTimeout(() => {
        if (settled) return;
        settle(null, true);
        this.terminateJobTree(child);
      }, this.options.restoreGraceMs ?? 120_000);
      this.timeout.unref?.();
    }, this.options.timeoutMs ?? (days ? dateTimeoutPerGroupMs * groups.length : 15 * 60_000));
    this.timeout.unref?.();
    return structuredClone(this.stored!.job);
  }

  cancel(session: RpaSession, id: string): LocalBackfillJob {
    if (!this.stored || !sameScope(this.stored.scope, asScope(session)) || this.stored.job.id !== id) throw new LocalControlError(404, "补采任务不存在。");
    if (active(this.stored.job.status)) {
      this.writeCancel(id);
      this.save({ ...this.stored, job: { ...this.stored.job, cancelRequested: true, updatedAt: now() } });
    }
    return structuredClone(this.stored.job);
  }

  private progress(event: unknown): TerminalEvent | undefined {
    if (!this.stored || !object(event) || event.event !== "backfill" || !["RUNNING", "RESTORING", "COMPLETED", "CANCELLED", "FAILED"].includes(String(event.status))) return;
    const current = this.stored.job;
    const count = (value: unknown, maximum: number, fallback: number) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum ? value : fallback;
    const group = typeof event.chatName === "string" && current.groups.some((group) => group.chatName === event.chatName) ? event.chatName : current.chatName;
    const groups = current.groups.map((group) => {
      const update = Array.isArray(event.groups) ? event.groups.find((entry) => object(entry) && entry.chatName === group.chatName) : undefined;
      if (!object(update)) return group;
      const stop = update.stopReason === "BACKFILL_SCROLL_UNRESPONSIVE" ? "SCROLL_UNVERIFIED" : update.stopReason;
      const stopReason = isDateStop(stop) ? stop : group.stopReason;
      return {
        ...group, pagesCompleted: count(update.pagesCompleted, current.pagesRequested, group.pagesCompleted),
        queued: count(update.queued, 1_000_000, group.queued), uploaded: count(update.uploaded, 1_000_000, group.uploaded),
        skippedScreens: count(update.skippedScreens, 1000, group.skippedScreens),
        ...(typeof update.returnedToLatest === "boolean" ? { returnedToLatest: update.returnedToLatest } : {}),
        ...(typeof update.scrollAttempted === "boolean" ? { scrollAttempted: group.scrollAttempted === true || update.scrollAttempted } : {}),
        failureCode: failureCode(update.stopReason) ?? group.failureCode,
        restoreFailureCode: failureCode(update.restoreError) ?? group.restoreFailureCode,
        ...(current.days ? {
          stopReason, targetReached: stopReason === "DATE_BOUNDARY_REACHED" && (update.targetReached ?? group.targetReached) === true,
          messagesCounted: count(update.messagesCounted, 1_000_000, group.messagesCounted ?? 0),
          undatedSkipped: count(update.undatedSkipped, 1_000_000, group.undatedSkipped ?? 0),
          fallbackScreens: count(update.fallbackScreens, maxDatePages, group.fallbackScreens ?? 0),
        } : {}),
      };
    });
    const status = event.status as Status;
    const window = dateWindow(event, current);
    this.save({ ...this.stored, job: {
      ...current, status: active(status) ? status : "RESTORING", updatedAt: now(), chatName: group, groups,
      groupIndex: count(event.groupIndex, current.groupCount, current.groupIndex),
      pagesCompleted: count(event.pagesCompleted, current.pagesRequested * current.groupCount, current.pagesCompleted),
      queued: count(event.queued, 1_000_000, current.queued), uploaded: count(event.uploaded, 1_000_000, current.uploaded),
      skippedScreens: count(event.skippedScreens, 1000, current.skippedScreens),
      ...(current.days ? {
        ...window, targetReached: Boolean(current.rangeStart || window.rangeStart) && groups.every((g) => g.targetReached),
        messagesCounted: groups.reduce((total, g) => total + (g.messagesCounted ?? 0), 0),
        undatedSkipped: groups.reduce((total, g) => total + (g.undatedSkipped ?? 0), 0),
        fallbackScreens: groups.reduce((total, g) => total + (g.fallbackScreens ?? 0), 0),
      } : {}),
    } });
    if (!active(status)) {
      // A missing outcome from an older or interrupted worker cannot prove that
      // the windows were left untouched, even if the page counters are zero.
      let restoreRequired: boolean | undefined;
      if (event.restoreRequired === true || groups.some((entry) => entry.scrollAttempted || entry.pagesCompleted > 0)) restoreRequired = true;
      else if (event.restoreRequired === false && groups.every((entry) => entry.scrollAttempted === false)) restoreRequired = false;
      return { status, returnedToLatest: event.returnedToLatest === true, dateRangeIncomplete: event.error === "BACKFILL_DATE_RANGE_INCOMPLETE",
        restoreRequired, failureCode: failureCode(event.error) };
    }
  }
  private finish(status: Status, returnedToLatest: boolean, error?: string, restoreRequired?: boolean) {
    if (!this.stored) return;
    const next: StoredJob = { ...this.stored, job: { ...this.stored.job, status, returnedToLatest, restoreRequired, error, finishedAt: now(), updatedAt: now() } };
    try { this.save(next); } catch { this.storageHealthy = false; this.stored = { ...next, job: { ...next.job, status: "FAILED", error: "历史补采任务状态保存失败，请检查本机存储与微信窗口。" } }; }
  }
  private save(value: StoredJob) { writeAtomicJson(this.paths.jobs, value); this.stored = value; }
  private terminateJobTree(child: ChildProcess) {
    try {
      if (process.platform === "win32" && Number.isInteger(child.pid) && child.pid! > 0 && child.pid! <= 2_147_483_647) {
        const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
        const killer = (this.options.spawn ?? spawnProcess)(taskkill, ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
        killer.once("error", () => { /* The job remains failed with restoration explicitly unconfirmed. */ });
      } else child.kill();
    } catch { /* Never target other processes or claim successful restoration. */ }
  }
  private cancelPath(id: string) { return path.join(this.paths.cancelDirectory, `${id}.cancel`); }
  private writeCancel(id: string) { fs.mkdirSync(this.paths.cancelDirectory, { recursive: true, mode: 0o700 }); fs.writeFileSync(this.cancelPath(id), "cancel\n", { mode: 0o600 }); }
}

function loopback(address: string | undefined) { return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1"; }
export function isLocalRpaRequest(request: Request, localOrigin: string): boolean {
  const origin = new URL(localOrigin);
  return loopback(request.socket.remoteAddress) && loopback(request.socket.localAddress) && request.socket.localPort === Number(origin.port || 80)
    && request.headers.host === origin.host && (!request.headers.origin || request.headers.origin === origin.origin);
}
export function createLocalBackfillRouter(options: { enabled: boolean; controller: LocalBackfillController; readSession: (authorization: unknown) => RpaSession | null; localOrigin: string }) {
  const router = Router();
  router.use((request, response, next) => {
    if (!options.enabled) { response.sendStatus(404); return; }
    if (!isLocalRpaRequest(request, options.localOrigin)) { response.status(403).json({ error: "采集器只能从当前本机地址控制。" }); return; }
    const session = options.readSession(request.headers.authorization);
    if (!session || session.expiresAt <= Date.now()) { response.status(401).json({ error: "登录已失效，请重新登录后控制本机采集器。" }); return; }
    response.locals.localSession = session; next();
  });
  const respond = async (response: Response, action: () => unknown, status = 200) => {
    try { response.status(status).json(await action()); }
    catch (error) { response.status(error instanceof LocalControlError ? error.status : 503).json({ error: error instanceof LocalControlError ? error.message : "本机任务状态无法保存，请检查存储后重试。" }); }
  };
  router.get("/connection", (_request, response) => respond(response, () => options.controller.connectionStatus(response.locals.localSession)));
  router.get("/groups/windows", (_request, response) => respond(response, () => options.controller.windowChoices()));
  router.post("/connection", (request, response) => respond(response, () => options.controller.connect(response.locals.localSession, request.headers.authorization, request.body)));
  for (const action of ["start","stop"] as const) {
    router.post("/realtime/"+action, (request,response) => respond(response, () => options.controller.realtime(response.locals.localSession, action, request.body)));
  }
  router.get("/backfill", (_request, response) => respond(response, () => options.controller.capability(response.locals.localSession)));
  router.post("/connection/refresh", (request, response) => respond(response, () => options.controller.refreshConnection(response.locals.localSession, request.headers.authorization, request.body)));
  router.post("/groups/calibrate", (request, response) => respond(response, () => options.controller.calibrate(response.locals.localSession, request.headers.authorization, request.body)));
  router.post("/backfill", (request, response) => respond(response, () => ({ job: options.controller.start(response.locals.localSession, request.body) }), 202));
  router.post("/backfill/:id/cancel", (request, response) => respond(response, () => ({ job: options.controller.cancel(response.locals.localSession, String(request.params.id)) })));
  return router;
}
