import React, { useEffect, useRef, useState } from "react";
import { Play, RefreshCw, Settings2 } from "lucide-react";
import CaptureDialog from "./CaptureDialog";
import CloudAssistantEntry from "./CloudAssistantEntry";
import LocalGroupPicker, { type CaptureRange } from "./LocalGroupPicker";
import WechatCollectionGroups, { type ManagedGroup, type ManagedGroupList } from "./WechatCollectionGroups";

interface BackfillGroup {
  chatName: string;
  pagesRequested: number;
  pagesCompleted: number;
  queued: number;
  uploaded: number;
  skippedScreens?: number;
  returnedToLatest?: boolean;
  stopReason?: string;
  undatedSkipped?: number;
  fallbackScreens?: number;
  messagesCounted?: number;
}

type HistoryDays = 1 | 3 | 7;

interface BackfillJob {
  id: string;
  status: "RUNNING" | "RESTORING" | "COMPLETED" | "CANCELLED" | "FAILED";
  pagesRequested: number;
  pagesCompleted: number;
  groupIndex: number;
  groupCount: number;
  chatName?: string;
  queued: number;
  uploaded: number;
  skippedScreens?: number;
  returnedToLatest?: boolean;
  cancelRequested: boolean;
  restoreRequired?: boolean;
  error?: string;
  days?: HistoryDays;
  rangeStart?: string;
  rangeEnd?: string;
  targetReached?: boolean;
  messagesCounted?: number;
  groups: BackfillGroup[];
}

interface BackfillState {
  desktopPicker?: boolean;
  connectionRequired?: boolean;
  realtime?: { running: boolean; occupied?: boolean; stopping?: boolean; note?: string; uploaded?: number; lastCheck?: string };
  enabled: boolean;
  available: boolean;
  reason?: string;
  connectionRefreshRequired?: boolean;
  groups: string[];
  uncalibratedGroups?: string[];
  calibrationAvailable?: boolean;
  maxPages: number;
  defaultPages: number;
  daysOptions?: HistoryDays[];
  job: BackfillJob | null;
}

export type CaptureTool = "groups" | "connection" | "history" | "realtime" | "picker";
interface Props {
  token: string;
  userId: string;
  workspaceId: string;
  tool: CaptureTool | null;
  onTool: (tool: CaptureTool | null) => void;
  connection: React.ReactNode;
  destination: string;
  disabled: boolean;
  managedGroups: ManagedGroup[] | undefined;
  configError: string;
  onGroupChange: (groups: ManagedGroupList) => void;
}

const ENDPOINT = "/api/rpa/local/backfill";
const HISTORY_DAYS = [1, 3, 7] as const;
const stopLabels: Record<string, string> = {
  DATE_BOUNDARY_REACHED: "已翻到时段起点",
  TOP_REACHED: "已翻到可见历史开头，时段起点待核实",
  PAGE_LIMIT: "已达上翻次数上限，时段覆盖待核实",
  TIME_LIMIT: "已达时长上限，时段覆盖待核实",
  SCROLL_UNVERIFIED: "无法确认是否继续上翻，时段覆盖待核实",
};
const dateLabel = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const statusLabels: Record<BackfillJob["status"], string> = {
  RUNNING: "正在采集",
  RESTORING: "正在回到最新消息",
  COMPLETED: "采集完成",
  CANCELLED: "采集已停止",
  FAILED: "采集失败",
};

function isRunning(job: BackfillJob | null | undefined): boolean {
  return job?.status === "RUNNING" || job?.status === "RESTORING";
}

function progressTitle(job: BackfillJob): string {
  if (job.cancelRequested && isRunning(job)) return "正在停止采集并回到最新消息";
  const incompleteRange = job.days && job.status === "FAILED" && job.returnedToLatest && job.targetReached === false;
  if (incompleteRange && job.groups.some((group) => group.stopReason && ["TOP_REACHED", "PAGE_LIMIT", "TIME_LIMIT", "SCROLL_UNVERIFIED"].includes(group.stopReason))) {
    return "采集结束，部分时段待核实";
  }
  return statusLabels[job.status];
}

export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

