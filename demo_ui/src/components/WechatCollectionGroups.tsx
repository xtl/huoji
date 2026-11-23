import React, { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

export interface ManagedGroup {
  name: string;
  enabled: boolean;
}

export interface ManagedGroupList {
  managedGroups: ManagedGroup[];
  allowedGroups: string[];
}

interface Props {
  token: string;
  groups: ManagedGroup[] | undefined;
  configError: string;
  local: boolean;
  calibrated: readonly string[];
  uncalibrated: readonly string[];
  canCalibrate: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onChanged: (groups: ManagedGroupList) => void;
  onCalibrated: () => void;
}

async function changeGroup<T>(token: string, path: string, method: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(payload?.error || "操作未完成，请刷新后重试。");
  return payload as T;
}

export default function WechatCollectionGroups(props: Props) {
  const { token, groups, configError, local, calibrated, uncalibrated, canCalibrate, busy, onBusy, onChanged, onCalibrated } = props;
  const [name, setName] = useState("");
  const [action, setAction] = useState("");
  const [feedback, setFeedback] = useState<{ error?: boolean; message: string } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const focusRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);
  const duplicate = groups?.some(group => group.name === name.trim());

  async function act(method: "POST" | "PATCH" | "DELETE" | "calibrate", target: string, enabled?: boolean) {
    if (!groups || busy || controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    onBusy(true);
    setAction(method === "calibrate" ? target : "");
    setFeedback(null);
    try {
      if (method === "calibrate") {
        await changeGroup(token, "/api/rpa/local/groups/calibrate", "POST", { name: target }, controller.signal);
        if (controller.signal.aborted) return;
        onCalibrated();
        setFeedback({ message: `已校准「${target}」，可在历史补采中选择。` });
      } else {
        const result = await changeGroup<ManagedGroupList>(token, "/api/rpa/groups", method,
          method === "PATCH" ? { name: target, enabled } : { name: target }, controller.signal);
        if (controller.signal.aborted) return;
        onChanged(result);
        if (method === "POST") {
          setName("");
          focusRef.current?.focus();
        }
        const verb = method === "POST" ? "已添加" : method === "DELETE" ? "已移除" : enabled ? "已启用" : "已暂停";
        setFeedback({ message: `${verb}「${target}」。` });
      }
    } catch (error) {
      if (!controller.signal.aborted) setFeedback({ error: true, message: error instanceof Error && !(error instanceof TypeError)
        ? error.message : "未能连接采集服务，请刷新后重试。" });
    } finally {
      if (!controller.signal.aborted) {
        controllerRef.current = null;
        onBusy(false);
        setAction("");
      }
    }
  }

  return <section aria-label="采集群管理" className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2">
      {groups && <span className="caption-text">已启用 {groups.filter(group => group.enabled).length} 个群，共 {groups.length} 个</span>}
    </div>
    <form className="mt-3" onSubmit={event => {
      event.preventDefault();
      if (name.trim() && !duplicate) void act("POST", name.trim());
    }}>
      <label htmlFor="wechat-group-name" className="text-xs font-medium text-neutral-600">微信群完整名称</label>
      <div className="mt-1 flex items-stretch gap-2">
        <input ref={focusRef} id="wechat-group-name" type="text" autoComplete="off" maxLength={200} disabled={busy}
          className="field-surface min-h-10 min-w-0 flex-1 rounded-lg px-3 py-2 text-sm" placeholder="与电脑微信的群窗口标题一致"
          aria-invalid={Boolean(duplicate)} aria-describedby={duplicate ? "wechat-group-duplicate" : undefined}
          value={name} onChange={event => { setName(event.target.value); setFeedback(null); }} />
        <button type="submit" disabled={!groups || busy || !name.trim() || duplicate} className="primary-button inline-flex shrink-0 items-center gap-1 rounded-md px-3 py-2 text-sm disabled:opacity-50">
          <Plus className="h-4 w-4" />添加群
        </button>
      </div>
      {duplicate && <p id="wechat-group-duplicate" className="mt-1 text-xs text-amber-700">这个群已在列表中。</p>}
    </form>
    {configError ? <p role="alert" className="mt-3 text-xs text-amber-700">{configError}</p>
      : !groups ? <p className="caption-text mt-3">正在读取群列表…</p>
      : groups.length === 0 ? <p className="caption-text mt-3">还没有采集群。输入群名，添加第一个群。</p> : null}
    {groups && groups.length > 0 && <ul className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">
      {groups.map(group => <li key={group.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
        <div className="min-w-0 flex-1 basis-36">
          <p className="break-all text-sm font-medium text-neutral-900">{group.name}</p>
          <p className="mt-0.5 text-xs text-neutral-600"><span className={group.enabled ? "text-[color:var(--accent)]" : ""}>{group.enabled ? "已启用" : "已暂停"}</span>
            {group.enabled && (calibrated.includes(group.name) ? " · 已校准" : uncalibrated.includes(group.name) ? <span className="text-amber-800"> · 待校准</span> : "")}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {local && group.enabled && canCalibrate && <button type="button" aria-label={`校准 ${group.name}`} disabled={busy}
            className="ghost-button min-h-9 rounded-md border border-[#cfdcd4] bg-white px-2 text-xs disabled:opacity-50" onClick={() => void act("calibrate", group.name)}>
            {action === group.name ? "正在校准…" : "校准窗口"}</button>}
          <button type="button" aria-label={`${group.enabled ? "暂停" : "启用"} ${group.name}`} disabled={busy}
            className="ghost-button min-h-9 rounded-md px-2 text-xs disabled:opacity-50" onClick={() => void act("PATCH", group.name, !group.enabled)}>
            {group.enabled ? "暂停" : "启用"}</button>
          <button type="button" aria-label={`移除 ${group.name}`} disabled={busy}
            className="min-h-9 rounded-md px-2 text-xs text-neutral-600 hover:bg-red-50 hover:text-red-800 disabled:opacity-50" onClick={() => void act("DELETE", group.name)}>移除</button>
        </div>
      </li>)}
    </ul>}
    {groups && groups.length > 0 && <p className="caption-text mt-2">暂停或移除群后，已采集的消息会保留。</p>}
    {local && uncalibrated.length > 0 && <p className="caption-text mt-2">校准前，请将群聊单独打开，调整为与已校准群相同的窗口大小。</p>}
    {!local && <p className="caption-text mt-2">请在采集电脑下载更新后的连接配置，并校准新增群的独立窗口。</p>}
    {feedback && <p role={feedback.error ? "alert" : "status"} className={`mt-2 break-words text-xs leading-5 ${feedback.error ? "text-amber-800" : "text-emerald-700"}`}>{feedback.message}</p>}
  </section>;
}
