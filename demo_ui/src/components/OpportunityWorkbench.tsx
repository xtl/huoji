import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { isOpenOpportunity, nextActions, opportunityStages, tradeModes } from "../opportunity-types";
import type {
  Opportunity, OpportunityBoard, OpportunityDemand, OpportunitySeed, PortfolioLine,
} from "../opportunity-types";
import { CircleDrawer } from "./CircleForms";
import "./opportunities.css";

const emptyDemand: OpportunityDemand = { title: "", model: "", customer: "", quantity: 0, unit: "台", city: "", mode: "SPOT" };
const chinaTime = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const localInput = (at: string | null) => at ? new Date(Date.parse(at) + 8 * 3600000).toISOString().slice(0, 16) : "";
const shortTime = (at: string | null) => at && Number.isFinite(Date.parse(at)) ? chinaTime.format(new Date(at)) : "未记录";
const describeError = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试。";
type Scope = "personal" | "enterprise";

class RequestError extends Error {
  constructor(message: string, readonly existingId?: string) { super(message); }
}
async function request<T>(token: string, scope: Scope, route = "", method = "GET", body?: object, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api/${scope}/opportunities` + route, {
    method, signal, headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new RequestError(data.error || "商机请求失败。", data.existingId);
  return data;
}

function useBoard(token: string, scope: Scope, refresh = 0, supplied?: OpportunityBoard) {
  const [board, setBoard] = useState<OpportunityBoard>();
  const [error, fail] = useState("");
  useEffect(() => {
    if (supplied) return;
    const controller = new AbortController();
    fail("");
    void request<OpportunityBoard>(token, scope, "", "GET", undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setBoard(data); })
      .catch(reason => { if (!controller.signal.aborted) fail(describeError(reason)); });
    return () => controller.abort();
  }, [token, scope, refresh, supplied]);
  return { board: supplied ?? board, error };
}

export function OpportunityEditor({ token, userId, scope = "enterprise", seed, existing, board: loadedBoard, onClose, onDone }: {
  token: string; userId: string; scope?: Scope; seed?: OpportunitySeed; existing?: Opportunity; board?: OpportunityBoard;
  onClose: () => void; onDone: (id: string) => void;
}) {
  const { board, error: loadError } = useBoard(token, scope, 0, loadedBoard);
  const personal = scope === "personal";
  const [requestId] = useState(() => crypto.randomUUID());
  const [demand, setDemand] = useState(seed?.demand ?? emptyDemand);
  const [stage, setStage] = useState(existing?.stage ?? (seed?.outgoingQuote ? "QUOTED" : "NEW"));
  const [target, setTarget] = useState("");
  const [duplicate, setDuplicate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, fail] = useState("");
  const pending = useRef<AbortController>();
  useEffect(() => () => pending.current?.abort(), []);
  const linkOnly = Boolean(target && seed?.quote);
  const updateDemand = (fields: Partial<OpportunityDemand>) => setDemand(before => ({ ...before, ...fields }));

  async function submit(form: HTMLFormElement, joinExisting = false) {
    if (pending.current || !board) return;
    const aborts = new AbortController();
    pending.current = aborts;
    const input = new FormData(form);
    const fields = {
      stage, assigneeId: input.get("assigneeId") ?? userId,
      nextAction: input.get("nextAction"), nextStep: input.get("nextStep"), dueAt: input.get("dueAt"),
    };
    setBusy(true);
    fail("");
    try {
      const result = linkOnly
        ? await request<{ id: string }>(token, scope, `/${target}/quotes`, "POST", { quote: seed!.quote }, aborts.signal)
        : existing
          ? await request<{ id: string }>(token, scope, `/${existing.id}`, "PATCH", { ...fields, version: existing.version }, aborts.signal)
          : await request<{ id: string }>(token, scope, "", "POST", {
            ...fields, demand, requestId, demandId: seed?.demandId, supplyId: seed?.supplyId, quote: seed?.quote,
            plannedQuantity: input.get("plannedQuantity") ? Number(input.get("plannedQuantity")) : null, joinExisting,
          }, aborts.signal);
      if (!aborts.signal.aborted) onDone(result.id);
    } catch (reason) {
      if (aborts.signal.aborted) return;
      if (reason instanceof RequestError && reason.existingId) setDuplicate(reason.existingId);
      fail(describeError(reason));
    } finally {
      pending.current = undefined;
      if (!aborts.signal.aborted) setBusy(false);
    }
  }

  return <CircleDrawer title={existing ? "更新商机" : seed ? "转商机" : "新建商机"} onClose={onClose}>
    <form className="opportunity-editor" onSubmit={(event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submit(event.currentTarget, Boolean(duplicate));
    }}>
      {existing && <p className="opportunity-form-context">{existing.demand.title} · {existing.demand.quantity}{existing.demand.unit}</p>}
      {seed?.quote && <>
        <p className="opportunity-form-context">{personal ? "这版报价将归档到个人商机。" : "这版报价将归档到企业商机。"}</p>
        <label>归档到<select value={target} onChange={event => setTarget(event.target.value)}>
          <option value="">新建商机</option>
          {board?.opportunities.map(row => <option key={row.id} value={row.id}>{row.demand.title} · {row.demand.customer || row.demand.model}</option>)}
        </select></label>
      </>}
      {!linkOnly && <>
        {!existing && <div className="opportunity-fields">
          <label className="opportunity-wide">需求名称<input required maxLength={120} value={demand.title} onChange={event => updateDemand({ title: event.target.value })} /></label>
          <label>客户<input maxLength={100} value={demand.customer} onChange={event => updateDemand({ customer: event.target.value })} /></label>
          <label>型号<input required maxLength={100} value={demand.model} onChange={event => updateDemand({ model: event.target.value })} /></label>
          <label>数量<input type="number" min="0.000001" max="1000000000" step="any" required value={demand.quantity || ""} onChange={event => updateDemand({ quantity: event.target.valueAsNumber || 0 })} /></label>
          <label>单位<input required maxLength={16} value={demand.unit} onChange={event => updateDemand({ unit: event.target.value })} /></label>
          <label>交付地<input maxLength={60} value={demand.city} onChange={event => updateDemand({ city: event.target.value })} /></label>
          <label>交易方式<select value={demand.mode} onChange={event => updateDemand({ mode: event.target.value as OpportunityDemand["mode"] })}>
            {Object.entries(tradeModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          {seed?.supplyId && <label className="opportunity-wide">候选货源计划拿货量（可稍后填写）
            <input name="plannedQuantity" type="number" min="0.000001" max="1000000000" step="any" placeholder={demand.unit} />
          </label>}
        </div>}
        <fieldset>
          <div className="opportunity-fields">
            {!personal && <label>负责人<select name="assigneeId" defaultValue={existing?.assigneeId || userId} required>
              <option value={userId}>{board?.members.find(member => member.id === userId)?.name || "我"}</option>
              {board?.members.filter(member => member.id !== userId && (member.active || member.id === existing?.assigneeId))
                .map(member => <option key={member.id} value={member.id}>{member.name}{member.active ? "" : "（已停用）"}</option>)}
            </select></label>}
            <label>阶段<select value={stage} onChange={event => setStage(event.target.value as Opportunity["stage"])}>
              {Object.entries(opportunityStages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>下一步类型<select name="nextAction" defaultValue={existing?.nextAction || (seed?.outgoingQuote ? "CUSTOMER_REPLY" : "CONTACT")}>
              {Object.entries(nextActions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>跟进截止（北京时间）<input type="datetime-local" name="dueAt" required={isOpenOpportunity(stage)} defaultValue={localInput(existing?.dueAt ?? null)} /></label>
            <label className="opportunity-wide">下一步<input name="nextStep" maxLength={300} required={isOpenOpportunity(stage)}
              defaultValue={existing?.nextStep} placeholder="例如向供方确认深圳能提几台" /></label>
          </div>
        </fieldset>
      </>}
      {(error || loadError) && <p className="opportunity-error" role="alert">{error || loadError}</p>}
      <div className="opportunity-actions">
        <button className="circle-primary" type="submit" disabled={busy || !board}>
          {busy ? "正在保存…" : duplicate ? "加入已有商机" : linkOnly ? "关联报价" : "保存商机"}
        </button>
        {duplicate && <button className="circle-secondary" type="button" onClick={() => onDone(duplicate)}>打开已有商机</button>}
      </div>
    </form>
  </CircleDrawer>;
}

const sameModel = (line: PortfolioLine, row: Opportunity) => line.model.toUpperCase().replace(/\s+/g, "") ===
  row.demand.model.toUpperCase().replace(/\s+/g, "") && line.unit === row.demand.unit && line.mode === row.demand.mode;

function OpportunityDetail({ row, board, token, scope, onClose, onEdit, refresh }: {
  row: Opportunity; board: OpportunityBoard; token: string; scope: Scope; onClose: () => void; onEdit: () => void; refresh: () => void;
}) {
  const [error, fail] = useState("");
  const [saving, setSaving] = useState(false);
  const open = isOpenOpportunity(row.stage);
  const candidates = board.portfolio.filter(line => sameModel(line, row)).flatMap(line => line.sources)
    .filter(source => source.kind !== "DEMAND" && !row.supplies.some(link => link.ownerId === source.ownerId && link.id === source.id));
  async function saveSupply(fields: object) {
    if (saving) return;
    setSaving(true);
    fail("");
    try {
      await request(token, scope, `/${row.id}/supplies`, "POST", { ...fields, version: row.version });
      refresh();
    } catch (reason) { fail(describeError(reason)); }
    finally { setSaving(false); }
  }
  return <CircleDrawer title="商机详情" onClose={onClose}>
    <div className="opportunity-editor">
      <div className="opportunity-detail-heading">
        <div><h3>{row.demand.title}</h3><p>{[row.demand.customer, row.demand.city, tradeModes[row.demand.mode]].filter(Boolean).join(" · ")}</p></div>
        <button type="button" className="circle-secondary" onClick={onEdit}>更新跟进</button>
      </div>
      <p>{[opportunityStages[row.stage], scope === "enterprise" && (board.members.find(member => member.id === row.assigneeId)?.name || "企业成员"),
        shortTime(row.dueAt)].filter(Boolean).join(" · ")}</p>
      {row.nextStep && <p>{nextActions[row.nextAction]}：{row.nextStep}</p>}
      <section>
        <h4>备选货源</h4>
        <p>需 {row.demand.quantity}{row.demand.unit} · 已核实可用 {row.confirmedQuantity}{row.demand.unit} · 差 {Math.max(0, row.demand.quantity - row.confirmedQuantity)}{row.demand.unit}</p>
        {!row.supplies.length && <p className="opportunity-muted">还没有关联货源。</p>}
        {row.supplies.map(supply => <div className="opportunity-source" key={JSON.stringify([supply.ownerId, supply.id])}>
          <strong>{supply.title}</strong>
          <small>{[supply.source, supply.city, `原报 ${supply.quantity}${supply.unit}`].filter(Boolean).join(" · ")}</small>
          <small>{supply.unavailable ? "原货源已不可用" : supply.pressure ? "多单计划数量超过可供量，待核实" :
            supply.verifiedQuantity ? `已核实可用 ${supply.verifiedQuantity}${supply.unit}` : "可用量待核实"}</small>
          {open && <form className="opportunity-actions" onSubmit={event => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("plan");
            void saveSupply({ ownerId: supply.ownerId, sourceId: supply.id, plannedQuantity: value ? Number(value) : null });
          }}>
            <label>计划拿货量<input key={String(supply.plannedQuantity)} type="number" name="plan" min="0.000001" step="any"
              defaultValue={supply.plannedQuantity ?? ""} /></label>
            <button type="submit" className="circle-secondary" disabled={saving}>保存数量</button>
            <button type="button" className="circle-link" disabled={saving}
              onClick={() => void saveSupply({ ownerId: supply.ownerId, sourceId: supply.id, remove: true })}>移除</button>
          </form>}
        </div>)}
        {open && candidates.length > 0 && <form className="opportunity-actions" onSubmit={event => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("source");
          const source = candidates[Number(value)];
          if (source && value !== "") void saveSupply({ ownerId: source.ownerId, sourceId: source.id, plannedQuantity: null });
        }}>
          <label>添加同型号货源<select name="source" required defaultValue="">
            <option value="">请选择</option>
            {candidates.map((source, index) => <option value={index} key={JSON.stringify([source.ownerId, source.id])}>
              {source.title} · {source.quantity}{row.demand.unit} · {source.city || source.source}
            </option>)}
          </select></label>
          <button className="circle-secondary" disabled={saving}>添加</button>
        </form>}
        {error && <p className="opportunity-error" role="alert">{error}</p>}
      </section>
      {row.quotes.length > 0 && <section>
        <h4>已归档报价</h4>
        {row.quotes.map(quote => <div className="opportunity-source" key={quote.id}>
          <strong>{quote.outgoing ? "发出" : "收到"} V{quote.version} · {quote.terms.price}</strong>
          <small>{quote.terms.quantity} · {quote.terms.tax} · {quote.terms.delivery}</small>
          <small>{shortTime(quote.sentAt)} · 有效至 {quote.terms.validUntil}</small>
        </div>)}
      </section>}
      <details><summary>跟进记录（{row.events.length}）</summary>
        <ul className="opportunity-history">{row.events.map((event, index) => <li key={event.at + index}>
          <b>{event.note}</b> · {event.by} · {shortTime(event.at)}
          <p>{[opportunityStages[event.fields.stage], board.members.find(member => member.id === event.fields.assigneeId)?.name,
            event.fields.dueAt && shortTime(event.fields.dueAt), event.fields.nextStep].filter(Boolean).join(" · ")}</p>
        </li>)}</ul>
      </details>
    </div>
  </CircleDrawer>;
}

function reasonFor(row: Opportunity) {
  const today = localInput(new Date().toISOString()).slice(0, 10);
  const tomorrow = localInput(new Date(Date.now() + 86400000).toISOString()).slice(0, 10);
  const latestValid = row.quotes.find(quote => quote.outgoing)?.terms.validUntil;
  if (latestValid && latestValid < today) return "报价已过期";
  if (latestValid && latestValid <= tomorrow) return "报价即将过期";
  if (row.dueAt && Date.parse(row.dueAt) <= Date.now()) return "跟进已逾期";
  if (row.nextAction === "VERIFY_SUPPLY" || row.supplies.some(item => item.pressure)) return "货源待核实";
  return nextActions[row.nextAction];
}

export default function OpportunityWorkbench({ token, userId, initialId, scope = "enterprise" }: {
  token: string; userId: string; initialId?: string; scope?: Scope;
}) {
  const [revision, setRevision] = useState(0);
  const { board, error } = useBoard(token, scope, revision);
  const personal = scope === "personal";
  const [selected, setSelected] = useState(initialId ?? "");
  const [editor, setEditor] = useState<"create" | "edit">();
  const [filter, setFilter] = useState<"today" | "open" | "closed">("today");
  const [modelQuery, setModelQuery] = useState("");
  const refresh = () => setRevision(value => value + 1);
  useEffect(() => { setSelected(initialId ?? ""); }, [initialId]);
  const rows = board?.opportunities ?? [];
  const row = rows.find(item => item.id === selected);
  const tomorrow = localInput(new Date(Date.now() + 86400000).toISOString()).slice(0, 10);
  const today = rows.filter(item => isOpenOpportunity(item.stage) &&
    (localInput(item.dueAt).slice(0, 10) < tomorrow || ["报价即将过期", "报价已过期"].includes(reasonFor(item))));
  const filtered = filter === "closed" ? rows.filter(item => !isOpenOpportunity(item.stage)) :
    filter === "open" ? rows.filter(item => isOpenOpportunity(item.stage)) : today;
  return <div className="opportunity-board">
    <section className="ent-card">
      <header className="opportunity-heading"><div><h3>今天要跟的单</h3><p>{personal ? "查看待回复、快到期的报价和待核实货源。" :
        board?.manager ? "看看哪单要催、哪单还缺货。" : "查看分给你的商机和下一步。"}</p></div>
        <button className="circle-primary" type="button" disabled={!board} onClick={() => setEditor("create")}><Plus size={16} />新建商机</button>
      </header>
      {error && <p className="opportunity-error" role="alert">{error} <button type="button" className="circle-link" onClick={refresh}>重试</button></p>}
      {!board && !error && <p role="status">正在加载商机…</p>}
      {board && <>
        <div className="opportunity-filters" role="group" aria-label="商机状态">
          {([["today", `今天要跟 · ${today.length}`], ["open", "全部在跟"], ["closed", "已结束"]] as const).map(([value, label]) =>
            <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        {filtered.length ? <ul className="opportunity-list">{filtered.map(item => <li key={item.id}>
          <button type="button" onClick={() => setSelected(item.id)}>
            <div><strong>{item.demand.title}</strong><small>{item.demand.customer || item.demand.city || item.demand.model} · {item.demand.quantity}{item.demand.unit}
              {!personal && <> · {board.members.find(member => member.id === item.assigneeId)?.name || "企业成员"}</>}</small></div>
            <div><strong>{isOpenOpportunity(item.stage) ? reasonFor(item) : opportunityStages[item.stage]}</strong><small>{item.nextStep || opportunityStages[item.stage]}</small></div>
            <div><time dateTime={item.dueAt ?? undefined}>{shortTime(item.dueAt)}</time><small>{`已核实 ${item.confirmedQuantity}/${item.demand.quantity}${item.demand.unit}`}</small></div>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </li>)}</ul> : <p className="opportunity-empty">{filter === "today" ? "今天暂无到期跟进，可以切到「全部在跟」查看其他商机。" :
          filter === "open" ? "还没有在跟的商机，可以从匹配详情或报价转入。" : "还没有已结束的商机。"}</p>}
        {selected && !row && <p className="opportunity-error" role="status">这笔商机当前不可访问。</p>}
      </>}
    </section>
    {board && <section className="ent-card">
      <header className="opportunity-heading">
        <div><h3>{board.manager ? "公司手上的货和需求" : "我整理的货和需求"}</h3><p>按型号、单位和交易方式汇总。采集到的数量以实际核实为准。</p></div>
        <input aria-label="筛选供需型号" placeholder="搜索型号" value={modelQuery} onChange={event => setModelQuery(event.target.value)} />
      </header>
      {board.portfolio.filter(line => line.model.toLowerCase().includes(modelQuery.trim().toLowerCase())).map(line =>
        <details className="opportunity-portfolio" key={line.key}>
          <summary>
            <strong>{line.model} <small>{tradeModes[line.mode]}</small></strong>
            <span>需求 {line.demand}{line.unit}</span><span>已核实 {line.verified}{line.unit}</span>
            <span>待核实 {line.unverified}{line.unit}</span><span>缺口 {Math.max(0, line.demand - line.verified)}{line.unit}</span>
          </summary>
          <ul className="opportunity-history">{[...line.sources].sort((a, b) => b.date.localeCompare(a.date)).map(source =>
            <li key={JSON.stringify([source.ownerId, source.kind, source.id])}>
              <strong>{source.kind === "DEMAND" ? "需求" : source.kind === "VERIFIED" ? "已核实供应" : "待核实供应"} · {source.title}</strong>
              <p>{[source.source, source.city, source.quantity + line.unit, shortTime(source.date)].filter(Boolean).join(" · ")}</p>
            </li>)}</ul>
        </details>)}
      {!board.portfolio.some(line => line.model.toLowerCase().includes(modelQuery.trim().toLowerCase())) &&
        <p className="opportunity-empty">{modelQuery ? "没有匹配型号。" : "核对入库后，供需会出现在这里。"}</p>}
    </section>}
    {board && row && !editor && <Fragment key={row.id}>
      <OpportunityDetail row={row} board={board} token={token} scope={scope}
        onClose={() => setSelected("")} onEdit={() => setEditor("edit")} refresh={refresh} /></Fragment>}
    {board && editor && <OpportunityEditor token={token} userId={userId} scope={scope} board={board} existing={editor === "edit" ? row : undefined}
      onClose={() => setEditor(undefined)} onDone={id => { setSelected(id); setEditor(undefined); refresh(); }} />}
  </div>;
}
