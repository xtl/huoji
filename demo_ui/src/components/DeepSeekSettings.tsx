import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, Check, ExternalLink, KeyRound, LoaderCircle } from "lucide-react";

type KeyStatus = { configured: boolean; updatedAt: string | null };
type Action = "load" | "save" | "test" | "remove";
type Feedback = { error: boolean; text: string };
const settingsPath = "/api/platform/key";

type Props = { token: string };
export default function DeepSeekSettings({ token }: Props) {
  const { protocol, hostname } = window.location;
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  if (protocol !== "https:" && !(protocol === "http:" && loopback)) {
    return <section aria-label="DeepSeek API 配置" className="account-surface account-padding">
      <h2 className="text-lg font-semibold text-neutral-950">DeepSeek API 配置</h2>
      <p role="alert" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">请使用 HTTPS 访问货记，或在服务器本机通过 localhost 打开后配置密钥。</p>
    </section>;
  }
  return <DeepSeekSettingsForm token={token} />;
}

function DeepSeekSettingsForm({ token }: Props) {
  const inputId = useId();
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [pending, setPending] = useState<Action | null>("load");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const request = useRef<AbortController | null>(null);

  async function run(action: Action) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(action);
    setFeedback(null);
    const draft = apiKey.trim();
    try {
      const method = { load: "GET", save: "PUT", test: "POST", remove: "DELETE" }[action];
      const hasBody = action === "save" || action === "test";
      const response = await fetch(action === "test" ? settingsPath + "/test" : settingsPath, {
        method, mode: "same-origin", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, ...(hasBody ? { "Content-Type": "application/json" } : {}) },
        ...(hasBody ? { body: JSON.stringify(draft ? { apiKey: draft } : {}) } : {}),
      });
      const data = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setFeedback({ error: true, text: response.status === 401 ? "登录已过期，请重新登录后再操作。" :
          typeof data?.error === "string" ? data.error : "请求失败，请稍后重试。" });
        return;
      }
      if (action === "test") {
        if (data?.ok !== true) throw new Error();
        setFeedback({ error: false, text: draft ? "测试通过，可读取模型列表。保存后即可使用这把密钥。" : "测试通过，已保存的密钥可读取模型列表。" });
        return;
      }
      if (typeof data?.configured !== "boolean") throw new Error();
      setStatus({ configured: data.configured, updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null });
      if (action !== "load") {
        setApiKey("");
        setConfirmRemove(false);
        setFeedback({ error: false, text: action === "save" ? "平台密钥已保存，将用于后续供需解析。" : "已移除平台密钥。" });
      }
    } catch {
      if (!controller.signal.aborted) setFeedback({ error: true, text: "未收到货记服务的有效响应，请检查连接后重试。" });
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(null);
      }
    }
  }

  useEffect(() => {
    setApiKey("");
    setConfirmRemove(false);
    setStatus(null);
    void run("load");
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [token]);

  const busy = pending !== null;
  const newKey = Boolean(apiKey.trim());
  const enabled = status?.configured === true;
  const timestamp = status?.updatedAt ? Date.parse(status.updatedAt) : NaN;
  return <section aria-labelledby={inputId + "-title"} className="account-surface account-padding">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <KeyRound size={19} aria-hidden="true" className="text-emerald-800" />
        <h2 id={inputId + "-title"} className="account-heading">DeepSeek API 配置</h2>
      </div>
      <span role="status" className="account-key-status" data-enabled={enabled || undefined}>
        {pending === "load" ? "读取中…" : status === null ? "状态未知" : enabled?"平台已配置":"平台未配置"}
      </span>
    </div>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">平台统一提供个人和企业空间的 AI 解析。密钥加密保存在服务端。</p>
    {status && <form className="account-key-form" aria-busy={busy} onSubmit={event => { event.preventDefault(); if (newKey && !busy) void run("save"); }}>
      <div className="account-key-input">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={inputId} className="text-sm font-semibold text-neutral-800">API Key</label>
          <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer" className="account-action-link">
            获取 API Key <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
        <input id={inputId} type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" disabled={busy} aria-describedby={inputId + "-hint"}
          className="field-surface mt-2 w-full min-w-0 rounded-md px-3 py-2.5 text-sm outline-none"
          placeholder={enabled ? "输入新密钥以替换已保存的密钥" : "粘贴 DeepSeek API Key"} value={apiKey}
          onChange={event => { setApiKey(event.target.value); setFeedback(null); setConfirmRemove(false); }} />
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-1 text-xs leading-5 text-neutral-500">
          <span id={inputId + "-hint"}>密钥加密保存在货记服务端。</span>
          {enabled && Number.isFinite(timestamp) && <span>更新于 {new Date(timestamp).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}</span>}
        </div>
      </div>
      <div className="account-key-actions">
        <button type="submit" disabled={busy || !newKey} className="primary-button inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 py-2 text-sm">
          {pending === "save" && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}{pending === "save" ? "正在保存…" : "保存并启用"}
        </button>
        <button type="button" disabled={busy || (!newKey && !enabled)} onClick={() => { setConfirmRemove(false); void run("test"); }}
          className="surface-card-quiet ghost-button inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 py-2 text-sm disabled:opacity-45">
          {pending === "test" && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}{pending === "test" ? "正在测试…" : "测试连接"}
        </button>
        {enabled && !confirmRemove && <button type="button" disabled={busy} onClick={() => { setConfirmRemove(true); setFeedback(null); }}
          className="ghost-button min-h-9 rounded-md px-2 py-1.5 text-xs text-neutral-600 hover:text-red-700">移除密钥</button>}
      </div>
      {confirmRemove && <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm text-amber-950">移除后，所有空间将暂停使用平台 DeepSeek 服务。确认移除？</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy} className="min-h-9 rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white" onClick={() => void run("remove")}>{pending === "remove" ? "正在移除…" : "确认移除"}</button>
          <button type="button" disabled={busy} className="ghost-button min-h-9 rounded-md px-3 py-1.5 text-xs" onClick={() => setConfirmRemove(false)}>取消</button>
        </div>
      </div>}
    </form>}
    {feedback && <div role={feedback.error ? "alert" : "status"} className={`mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-sm ${feedback.error ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>
      {feedback.error ? <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> : <Check size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 break-words">{feedback.text}</span>
    </div>}
    {!status && !busy && <button type="button" className="surface-card-quiet ghost-button mt-3 rounded-md px-3 py-2 text-sm" onClick={() => void run("load")}>重新读取配置</button>}
  </section>;
}
