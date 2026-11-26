import { useEffect, useRef, useState } from "react";
import DeepSeekSettings from "./DeepSeekSettings";
import "./platform-console.css";

type Row = {
  id: string;
  name: string;
  input: number;
  output: number;
  total: number;
  unknown: number;
  rejected: number;
  calls: number;
  modelCost: number;
  chargedCredits: number;
  ceiling: number | null;
  kind?: string;
  membership?: string;
  expiry?: string;
  companies?: {name: string; status: string}[];
};
type Report = { items: Row[]; count: number; total: number };
const fmt = (n: number) => n.toLocaleString("zh-CN");
const key = "huoji_platform_session";
export default function PlatformConsole() {
  const [token, setToken] = useState(() => sessionStorage.getItem(key) || "");
  const [phone, setPhone] = useState(""),
    [password, setPassword] = useState(""),
    [setup, setSetup] = useState(false),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [tab, setTab] = useState<"usage" | "key">("usage");
  const [by, setBy] = useState<"account" | "company">("account"),
    [month, setMonth] = useState(new Date(Date.now() + 28800000).toISOString().slice(0, 7));
  const [q, search] = useState(""),
    [page, setPage] = useState(1),
    [version, refresh] = useState(0),
    [report, setReport] = useState<Report | null>(null);
  const [selected, select] = useState<Row | null>(null),
    [limit, setLimit] = useState(""),
    [details, setDetails] = useState<Row[] | null>(null);
  const [points, setPoints] = useState("");
  const [grantMessage, setGrantMessage] = useState("");
  const pendingGrants = useRef(new Map<string, string>());
  function grant(kind: "membership" | "credits") {
    if (!selected || busy) return;
    const amount = kind === "credits" ? Number(points) : 0;
    const description = kind === "membership" ? "增加 7 天个人 Pro 会员" : "发放 " + fmt(amount) + " 货记分";
    if (!window.confirm("确认给 " + selected.name + " 的个人空间" + description + "？")) return;
    void action(async () => {
      const intent = JSON.stringify([selected.id, kind, amount]);
      const requestId = pendingGrants.current.get(intent) ?? crypto.randomUUID();
      pendingGrants.current.set(intent, requestId);
      await api("accounts/" + encodeURIComponent(selected.id) + "/grants", "POST", {kind, points: amount, requestId});
      pendingGrants.current.delete(intent);
      setGrantMessage("已为 " + selected.name + description + "。");
      setPoints("");
      select(null);
      refresh(v => v + 1);
    });
  }
  function leave() {
    sessionStorage.removeItem(key);
    setToken("");
    select(null);
    setReport(null);
    setGrantMessage("");
    pendingGrants.current.clear();
  }
  async function api<T>(route: string, method = "GET", body?: unknown, signal?: AbortSignal, bearer = token): Promise<T> {
    const response = await fetch("/api/platform/" + route, {
      method,
      signal,
      redirect: "error",
      cache: "no-store",
      headers: { Authorization: "Bearer " + bearer, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      if (response.status === 401 && token) leave();
      throw Error(data?.error || "后台请求未完成。");
    }
    return data;
  }
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!token || tab !== "usage") return;
    const c = new AbortController();
    setReport(null);
    setNotice("");
    const timer = setTimeout(
      () =>
        void api<Report>(
          "usage?" + new URLSearchParams({ by, month, q, page: String(page) }),
          "GET",
          undefined,
          c.signal,
        )
          .then((data) => {
            if (!c.signal.aborted) setReport(data);
          })
          .catch((e) => {
            if (!c.signal.aborted) setNotice(e.message);
          }),
      100,
    );
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [token, tab, by, month, q, page, version]);
  useEffect(() => {
    if (!selected) return;
    const c = new AbortController();
    setDetails(null);
    setLimit(selected.ceiling === null ? "" : String(selected.ceiling));
    void api<{ items: Row[] }>(
      "breakdown?" + new URLSearchParams({ by, id: selected.id, month }),
      "GET",
      undefined,
      c.signal,
    )
      .then((d) => {
        if (!c.signal.aborted) setDetails(d.items);
      })
      .catch((e) => {
        if (!c.signal.aborted) setNotice(e.message);
      });
    return () => c.abort();
  }, [selected, by, month]);
  const isSecure =
    location.protocol === "https:" || ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
  return (
    <main className="platform-ai">
      <header>
        <strong>
          货记 <span>平台管理</span>
        </strong>
        {token && (
          <button
            onClick={() =>
              void action(async () => {
                await api("auth/logout", "POST", {});
                leave();
              })
            }
          >
            退出后台
          </button>
        )}
      </header>
      {!token ? (
        <form
          className="platform-login"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              if (setup) {
                const session = JSON.parse(localStorage.getItem("huoji_auth_session") || "null");
                await api("auth/setup", "POST", { phone, password }, undefined, session?.token || "");
                setSetup(false);
              }
              const s = await api<{ token: string }>("auth/login", "POST", { phone, password });
              sessionStorage.setItem(key, s.token);
              setToken(s.token);
              setPassword("");
            });
          }}
        >
          <h1>平台管理员登录</h1>
          <label>
            管理员手机号
            <input
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setPassword("");
              }}
              autoComplete="tel"
            />
          </label>
          <label>
            {setup ? "设置新密码（12 至 128 个字符）" : "后台密码"}
            <input type="password" required minLength={12} maxLength={128} value={password}
              onChange={e => setPassword(e.target.value)} autoComplete={setup ? "new-password" : "current-password"} />
          </label>
          {setup && <p>请先在同一浏览器<a href="/" target="_blank" rel="noreferrer">登录货记账号</a>，再返回此页设置后台密码。</p>}
          <div>
            <button type="button" disabled={busy} onClick={() => { setSetup(!setup); setPassword(""); setNotice(""); }}>
              {setup ? "返回登录" : "首次设置密码"}
            </button>
            <button className="primary" disabled={busy || !password || !isSecure}>
              {setup ? "设置并登录" : "登录后台"}
            </button>
          </div>
          {!isSecure && <p>请通过 HTTPS 打开平台后台。</p>}
        </form>
      ) : (
        <>
          <nav aria-label="平台管理">
            <button aria-pressed={tab === "usage"} onClick={() => setTab("usage")}>
              Token 用量
            </button>
            <button aria-pressed={tab === "key"} onClick={() => setTab("key")}>
              平台密钥
            </button>
          </nav>
          {tab === "key" ? (
            <DeepSeekSettings token={token} />
          ) : (
            <section>
              <div className="platform-filters">
                <div>
                  <button
                    aria-pressed={by === "account"}
                    onClick={() => {
                      select(null);
                      setBy("account");
                      setPage(1);
                    }}
                  >
                    按账号
                  </button>
                  <button
                    aria-pressed={by === "company"}
                    onClick={() => {
                      select(null);
                      setBy("company");
                      setPage(1);
                    }}
                  >
                    按企业
                  </button>
                </div>
                <input
                  aria-label="统计月份"
                  type="month"
                  value={month}
                  onChange={(e) => {
                    if (e.target.value) {
                      select(null);
                      setMonth(e.target.value);
                      setPage(1);
                    }
                  }}
                />
                <input
                  aria-label={by === "account" ? "搜索手机号" : "搜索企业名称"}
                  placeholder={by === "account" ? "搜索手机号" : "搜索企业名称"}
                  value={q}
                  onChange={(e) => {
                    select(null);
                    search(e.target.value);
                    setPage(1);
                  }}
                />
                <button onClick={() => refresh((v) => v + 1)}>刷新</button>
              </div>
              <p>
                {by === "account" ? "按使用人合计个人和企业空间的调用。" : "按企业空间合计旗下成员的调用。"}
                仅统计平台密钥产生的用量。
              </p>
              <h2>
                {report ? fmt(report.total) : "…"} <small>已回执 Token</small>
              </h2>
              <div className="platform-table">
                <table>
                  <thead>
                    <tr>
                      {[
                        by === "account" ? "账号手机号" : "企业",
                        ...(by === "account" ? ["个人会员", "企业认证"] : []),
                        "输入",
                        "输出",
                        "总 Token",
                        "已核算模型费用（元）",
                        "实扣货记分",
                        "调用",
                        "待核对",
                        "月限额",
                        "",
                      ].map((s) => (
                        <th key={s}>{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report?.items.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        {by === "account" && <>
                          <td>{row.membership}{row.expiry && <div>{new Date(row.expiry).toLocaleString("zh-CN")} 到期</div>}</td>
                          <td>{row.companies?.length ? row.companies.map((c, i) => <div key={i}>{c.name} · {({APPROVED:"已认证", PENDING:"审核中", REJECTED:"已驳回"} as Record<string,string>)[c.status] ?? c.status}</div>) : "未认证"}</td>
                        </>}
                        <td>{fmt(row.input)}</td>
                        <td>{fmt(row.output)}</td>
                        <td>
                          <b>{fmt(row.total)}</b>
                        </td>
                        <td>{row.modelCost.toLocaleString("zh-CN",{maximumFractionDigits:8})}</td>
                        <td>{row.chargedCredits.toLocaleString("zh-CN",{maximumFractionDigits:7})}</td>
                        <td>{row.calls}</td>
                        <td>{row.unknown}</td>
                        <td>{row.ceiling === null ? "不限" : fmt(row.ceiling)}</td>
                        <td>
                          <button disabled={busy} onClick={() => { select(row); setPoints(""); setGrantMessage(""); }}>管理</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report && !report.items.length && <p>暂无符合条件的{by === "account" ? "账号" : "企业"}。</p>}
              {report && report.count > 40 && (
                <div>
                  <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    上一页
                  </button>{" "}
                  {page} / {Math.ceil(report.count / 40)}{" "}
                  <button disabled={page * 40 >= report.count} onClick={() => setPage((p) => p + 1)}>
                    下一页
                  </button>
                </div>
              )}
              {grantMessage && <p role="status">{grantMessage}</p>}
              {selected && (
                <section className="platform-detail">
                  <div className="platform-filters">
                    <h3>{selected.name}</h3>
                    <button onClick={() => select(null)}>关闭</button>
                  </div>
                  {by === "account" && <div>
                    <h4>个人空间权益</h4>
                    <p>已有会员的账号从现有到期时间顺延 7 天。</p>
                    <button disabled={busy} onClick={() => grant("membership")}>开通 7 天会员</button>
                    <label>发放货记分数量<input type="number" min="1" step="1" value={points} onChange={e => setPoints(e.target.value)} /></label>
                    <button disabled={busy || !/^\d+$/.test(points) || Number(points) <= 0 || !Number.isSafeInteger(Number(points) * 10_000_000)} onClick={() => grant("credits")}>发放货记分</button>
                  </div>}
                  <p>
                    {by === "account" ? "各空间用量" : "企业成员用量"} · {month}
                  </p>
                  {details === null ? (
                    <p>读取中…</p>
                  ) : details.length ? (
                    details.map((r) => (
                      <p key={r.id + r.kind}>
                        {r.name} · {r.kind === "CAPTURE" ? "微信采集" : "粘贴录入"}　{fmt(r.total)} Token ·{" "}
                        {r.calls} 次
                      </p>
                    ))
                  ) : (
                    <p>本月尚无平台 AI 调用。</p>
                  )}
                  <label>
                    每月 Token 限额
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="不限"
                      value={limit}
                      onChange={(e) => setLimit(e.target.value)}
                    />
                  </label>
                  <p>留空表示不限，0 表示暂停。已回执用量达到限额后暂停新调用，执行中的调用继续结算。</p>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        if (limit !== "" && (!/^\d+$/.test(limit) || !Number.isSafeInteger(Number(limit))))
                          throw Error("请输入非负整数。");
                        await api("limits", "PUT", {
                          dimension: by,
                          id: selected.id,
                          ceiling: limit === "" ? null : Number(limit),
                        });
                        select(null);
                        refresh((v) => v + 1);
                      })
                    }
                  >
                    保存限额
                  </button>
                </section>
              )}
            </section>
          )}
        </>
      )}
      {notice && (
        <p role="status" className="platform-notice">
          {notice}
        </p>
      )}
    </main>
  );
}
