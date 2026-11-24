import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  ChevronRight,
  MessageCircle,
  MessagesSquare,
  PackageOpen,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import type { CircleParticipation, CirclePost, CircleQuestion, CircleSource, CircleThread, QuoteTerms } from "../circle-types";
import { listingKindLabel, matchingCircleSources, sourceRoleLabel } from "../circle-types";
import { navigateWorkspace, TALK_HASH } from "../workspace-navigation";
import { CircleDrawer, CircleMembershipNotice, PublishForm } from "./CircleForms";
import { CircleChat } from "./CircleChat";
import { localDate, postCircle, useCircleData } from "./circle-client";
import "./circle.css";
import "./circle-feed-card.css";

type Detail = {
  post: CirclePost;
  authorAvatar?: string | null;
  questions: CircleQuestion[];
  offers: { threadId: string; name: string; quote: QuoteTerms; version: number; sentAt: string }[];
};
type Props = {
  token: string;
  actor: string;
  name: string;
  companyName?: string;
  participation: CircleParticipation;
  onCheckMembership: () => void;
  version: string;
  hash: string;
  sources: CircleSource[];
  refresh: () => void;
};
function Kind({ kind, mode }: { kind: string; mode: string }) {
  return <span className={"circle-kind " + (kind === "求购" ? "buy" : "")}>{listingKindLabel(kind, mode)}</span>;
}
function CircleIdentity({ post, avatar, showTime = false }: { post: CirclePost; avatar?: string | null; showTime?: boolean }) {
  const initial = /^\d{3}\*{4}\d{4}$/.test(post.author) ? "" : Array.from(post.author.trim())[0];
  return <div className="circle-identity">
    <span className="circle-avatar" aria-hidden="true">
      {avatar ? <img src={avatar} alt="" loading="lazy" /> : initial || <UserRound size={20} />}
    </span>
    <div className="circle-identity-copy">
      <div className="circle-identity-name">
        <strong>{post.author}</strong>
        {post.companyName && <span className="circle-company" title="已认证企业"><BadgeCheck size={14} aria-hidden="true" />{post.companyName}</span>}
      </div>
      <small className="circle-identity-meta">
        {showTime && <time dateTime={post.publishedAt}>{localDate(post.publishedAt)}</time>}
        <span>{post.businessRole || sourceRoleLabel(post.role, post.mode)}</span>
      </small>
    </div>
  </div>;
}
function FeedPost({
  post,
  avatar,
  own,
  onOpen,
  onDiscuss,
  onChat,
}: {
  post: CirclePost;
  avatar?: string;
  own: boolean;
  onOpen: () => void;
  onDiscuss: () => void;
  onChat: () => void;
}) {
  const supply = post.kind === "供应";
  const rental = post.mode === "租赁";
  const quoteLabel = rental ? (supply ? "租金" : "租金预算") : (supply ? "报价" : "预算");
  const initial = /^\d{3}\*{4}\d{4}$/.test(post.author) ? "" : Array.from(post.author.trim())[0];
  return (
    <li className="circle-feed-post" data-kind={supply ? "supply" : "buy"} data-closed={!post.active || undefined}>
      <article>
        <div className="circle-feed-body">
          <h3 className="circle-feed-title">
            <span className="circle-feed-kind">{listingKindLabel(post.kind, post.mode)}</span>
            <button type="button" className="circle-feed-open" onClick={onOpen}>{post.title}</button>
          </h3>
          <p className="circle-feed-specs">
            <strong>{post.quantity}</strong>
            <span>{post.city}</span>
            <span>{post.mode}</span>
            {!post.active && <span className="circle-feed-closed">已结束</span>}
          </p>
          {post.terms && <p className="circle-feed-terms">{post.terms}</p>}
          <p className="circle-feed-meta">
            {post.demo && <span className="circle-demo-label">模拟</span>}
            <span className="circle-feed-avatar" aria-hidden="true">
              {avatar ? <img src={avatar} alt="" loading="lazy" /> : initial || <UserRound size={12} />}
            </span>
            <span className="circle-feed-author">{post.author}</span>
            {post.companyName && <span className="circle-company" title="已认证企业"><BadgeCheck size={13} aria-hidden="true" />{post.companyName}</span>}
            <span className="circle-feed-role">{post.businessRole || sourceRoleLabel(post.role, post.mode)}</span>
            <time dateTime={post.publishedAt}>{localDate(post.publishedAt)}</time>
            {!post.demo && <button type="button" className="circle-feed-discuss" onClick={onDiscuss} aria-label={"规格讨论" + (post.questionCount ? "，" + post.questionCount + " 条" : "")}>
              <MessagesSquare size={13} aria-hidden="true" />{post.questionCount || "讨论"}
            </button>}
          </p>
        </div>
        <div className="circle-feed-aside">
          <p className="circle-feed-price" data-quoted={Boolean(post.price) || undefined}>
            <small>{quoteLabel}</small>
            <strong>{post.price || (supply ? "面议" : "接受报价")}</strong>
          </p>
          <button type="button" className="circle-feed-action" data-own={own || undefined} onClick={own || post.demo ? onOpen : onChat}>
            {own ? "管理" : post.demo ? "查看示例" : supply ? (rental ? "询租" : "询价") : "我能供货"}
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
      </article>
    </li>
  );
}
function PostDetail({
  detail,
  mine,
  threads,
  sources,
  open,
  token,
  refresh,
  canParticipate,
  showDiscussion,
}: {
  detail: Detail;
  mine: boolean;
  threads: CircleThread[];
  sources: CircleSource[];
  open: (s: string) => void;
  token: string;
  refresh: () => void;
  canParticipate: boolean;
  showDiscussion: boolean;
}) {
  const p = detail.post,
    [error, fail] = useState(""),
    [pending, work] = useState(false),
    [action, setAction] = useState(""),
    [value, setValue] = useState("");
  const [question, qText] = useState(""),
    [reply, setReply] = useState(0),
    [answer, setAnswer] = useState("");
  const lock = useRef(false),
    nonce = useRef(crypto.randomUUID());
  const discussion = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!showDiscussion || !discussion.current) return;
    discussion.current.open = true;
    discussion.current.scrollIntoView({ block: "nearest" });
  }, [p.id, showDiscussion]);
  async function save(path: string, body: object, method = "POST") {
    if (lock.current) return;
    lock.current = true;
    work(true);
    fail("");
    try {
      await postCircle(token, path, body, method);
      setAction("");
      qText("");
      setAnswer("");
      setReply(0);
      nonce.current = crypto.randomUUID();
      refresh();
    } catch (e) {
      fail((e as Error).message);
    } finally {
      lock.current = false;
      work(false);
    }
  }
  const leads = threads.filter((t) => t.postId === p.id);
  const matches = mine ? [] : matchingCircleSources(p, sources);
  return (
    <div className="circle-pad circle-post-detail">
      <div className="circle-detail-top">
        <Kind kind={p.kind} mode={p.mode} />
        <small>{p.demo ? "模拟供需" : p.active ? sourceRoleLabel(p.role, p.mode) : "已结束"}</small>
      </div>
      <h3>{p.title}</h3>
      <div className="circle-detail-price">{p.price || (p.kind === "供应" ? "价格面议" : "接受报价")}</div>
      <dl className="circle-facts">
        <dt>{p.mode === "租赁" ? listingKindLabel(p.kind, p.mode) + "数量" : p.kind === "供应" ? "可供数量" : "求购数量"}</dt>
        <dd>{p.quantity}</dd>
        <dt>交付</dt>
        <dd>
          {p.city} · {p.mode}
        </dd>
        <dt>发布时间</dt>
        <dd>
          <time>{localDate(p.publishedAt)}</time>
        </dd>
        <dt>有效至</dt>
        <dd>{localDate(p.expiresAt)}</dd>
        {p.confirmedAt !== p.publishedAt && (
          <>
            <dt>最近确认</dt>
            <dd>{localDate(p.confirmedAt)}</dd>
          </>
        )}
      </dl>
      {p.terms && (
        <section>
          <h4>交易条件</h4>
          <p className="circle-preserve">{p.terms}</p>
        </section>
      )}
      <div className="circle-author">
        <CircleIdentity post={p} avatar={detail.authorAvatar} />
        {!mine && !p.demo && (
          <button className="circle-link" onClick={() => open("direct/" + p.id)}>
            私信发布人
          </button>
        )}
      </div>
      {!mine && !p.demo && (p.active || leads.length > 0) && (
        <button className="circle-primary" onClick={() => open("inquire/" + p.id)}>
          <MessageCircle size={16} />
          {leads.length ? "继续对接" : p.kind === "供应" ? "我要询价" : "我能供货"}
        </button>
      )}
      {!p.demo && matches.length > 0 && p.active && (
        <details className="circle-qa">
          <summary>
            我的{p.kind === "供应" ? "需求" : "供应"}库有 {matches.length} 条相关型号
          </summary>
          {matches.map((s) => (
            <p key={s.id} className="circle-help">
              {s.title} · {s.quantity || "数量待核对"} · {s.city || "交付地待核对"}
            </p>
          ))}
        </details>
      )}
      {mine && (
        <section className="circle-manage">
          <h4>我的发布</h4>
          <div className="circle-actions">
            {p.active && (
              <>
                <button
                  className="circle-secondary"
                  disabled={pending}
                  onClick={() => void save("/posts/" + p.id, { action: "confirm" }, "PATCH")}
                >
                  确认仍有效
                </button>
                <button
                  className="circle-secondary"
                  onClick={() => {
                    setAction("quantity");
                    setValue(p.quantity);
                  }}
                >
                  更新数量
                </button>
                <button className="circle-link" onClick={() => setAction("close")}>
                  结束发布
                </button>
              </>
            )}
          </div>
          {action && (
            <form
              className="circle-confirm"
              onSubmit={(e) => {
                e.preventDefault();
                void save("/posts/" + p.id, { action, quantity: value }, "PATCH");
              }}
            >
              {action === "quantity" ? (
                <label>
                  剩余数量
                  <input required maxLength={35} value={value} onChange={(e) => setValue(e.target.value)} />
                </label>
              ) : (
                <span>结束后将从广场移出，已有对话保留。</span>
              )}
              <button disabled={pending}>{action === "quantity" ? "保存数量" : "确认结束"}</button>
              <button type="button" onClick={() => setAction("")}>
                取消
              </button>
            </form>
          )}
          <h4>
            收到的回应 <small>{leads.length}</small>
          </h4>
          {leads.length === 0 && <p className="circle-help">同行的询价和报价会出现在这里。</p>}
          {leads.map((t) => {
            const offer = detail.offers.find((o) => o.threadId === t.id);
            return (
              <button className="circle-lead-row" key={t.id} onClick={() => open("thread/" + t.id)}>
                <span>
                  <strong>{t.name}</strong>
                  <small>
                    {offer
                      ? [
                          offer.quote.quantity,
                          offer.quote.price,
                          offer.quote.tax,
                          offer.quote.delivery,
                          "V" + offer.version,
                        ].join(" · ")
                      : t.lastText}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            );
          })}
        </section>
      )}
      {!p.demo && <details className="circle-qa" ref={discussion}>
        <summary>
          公开问规格 <span>{detail.questions.length}</span>
        </summary>
        {detail.questions.map((q) => (
          <div key={q.id} className="circle-question">
            <small>
              {q.author} · {localDate(q.createdAt)}
            </small>
            <p>{q.body}</p>
            {q.answer ? (
              <p className="circle-answer">
                <b>发布人</b> {q.answer}
              </p>
            ) : (
              canParticipate && mine &&
              p.active && (
                <button
                  className="circle-link"
                  onClick={() => {
                    setReply(q.id);
                    setAnswer("");
                  }}
                >
                  答复
                </button>
              )
            )}
            {canParticipate && reply === q.id && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save("/posts/" + p.id + "/questions", { questionId: q.id, body: answer });
                }}
              >
                <input
                  required
                  aria-label="公开答复"
                  value={answer}
                  maxLength={300}
                  onChange={(e) => setAnswer(e.target.value)}
                />
                <button className="circle-secondary" disabled={pending}>
                  发布答复
                </button>
              </form>
            )}
          </div>
        ))}
        {canParticipate && !mine && p.active ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save("/posts/" + p.id + "/questions", { body: question, nonce: nonce.current });
            }}
          >
            <input
              required
              maxLength={300}
              aria-label="公开问题"
              placeholder="询问型号、批次等公开规格"
              value={question}
              onChange={(e) => qText(e.target.value)}
            />
            <button disabled={pending} className="circle-secondary">
              公开提问
            </button>
          </form>
        ) : (
          !detail.questions.length && <p className="circle-help">暂无规格问题。</p>
        )}
      </details>}
      {error && (
        <p role="alert" className="circle-error">
          {error}
        </p>
      )}
    </div>
  );
}
export default function CircleWorkspace({ token, actor, name, companyName, participation, onCheckMembership, version, hash, sources, refresh }: Props) {
  const parts = hash.replace(/^#/, "").split("/"),
    talk = parts[0] === "input" && parts[1] === "talk",
    mine = !talk && parts[1] === "mine",
    rental = !talk && parts[1] === "rental",
    demo = !talk && parts[1] === "demo";
  const base = talk ? TALK_HASH : mine ? "#circle/mine" : rental ? "#circle/rental" : demo ? "#circle/demo" : "#circle";
  const [action, param, sourceKind] = parts.slice(talk || mine || rental || demo ? 2 : 1);
  const [filter, setFilter] = useState(""),
    [word, query] = useState(""),
    [search, searchFor] = useState(""),
    [page, go] = useState(0);
  const [hint, setHint] = useState("");
  const list = useCircleData<{ items: CirclePost[]; more: boolean; avatars?: Record<string, string> }>(
    token,
    talk
      ? ""
      : "/posts?" +
          new URLSearchParams({ mine: mine ? "1" : "0", demo: demo ? "1" : "0", scope: mine || demo ? "" : rental ? "rental" : "sale", kind: filter, q: search, offset: String(page * 30) }),
    version,
  );
  const threads = useCircleData<{ items: CircleThread[] }>(token, "/threads", version);
  const detail = useCircleData<Detail>(
    token,
    ["post", "inquire", "direct"].includes(action) && param ? "/posts/" + encodeURIComponent(param) : "",
    version,
  );
  const items = threads.data?.items ?? [],
    p = detail.data?.post;
  const unread = items.reduce((total, thread) => total + thread.unread, 0);
  const hasRecentTalk = !talk && items.length > 0;
  const open = (next: string) => {
    setHint("");
    navigateWorkspace(base + "/" + next);
  };
  const dismiss = () => navigateWorkspace(base);
  useEffect(() => {
    if (page > 0 && list.data && !list.data.items.length) go((v) => Math.max(0, v - 1));
  }, [list.data, page]);
  useEffect(() => {
    const timer = setTimeout(() => {
      searchFor(word.trim());
      go(0);
    }, 240);
    return () => clearTimeout(timer);
  }, [word]);
  const seed =
    action === "publish"
      ? sources.find(
          (s) => encodeURIComponent(s.id) === param && s.kind === (sourceKind === "market" ? "求购" : "供应"),
        )
      : undefined;
  const existing =
    action === "thread"
      ? items.find((t) => t.id === param)
      : items.find((t) => (action === "direct" ? t.peer === p?.owner && !t.postId : t.postId === param));
  const canParticipate = participation === "allowed";
  const startsConversation = ["direct", "inquire"].includes(action);
  const membershipGate = !canParticipate && (action === "publish" || (startsConversation && !existing && !p?.demo));
  const chatReady = !membershipGate && !p?.demo &&
    (action === "thread" || (startsConversation && p && actor && threads.data));
  const error = (talk ? threads.error : list.error) || (action && detail.error);
  return (
    <div className={talk ? "circle-workspace" : "circle-workspace circle-marketplace" + (hasRecentTalk ? " has-recent-talk" : "")}>
      {error && (
        <div role="alert" className="circle-error">
          {error} <button onClick={refresh}>重试</button>
        </div>
      )}
      {hint && (
        <div role="status" className="circle-toast">
          {hint}
        </div>
      )}
      {talk ? (
        <section className="circle-inbox" aria-label="同行会话列表">
          {items.map((t) => (
            <button className="circle-inbox-row" key={t.id} onClick={() => open("thread/" + t.id)}>
              <span className="circle-avatar">
                <UserRound size={20} />
              </span>
              <span className="circle-inbox-copy">
                <strong>
                  {t.name} {t.unread > 0 && <b className="circle-unread">{t.unread}</b>}
                </strong>
                {t.postId && <span className="inbox-subject">{t.title}</span>}
                <small>{t.lastText}</small>
              </span>
              <time dateTime={t.updatedAt}>{localDate(t.updatedAt)}</time>
              <ChevronRight size={16} />
            </button>
          ))}
          {!items.length && !threads.error && (
            <Empty loading={!threads.data} chat go={() => navigateWorkspace("#circle")} />
          )}
        </section>
      ) : (
        <>
          <div className="view-bar circle-market-nav">
            <nav className="circle-tabs" aria-label="广场范围">
              {[
                ["圈内供需", "#circle"],
                ["租赁", "#circle/rental"],
                ["我的发布", "#circle/mine"],
                ["模拟供需", "#circle/demo"],
              ].map(([label, path]) => (
                <a
                  href={path}
                  key={path}
                  aria-current={base === path ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    go(0);
                    setFilter("");
                    query("");
                    searchFor("");
                    navigateWorkspace(path);
                  }}
                >
                  {label}
                </a>
              ))}
            </nav>
            <div className="circle-feed-nav-actions">
              <a className="circle-link circle-feed-talk-link" href={TALK_HASH} aria-label={unread > 0 ? "同行会话，" + unread + " 条未读消息" : "同行会话"}>
                <MessageCircle size={19} aria-hidden="true" />
                <span>会话</span>
                {unread > 0 && <b className="circle-unread" aria-hidden="true">{unread}</b>}
              </a>
              <button type="button" className="circle-primary" aria-label="发布供需" onClick={() => open("publish")}>
                <Plus size={16} aria-hidden="true" /><span>发布<span className="circle-publish-suffix">供需</span></span>
              </button>
            </div>
          </div>
          <div className="circle-feed-layout">
            <div className="circle-feed-main">
              {demo && <p className="circle-help">以下为模拟账号和供需示例，仅供浏览。</p>}
              <div className="circle-toolbar">
                <div className="circle-filters" aria-label="供需类型">
                  {["", "供应", "求购"].map((k) => (
                    <button
                      type="button"
                      key={k}
                      aria-pressed={filter === k}
                      onClick={() => {
                        setFilter(k);
                        go(0);
                      }}
                    >
                      {k ? listingKindLabel(k, rental ? "租赁" : undefined) : "全部"}
                    </button>
                  ))}
                </div>
                <label className="circle-search">
                  <Search size={16} />
                  <input
                    aria-label="搜索广场"
                    maxLength={80}
                    placeholder="搜索型号或城市"
                    value={word}
                    onChange={(e) => query(e.target.value)}
                  />
                </label>
              </div>
              {list.data?.items.length ? (
                <ul className="circle-feed" aria-label="广场发布">
                  {[...list.data.items].sort((a, b) => Number(b.active) - Number(a.active)).map(post => (
                    <React.Fragment key={post.id}>
                      <FeedPost
                        post={post}
                        avatar={post.demo ? undefined : list.data?.avatars?.[post.owner]}
                        own={post.owner === actor}
                        onOpen={() => open("post/" + post.id)}
                        onDiscuss={() => open("post/" + post.id + "/discussion")}
                        onChat={() => open("inquire/" + post.id)}
                      />
                    </React.Fragment>
                  ))}
                </ul>
              ) : (
                !list.error && (
                  <Empty
                    loading={!list.data}
                    filtered={!!(search || filter)}
                    mine={mine}
                    go={() => {
                      if (search || filter) {
                        setFilter("");
                        query("");
                        searchFor("");
                      } else open("publish");
                    }}
                  />
                )
              )}
              {(page > 0 || list.data?.more) && (
                <div className="circle-pages">
                  <button disabled={!page} onClick={() => go(page - 1)}>
                    上一页
                  </button>
                  <span>第 {page + 1} 页</span>
                  <button disabled={!list.data?.more} onClick={() => go(page + 1)}>
                    下一页
                  </button>
                </div>
              )}
            </div>
            {hasRecentTalk && <aside className="circle-feed-side" aria-label="同行会话">
              <a className="circle-feed-side-heading" href={TALK_HASH}>
                <span><MessageCircle size={17} aria-hidden="true" />最近会话</span>
                {unread > 0 && <b className="circle-unread" aria-label={unread + " 条未读消息"}>{unread}</b>}
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
              {items.slice(0, 3).map(thread => (
                <a className="circle-feed-thread" key={thread.id} href={TALK_HASH + "/thread/" + thread.id}>
                  <strong>{thread.name}{thread.unread > 0 && <b className="circle-unread">{thread.unread}</b>}</strong>
                  <small>{thread.lastText || thread.title}</small>
                </a>
              ))}
            </aside>}
          </div>
        </>
      )}
      {membershipGate && (
        <CircleDrawer title={action === "publish" ? "发布供需" : "同行会话"} onClose={dismiss}>
          <CircleMembershipNotice participation={participation} onRetry={onCheckMembership} />
        </CircleDrawer>
      )}
      {action === "publish" && canParticipate && (
        <PublishForm
          token={token}
          name={name}
          companyName={companyName}
          initial={seed}
          rental={rental}
          sources={sources}
          onClose={dismiss}
          onDone={(id) => {
            setFilter("");
            query("");
            go(0);
            refresh();
            navigateWorkspace("#circle/mine/post/" + id);
            setHint("已发布到同行广场");
          }}
        />
      )}
      {action === "post" && (
        <CircleDrawer title="发布详情" onClose={dismiss}>
          {p && detail.data ? (
            <PostDetail
              detail={detail.data}
              token={token}
              mine={p.owner === actor}
              threads={items}
              sources={sources}
              open={open}
              refresh={refresh}
              canParticipate={canParticipate}
              showDiscussion={sourceKind === "discussion"}
            />
          ) : (
            <p className="circle-pad">{detail.error || "正在加载发布…"}</p>
          )}
        </CircleDrawer>
      )}
      {chatReady && (
        <React.Fragment key={base + action + param}>
          <CircleChat
            token={token}
            version={version}
            actor={actor}
            sources={sources}
            participation={participation}
            onCheckMembership={onCheckMembership}
            target={{
              threadId: action === "thread" ? param : existing?.id,
              post: action === "thread" ? undefined : p,
              direct: action === "direct",
              peerName: existing?.name || p?.author || "",
            }}
            onSaved={refresh}
            onClose={dismiss}
          />
        </React.Fragment>
      )}
      {startsConversation && !chatReady && !membershipGate && (
        <CircleDrawer title="同行会话" onClose={dismiss}>
          <div className="circle-pad">
            {p?.demo ? "模拟供需仅供浏览。" : detail.error || threads.error || "正在打开会话…"}
            {(detail.error || threads.error) && <button onClick={refresh}>重试</button>}
          </div>
        </CircleDrawer>
      )}
    </div>
  );
}
function Empty({
  loading,
  chat,
  filtered,
  mine,
  go,
}: {
  loading?: boolean;
  chat?: boolean;
  filtered?: boolean;
  mine?: boolean;
  go: () => void;
}) {
  return (
    <div className="circle-empty">
      {chat ? <MessageCircle size={32} strokeWidth={1.4} /> : <PackageOpen size={34} strokeWidth={1.4} />}
      <h2>
        {loading
          ? "正在加载…"
          : chat
            ? "还没有同行会话"
            : filtered
              ? "没有符合条件的供需"
              : mine
                ? "你还没有发布供需"
                : "暂无有效的供需发布"}
      </h2>
      {!loading && (
        <>
          <p>
            {chat
              ? "从一条供应发起询价，收到的报价也会出现在这里。"
              : filtered
                ? "试试其他型号，或清除当前筛选。"
                : "可以从个人库选一条，也可以直接填写新的货源或求购。"}
          </p>
          <button type="button" className="circle-secondary" onClick={go}>
            {chat ? "去同行广场" : filtered ? "清除筛选" : "发布第一条供需"}
            <ArrowRight size={15} />
          </button>
        </>
      )}
    </div>
  );
}
