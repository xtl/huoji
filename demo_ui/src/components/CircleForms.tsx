import React, { useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, X } from "lucide-react";
import { businessRoles, listingKindLabel, sourceRoleLabel, type CircleSource, type ListingDraft, type ListingKind } from "../circle-types";
import { postCircle } from "./circle-client";

export function CircleDrawer({
  title,
  onClose,
  children,
  onBack,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  onBack?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const d = ref.current,
      trigger = document.activeElement as HTMLElement;
    d?.showModal();
    return () => {
      d?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="circle-drawer"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target !== ref.current) return;
        const r = ref.current.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right) onClose();
      }}
    >
      <header className="circle-drawer-head">
        <div>
          {onBack && (
            <button type="button" aria-label="返回上一步" onClick={onBack}>
              <ArrowLeft size={19} />
            </button>
          )}
          <h2>{title}</h2>
        </div>
        <button type="button" aria-label="关闭侧边面板" autoFocus onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
const blank: ListingDraft = {
  kind: "供应",
  title: "",
  quantity: "",
  city: "",
  mode: "现货",
  role: "自有货源",
  price: "",
  terms: "",
  days: 3,
};
const roleFor = (kind: ListingKind) => (kind === "供应" ? "自有货源" : "本人采购");
function fromSource(s?: CircleSource): ListingDraft {
  return s
    ? {
        ...blank,
        kind: s.kind,
        title: s.title,
        quantity: s.quantity,
        city: s.city,
        mode: s.mode,
        role: s.kind === "供应" ? "受托供货" : "受托采购",
      }
    : { ...blank };
}
export function PublishForm({
  token,
  sources,
  initial,
  rental = false,
  name,
  companyName,
  onClose,
  onDone,
}: {
  token: string;
  sources: CircleSource[];
  initial?: CircleSource;
  rental?: boolean;
  name: string;
  companyName?: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [d, set] = useState<ListingDraft>(() => initial ? fromSource(initial) : { ...blank, mode: rental ? "租赁" : blank.mode }),
    [preview, showPreview] = useState(false),
    [source, setSource] = useState(initial?.id ?? "");
  const [error, fail] = useState(""),
    [busy, working] = useState(false);
  const [alias, setAlias] = useState<string | null>(null);
  const nonce = useRef(crypto.randomUUID()),
    locked = useRef(false);
  function edit(k: keyof ListingDraft, v: string | number) {
    set((prev) => ({ ...prev, [k]: v }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    fail("");
    if (!d.title.trim() || !d.quantity.trim() || !d.city.trim()) {
      fail("请填写产品、数量和交付地。");
      return;
    }
    if (!preview) {
      showPreview(true);
      return;
    }
    if (locked.current) return;
    locked.current = true;
    working(true);
    try {
      const post = await postCircle<{ id: string }>(token, "/posts", {
        ...d,
        displayName: (alias ?? name).trim(),
        nonce: nonce.current,
      });
      onDone(post.id);
    } catch (e) {
      fail((e as Error).message);
    } finally {
      working(false);
      locked.current = false;
    }
  }
  return (
    <CircleDrawer
      title={preview ? "发布预览" : "发布供需"}
      onClose={onClose}
      onBack={preview ? () => showPreview(false) : undefined}
    >
      <form className="circle-form circle-pad" onSubmit={submit}>
        {preview ? (
          <>
            <div className="circle-public-preview">
              <span className={"circle-kind " + (d.kind === "求购" ? "buy" : "")}>{listingKindLabel(d.kind, d.mode)}</span>
              <h3>{d.title}</h3>
              <p>{[d.quantity, d.city, d.mode].join(" · ")}</p>
              <strong>{d.price || (d.kind === "供应" ? "价格面议" : "接受报价")}</strong>
              {d.terms && <p>{d.terms}</p>}
            </div>
            <label>
              你的圈内称呼
              <input
                maxLength={32}
                required
                placeholder="同行如何称呼你"
                value={alias ?? name}
                onChange={(e) => setAlias(e.target.value)}
              />
            </label>
            <dl className="circle-facts">
              {companyName && <><dt>发布企业</dt><dd>{companyName}</dd></>}
              {d.businessRole && <><dt>业务角色</dt><dd>{d.businessRole}</dd></>}
              <dt>信息来源</dt>
              <dd>{sourceRoleLabel(d.role, d.mode)}</dd>
              <dt>可见范围</dt>
              <dd>已登录的圈内同行</dd>
              <dt>有效期</dt>
              <dd>{d.days} 天</dd>
            </dl>
            <p className="circle-help">
              同行可向你的货记账号询价。原聊天、群名、上游联系人和成本留在个人库。
            </p>
          </>
        ) : (
          <>
            <div className="circle-kind-select" aria-label="发布类型">
              {(["供应", "求购"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={d.kind === k}
                  onClick={() => {
                    if (d.kind !== k) {
                      set({ ...blank, mode: d.mode, businessRole: d.businessRole, kind: k, role: roleFor(k) });
                      setSource("");
                    }
                  }}
                >
                  {d.mode === "租赁" ? (k === "供应" ? "我要出租" : "我要求租") : (k === "供应" ? "我有货源" : "我要采购")}
                </button>
              ))}
            </div>
            {sources.length > 0 && (
              <label>
                从个人库带入
                <select
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value);
                    const s = sources.find((i) => i.id === e.target.value && i.kind === d.kind);
                    set({ ...(s ? fromSource(s) : { ...blank, kind: d.kind, role: roleFor(d.kind), mode: d.mode }), businessRole: d.businessRole });
                  }}
                >
                  <option value="">手动填写</option>
                  {sources
                    .filter((s) => s.kind === d.kind)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title} · {s.city || "交付地待填"} {s.quantity}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              产品 / 型号
              <input
                required
                maxLength={90}
                value={d.title}
                placeholder="例如 H200 PCIe 8 卡整机"
                onChange={(e) => edit("title", e.target.value)}
              />
            </label>
            <div className="circle-fields">
              <label>
                数量及单位
                <input
                  required
                  maxLength={35}
                  placeholder="例如 2 台"
                  value={d.quantity}
                  onChange={(e) => edit("quantity", e.target.value)}
                />
              </label>
              <label>
                交付地
                <input
                  required
                  maxLength={45}
                  placeholder="例如 深圳"
                  value={d.city}
                  onChange={(e) => edit("city", e.target.value)}
                />
              </label>
            </div>
            <div className="circle-fields">
              <label>
                交易方式
                <select aria-label="交易方式" value={d.mode} onChange={(e) => edit("mode", e.target.value)}>
                  {["现货", "期货", "租赁"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                信息来源
                <select aria-label="信息来源" value={d.role} onChange={(e) => edit("role", e.target.value)}>
                  {(d.kind === "供应" ? ["自有货源", "受托供货"] : ["本人采购", "受托采购"]).map((v) => (
                    <option key={v} value={v}>{sourceRoleLabel(v, d.mode)}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              业务角色
              <select aria-label="业务角色" value={d.businessRole ?? ""} onChange={e => edit("businessRole", e.target.value)}>
                <option value="">请选择（选填）</option>
                {businessRoles.map(role => <option key={role}>{role}</option>)}
              </select>
            </label>
            <label>
              {d.mode === "租赁" ? (d.kind === "供应" ? "租金" : "租金预算") : (d.kind === "供应" ? "公开报价" : "公开预算")}
              <input
                maxLength={70}
                placeholder={d.mode === "租赁" ? "例如 800 元/台/天" : d.kind === "供应" ? "可留空，同行私下询价" : "可留空，让同行报价"}
                value={d.price}
                onChange={(e) => edit("price", e.target.value)}
              />
            </label>
            <label>
              交付条件{" "}
              <textarea
                maxLength={450}
                placeholder="可填写批次、交期或质保要求"
                value={d.terms}
                onChange={(e) => edit("terms", e.target.value)}
              />
            </label>
            <label>
              发布有效期
              <select value={d.days} onChange={(e) => edit("days", Number(e.target.value))}>
                {[1, 3, 7].map((n) => (
                  <option key={n} value={n}>
                    {n} 天
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="circle-error">
            {error}
          </p>
        )}
        <div className="circle-form-actions">
          <button
            type="button"
            className="circle-secondary"
            onClick={preview ? () => showPreview(false) : onClose}
          >
            {preview ? "返回修改" : "取消"}
          </button>
          <button className="circle-primary" disabled={busy}>
            {busy ? "正在发布…" : preview ? "确认发布" : "预览发布"}
            <ChevronRight size={15} />
          </button>
        </div>
      </form>
    </CircleDrawer>
  );
}
