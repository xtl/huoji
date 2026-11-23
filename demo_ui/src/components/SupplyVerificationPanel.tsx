import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ClipboardCopy, MessageSquarePlus } from "lucide-react";
import {
  assessVerification, emptyVerificationEntry, suggestSellerFields, validateVerificationEntry,
  type VerificationContext, type VerificationEntry,
} from "../supply-verification";
import { wechatTimestamp } from "../wechat-time-label";

type Source = {
  groupName?: string;
  sender?: string;
  contact?: string;
  observedAt?: string;
  publishedTimeText?: string;
  excerpt?: string;
  sourceRef?: string;
};
type Role = VerificationEntry["role"];
type SellerFields = { packaging: VerificationEntry["packaging"]; batch: string; stockQuantity: string; reservableQuantity: string };

const control = "field-surface w-full min-w-0 rounded-md px-2 py-1.5 text-sm text-neutral-900";
const secondaryButton = "ghost-button surface-card-quiet inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm";
const packagingNames = { unknown: "未说明", original: "原厂", "white-label": "白牌" };

function localTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short", hour12: false });
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid min-w-0 gap-1 text-xs font-medium text-neutral-600">
    {label}{children}
  </label>;
}

function attribution(entry?: VerificationEntry) {
  return entry ? `${entry.confirmedBy} · 记录于 ${localTime(entry.recordedAt)}` : "";
}

function SourceDetails({ source }: { source: Source }) {
  if (!Object.values(source).some(Boolean)) return null;
  return <details className="mt-2 text-xs text-neutral-600">
    <summary className="cursor-pointer py-1 font-medium">货源出处</summary>
    <div className="mt-1 grid gap-1 rounded-md bg-neutral-50 p-2">
      {source.groupName && <p>来源群 · {source.groupName}</p>}
      {source.sender && <p>消息发布人 · {source.sender}</p>}
      {source.contact && <p>货源联系人 · {source.contact}</p>}
      {source.publishedTimeText && <p>{source.publishedTimeText}</p>}
      {source.observedAt && <p>采集时间 · {wechatTimestamp(source.observedAt)}</p>}
      {source.sourceRef && <p className="break-words">来源记录 · {source.sourceRef}</p>}
      {source.excerpt && <blockquote className="whitespace-pre-wrap break-words border-l-2 border-neutral-300 pl-2">{source.excerpt}</blockquote>}
    </div>
  </details>;
}

