import { Fragment, useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Building2, ShieldCheck } from "lucide-react";
import type { AuthSession } from "../App";
import StaffRecords from "./StaffRecords";
import "./enterprise.css";

import { companyRequest, type Role, type Staff } from "./enterprise-client";
const names: Record<Role, string> = { OWNER: "企业主", ADMIN: "管理员", MEMBER: "员工" };
type Application = {
  id: string;
  name: string;
  credit: string;
  domain?: string;
  applicantPhone?: string;
  status: string;
  reason: string;
};
type Overview = {
  companies: { id: string; name: string; role: Role }[];
  applications: Application[];
  reviewQueue: Application[];
  offers: { id: string; name: string; role: Role }[];
  reviewer: boolean;
  members: Staff[];
  invitations: { id: string; target: string; role: Role }[];
};
const message = (error: unknown) => (error instanceof Error ? error.message : "请求失败，请重试。");

export function TokenUsage({ token }: { token: string }) {
  const [month, setMonth] = useState(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7));
  type Row = {
    employee: string;
    name: string;
    kind: string;
    input: number;
    output: number;
    total: number;
    hit: number;
    unknown: number;
    rejected: number;
    calls: number;
  };
  const [rows, setRows] = useState<Row[]>([]),
    [status, setStatus] = useState(""),
    [refresh, setRefresh] = useState(0);
  const [showCalls, setShowCalls] = useState(false);
  useEffect(() => {
    let active = true;
    setRows([]);
    setStatus("读取中…");
    companyRequest<{ rows: Row[] }>(token, "/usage?month=" + month)
      .then((data) => {
        if (active) {
          setRows(data.rows);
          setStatus("");
        }
      })
      .catch((e) => {
        if (active) setStatus(message(e));
      });
    return () => {
      active = false;
    };
  }, [token, month, refresh]);
  const sum = (field: "input" | "output" | "total" | "unknown") => rows.reduce((n, r) => n + r[field], 0);
  return (
    <section className="ent-card">
      <div className="ent-head">
        <h3>Token 用量</h3>
        <div className="ent-inline">
          <input
            aria-label="统计月份"
            type="month"
            value={month}
            onChange={(e) => {
              if (e.target.value) setMonth(e.target.value);
            }}
          />
          <button onClick={() => setRefresh((n) => n + 1)}>刷新</button>
        </div>
      </div>
      <div className="ent-metrics">
        {(
          [
            ["已确认总量", "total"],
            ["输入", "input"],
            ["输出", "output"],
          ] as const
        ).map(([label, key]) => (
          <div key={key}>
            <small>{label}</small>
            <strong>{sum(key).toLocaleString()}</strong>
          </div>
        ))}
      </div>
      {status ? (
        <p role="status">{status}</p>
      ) : rows.length ? (
        <div className="ent-scroll">
          <table>
            <thead>
              <tr>
                {["使用人", "来源", "输入", "输出", "缓存命中", "总量", "调用"].map((s) => (
                  <th key={s}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee + r.kind}>
                  <td>{r.name}</td>
                  <td>{r.kind === "CAPTURE" ? "微信采集" : "粘贴录入"}</td>
                  {[r.input, r.output, r.hit, r.total, r.calls].map((n, i) => (
                    <td key={i}>{n.toLocaleString()}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>本月暂无 AI 调用。</p>
      )}
      {!!sum("unknown") && <p role="status">{sum("unknown")} 次调用尚无服务商用量回执。</p>}
      {!!rows.length && (
        <button onClick={() => setShowCalls(!showCalls)} aria-expanded={showCalls}>
          {showCalls ? "收起调用明细" : "查看调用明细"}
        </button>
      )}
      {showCalls && !!rows.length && (
        <Fragment key={token + month + refresh}>
          <UsageCalls token={token} month={month} />
        </Fragment>
      )}
    </section>
  );
}
function UsageCalls({ token, month }: { token: string; month: string }) {
  type Detail = {
    id: string;
    created: string;
    model: string;
    name: string;
    kind: string;
    total: number | null;
    status: string;
  };
  const [page, setPage] = useState(1),
    [result, setResult] = useState<{ rows: Detail[]; more: boolean } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setResult(null);
    setError("");
    companyRequest<{ rows: Detail[]; more: boolean }>(token, "/usage?detail=1&month=" + month + "&page=" + page)
      .then((d) => {
        if (active) setResult(d);
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [page, month, token]);
  return (
    <>
      <div className="ent-list">
        {result?.rows.map((r) => (
          <div key={r.id}>
            <span>
              <strong>
                {r.name} · {r.kind === "CAPTURE" ? "微信采集" : "粘贴录入"}
              </strong>
              <small>
                {new Date(r.created).toLocaleString("zh-CN")} · {r.model}
              </small>
            </span>
            <span>
              {r.status === "REPORTED"
                ? r.total?.toLocaleString() + " Token"
                : r.status === "REJECTED"
                  ? "请求被拒绝"
                  : "待核对"}
            </span>
          </div>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {(page > 1 || result?.more) && (
        <div className="ent-inline">
          <button disabled={page === 1 || !result} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <small>第 {page} 页</small>
          <button disabled={!result?.more} onClick={() => setPage(page + 1)}>
            下一页
          </button>
        </div>
      )}
    </>
  );
}

function ReviewRow({
  item,
  token,
  onReview,
}: {
  item: Application;
  token: string;
  onReview: (approve: boolean, reason: string) => void;
}) {
  const [proof, setProof] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState("");
  useEffect(
    () => () => {
      if (proof) URL.revokeObjectURL(proof);
    },
    [proof],
  );
  async function view() {
    try {
      const res = await fetch("/api/enterprise/applications/" + item.id + "/evidence", {
        headers: { Authorization: "Bearer " + token },
      });
      if (!res.ok) throw Error("无法读取认证材料。");
      setProof(URL.createObjectURL(await res.blob()));
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="ent-review">
      <strong>{item.name}</strong>
      <small>
        {item.credit} · 申请人 {item.applicantPhone}
        {item.domain && " · " + item.domain}
      </small>
      <p>请核对主体登记信息、申请人的代表权限及所填邮箱域名。</p>
      <button onClick={() => void view()}>查看认证材料</button>
      {proof && (
        <a href={proof} target="_blank" rel="noreferrer">
          <img alt="企业提交的认证材料" src={proof} />
        </a>
      )}
      <input
        aria-label="审核意见"
        placeholder="审核意见（驳回时必填）"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="ent-inline">
        <button disabled={!proof} onClick={() => onReview(true, reason)}>
          审核通过
        </button>
        <button disabled={!reason.trim()} onClick={() => onReview(false, reason)}>
          驳回
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export default function EnterpriseHome({
  session,
  onSwitch,
}: {
  session: AuthSession;
  onSwitch: (session: AuthSession) => void;
}) {
  const token = session.token,
    id = session.currentWorkspaceId;
  const [data, setData] = useState<Overview | null>(null),
    [rev, setRev] = useState(0),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(window.location.hash === "#account/enterprise/usage" ? "AI 用量" : "成员"),
    [channel, setChannel] = useState("phone"),
    [showApplication, setShowApplication] = useState(false);
  useEffect(() => {
    let live = true;
    companyRequest<Overview>(token, "")
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setNote(message(e));
      });
    return () => {
      live = false;
    };
  }, [token, rev, tab]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setRev(value => value + 1); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 20000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const current = data?.companies.find((w) => w.id === id),
    personal = session.workspaces.find((w) => w.type === "PERSONAL");
  const owner = current?.role === "OWNER",
    manager = owner || current?.role === "ADMIN";
  async function act(fn: () => Promise<unknown>, success = "") {
    if (busy) return;
    setBusy(true);
    setNote("");
    try {
      await fn();
      setNote(success);
      setRev((n) => n + 1);
    } catch (e) {
      setNote(message(e));
    } finally {
      setBusy(false);
    }
  }
  const request = (route: string, body: unknown, method = "POST") => companyRequest(token, route, method, body);
  const switchTo = (workspaceId: string) =>
    act(async () => onSwitch(await companyRequest<AuthSession>(token, "/switch", "POST", { workspaceId })));
  function submitApplication(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      fields = new FormData(form),
      file = fields.get("file") as File;
    void act(async () => {
      if (!file.size || file.size > 3 * 1024 * 1024) throw Error("请选择 3 MB 以内的营业执照图片。");
      const evidence = await new Promise<string>((ok, fail) => {
        const reader = new FileReader();
        reader.onload = () => ok(String(reader.result));
        reader.onerror = () => fail(Error("读取文件失败。"));
        reader.readAsDataURL(file);
      });
      await request("/applications", {
        name: fields.get("name"),
        credit: fields.get("credit"),
        domain: fields.get("domain"),
        evidence,
      });
      form.reset();
      setShowApplication(false);
    }, "申请已提交，等待平台审核。");
  }
  function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      fields = new FormData(form);
    void act(
      async () => {
        await request("/invites", { channel, target: fields.get("target"), role: fields.get("role") });
        form.reset();
      },
      channel === "email" ? "邀请已发到企业邮箱。" : "邀请已发出，对方使用该手机号登录后可接受。",
    );
  }
  return (
    <div className="enterprise-home" aria-label="企业工作台">
      <section className="ent-card">
        <div className="ent-head">
          <div className="ent-title">
            <Building2 size={23} />
            <div>
              <h2>{current?.name || "工作空间"}</h2>
              <small>{current ? "企业已认证 · " + names[current.role] : "当前使用个人版"}</small>
            </div>
          </div>
          {current && personal && (
            <button disabled={busy} onClick={() => void switchTo(personal.id)}>
              切换到个人版
            </button>
          )}
        </div>
        {!!data?.companies.filter((c) => c.id !== id).length && (
          <div className="ent-list">
            {data.companies
              .filter((c) => c.id !== id)
              .map((c) => (
                <div key={c.id}>
                  <span>
                    <strong>{c.name}</strong>
                    <small>{names[c.role]}</small>
                  </span>
                  <button disabled={busy} onClick={() => void switchTo(c.id)}>
                    进入企业 <ArrowRight size={14} />
                  </button>
                </div>
              ))}
          </div>
        )}
      </section>
      {note && (
        <p className="ent-notice" role="status">
          {note}
        </p>
      )}
      {!data ? (
        <button onClick={() => setRev((n) => n + 1)}>重新读取工作空间</button>
      ) : (
        <>
          {!current && (
            <>
              <section className="ent-card">
                <div className="ent-head">
                  <div>
                    <h3>开通企业版</h3>
                    <p>提交营业执照，通过平台审核后即可邀请成员、管理业务资料和企业 AI 用量。</p>
                  </div>
                  <button className="ent-primary" onClick={() => setShowApplication(!showApplication)}>
                    {showApplication ? "收起" : "申请认证"}
                  </button>
                </div>
                {showApplication && (
                  <form className="ent-form" onSubmit={submitApplication}>
                    <label>
                      企业全称
                      <input required name="name" maxLength={100} placeholder="与营业执照一致" />
                    </label>
                    <label>
                      统一社会信用代码
                      <input required name="credit" minLength={18} maxLength={18} />
                    </label>
                    <label>
                      企业邮箱域名（选填）
                      <input name="domain" placeholder="company.cn" />
                      <small>填写后仅允许邀请该域名下的邮箱。</small>
                    </label>
                    <label>
                      企业认证材料
                      <input required type="file" name="file" accept="image/png,image/jpeg" />
                      <small>营业执照及申请人代表企业的授权证明可合并为一张图片，JPG 或 PNG，最大 3 MB</small>
                    </label>
                    <button className="ent-primary" disabled={busy}>
                      提交审核
                    </button>
                  </form>
                )}
                <div className="ent-list">
                  {data.applications.map((a) => (
                    <div key={a.id}>
                      <span>
                        <strong>{a.name}</strong>
                        <small>{a.reason}</small>
                      </span>
                      <span>{{ APPROVED: "已认证", PENDING: "审核中", REJECTED: "已驳回" }[a.status]}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="ent-card">
                <h3>加入受邀企业</h3>
                {data.offers.map((v) => (
                  <div className="ent-line" key={v.id}>
                    <span>
                      {v.name} · {names[v.role]}
                    </span>
                    <button
                      disabled={busy}
                      onClick={() => void act(() => request("/join", { id: v.id }), "已加入企业，可在上方进入。")}
                    >
                      接受邀请
                    </button>
                  </div>
                ))}
                <form
                  className="ent-inline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget,
                      code = new FormData(form).get("code");
                    void act(async () => {
                      await request("/join", { code });
                      form.reset();
                    }, "已加入企业，可在上方进入。");
                  }}
                >
                  <label>
                    邮箱邀请码
                    <input name="code" required placeholder="输入企业邀请邮件中的邀请码" autoComplete="off" />
                  </label>
                  <button disabled={busy}>加入企业</button>
                </form>
              </section>
              {data.reviewer && (
                <section className="ent-card">
                  <h3>
                    <ShieldCheck size={18} /> 平台认证审核
                  </h3>
                  {data.reviewQueue.length ? (
                    data.reviewQueue.map((item) => (
                      <Fragment key={item.id}>
                        <ReviewRow
                          item={item}
                          token={token}
                          onReview={(approve, reason) =>
                            void act(
                              () => request("/applications/" + item.id + "/review", { approve, reason }),
                              "审核结论已保存。",
                            )
                          }
                        />
                      </Fragment>
                    ))
                  ) : (
                    <p>暂无待审核申请。</p>
                  )}
                </section>
              )}
            </>
          )}
          {current && (
            <>
              <nav className="ent-tabs" aria-label="企业管理">
                {(manager ? ["成员", "员工资料", "AI 用量"] : ["AI 用量"]).map((t) => (
                  <button
                    key={t}
                    aria-current={(manager ? tab : "AI 用量") === t ? "page" : undefined}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </nav>
              {manager && tab === "成员" && (
                <>
                  {owner && (
                    <section className="ent-card">
                      <h3>邀请成员</h3>
                      <form className="ent-invite" onSubmit={invite}>
                        <label>
                          授权方式
                          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                            <option value="phone">手机号</option>
                            <option value="email">企业邮箱</option>
                          </select>
                        </label>
                        <label>
                          {channel === "email" ? "企业邮箱" : "手机号"}
                          <input
                            key={channel}
                            name="target"
                            required
                            type={channel === "email" ? "email" : "tel"}
                            placeholder={channel === "email" ? "name@company.cn" : "11 位手机号"}
                          />
                        </label>
                        <label>
                          角色
                          <select name="role">
                            <option value="MEMBER">员工</option>
                            <option value="ADMIN">管理员</option>
                          </select>
                        </label>
                        <button className="ent-primary" disabled={busy}>
                          发送邀请
                        </button>
                      </form>
                      {!!data.invitations.length && (
                        <div className="ent-list">
                          {data.invitations.map((v) => (
                            <div key={v.id}>
                              <span>
                                {v.target}
                                <small>{names[v.role]} · 待接受</small>
                              </span>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void act(() => companyRequest(token, "/invites/" + v.id, "DELETE"), "邀请已撤回。")
                                }
                              >
                                撤回邀请
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                  <section className="ent-card">
                    <h3>企业成员</h3>
                    <div className="ent-list">
                      {data.members.map((m) => (
                        <div key={m.userId}>
                          <span>
                            <strong>{m.name}</strong>
                            <small>
                              {names[m.role]}
                              {!m.active && " · 已停用"}
                            </small>
                          </span>
                          {owner && m.role !== "OWNER" && !!m.active && (
                            <div className="ent-inline">
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void act(
                                    () =>
                                      request(
                                        "/members/" + m.userId,
                                        { role: m.role === "ADMIN" ? "MEMBER" : "ADMIN" },
                                        "PATCH",
                                      ),
                                    "角色已更新。",
                                  )
                                }
                              >
                                {m.role === "ADMIN" ? "改为员工" : "设为管理员"}
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => {
                                  if (window.confirm("停用该成员的企业访问权限？"))
                                    void act(
                                      () => request("/members/" + m.userId, { role: "DISABLED" }, "PATCH"),
                                      "企业访问权限已停用。",
                                    );
                                }}
                              >
                                停用
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
              {manager && tab === "员工资料" && (
                <StaffRecords token={token} members={data.members.filter((m) => owner || m.role === "MEMBER")} />
              )}
              {(!manager || tab === "AI 用量") && (
                <>
                  <TokenUsage token={token} />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
