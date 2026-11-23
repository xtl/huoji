import { useEffect, useRef, useState } from "react";
import CaptureDialog from "./CaptureDialog";
import type { ManagedGroupList } from "./WechatCollectionGroups";

export default function LocalGroupPicker({ token, destination, onDismiss, onSaved, onReady }: {
  token: string; destination: string; onDismiss: () => void; onSaved: (groups: ManagedGroupList) => void;
  onReady: (tool: "history" | "realtime") => void;
}) {
  const [names, setNames] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [previous, setPrevious] = useState<string[]>([]);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  async function api<T>(url: string, signal: AbortSignal, body?: unknown): Promise<T> {
    const response = await fetch("/api/rpa/" + url, {
      signal, method: body === undefined ? "GET" : "POST", cache: "no-store",
      headers: {Authorization:"Bearer " + token, "Content-Type":"application/json"},
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "操作未完成，请重试。");
    return result;
  }
  async function load() {
    const c = new AbortController();
    request.current?.abort(); request.current = c;
    setWorking("读取微信窗口…"); setError("");
    try {
      const [windows, managed] = await Promise.all([api<string[]>("local/groups/windows", c.signal), api<ManagedGroupList>("groups", c.signal)]);
      if (!c.signal.aborted) {
        setNames(windows); setPrevious(managed.allowedGroups);
        setSelected(windows.filter(name => managed.allowedGroups.includes(name)));
      }
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : "未能读取微信窗口。"); }
    finally { if (!c.signal.aborted) setWorking(""); }
  }
  useEffect(() => { void load(); return () => request.current?.abort(); }, [token]);
  async function start(mode: "history" | "realtime") {
    if (working || !selected.length) return;
    const c = new AbortController(); request.current = c;
    setWorking("连接当前空间…"); setError("");
    try {
      const saved = await api<ManagedGroupList>("groups/selection", c.signal, {selected, previous});
      if (c.signal.aborted) return;
      setPrevious(saved.allowedGroups); onSaved(saved);
      await api("local/connection", c.signal, {});
      for (const name of selected) {
        setWorking("正在核对「" + name + "」…");
        try { await api("local/groups/calibrate", c.signal, {name}); }
        catch (e) { throw new Error("「" + name + "」" + (e instanceof Error ? e.message : "窗口核对失败。")); }
      }
      if (mode === "realtime") await api("local/realtime/start", c.signal, {});
      if (!c.signal.aborted) onReady(mode);
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : "未能开始采集。"); }
    finally { if (!c.signal.aborted) setWorking(""); }
  }
  return <CaptureDialog title="选择采集群" onDismiss={onDismiss}>
    <p className="caption-text">请把目标群在电脑微信中单独打开。从当前打开的聊天窗口中勾选要采集的群。</p>
    <p className="capture-picker-destination">采集到 <strong>{destination}</strong></p>
    <div className="capture-picker-list">{names.map(name => <label key={name}>
      <input type="checkbox" disabled={!!working} checked={selected.includes(name)} onChange={e =>
        setSelected(old => e.target.checked ? [...old, name] : old.filter(x => x !== name))}/>{name}</label>)}</div>
    {!working && !error && !names.length && <p>还没找到独立聊天窗口。打开群窗口后，点「重新查找」。</p>}
    <button className="capture-tool" disabled={!!working} onClick={()=>void load()}>重新查找</button>
    <p className="caption-text">开始前，助手会按需调整所选窗口的大小并核对群名。</p>
    {error && <p role="alert" className="capture-alert">{error}</p>}
    {working && <p role="status">{working}</p>}
    <div className="capture-tools"><button className="capture-action" disabled={!!working || !selected.length} onClick={()=>void start("realtime")}>开始实时采集</button>
    <button className="capture-tool" disabled={!!working || !selected.length} onClick={()=>void start("history")}>补采历史消息</button></div>
  </CaptureDialog>;
}
