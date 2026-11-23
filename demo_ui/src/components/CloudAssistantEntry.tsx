import { useEffect, useState } from "react";
import { ArrowUpRight, Download, RefreshCw } from "lucide-react";

const assistantOrigin = "http://127.0.0.1:5197";
const historyUrl = assistantOrigin + "/#input/wechat/history";
const installerUrl = "/downloads/Huoji-Capture-Cloud-x64-Setup.exe";

export default function CloudAssistantEntry() {
  const windows = /Windows/i.test(navigator.userAgent);
  const [status, setStatus] = useState<"checking" | "ready" | "unavailable">("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!windows) return;
    let active = true;
    let pending: AbortController | undefined;
    async function check() {
      if (document.hidden || pending) return;
      const controller = new AbortController();
      pending = controller;
      setStatus("checking");
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

  if (!windows) return <div className="assistant-entry">
    <strong>请在微信所在的 Windows 电脑上补采</strong>
    <p>用电脑打开货记，点击「补采历史」即可检测助手。采集完成后，可在这里查看消息。</p>
  </div>;

  return <div className="assistant-entry">
    <strong role="status">{status === "checking" ? "正在检测本机采集助手…" : status === "ready" ? "采集助手已就绪" : "未连接到采集助手"}</strong>
    {status === "ready" ? <>
      <p>在助手中选择微信群和时间范围，结果会同步到同一账号和空间。</p>
      <a href={historyUrl} target="_blank" rel="noopener noreferrer" className="capture-primary">进入历史补采<ArrowUpRight size={15} /></a>
    </> : status === "checking" ? <p>浏览器询问本地网络访问权限时，请选择允许。</p> : <>
      <p>首次使用请下载安装。已安装的用户可直接启动助手。</p>
      <div className="capture-tools">
        <a href={installerUrl} download className="capture-primary"><Download size={15} />下载 Windows 助手</a>
        <a href="huoji-capture://open" className="capture-action">启动已安装助手</a>
      </div>
      <div className="capture-tools">
        <button type="button" className="capture-tool" onClick={() => setAttempt(n => n + 1)}><RefreshCw size={14} />重新检测</button>
        <a href={historyUrl} target="_blank" rel="noopener noreferrer" className="capture-tool">手动打开采集页<ArrowUpRight size={14} /></a>
      </div>
      <p className="caption-text">使用旧版助手或浏览器未允许检测时，可从 Windows 开始菜单打开「货记采集助手（云同步版）」。</p>
    </>}
  </div>;
}
