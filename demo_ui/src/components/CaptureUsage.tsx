import { useEffect, useState } from "react";
import { companyRequest } from "./enterprise-client";

type Usage = { total: number; unknown: number };

export default function CaptureUsage({
  token,
  destination,
  enterprise,
  refresh,
}: {
  token: string;
  destination: string;
  enterprise: boolean;
  refresh: number;
}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true,
      busy = false;
    async function read() {
      if (document.hidden || busy) return;
      busy = true;
      try {
        const data = await companyRequest<{ rows: Usage[] }>(token, "/usage?mine=1&kind=CAPTURE");
        if (active) {
          setUsage(
            data.rows.reduce((sum, row) => ({ total: sum.total + row.total, unknown: sum.unknown + row.unknown }), {
              total: 0,
              unknown: 0,
            }),
          );
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        busy = false;
      }
    }
    void read();
    const timer = setInterval(read, 15000);
    document.addEventListener("visibilitychange", read);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, [token, refresh]);
  return (
    <div className="capture-usage">
      <span>
        采集到 <strong>{destination}</strong>
      </span>
      <a
        href={enterprise ? "#account/enterprise/usage" : "#settings/deepseek"}
        title="查看空间用量，采集按 AI 实际回执统计"
      >
        本月本人采集{" "}
        <b>{failed ? "用量暂不可用" : usage ? usage.total.toLocaleString("zh-CN") + " Token" : "读取中…"}</b>
        {!!usage?.unknown && !failed && <span> · {usage.unknown} 次待回执</span>}
      </a>
    </div>
  );
}
