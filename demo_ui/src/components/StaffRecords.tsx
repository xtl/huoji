import { Fragment, useEffect, useState } from "react";
import { companyRequest, type Staff } from "./enterprise-client";
import type { LedgerTable } from "../workspace-ledger";
import { sortTradesByTime } from "../trade-chronology";
type View = LedgerTable | "capture" | "posts";
type Row = {
  id: string;
  title?: string;
  text?: string;
  status?: string;
  active?: boolean;
  quantity?: string | number;
  createdAt?: string;
  publishedAt?: string;
  sourceSentAt?: string;
  sentAt?: string;
  chatName?: string;
};
const labels: Record<View, string> = {
  capture: "采集消息",
  drafts: "待入库",
  stocks: "供应",
  market: "需求",
  posts: "广场发布",
};
export default function StaffRecords({ members, token }: { members: Staff[]; token: string }) {
  const [member, setMember] = useState(members[0]?.userId || ""),
    [view, setView] = useState<View>("capture"),
    [page, setPage] = useState(1);
  // Changing employee or category remounts the list and discards in-flight UI results.
  return (
    <section className="ent-card">
      <div className="ent-head">
        <h3>员工资料</h3>
        {!!members.length && (
          <label>
            成员
            <select
              aria-label="成员"
              value={member}
              onChange={(e) => {
                setMember(e.target.value);
                setPage(1);
              }}
            >
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                  {!m.active && "（已停用）"}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {member ? (
        <>
          <nav className="ent-tabs" aria-label="员工资料分类">
            {Object.entries(labels).map(([k, label]) => (
              <button
                key={k}
                aria-current={view === k ? "page" : undefined}
                onClick={() => {
                  setView(k as View);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <Fragment key={[member, view].join(":")}>
            <List token={token} member={member} view={view} page={page} setPage={setPage} />
          </Fragment>
        </>
      ) : (
        <p>还没有可管理的员工。</p>
      )}
    </section>
  );
}
const stamp = (r: Row) => r.sourceSentAt || r.sentAt || r.publishedAt || r.createdAt || "";
function List({
  token,
  member,
  view,
  page,
  setPage,
}: {
  token: string;
  member: string;
  view: View;
  page: number;
  setPage: (n: number) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [more, setMore] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [rev, setRev] = useState(0);
  const prefix = "/staff/" + encodeURIComponent(member);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setRows([]);
    setMore(false);
    setError("");
    async function load() {
      let list: Row[], next: boolean;
      if (view === "capture") {
        const d = await companyRequest<{ items: Row[]; total: number }>(
          token,
          prefix + "/capture/messages?page=" + page + "&pageSize=20",
        );
        list = d.items;
        next = page * 20 < d.total;
      } else if (view === "posts") {
        const d = await companyRequest<{ items: Row[]; more: boolean }>(
          token,
          prefix + "/circle/posts?mine=1&offset=" + (page - 1) * 30,
        );
        list = d.items;
        next = d.more;
      } else {
        const d = await companyRequest<{ snapshot: Record<LedgerTable, Row[]> }>(token, prefix + "/ledger");
        const all = sortTradesByTime(d.snapshot[view]);
        list = all.slice((page - 1) * 20, page * 20);
        next = page * 20 < all.length;
      }
      if (live) {
        if (!list.length && page > 1) {
          setPage(page - 1);
          return;
        }
        setRows(list);
        setMore(next);
      }
    }
    load()
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [token, prefix, page, view, rev]);
  async function action(row: Row, cmd: string) {
    if (busy) return;
    if (
      ["remove", "close", "dismiss"].includes(cmd) &&
      !window.confirm("确认" + { remove: "移除这条资料", close: "结束这条发布", dismiss: "忽略这条消息" }[cmd] + "？")
    )
      return;
    const title = cmd === "edit" ? window.prompt("修改产品名称", row.title) : undefined;
    if (cmd === "edit" && !title?.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (view === "capture")
        await companyRequest(token, prefix + "/capture/messages/" + encodeURIComponent(row.id) + "/" + cmd, "POST");
      else if (view === "posts")
        await companyRequest(token, prefix + "/circle/posts/" + encodeURIComponent(row.id), "PATCH", { action: cmd });
      else
        await companyRequest(token, prefix + "/ledger", "POST", {
          operations: [
            {
              id: crypto.randomUUID(),
              seed: false,
              keys: [],
              changes: [
                {
                  table: view,
                  id: row.id,
                  action: cmd,
                  ...(cmd === "edit" ? { fields: { title: title!.trim() }, unset: [] } : {}),
                },
              ],
            },
          ],
        });
      setRev((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败。");
      setBusy(false);
    }
  }
  return (
    <>
      {error && (
        <p role="alert">
          {error} <button onClick={() => setRev((n) => n + 1)}>重试</button>
        </p>
      )}
      {!error && !rows.length && <p>{busy ? "正在读取…" : "该成员暂无" + labels[view] + "。"}</p>}
      <div className="ent-list">
        {rows.map((r) => (
          <div key={r.id}>
            <span>
              <strong>{r.title || r.text || "采集消息"}</strong>
              <small>
                {[stamp(r) && new Date(stamp(r)).toLocaleString("zh-CN"), r.chatName].filter(Boolean).join(" · ")}
              </small>
            </span>
            <div className="ent-inline">
              {view === "posts" ? (
                r.active ? (
                  <>
                    <button disabled={busy} onClick={() => void action(r, "confirm")}>
                      确认有效
                    </button>
                    <button disabled={busy} onClick={() => void action(r, "close")}>
                      结束发布
                    </button>
                  </>
                ) : (
                  <small>已结束</small>
                )
              ) : view === "capture" ? (
                <>
                  {["FAILED", "DISMISSED"].includes(r.status || "") && (
                    <button disabled={busy} onClick={() => void action(r, "retry")}>
                      重新解析
                    </button>
                  )}
                  {r.status !== "DISMISSED" && (
                    <button disabled={busy} onClick={() => void action(r, "dismiss")}>
                      忽略
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button disabled={busy} onClick={() => void action(r, "edit")}>
                    修改名称
                  </button>
                  <button disabled={busy} onClick={() => void action(r, "remove")}>
                    移除
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {(page > 1 || more) && (
        <div className="ent-inline">
          <button disabled={busy || page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <small>第 {page} 页</small>
          <button disabled={busy || !more} onClick={() => setPage(page + 1)}>
            下一页
          </button>
        </div>
      )}
    </>
  );
}