function ReplyForm({ role, context, packaging, respondents, onCancel, onSave }: {
  role: Role;
  context: VerificationContext;
  packaging: VerificationEntry["packaging"];
  respondents: string[];
  onCancel: () => void;
  onSave: (entry: VerificationEntry) => void | Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [buyerPackaging, setBuyerPackaging] = useState(packaging);
  const [edits, setEdits] = useState<Partial<SellerFields>>({});
  const suggested = useMemo(() => role === "seller" ? suggestSellerFields(reply, context.unit) : {}, [reply, context.unit, role]);
  const sellerFields: SellerFields = {
    packaging: suggested.packaging ?? "unknown",
    batch: suggested.batch ?? "",
    stockQuantity: suggested.stockQuantity?.toString() ?? "",
    reservableQuantity: suggested.reservableQuantity?.toString() ?? "",
    ...edits,
  };
  const respondentList = useId();
  const moreFields = useRef<HTMLDetailsElement>(null);
  const reservationFields = useRef<HTMLDetailsElement>(null);
  const unit = context.unit ? `（${context.unit}）` : "";
  const preview = [
    sellerFields.stockQuantity !== "" && `现货 ${sellerFields.stockQuantity}${context.unit || ""}`,
    sellerFields.reservableQuantity !== "" && `可预留 ${sellerFields.reservableQuantity}${context.unit || ""}`,
    sellerFields.packaging !== "unknown" && packagingNames[sellerFields.packaging],
    sellerFields.batch,
  ].filter(Boolean).join(" · ");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const quantity = (name: string) => value(name) === "" ? undefined : Number(value(name));
    const deadline = (name: string) => value(name) ? new Date(value(name)).toISOString() : undefined;
    const entry = emptyVerificationEntry(role);
    entry.confirmedBy = value("confirmedBy");
    entry.reply = value("reply");
    if (role === "seller") {
      entry.holder = value("holder") as VerificationEntry["holder"];
      entry.packaging = value("packaging") as VerificationEntry["packaging"];
      entry.batch = value("batch");
      entry.stockQuantity = quantity("stockQuantity");
      entry.reservableQuantity = quantity("reservableQuantity");
      entry.reservableUntil = deadline("reservableUntil");
      entry.reservedQuantity = quantity("reservedQuantity");
      entry.reservedUntil = deadline("reservedUntil");
    } else {
      entry.buyerAcceptsPackaging = (value("acceptance") || "unknown") as VerificationEntry["buyerAcceptsPackaging"];
      if (entry.buyerAcceptsPackaging !== "unknown" && buyerPackaging !== "unknown") {
        entry.acceptedPackaging = buyerPackaging;
      }
    }
    const problem = validateVerificationEntry(entry, context);
    if (problem) {
      setError(problem);
      if (moreFields.current) moreFields.current.open = true;
      if (reservationFields.current) reservationFields.current.open = true;
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(entry);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "回复未保存，填写的内容已保留，请重试。");
      setBusy(false);
    }
  }

  return <form onSubmit={submit} aria-label={role === "seller" ? "记录供货方回复" : "记录买方回复"} className="mt-3 grid min-w-0 gap-3">
    <Field label="对方回复原文">
      <textarea name="reply" className={control} rows={3} required maxLength={5000} autoFocus
        placeholder={role === "seller" ? "粘贴供货方回复，自动提取现货、可预留数量等信息" : "粘贴买方的回复"}
        value={reply} onChange={event => setReply(event.target.value)} />
    </Field>
    <Field label="回复人">
      <input name="confirmedBy" list={respondents.length ? respondentList : undefined} className={control} required maxLength={120} placeholder="填写或选择实际回复人的昵称" autoComplete="off" />
      {respondents.length > 0 && <datalist id={respondentList}>{respondents.map(name => <option key={name} value={name} />)}</datalist>}
    </Field>
    {role === "seller" ? <>
      <details ref={moreFields} className="rounded-md border border-neutral-200 px-2.5">
        <summary className="cursor-pointer py-2 text-sm font-medium text-neutral-800">
          {preview ? "核对提取结果" : "补充现货、数量或批次"}
          {preview && <span className="mt-1 block break-words text-sm font-normal text-neutral-600">{preview}</span>}
        </summary>
        <div className="grid gap-2 border-t border-neutral-200 py-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label={`对方确认的现货${unit}`}><input name="stockQuantity" type="number" min="0" step="1" className={control} value={sellerFields.stockQuantity} onChange={event => setEdits({ ...edits, stockQuantity: event.target.value })} /></Field>
            <Field label={`可为本单预留${unit}`}><input name="reservableQuantity" type="number" min="0" step="1" className={control} value={sellerFields.reservableQuantity} onChange={event => setEdits({ ...edits, reservableQuantity: event.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="成品类型">
              <select name="packaging" className={control} value={sellerFields.packaging} onChange={event => setEdits({ ...edits, packaging: event.target.value as SellerFields["packaging"] })}>
                <option value="unknown">本次未说明</option>
                <option value="original">原厂</option>
                <option value="white-label">白牌</option>
              </select>
            </Field>
            <Field label="批次"><input name="batch" className={control} placeholder="如 DC25" maxLength={100} value={sellerFields.batch} onChange={event => setEdits({ ...edits, batch: event.target.value })} /></Field>
          </div>
          <Field label="可预留至"><input name="reservableUntil" type="datetime-local" className={control} /></Field>
        </div>
      </details>
      <details ref={reservationFields} className="rounded-md border border-neutral-200 px-2.5">
        <summary className="cursor-pointer py-2 text-sm font-medium text-neutral-800">登记持货人或本单锁货</summary>
        <div className="grid gap-2 border-t border-neutral-200 py-2">
          <Field label="对方与货源的关系">
            <select name="holder" className={control}>
              <option value="unknown">本次未说明</option>
              <option value="holder">对方自述持货</option>
              <option value="intermediary">对方转述上家货源</option>
            </select>
          </Field>
          <Field label={`已为本单预留${unit}`}><input name="reservedQuantity" type="number" min="0" step="1" className={control} /></Field>
          <Field label="本单预留到期时间"><input name="reservedUntil" type="datetime-local" className={control} /></Field>
        </div>
      </details>
    </> : <>
      <Field label="买方回复涉及的成品类型">
        <select className={control} value={buyerPackaging} onChange={event => setBuyerPackaging(event.target.value as VerificationEntry["packaging"])}>
          <option value="unknown">本次未说明</option><option value="original">原厂</option><option value="white-label">白牌</option>
        </select>
      </Field>
      <Field label={buyerPackaging === "unknown" ? "买方接受情况" : `买方是否接受${packagingNames[buyerPackaging]}`}>
        <select key={buyerPackaging} name="acceptance" className={control} disabled={buyerPackaging === "unknown"}>
          <option value="unknown">本次未说明</option>
          <option value="yes">接受</option>
          <option value="no">不接受</option>
        </select>
      </Field>
    </>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button className="primary-button min-h-9 rounded-md px-3 py-1.5 text-sm font-medium" disabled={busy} type="submit">{busy ? "保存中…" : "保存回复"}</button>
      <button type="button" className={secondaryButton} disabled={busy} onClick={onCancel}>取消</button>
    </div>
  </form>;
}

export function SupplyVerificationPanel({ context, evidence, onSave, source }: {
  context: VerificationContext;
  evidence: readonly VerificationEntry[];
  onSave: (entry: VerificationEntry) => void | Promise<void>;
  source: Source;
}) {
  const [role, setRole] = useState<Role>("seller");
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [tick, setTick] = useState(0);
  const questionDetails = useRef<HTMLDetailsElement>(null);
  const recordButton = useRef<HTMLButtonElement>(null);
  const now = new Date();
  const summary = assessVerification(context, evidence, now);
  const reserved = summary.latestReservedEntry;
  const offer = summary.latestReservableEntry;
  useEffect(() => {
    const due = [reserved?.reservedUntil, offer?.reservableUntil]
      .map(value => Date.parse(value || ""))
      .filter(time => time > now.getTime());
    if (!due.length) return;
    const refresh = () => setTick(count => count + 1);
    const refreshVisible = () => { if (!document.hidden) refresh(); };
    const delay = Math.min(2_147_483_647, Math.max(0, Math.min(...due) - Date.now() + 1));
    const timer = window.setTimeout(refresh, delay);
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("focus", refresh);
    };
  }, [reserved?.reservedUntil, offer?.reservableUntil, tick]);

  const question = role === "seller" ? summary.sellerQuestion : summary.buyerQuestion;
  const unit = context.unit || "";
  const packageEntry = summary.latestPackagingEntry;
  const buyerEntry = summary.latestBuyerPackagingEntry;
  const history = [...evidence].sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  const respondents = [...new Set(history.filter(entry => entry.role === role).map(entry => entry.confirmedBy))];
  const specFacts = [
    packageEntry && `供方确认${packagingNames[packageEntry.packaging]}`,
    summary.latestBatchEntry && `批次 ${summary.latestBatchEntry.batch}`,
    buyerEntry && `买方${buyerEntry.buyerAcceptsPackaging === "yes" ? "接受" : "不接受"}${packagingNames[buyerEntry.acceptedPackaging]}`,
  ].filter(Boolean);

  async function copyQuestion() {
    try {
      await navigator.clipboard.writeText(question);
      setFeedback("已复制，可以粘贴到微信。");
    } catch {
      if (questionDetails.current) questionDetails.current.open = true;
      setFeedback("请选中上方问题，手动复制到微信。");
    }
  }

  function closeEditor() {
    setEditing(false);
    window.requestAnimationFrame(() => recordButton.current?.focus({ preventScroll: true }));
  }

  async function saveReply(entry: VerificationEntry) {
    await onSave(entry);
    closeEditor();
    setFeedback("已保存这笔匹配的核实记录。");
  }

  return <section aria-label="货源核实" className="mt-4 border-t border-neutral-200 pt-3">
    <h3 className="text-base font-semibold text-neutral-900">货源核实</h3>
    <dl className="mt-2 grid grid-cols-2 gap-2">
      <div className="min-w-0 rounded-md bg-neutral-50 p-2.5">
        <dt className="text-xs text-neutral-600">供方反馈现货</dt>
        <dd className="mt-1 font-semibold">{summary.stockQuantity === undefined ? "待确认" : `${summary.stockQuantity}${unit}`}</dd>
        {summary.latestStockEntry && <dd className="caption-text mt-1 break-words">{attribution(summary.latestStockEntry)}</dd>}
      </div>
      <div className="min-w-0 rounded-md bg-emerald-50 p-2.5">
        <dt className="text-xs text-emerald-800">本单有效预留</dt>
        <dd className="mt-1 font-semibold text-emerald-950">{summary.activeReservedQuantity}{unit}</dd>
        {reserved && <dd className="caption-text mt-1 break-words">
          {reserved.reservedUntil && `${summary.reservationExpired ? "已过期" : "至"} ${localTime(reserved.reservedUntil)} · `}{attribution(reserved)}
        </dd>}
      </div>
    </dl>
    {summary.shortfall !== undefined && <p className="mt-2 text-xs text-neutral-700">本单需求 {context.demandQuantity}{context.demandUnit}，按有效预留还差 {summary.shortfall}{context.demandUnit}。</p>}
    {offer && <p className="mt-2 text-xs text-neutral-700">
      供方表示可预留 {offer.reservableQuantity}{unit}{offer.reservableUntil && `，至 ${localTime(offer.reservableUntil)}`}
      {offer.reservableUntil && Date.parse(offer.reservableUntil) <= now.getTime() && "（已到期）"}。{attribution(offer)}
    </p>}
    {summary.latestHolderEntry && <p className="mt-1 text-xs text-neutral-700">{summary.latestHolderEntry.confirmedBy}{summary.latestHolderEntry.holder === "holder" ? "自述持货" : "转述上家货源"}</p>}
    {specFacts.length > 0 && <p className="mt-1 text-xs text-neutral-700">{specFacts.join(" · ")}</p>}
    {summary.notices.length > 0 && <ul className="mt-2 grid list-disc gap-1 rounded-md bg-amber-50 py-2 pr-2 pl-6 text-xs leading-relaxed text-amber-900">
      {summary.notices.map(note => <li key={note}>{note}</li>)}
    </ul>}
    <div className="mt-3 grid grid-cols-2 gap-1 rounded-md bg-neutral-100 p-1" role="group" aria-label="核实对象">
      {(["seller", "buyer"] as const).map(value => <button key={value} type="button" aria-pressed={value === role}
        disabled={editing && value !== role} className={`min-h-9 rounded px-2 text-sm font-medium ${value === role ? "bg-white text-neutral-950 shadow-sm" : "text-neutral-600 hover:text-neutral-900"} disabled:opacity-40`}
        onClick={() => { setRole(value); setFeedback(""); }}>
        {value === "seller" ? "问供货方" : "问买方"}
      </button>)}
    </div>
    {!editing && <>
      {question ? <details ref={questionDetails} className="mt-2 rounded-md bg-neutral-50 px-2.5">
        <summary className="cursor-pointer py-2 text-sm font-medium text-neutral-700">查看核实问题</summary>
        <p className="select-text whitespace-pre-wrap break-words pb-2 text-sm leading-relaxed text-neutral-800">{question}</p>
      </details> : <p className="caption-text my-2">目前没有需向{role === "seller" ? "供货方" : "买方"}追问的项目。</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {question && <button type="button" className="primary-button inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium" onClick={copyQuestion}><ClipboardCopy size={15} />复制问题</button>}
        <button ref={recordButton} type="button" className={secondaryButton} onClick={() => { setEditing(true); setFeedback(""); }}><MessageSquarePlus size={15} />记录回复</button>
      </div>
    </>}
    {editing && <ReplyForm role={role} context={context} packaging={packageEntry?.packaging ?? "unknown"} respondents={respondents} onCancel={closeEditor} onSave={saveReply} />}
    {feedback && <p role="status" className="caption-text mt-2">{feedback}</p>}
    <SourceDetails source={source} />
    {history.length > 0 && <details className="mt-2 text-xs">
      <summary className="cursor-pointer py-1 font-medium text-neutral-600">核实记录（{history.length}）</summary>
      <ol className="mt-1 grid gap-2">{history.map(entry => <li key={entry.id} className="rounded-md bg-neutral-50 p-2">
        <p className="font-medium">{entry.role === "buyer" ? "买方" : "供货方"} · {attribution(entry)}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-neutral-600">{entry.reply}</p>
      </li>)}</ol>
    </details>}
  </section>;
}
