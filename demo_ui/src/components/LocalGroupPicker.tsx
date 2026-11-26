import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, RefreshCw } from "lucide-react";
import type { ManagedGroupList } from "./WechatCollectionGroups";

export type CaptureRange = { days: 1 | 3 | 7 } | { pages: number };

async function api<T>(token: string, route: string, signal: AbortSignal, body?: object): Promise<T> {
  const response = await fetch("/api/rpa/" + route, {
    method: body === undefined ? "GET" : "POST", signal, cache: "no-store",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result == null) throw new Error(result?.error || "未能连接采集助手，请重试。");
  return result as T;
}

type Mode = "history" | "realtime" | "groups";
type Connection = { groups: string[]; connectionRequired?: boolean; connectionRefreshRequired?: boolean };

export default function LocalGroupPicker({ token, mode, disabled, range, rangeFields, onSaved, onPrepared, onBusy }: {
  token: string;
  mode: Mode;
  disabled: boolean;
  range?: CaptureRange | null;
  rangeFields?: ReactNode;
  onSaved: (groups: ManagedGroupList) => void;
  onPrepared: (names: string[], signal: AbortSignal) => Promise<void> | void;
  onBusy?: (busy: boolean) => void;
}) {
  const [windows, setWindows] = useState<string[]>([]);
  const [previous, setPrevious] = useState<string[]>([]);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const request = useRef<AbortController>(null);
  const managing = mode === "groups";
  const options = managing ? windows.filter(name => !previous.includes(name)) : windows;
  const selected = options.filter(name => (selection ?? (managing ? [] : previous)).includes(name));

  async function load() {
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const [names, saved] = await Promise.all([
        api<string[]>(token, "local/groups/windows", controller.signal),
        api<ManagedGroupList>(token, "groups", controller.signal),
      ]);
      if (!controller.signal.aborted) {
        setWindows([...new Set(names)]);
        setPrevious(saved.allowedGroups);
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setWindows([]);
        setError(reason instanceof Error ? reason.message : "未能读取微信窗口。");
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setLoading(false);
      }
    }
  }
  useEffect(() => { void load(); return () => request.current?.abort(); }, [token]);

  async function submit() {
    if (disabled || loading || request.current || !selected.length || (mode === "history" && !range)) return;
    const controller = new AbortController();
    const signal = controller.signal;
    request.current = controller;
    onBusy?.(true);
    setError("");
    setProgress(managing ? "正在保存群聊…" : "正在准备采集…");
    try {
      const enabled = mode === "realtime" ? selected : [...new Set([...previous, ...selected])];
      if (mode === "realtime" || enabled.length !== previous.length) {
        const saved = await api<ManagedGroupList>(token, "groups/selection", signal, { previous, selected: enabled });
        if (signal.aborted) return;
        setPrevious(saved.allowedGroups);
        onSaved(saved);
      }
      if (!managing) {
        let state = await api<Connection>(token, "local/connection", signal);
        if (state.connectionRequired || state.connectionRefreshRequired) {
          setProgress("正在连接当前空间…");
          state = await api<Connection>(token, "local/connection", signal, {});
        }
        for (const name of selected.filter(name => !state.groups.includes(name))) {
          if (signal.aborted) return;
          setProgress(`正在核对「${name}」…`);
          try { await api(token, "local/groups/calibrate", signal, { name }); }
          catch (reason) {
            if (signal.aborted) return;
            throw new Error(`「${name}」${reason instanceof Error ? reason.message : "窗口核对失败。"}`);
          }
        }
        setProgress("正在启动采集…");
      }
      if (!signal.aborted) await onPrepared(selected, signal);
    } catch (reason) {
      if (!signal.aborted) setError(reason instanceof Error ? reason.message : "操作未完成，请重试。");
    } finally {
      request.current = null;
      onBusy?.(false);
      if (!signal.aborted) setProgress("");
    }
  }

  const stillLoading = loading || Boolean(progress);
  return <div className="capture-picker">
    <fieldset disabled={disabled || stillLoading} className="capture-form-part">
      <legend>微信窗口</legend>
      <div className="capture-picker-heading">
        <p>在电脑微信中把目标群单独打开，再勾选对应的窗口。</p>
        <button type="button" className="capture-action" onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" />刷新窗口</button>
      </div>
      {options.length > 0 && <div className="capture-picker-list">{options.map(name => <label key={name}>
        <input type="checkbox" checked={selected.includes(name)} onChange={event => {
          setSelection(event.target.checked ? [...selected, name] : selected.filter(item => item !== name));
        }} />
        <span>{name}</span>
      </label>)}</div>}
      {loading && <p role="status">正在查找微信窗口…</p>}
      {!loading && !error && !options.length && <p>{managing && windows.length
        ? "已打开的窗口都在采集群列表中。"
        : "还没找到独立窗口。打开目标群后，点「刷新窗口」。"}</p>}
    </fieldset>
    {rangeFields && <fieldset className="capture-form-part" disabled={disabled || Boolean(progress)}>
      <legend>采集范围</legend>{rangeFields}
    </fieldset>}
    {mode === "realtime" && <p className="caption-text">实时采集只跟踪这次勾选的群，未选群会暂停。第一次读取时会建立起点。</p>}
    {mode === "history" && selected.some(name => !previous.includes(name)) &&
      <p className="caption-text">首次选中的群会加入采集群列表。</p>}
    {error && <p role="alert" className="capture-alert">{error}</p>}
    {progress && <p role="status">{progress}</p>}
    <div className="capture-start-row">
      <span>已选 {selected.length} 个窗口</span>
      <button type="button" className="capture-primary" onClick={() => void submit()} disabled={disabled || stillLoading ||
        !selected.length || (mode === "history" && !range)}>
        {managing && <Plus size={15} aria-hidden="true" />}
        {progress ? "正在处理…" : managing ? "添加所选群" : mode === "history" ? "开始采集" : "开始实时采集"}
      </button>
    </div>
  </div>;
}
