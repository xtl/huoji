import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileText, Send } from "lucide-react";
import type { CircleMessage, CirclePost, CircleSource, CircleThread, QuoteTerms } from "../circle-types";
import { listingKindLabel, matchingCircleSources } from "../circle-types";
import { circleApi, localDate, postCircle, useCircleData } from "./circle-client";
import { CircleDrawer } from "./CircleForms";
export type ChatTarget = { threadId?: string; post?: CirclePost; direct?: boolean; peerName: string };
type History = { thread: CircleThread; items: CircleMessage[]; more: boolean };
const dateAfter = (days: number) =>
  new Date(Date.now() + days * 86400000 + 8 * 3600000).toISOString().slice(0, 10);
export function CircleChat({
  token,
  actor,
  version,
  target,
  sources,
  onClose,
  onSaved,
}: {
  token: string;
  actor: string;
  version: string;
  target: ChatTarget;
  sources: CircleSource[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [id, setId] = useState(target.threadId ?? "");
  const remote = useCircleData<History>(token, id ? "/threads/" + id : "", version);
  const history = remote.data,
    thread = history?.thread,
    postId = thread?.postId || target.post?.id;
  const detail = useCircleData<{ post: CirclePost }>(
    token,
    !target.direct && postId && !target.post ? "/posts/" + postId : "",
    version,
  );
  const post = detail.data?.post ?? target.post,
    direct = target.direct || thread?.postId === "";
  const canQuote = post && !direct && (post.kind === "供应" ? post.owner === actor : post.owner !== actor);
  const suggestions = post ? matchingCircleSources(post, sources) : [];
  const supplyOptions = [
    ...suggestions.filter((s) => s.kind === "供应"),
    ...sources.filter((s) => s.kind === "供应" && !suggestions.includes(s)),
  ];
  const [mode, setMode] = useState<"text" | "quote">(
    !target.threadId && !target.direct && target.post?.kind === "求购" ? "quote" : "text",
  );
  const [body, setBody] = useState(""),
    [needed, setNeeded] = useState(""),
    [city, setCity] = useState(target.post?.city ?? "");
  const [q, setQ] = useState<QuoteTerms>({
    quantity: "",
    price: "",
    tax: "含税",
    delivery: "",
    validUntil: dateAfter(1),
  });
  const [older, setOlder] = useState<CircleMessage[]>([]),
    [more, setMore] = useState<boolean | null>(null),
    [loadingOld, setLoadingOld] = useState(false);
  const [confirmEnd, end] = useState(false),
    [error, fail] = useState(""),
    [busy, working] = useState(false);
  const nonce = useRef(crypto.randomUUID()),
    locked = useRef(false),
    scroller = useRef<HTMLDivElement>(null),
    stick = useRef(true),
    lastRead = useRef(0);
  const firstInquiry = !id && !direct && post?.kind === "供应";
  const items = Array.from(
    new Map([...older, ...(history?.items ?? [])].map((m) => [m.id, m])).values(),
  ).sort((a, b) => a.id - b.id);
  const last = items.at(-1)?.id ?? 0;
  const cached = useRef<CircleMessage[]>([]);
  // Preserve loaded history when a live update moves the most recent 50-message window.
  useEffect(() => {
    if (!history) return;
    const before = history.items[0]?.id ?? 0;
    const shifted = cached.current.filter((x) => x.id < before);
    if (shifted.length)
      setOlder((prev) => [...new Map([...prev, ...shifted].map((x) => [x.id, x])).values()]);
    cached.current = history.items;
  }, [history]);
  useLayoutEffect(() => {
    if (stick.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [last]);
  useEffect(() => {
    if (!id || !last) return;
    let cancelled = false;
    function read() {
      if (document.visibilityState !== "visible" || lastRead.current >= last || !stick.current) return;
      lastRead.current = last;
      void postCircle(token, "/threads/" + id + "/read", { id: last }).catch(() => {
        if (!cancelled) lastRead.current = 0;
      });
    }
    const node = scroller.current;
    read();
    document.addEventListener("visibilitychange", read);
    node?.addEventListener("scroll", read);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", read);
      node?.removeEventListener("scroll", read);
    };
  }, [token, id, last]);
  async function loadOlder() {
    if (loadingOld || !items.length) return;
    setLoadingOld(true);
    fail("");
    try {
      const data = await circleApi<History>(token, "/threads/" + id + "?before=" + items[0].id);
      const el = scroller.current,
        prevHeight = el?.scrollHeight ?? 0;
      stick.current = false;
      setOlder((prev) => [...data.items, ...prev]);
      setMore(data.more);
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - prevHeight;
      });
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setLoadingOld(false);
    }
  }
  async function send(kind: "text" | "quote" | "status") {
    if (locked.current) return;
    locked.current = true;
    working(true);
    fail("");
    const text =
      firstInquiry && kind === "text"
        ? ["询货 " + needed.trim(), city.trim(), body.trim()].filter(Boolean).join(" · ")
        : body.trim();
    try {
      const result = await postCircle<{ id: string }>(token, "/send", {
        threadId: id || undefined,
        postId: postId || undefined,
        direct: !!direct,
        kind,
        text,
        quote: kind === "quote" ? q : undefined,
        nonce: nonce.current,
      });
      nonce.current = crypto.randomUUID();
      stick.current = true;
      setId(result.id);
      setBody("");
      setMode("text");
      end(false);
      onSaved();
    } catch (e) {
      fail((e as Error).message);
    } finally {
      working(false);
      locked.current = false;
    }
  }
  const name = thread?.name || target.peerName;
  return (
    <CircleDrawer title={name ? "与 " + name + " 对话" : "同行会话"} onClose={onClose}>
      <div className="circle-chat">
        {!direct && (post || thread?.postId) && (
          <div className="circle-chat-context">
            <span className={"circle-kind " + ((post?.kind || thread?.kind) === "求购" ? "buy" : "")}>
              {listingKindLabel(post?.kind || thread?.kind || "", post?.mode)}
            </span>
            <div>
              <strong>{post?.title || thread?.title}</strong>
              {post && (
                <small>{[post.quantity, post.city, post.active ? post.mode : "已结束"].join(" · ")}</small>
              )}
            </div>
          </div>
        )}
        <div
          className="circle-transcript"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.clientHeight - el.scrollTop < 70;
          }}
          aria-label="对话记录"
        >
          {(more ?? history?.more) && (
            <button type="button" className="circle-link" onClick={loadOlder} disabled={loadingOld}>
              查看更早消息
            </button>
          )}
          {!items.length && (
            <p className="circle-chat-start">
              {id
                ? remote.error || "正在加载会话…"
                : direct
                  ? "从一条私信开始。"
                  : mode === "quote"
                    ? "报价将单独发给采购方。"
                    : "询价会直接发给这条供应的发布人。"}
            </p>
          )}
          {items.map((m) => (
            <div
              key={m.id}
              className={
                "circle-msg " +
                (m.sender === actor ? "self" : "") +
                " " +
                (m.kind === "status" ? "event" : "")
              }
            >
              <small>
                {m.sender === actor ? "我" : name} · {localDate(m.sentAt)}
              </small>
              {m.quote ? (
                <div className="circle-quote">
                  <div>
                    <FileText size={15} />
                    <b>供货报价</b>
                    <span>V{m.version}</span>
                  </div>
                  <strong>{m.quote.price}</strong>
                  {m.quote.product && <p>{m.quote.product}</p>}
                  <p>
                    {m.quote.quantity} · {m.quote.tax}
                  </p>
                  <p>交期 {m.quote.delivery}</p>
                  <small>有效至 {m.quote.validUntil}</small>
                </div>
              ) : (
                <p>{m.text}</p>
              )}
            </div>
          ))}
        </div>
        {remote.error && (
          <p role="alert" className="circle-error">
            {remote.error}
          </p>
        )}
        {thread?.status === "done" ? (
          <p className="circle-chat-end">本次对接已结束，历史报价可继续查看。</p>
        ) : (
          <form
            className="circle-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(mode);
            }}
          >
            <div className="circle-compose-tabs">
              <button type="button" aria-pressed={mode === "text"} onClick={() => setMode("text")}>
                发消息
              </button>
              {canQuote && post?.active && (
                <button type="button" aria-pressed={mode === "quote"} onClick={() => setMode("quote")}>
                  <FileText size={14} />
                  发报价
                </button>
              )}
              {id && (
                <button type="button" className="finish" onClick={() => end(!confirmEnd)}>
                  结束对接
                </button>
              )}
            </div>
            {confirmEnd && (
              <div className="circle-confirm">
                结束后仍可查看历史记录。
                <button type="button" onClick={() => void send("status")} disabled={busy}>
                  确认结束
                </button>
                <button type="button" onClick={() => end(false)}>
                  取消
                </button>
              </div>
            )}
            {mode === "quote" ? (
              <div className="circle-quote-fields">
                {supplyOptions.length > 0 && (
                  <label>
                    从我的供应库选货
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const s = supplyOptions.find((s) => s.id === e.target.value);
                        setQ({ ...q, product: s?.title || "", quantity: s?.quantity || "" });
                      }}
                    >
                      <option value="">手动报价</option>
                      {supplyOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {suggestions.includes(s) ? "相关型号 · " : ""}
                          {s.title} · {s.quantity}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="circle-fields">
                  <label>
                    可供数量
                    <input
                      required
                      maxLength={35}
                      placeholder="80 条"
                      value={q.quantity}
                      onChange={(e) => setQ({ ...q, quantity: e.target.value })}
                    />
                  </label>
                  <label>
                    {post?.mode === "租赁" ? "租金及计费单位" : "单价及单位"}
                    <input
                      required
                      maxLength={45}
                      placeholder={post?.mode === "租赁" ? "例如 800 元/台/天" : "元 / 条"}
                      value={q.price}
                      onChange={(e) => setQ({ ...q, price: e.target.value })}
                    />
                  </label>
                </div>
                <div className="circle-fields">
                  <label>
                    税价口径
                    <select value={q.tax} onChange={(e) => setQ({ ...q, tax: e.target.value })}>
                      {["含税", "未税", "税另议"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    最早交期
                    <input
                      required
                      maxLength={65}
                      value={q.delivery}
                      placeholder="例如 明天可交"
                      onChange={(e) => setQ({ ...q, delivery: e.target.value })}
                    />
                  </label>
                </div>
                <label>
                  报价有效至
                  <input
                    type="date"
                    required
                    min={dateAfter(0)}
                    value={q.validUntil}
                    onChange={(e) => setQ({ ...q, validUntil: e.target.value })}
                  />
                </label>
              </div>
            ) : (
              <>
                {firstInquiry && (
                  <div className="circle-fields">
                    <label>
                      需要数量
                      <input
                        required
                        maxLength={35}
                        value={needed}
                        placeholder="例如 1 台"
                        onChange={(e) => setNeeded(e.target.value)}
                      />
                    </label>
                    <label>
                      交付地
                      <input required maxLength={45} value={city} onChange={(e) => setCity(e.target.value)} />
                    </label>
                  </div>
                )}
                <textarea
                  aria-label="消息内容"
                  placeholder={firstInquiry ? "补充交期、税价等要求（选填）" : "输入消息…"}
                  maxLength={1800}
                  required={!firstInquiry}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </>
            )}
            {error && (
              <p role="alert" className="circle-error">
                {error}
              </p>
            )}
            <div className="circle-send">
              <small>仅对话双方可见</small>
              <button className="circle-primary" disabled={busy || (!!id && !history)}>
                {busy ? "正在发送…" : mode === "quote" ? "发送报价" : firstInquiry ? "发送询价" : "发送"}
                <Send size={15} />
              </button>
            </div>
          </form>
        )}
      </div>
    </CircleDrawer>
  );
}
