import React, { useEffect, useRef, useState } from "react";
import { History, RefreshCw, Settings2 } from "lucide-react";
import CaptureDialog from "./CaptureDialog";
import LocalGroupPicker from "./LocalGroupPicker";
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
  RUNNING: "正在补采",
  RESTORING: "正在回到最新消息",
  COMPLETED: "补采完成",
  CANCELLED: "补采已停止",
  FAILED: "补采失败",
};

function isRunning(job: BackfillJob | null | undefined): boolean {
  return job?.status === "RUNNING" || job?.status === "RESTORING";
}

function progressTitle(job: BackfillJob): string {
  if (job.cancelRequested && isRunning(job)) return "正在停止补采并回到最新消息";
  const incompleteRange = job.days && job.status === "FAILED" && job.returnedToLatest && job.targetReached === false;
  if (incompleteRange && job.groups.some((group) => group.stopReason && ["TOP_REACHED", "PAGE_LIMIT", "TIME_LIMIT", "SCROLL_UNVERIFIED"].includes(group.stopReason))) {
    return "补采结束，部分时段待核实";
  }
  return statusLabels[job.status];
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

async function requestLocalControl<T>(token: string, signal: AbortSignal, url = "/api/rpa/local/connection", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (response.status === 401) throw new Error("登录已过期，请重新登录后补采。");
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
  const [changingGroups, setChangingGroups] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const selectionInitialized = useRef(false);
  const actionController = useRef<AbortController | null>(null);
  const scopeEpoch = useRef(0);
  const local = isLocalHost(window.location.hostname);
  const job = state?.job ?? null;
  const running = isRunning(job);
  const groups = (state?.groups ?? []).filter(name => managedGroups?.some(group => group.name === name && group.enabled));
  const chosen = selectedGroups.filter(name => groups.includes(name));
  const maxPages = Math.min(30, Math.max(1, state?.maxPages ?? 30));
  const dayOptions = HISTORY_DAYS.filter((days) => state?.daysOptions?.includes(days));
  const selectedDays = range !== "pages" && dayOptions.includes(range) ? range : undefined;
  const pageCount = Number(pages);
  const validPages = /^\d+$/.test(pages) && Number.isInteger(pageCount) && pageCount >= 1 && pageCount <= maxPages;
  const canStart = local && state?.enabled && state.available && !running && !busy && !changingGroups && (selectedDays || validPages) && chosen.length > 0;
  const showOptions = local && state?.enabled && state.available && groups.length > 0 && !running;

  useEffect(() => {
    scopeEpoch.current += 1;
    actionController.current?.abort();
    selectionInitialized.current = false;
    setState(null);
    setPages("5");
    setRange(3);
    setSelectedGroups([]);
    setBusy(null);
    setError("");
    setNotice("");
    setLoading(local);
    return () => { scopeEpoch.current += 1; actionController.current?.abort(); };
  }, [token, userId, workspaceId]);

  useEffect(() => {
    if (!local) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      let delay = 30000;
      try {
        let next = await requestLocalControl<BackfillState>(token, controller.signal);
        if (next.connectionRefreshRequired && !isRunning(next.job) && !controller.signal.aborted) {
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
        action === "start" ? { ...(selectedDays ? { days: selectedDays } : { pages: pageCount }), groups: chosen } : {},
      );
      if (controller.signal.aborted || epoch !== scopeEpoch.current) return;
      setState((previous) => previous ? { ...previous, job: result.job } : previous);
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
      if (!liveAction && tool === "connection") onTool("realtime");
      else if (!liveAction) setNotice("此电脑已连接到" + destination + "。");
      setRefreshVersion((value) => value + 1);
    } catch (reason) {
      if (!controller.signal.aborted && epoch === scopeEpoch.current) setError(reason instanceof Error ? reason.message : "连接更新失败，请重试。");
    } finally {
      if (!controller.signal.aborted && epoch === scopeEpoch.current) setBusy(null);
    }
  }

  const currentGroup = job?.groups.find((group) => group.chatName === job.chatName);
  const disabledReason = !local
    ? "历史补采仅支持在运行采集器的电脑上控制，请在该电脑通过本机地址打开货记。"
    : !state?.enabled || !state?.available
      ? state?.reason || (loading ? "正在检查本机采集器连接…" : "本机采集器未连接，连接当前账号后才能开始补采。")
      : groups.length === 0 ? "当前采集器尚未配置可补采的群聊。" : "";

  const needsConnection = state?.connectionRefreshRequired || (!loading && local && (!state?.available || error));
  const historyStatus = running ? statusLabels[job!.status] : state?.connectionRequired ? "待连接" : state?.connectionRefreshRequired ? "连接待更新"
    : needsConnection ? "检查连接" : job?.status === "FAILED" ? "补采待检查"
    : job && job.restoreRequired !== false && job.returnedToLatest !== true ? "检查群窗口" : "";
  const live = state?.realtime;
  const canPick = state?.desktopPicker && !live?.running && !live?.occupied && !running;
  const linkAction = local && (state?.connectionRequired || state?.connectionRefreshRequired) && <div className="capture-binding">
    <strong>{destination}</strong>
    <p>在此电脑上记住这个空间。采集结果和 AI 解析用量都归入这里。</p>
    <p>已启用的群　{managedGroups ? managedGroups.filter(g=>g.enabled).map(g=>g.name).join("、") || "暂无" : "读取中…"}</p>
    <button type="button" className="capture-action" disabled={Boolean(busy)} onClick={()=>void changeConnection()}>{busy==="connect"?"正在连接…":state.connectionRequired?"连接此电脑":"更新连接"}</button>
  </div>;
  return (<>
    {local && <button type="button" className="capture-tool" aria-haspopup="dialog" disabled={disabled || (!state && loading)} onClick={()=>onTool(canPick ? "picker" : state?.connectionRequired?"connection":"realtime")}>{live?.running?"实时采集中":canPick?"选择采集群":state?.connectionRequired?"连接此电脑":"实时采集"}</button>}
    {tool === "picker" && <LocalGroupPicker token={token} destination={destination} onDismiss={()=>onTool(null)} onSaved={onGroupChange}
      onReady={mode=>{ selectionInitialized.current = false; setRefreshVersion(v=>v+1); onTool(mode); }} />}
    <button type="button" className="capture-tool" disabled={disabled} aria-haspopup="dialog"
      aria-label={"补采历史消息" + (historyStatus ? "，" + historyStatus : "")}
      onClick={() => onTool(canPick && !state?.available ? "picker" : "history")}><History size={16} aria-hidden="true" /><span className="capture-history-label">补采历史</span>
      {historyStatus && <span className={running ? "capture-running" : "capture-needs-attention"}>{historyStatus}</span>}
    </button>
    <button type="button" className="capture-tool" disabled={disabled} aria-haspopup="dialog"
      onClick={() => onTool("groups")}><Settings2 size={16} aria-hidden="true" />采集设置{configError && <span className="capture-needs-attention">读取失败</span>}</button>
    <CaptureDialog title="采集设置" open={tool === "groups" || tool === "connection"} onDismiss={() => onTool(null)}>
      <div className="capture-tool-switch" role="group" aria-label="采集设置">
        <button type="button" aria-pressed={tool === "groups"} onClick={() => onTool("groups")}>管理采集群</button>
        <button type="button" aria-pressed={tool === "connection"} onClick={() => onTool("connection")}>连接配置</button>
      </div>
      <div hidden={tool !== "groups"}>
      <WechatCollectionGroups token={token} groups={managedGroups} configError={configError} local={local}
        calibrated={groups} uncalibrated={state?.uncalibratedGroups ?? []} canCalibrate={Boolean(state?.calibrationAvailable)}
        busy={running || Boolean(busy) || changingGroups} onBusy={setChangingGroups}
        onChanged={result => { onGroupChange(result); setRefreshVersion(value => value + 1); }}
        onCalibrated={() => setRefreshVersion(value => value + 1)} />
      {running && <p className="caption-text mt-1">补采结束后可更改采集群。</p>}
      {local && (error || (!state?.calibrationAvailable && state?.reason)) && <p className="caption-text mt-1">{error || state?.reason}</p>}
      </div>
      {tool === "connection" && <>{linkAction}{local && state && !linkAction && <p className="caption-text">{state.reason || "此电脑已连接到"+destination+"。"}</p>}
        {local ? <details><summary>高级 · 下载连接配置</summary>{connection}</details> : connection}
        {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      </>}
    </CaptureDialog>
    {tool === "realtime" && <CaptureDialog title="实时采集" onDismiss={()=>onTool(null)}>
      {linkAction || <div className="capture-binding"><strong>{destination}</strong>
        <p>{live?.occupied ? "本机正在为其他空间实时采集，请先在原空间停止。" : live?.running ? "正在检查已启用群的新消息。已上传 "+(live.uploaded || 0)+" 条。" : "请在微信打开已启用群的独立窗口。首次读取建立基线，之后自动采集新消息。"}</p>
        {state?.reason && <p>{state.reason}</p>}
        {state && !state.available && !live?.running && !live?.occupied && <button type="button" className="capture-tool" onClick={()=>onTool("groups")}>管理采集群</button>}
        {live?.note && <p role="status">{live.note}</p>}
        {live?.running ? <button className="capture-action" disabled={!!busy || live.stopping} onClick={()=>void changeConnection("stop")}>{live.stopping?"正在停止…":"停止实时采集"}</button> :
          <button className="capture-action" disabled={!!busy || running || !state?.available || live?.occupied} onClick={()=>void changeConnection("start")}>开始实时采集</button>}
        {state?.available && !live?.running && <button className="capture-tool" onClick={()=>onTool("history")}>补采历史消息</button>}
      </div>}
      {error && <p role="alert">{error}</p>}
    </CaptureDialog>}
    {tool === "history" && <CaptureDialog title="补采历史消息" onDismiss={() => onTool(null)}>
      {disabledReason && !linkAction && !error && <p className="mt-2 text-xs leading-6 text-neutral-500">{disabledReason}</p>}
      {linkAction}
      {showOptions && <fieldset disabled={Boolean(busy) || changingGroups} className="mt-2 min-w-0 space-y-3 disabled:opacity-60">
        <legend className="mb-1.5 text-sm font-medium text-[color:var(--ink)]">选择补采群聊</legend>
        <div className="flex flex-wrap gap-2">
          {groups.map((group) => <label key={group} className="flex min-h-9 min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-[var(--line)] px-2.5 text-sm text-[#4b5f53] has-checked:border-[#abcdba] has-checked:bg-[#f0f7f3]">
            <input type="checkbox" className="size-4 shrink-0 accent-[var(--accent)]" checked={selectedGroups.includes(group)} onChange={(event) => setSelectedGroups((selected) => event.target.checked ? [...selected, group] : selected.filter((item) => item !== group))} />
            <span className="break-all">{group}</span>
          </label>)}
        </div>
        {dayOptions.length > 0 && <fieldset className="min-w-0 pt-1">
          <legend className="text-sm font-medium text-[color:var(--ink)]">补采范围</legend>
          <div className="mt-1.5 flex w-fit max-w-full flex-wrap gap-1 rounded-lg border border-[var(--line)] bg-[var(--canvas)] p-1">
            {([...dayOptions, "pages"] as const).map((choice) => <button key={choice} type="button" aria-pressed={range === choice}
              onClick={() => setRange(choice)} className={`${range === choice ? "bg-white font-semibold text-[color:var(--accent)] shadow-sm ring-1 ring-[#d3dfd7]" : "ghost-button"} min-h-8 rounded-md px-2.5 text-sm`}>
              {choice === "pages" ? "按上翻次数" : `近 ${choice} 天`}
            </button>)}
          </div>
        </fieldset>}
        {selectedDays ? <p className="caption-text">从现在起往前 {selectedDays * 24} 小时，以微信时间标记筛选，跳过时间待核实的消息。</p> : <label className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">每群上翻次数
          <input aria-label="每群上翻次数" type="number" min={1} max={maxPages} step={1} value={pages} onChange={(event) => setPages(event.target.value)} className="field-surface w-20 rounded-md px-2 py-1.5" />
          <span className="text-xs text-neutral-400">1–{maxPages} 次</span>
        </label>}
        <p className="caption-text rounded-lg bg-[#f2f6f3] px-3 py-2">请单独打开所选群窗口，保持桌面解锁。补采时暂停操作微信，结束后采集器会尝试回到最新消息。</p>
        {chosen.length === 0 && <p className="text-xs text-amber-800">请选择至少一个群聊。</p>}
      </fieldset>}
      {showOptions && !selectedDays && !validPages && <p className="mt-2 text-xs text-amber-700">请输入 1–{maxPages} 之间的整数。</p>}
      {error && <p role="alert" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {showOptions && <button type="button" onClick={() => void act("start")} disabled={!canStart} className="primary-button rounded-md px-3 py-2 text-sm disabled:opacity-50">{busy === "start" ? "正在开始…" : "开始补采"}</button>}
        {running && <button type="button" onClick={() => void act("cancel")} disabled={!local || Boolean(busy) || job?.cancelRequested || job?.status === "RESTORING"} className="ghost-button rounded-md px-3 py-2 text-sm disabled:opacity-50">{busy === "cancel" || job?.cancelRequested ? "正在停止并回到最新…" : "停止补采并回到最新"}</button>}
        {local && !running && <button type="button" disabled={loading || Boolean(busy)} onClick={() => setRefreshVersion((value) => value + 1)} className="ghost-button inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />检查连接</button>}
      </div>
      {job && <div role="status" aria-live="polite" className="surface-card-quiet mt-3 space-y-2 rounded-md p-3 text-sm text-neutral-600">
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
    </CaptureDialog>}</>
  );
}