async function requestLocalControl<T>(token: string, signal: AbortSignal, url = "/api/rpa/local/connection", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (response.status === 401) throw new Error("登录已过期，请重新登录后采集。");
  if (response.status === 404) throw new Error("本机采集器未连接，请启动采集器并连接当前账号。");
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(payload?.error || "本机采集器暂时无法连接，请稍后重试。");
  return payload as T;
}

export default function WechatHistoryBackfill({ token, userId, workspaceId, tool, onTool, connection, destination, disabled, managedGroups, configError, onGroupChange }: Props) {
  const [state, setState] = useState<BackfillState | null>(null);
  const [pages, setPages] = useState("5");
  const [range, setRange] = useState<HistoryDays | "pages">(3);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"start" | "cancel" | "connect" | "live" | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [changingGroups, setChangingGroups] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const preparingRef = useRef(false);
  const selectionInitialized = useRef(false);
  const actionController = useRef<AbortController | null>(null);
  const scopeEpoch = useRef(0);
  const local = isLocalHost(window.location.hostname);
  const job = state?.job ?? null;
  const running = isRunning(job);
  const live = state?.realtime;
  const groups = (state?.groups ?? []).filter(name => managedGroups?.some(group => group.name === name && group.enabled));
  const chosen = selectedGroups.filter(name => groups.includes(name));
  const maxPages = Math.min(30, Math.max(1, state?.maxPages ?? 30));
  const dayOptions = state?.desktopPicker && !state.daysOptions ? HISTORY_DAYS :
    HISTORY_DAYS.filter((days) => state?.daysOptions?.includes(days));
  const selectedDays = range === "pages" ? undefined : dayOptions.includes(range) ? range : dayOptions[0];
  const pageCount = Number(pages);
  const validPages = /^\d+$/.test(pages) && Number.isInteger(pageCount) && pageCount >= 1 && pageCount <= maxPages;
  const captureRange: CaptureRange | null = selectedDays ? { days: selectedDays } : validPages ? { pages: pageCount } : null;
  const blockedByLive = live?.running || live?.occupied;
  const pickerAvailable = Boolean(local && state?.desktopPicker);
  const usePicker = pickerAvailable && !running && !blockedByLive;
  const canStart = local && state?.enabled && state.available && !running && !blockedByLive && !busy && !changingGroups && captureRange && chosen.length > 0;
  const showOptions = local && !pickerAvailable && state?.enabled && state.available && groups.length > 0 && !running && !blockedByLive;
  const viewingResult = Boolean(job && (running || showResult));

  function reportPreparation(value: boolean) {
    preparingRef.current = value;
    setPreparing(value);
  }

  useEffect(() => {
    scopeEpoch.current += 1;
    actionController.current?.abort();
    selectionInitialized.current = false;
    setState(null);
    setPages("5");
    setRange(3);
    setSelectedGroups([]);
    setBusy(null);
    setShowResult(false);
    reportPreparation(false);
    setError("");
    setNotice("");
    setLoading(local);
    return () => { scopeEpoch.current += 1; actionController.current?.abort(); };
  }, [token, userId, workspaceId]);
  useEffect(() => {
    if (tool !== "history") setShowResult(false);
    else if (running) setShowResult(true);
  }, [tool, running]);

  useEffect(() => {
    if (!local) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      let delay = 30000;
      try {
        let next = await requestLocalControl<BackfillState>(token, controller.signal);
        if (next.connectionRefreshRequired && !preparingRef.current && !isRunning(next.job) && !controller.signal.aborted) {
          setState(next);
          // Only renew a previously authorized binding for the same account and workspace.
          await requestLocalControl(token, controller.signal, "/api/rpa/local/connection/refresh", {});
          next = await requestLocalControl<BackfillState>(token, controller.signal);
        }
        if (controller.signal.aborted) return;
        setState(next);
        setError("");
        const allowed = next.groups;
        if (allowed.length === 0) selectionInitialized.current = false;
        if (!selectionInitialized.current && next.available && allowed.length > 0) {
          setSelectedGroups(allowed);
          setPages(String(Math.min(30, Math.max(1, next.maxPages ?? 30), Math.max(1, next.defaultPages ?? 5))));
          selectionInitialized.current = true;
        } else {
          setSelectedGroups((selected) => selected.filter((group) => allowed.includes(group)));
        }
        delay = isRunning(next.job) || next.realtime?.running ? 2500 : next.available ? 15000 : 30000;
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error && !(reason instanceof TypeError) ? reason.message : "本机采集器暂时无法连接，请检查采集器是否运行。");
          setState((previous) => previous ? { ...previous, available: false } : null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(() => void poll(), delay);
        }
      }
    }
    setLoading(true);
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [token, userId, workspaceId, refreshVersion, local]);

  async function act(action: "start" | "cancel") {
    if ((action === "start" && !canStart) || (action === "cancel" && (!job || !running || job.cancelRequested))) return;
    const controller = new AbortController();
    const epoch = scopeEpoch.current;
    actionController.current?.abort();
    actionController.current = controller;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const result = await requestLocalControl<{ job: BackfillJob }>(token, controller.signal,
        action === "cancel" ? `${ENDPOINT}/${encodeURIComponent(job!.id)}/cancel` : ENDPOINT,
        action === "start" ? { ...captureRange, groups: chosen } : {},
      );
      if (controller.signal.aborted || epoch !== scopeEpoch.current) return;
      setState((previous) => previous ? { ...previous, job: result.job } : previous);
      if (action === "start") setShowResult(true);
      setRefreshVersion((value) => value + 1);
    } catch (reason) {
      if (!controller.signal.aborted && epoch === scopeEpoch.current) setError(reason instanceof Error && !(reason instanceof TypeError) ? reason.message : "操作未完成，请检查本机采集器连接后重试。");
    } finally {
      if (!controller.signal.aborted && epoch === scopeEpoch.current) setBusy(null);
    }
  }

  async function changeConnection(liveAction?: "start" | "stop") {
    if (!local || busy) return;
    const controller = new AbortController();
    const epoch = scopeEpoch.current;
    actionController.current?.abort();
    actionController.current = controller;
    setBusy(liveAction ? "live" : "connect");
    setError("");
    setNotice("");
    try {
      const result = await requestLocalControl<BackfillState>(token, controller.signal,
        liveAction ? "/api/rpa/local/realtime/"+liveAction : state?.connectionRequired ? "/api/rpa/local/connection" : "/api/rpa/local/connection/refresh", {});
      if (controller.signal.aborted || epoch !== scopeEpoch.current) return;
      setState(result);
      if (!liveAction) setNotice("此电脑已连接到" + destination + "。");
      setRefreshVersion((value) => value + 1);
    } catch (reason) {
      if (!controller.signal.aborted && epoch === scopeEpoch.current) setError(reason instanceof Error ? reason.message : "连接更新失败，请重试。");
    } finally {
      if (!controller.signal.aborted && epoch === scopeEpoch.current) setBusy(null);
    }
  }

  async function startPicked(names: string[], signal: AbortSignal) {
    if (!captureRange) return;
    const result = await requestLocalControl<{ job: BackfillJob }>(token, signal, ENDPOINT, { ...captureRange, groups: names });
    if (signal.aborted) return;
    setNotice("");
    setError("");
    setState(previous => previous ? { ...previous, job: result.job } : previous);
    setShowResult(true);
    setRefreshVersion(value => value + 1);
  }

  async function startPickedRealtime(_names: string[], signal: AbortSignal) {
    const result = await requestLocalControl<BackfillState>(token, signal, "/api/rpa/local/realtime/start", {});
    if (signal.aborted) return;
    setError("");
    setState(result);
    setRefreshVersion(value => value + 1);
  }

  function savedGroups(result: ManagedGroupList) {
    onGroupChange(result);
    setRefreshVersion(value => value + 1);
  }

  const currentGroup = job?.groups.find((group) => group.chatName === job.chatName);
  const disabledReason = !state?.enabled || !state?.available
      ? state?.reason || (loading ? "正在检查本机采集器连接…" : "请先启动采集助手，连接当前账号。")
      : groups.length === 0 ? "请先启用采集群并核对窗口。" : "";

  const needsConnection = state?.connectionRefreshRequired || (!loading && local && (!state?.available || error));
  const historyStatus = running ? statusLabels[job!.status] : state?.connectionRequired ? "待连接" : state?.connectionRefreshRequired ? "连接待更新"
    : needsConnection && !pickerAvailable ? "检查连接" : job?.status === "FAILED" ? "查看上次结果"
    : job && job.restoreRequired !== false && job.returnedToLatest !== true ? "检查群窗口" : "";
  const linkAction = local && (state?.connectionRequired || state?.connectionRefreshRequired) && <div className="capture-binding">
    <strong>{destination}</strong>
    <p>在此电脑上记住这个空间。采集结果和 AI 解析用量都归入这里。</p>
    <p>已启用的群　{managedGroups ? managedGroups.filter(g=>g.enabled).map(g=>g.name).join("、") || "暂无" : "读取中…"}</p>
    <button type="button" className="capture-action" disabled={Boolean(busy)} onClick={()=>void changeConnection()}>{busy==="connect"?"正在连接…":state.connectionRequired?"连接此电脑":"更新连接"}</button>
  </div>;
  const rangeFields = <>
    {dayOptions.length > 0 && <div className="capture-ranges" role="group" aria-label="按时间采集">
      {dayOptions.map(days => <button key={days} type="button" aria-pressed={selectedDays === days}
        onClick={() => setRange(days)}>近 {days} 天</button>)}
      <button type="button" aria-pressed={!selectedDays} onClick={() => setRange("pages")}>按上翻次数</button>
    </div>}
    {!selectedDays && <label className="capture-page-option">每群上翻
      <input aria-label="每群上翻次数" type="number" min={1} max={maxPages} step={1} value={pages}
        onChange={event => { setPages(event.target.value); setRange("pages"); }} className="field-surface" />次
    </label>}
    {!selectedDays && !validPages && <p className="capture-alert">请输入 1–{maxPages} 之间的整数。</p>}
    <p className="caption-text">{selectedDays ? `按微信时间采集最近 ${selectedDays * 24} 小时的消息。` : "助手将按次数向上翻看每个群。"}
      采集时请保持桌面解锁，暂停操作微信。</p>
  </>;
  return (<>
    {local && <button type="button" className="capture-primary" disabled={disabled} aria-haspopup="dialog"
      aria-label={(running ? "查看采集进度" : "开始采集") + (historyStatus ? "，" + historyStatus : "")}
      onClick={() => onTool("history")}><Play size={15} aria-hidden="true" />{running ? "查看采集进度" : "开始采集"}
    </button>}
    {local && <button type="button" className="capture-action" aria-haspopup="dialog" disabled={disabled}
      onClick={() => onTool("realtime")}>{live?.running ? "实时采集中" : "实时采集"}</button>}
    {tool === "picker" && <CaptureDialog title="从微信窗口添加" onDismiss={() => { if (!preparing) onTool("groups"); }}>
      <LocalGroupPicker token={token} mode="groups" disabled={disabled || running || Boolean(blockedByLive)} onSaved={savedGroups}
        onPrepared={() => onTool("groups")} onBusy={reportPreparation} />
    </CaptureDialog>}
    <button type="button" className="capture-tool" disabled={disabled} aria-haspopup="dialog"
      onClick={() => onTool("groups")}><Settings2 size={16} aria-hidden="true" />管理群聊{configError && <span className="capture-needs-attention">读取失败</span>}</button>
    <CaptureDialog title={tool === "connection" ? "采集连接" : "管理群聊"} open={tool === "groups" || tool === "connection"} onDismiss={() => onTool(null)}>
      <div className="capture-tool-switch" role="group" aria-label="群聊与连接">
        <button type="button" aria-pressed={tool === "groups"} onClick={() => onTool("groups")}>群聊</button>
        <button type="button" aria-pressed={tool === "connection"} onClick={() => onTool("connection")}>连接</button>
      </div>
      <div hidden={tool !== "groups"}>
      <WechatCollectionGroups token={token} groups={managedGroups} configError={configError} local={local}
        calibrated={groups} uncalibrated={state?.uncalibratedGroups ?? []} canCalibrate={Boolean(state?.calibrationAvailable)}
        busy={running || Boolean(blockedByLive) || Boolean(busy) || changingGroups} onBusy={setChangingGroups}
        onChooseWindows={pickerAvailable ? () => onTool("picker") : undefined}
        onChanged={savedGroups}
        onCalibrated={() => setRefreshVersion(value => value + 1)} />
      {(running || blockedByLive) && <p className="caption-text mt-1">请等当前采集结束后再更改群聊。</p>}
      {local && !pickerAvailable && (error || (!state?.calibrationAvailable && state?.reason)) && <p className="caption-text mt-1">{error || state?.reason}</p>}
      </div>
      {tool === "connection" && <>{linkAction}{local && state && !linkAction && <p className="caption-text">{state.reason || "此电脑已连接到"+destination+"。"}</p>}
        {!local && <CloudAssistantEntry />}
        <details><summary>高级 · 下载连接配置</summary>{connection}</details>
        {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      </>}
    </CaptureDialog>
    {tool === "realtime" && <CaptureDialog title="实时采集" onDismiss={() => { if (!preparing) onTool(null); }}>
      <p className="capture-picker-destination">保存到 <strong>{destination}</strong></p>
      {usePicker ? <LocalGroupPicker token={token} mode="realtime" disabled={disabled || changingGroups} onSaved={savedGroups}
        onPrepared={startPickedRealtime} onBusy={reportPreparation} />
        : linkAction || <div className="capture-binding">
        <p>{live?.occupied ? "本机正在为其他空间实时采集，请先在原空间停止。" : live?.running ? "正在检查已启用群的新消息。已上传 "+(live.uploaded || 0)+" 条。" : "请在微信打开已启用群的独立窗口。首次读取建立基线，之后自动采集新消息。"}</p>
        {state?.reason && <p>{state.reason}</p>}
        {state && !state.available && !live?.running && !live?.occupied && <button type="button" className="capture-tool" onClick={()=>onTool("groups")}>管理采集群</button>}
        {live?.note && <p role="status">{live.note}</p>}
        {live?.running ? <button className="capture-action" disabled={!!busy || live.stopping} onClick={()=>void changeConnection("stop")}>{live.stopping?"正在停止…":"停止实时采集"}</button> :
          <button className="capture-action" disabled={!!busy || running || !state?.available || live?.occupied} onClick={()=>void changeConnection("start")}>开始实时采集</button>}
        {state?.available && !live?.running && <button className="capture-tool" onClick={()=>onTool("history")}>采集最近消息</button>}
      </div>}
      {error && <p role="alert">{error}</p>}
    </CaptureDialog>}
    {tool === "history" && <CaptureDialog title={running ? "采集进度" : viewingResult ? "采集结果" : "开始采集"} onDismiss={() => { if (!preparing) onTool(null); }}>
      {!local && <CloudAssistantEntry />}
      {local && <p className="capture-picker-destination">保存到 <strong>{destination}</strong></p>}
      {usePicker && !viewingResult && <LocalGroupPicker token={token} mode="history" disabled={disabled || changingGroups} range={captureRange} rangeFields={rangeFields}
        onSaved={savedGroups} onPrepared={startPicked} onBusy={reportPreparation} />}
      {local && !viewingResult && !pickerAvailable && disabledReason && !linkAction && !error && <p className="caption-text">{disabledReason}</p>}
      {local && !viewingResult && !pickerAvailable && !groups.length && !loading && <button className="capture-action" type="button" onClick={() => onTool("groups")}>管理群聊</button>}
      {local && !viewingResult && blockedByLive && <div className="capture-binding">
        <p>{live?.occupied ? "这台电脑正在替另一个空间实时采集，请在原空间停止。" : "实时采集正在运行。停止后可采集最近的消息。"}</p>
        {live?.running && <button className="capture-action" type="button" onClick={() => onTool("realtime")}>查看实时采集</button>}
      </div>}
      {!viewingResult && !pickerAvailable && linkAction}
      {showOptions && !viewingResult && <fieldset disabled={Boolean(busy) || changingGroups} className="mt-2 min-w-0 space-y-3 disabled:opacity-60">
        <legend className="mb-1.5 text-sm font-medium text-[color:var(--ink)]">选择群聊</legend>
        <div className="flex flex-wrap gap-2">
          {groups.map((group) => <label key={group} className="flex min-h-9 min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-[var(--line)] px-2.5 text-sm text-[#4b5f53] has-checked:border-[#abcdba] has-checked:bg-[#f0f7f3]">
            <input type="checkbox" className="size-4 shrink-0 accent-[var(--accent)]" checked={selectedGroups.includes(group)} onChange={(event) => setSelectedGroups((selected) => event.target.checked ? [...selected, group] : selected.filter((item) => item !== group))} />
            <span className="break-all">{group}</span>
          </label>)}
        </div>
        <fieldset className="capture-form-part"><legend>采集范围</legend>{rangeFields}</fieldset>
        {chosen.length === 0 && <p className="text-xs text-amber-800">请选择至少一个群聊。</p>}
      </fieldset>}
      {error && !usePicker && <p role="alert" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {showOptions && !viewingResult && <button type="button" onClick={() => void act("start")} disabled={!canStart} className="capture-primary">{busy === "start" ? "正在开始…" : "开始采集"}</button>}
        {running && <button type="button" onClick={() => void act("cancel")} disabled={!local || Boolean(busy) || job?.cancelRequested || job?.status === "RESTORING"} className="capture-action">{busy === "cancel" || job?.cancelRequested ? "正在停止并回到最新…" : "停止采集并回到最新"}</button>}
        {local && !pickerAvailable && !viewingResult && <button type="button" disabled={loading || Boolean(busy)} onClick={() => setRefreshVersion((value) => value + 1)} className="capture-tool"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />检查连接</button>}
        {job && !viewingResult && <button type="button" className="capture-tool" disabled={preparing} onClick={() => setShowResult(true)}>查看上次采集结果</button>}
      </div>
      {job && viewingResult && <div role="status" aria-live="polite" className="surface-card-quiet mt-3 space-y-2 rounded-md p-3 text-sm text-neutral-600">
        <p className="font-medium">{job.days ? `近 ${job.days} 天 · ` : ""}{progressTitle(job)}</p>
        {job.days && job.rangeStart && job.rangeEnd && <p>北京时间 {dateLabel.format(new Date(job.rangeStart))} 至 {dateLabel.format(new Date(job.rangeEnd))}</p>}
        {running && <p className="break-all">当前群：{job.chatName || "准备中"}{currentGroup ? ` · 已上翻 ${currentGroup.pagesCompleted} 次` : ""}</p>}
        <p>累计上翻 {job.pagesCompleted}{!job.days && `/${job.groups.reduce((sum, group) => sum + group.pagesRequested, 0)}`} 次{job.days && job.messagesCounted != null && ` · 时段内识别 ${job.messagesCounted} 条`} · 新入队 {job.queued} 条 · 已上传 {job.uploaded} 条</p>
        {(job.skippedScreens ?? 0) > 0 && <p className="rounded-md bg-amber-50 px-3 py-2 font-medium text-amber-800">有 {job.skippedScreens} 个画面未能完整识别，请核对采集结果。</p>}
        {job.groups.map((group) => <p key={group.chatName} className="caption-text break-all">
          {group.chatName}：上翻 {group.pagesCompleted}{!job.days && `/${group.pagesRequested}`} 次{job.days && group.messagesCounted != null && `，时段内 ${group.messagesCounted} 条`}，新增 {group.queued} 条
          {(group.skippedScreens ?? 0) > 0 && `，${group.skippedScreens} 屏未完整识别`}
          {job.days && (group.fallbackScreens ?? 0) > 0 && `，有 ${group.fallbackScreens} 屏含无法拆分的内容`}
          {(group.undatedSkipped ?? 0) > 0 && `，时间待核实跳过 ${group.undatedSkipped} 条`}
          {group.stopReason && stopLabels[group.stopReason] && ` · ${stopLabels[group.stopReason]}`}
        </p>)}
        {job.error && <p className="text-amber-800">{job.error}</p>}
        {!running && job.restoreRequired === false && <p>本次任务没有滚动群窗口。</p>}
        {!running && job.restoreRequired !== false && job.returnedToLatest === true && <p className="text-emerald-700">已滚动的群窗口均已回到最新消息。</p>}
        {!running && job.restoreRequired !== false && job.returnedToLatest !== true && !job.error?.includes("无法确认已返回最新消息") && <p className="text-amber-800">尚未确认已回到最新消息，请检查群聊窗口。</p>}
      </div>}
      {job && viewingResult && !running && <div className="capture-start-row mt-3">
        <button type="button" className="capture-action" onClick={() => setShowResult(false)}>再采一次</button>
        <button type="button" className="capture-primary" onClick={() => onTool(null)}>返回采集记录</button>
      </div>}
    </CaptureDialog>}</>
  );
}
