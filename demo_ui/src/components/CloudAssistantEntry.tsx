import { useEffect, useState } from "react";
import { ArrowUpRight, Download, MonitorDown, RefreshCw } from "lucide-react";

const assistantOrigin = "http://127.0.0.1:5197";
const historyUrl = assistantOrigin + "/#input/wechat/history";
const installerUrl = "/downloads/Huoji-Capture-Cloud-x64-Setup.exe";

export default function CloudAssistantEntry({ inline = false }: { inline?: boolean }) {
  const windows = /Windows NT/i.test(navigator.userAgent) && !/Mobile/i.test(navigator.userAgent);
  const [status, setStatus] = useState<"idle" | "checking" | "ready" | "unavailable">("idle");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!windows || !attempt) return;
    let active = true;
    let pending: AbortController | undefined;
    async function check() {
      if (document.hidden || pending) return;
      const controller = new AbortController();
      pending = controller;
      const timeout = window.setTimeout(() => controller.abort(), 6000);
      try {
        const options = {
          method: "GET", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer",
          redirect: "error", cache: "no-store", signal: controller.signal, targetAddressSpace: "loopback",
        } as const;
        const response = await fetch(assistantOrigin + "/api/assistant/presence", options);
        const data = response.ok ? await response.json() : null;
        if (active) setStatus(data?.assistant === "huoji-cloud" && data.protocol === 1 ? "ready" : "unavailable");
      } catch {
        if (active) setStatus("unavailable");
      } finally {
        clearTimeout(timeout);
        pending = undefined;
      }
    }
    void check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false;
      pending?.abort();
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [windows, attempt]);

  const ready = status === "ready";
  const checking = status === "checking";
  const unavailable = status === "unavailable";

  return <section className={inline ? "assistant-entry assistant-entry-inline" : "assistant-entry"} aria-label="货记采集助手">
    <div className="assistant-entry-heading">
      <MonitorDown size={21} aria-hidden="true" />
      <div>
        <h3>货记采集助手</h3>
        <p>{!windows
          ? "在登录了微信的 Windows 电脑上打开货记，下载安装助手。采集结果可在这里查看。"
          : ready
            ? "打开助手，用同一手机号登录，选择工作空间、微信群和时间范围。"
            : "第一次用？下载安装后打开助手，再点「检测连接」。"}</p>
      </div>
    </div>
    {windows && <>
      <div className="capture-tools">
        {ready
          ? <a href={historyUrl} target="_blank" rel="noopener noreferrer" className="capture-primary">开始采集<ArrowUpRight size={15} aria-hidden="true" /></a>
          : <a href={installerUrl} download className="capture-primary"><Download size={15} aria-hidden="true" />下载 Windows 助手</a>}
        {!ready && <a href="huoji-capture://open" className="capture-action">启动已安装助手</a>}
        <button type="button" className="capture-tool" disabled={checking} onClick={() => {
          setStatus("checking");
          setAttempt(n => n + 1);
        }}>
          <RefreshCw size={14} aria-hidden="true" />{checking ? "正在检测…" : attempt ? "重新检测" : "检测连接"}
        </button>
      </div>
      <p role="status" className="assistant-entry-status" data-status={status}>
        {checking ? "若浏览器询问是否允许访问本地网络，请选择允许。" : ready ? "已检测到本机助手" : unavailable ? "未检测到助手。请确认助手已启动，并允许浏览器访问本地网络。" : ""}
      </p>
      {unavailable && <p className="assistant-entry-help">
        也可以从 Windows 开始菜单打开「货记采集助手（云同步版）」，或<a href={historyUrl} target="_blank" rel="noopener noreferrer">手动打开采集页</a>。
      </p>}
    </>}
  </section>;
}
