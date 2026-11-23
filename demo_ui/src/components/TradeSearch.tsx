import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { compareChronology, tradeChronology, type TimedTrade } from "../trade-chronology";
import { tradeTimeCaption } from "../wechat-time-label";

type Trade = TimedTrade & {
  id: string; title: string; gpuModel: string; sourceContact: string; locationCity: string; quantity: number; quantityUnit: string;
  sourceChatName?: string; sourceSender?: string; tradeMode: string; configItems: { label: string; value: string }[];
};
type Kind = "stock" | "market";
function kindLabel(kind: Kind, item: Trade) {
  return item.tradeMode === "RENTAL" ? (kind === "stock" ? "出租" : "求租") : kind === "stock" ? "供应" : "需求";
}
type Result = { kind: Kind; item: Trade; position: number };
type Props = {
  stocks: (Trade & { createdAt: string })[];
  demands: (Trade & { publishedAt: string })[];
  onChoose: (kind: Kind, id: string, position: number) => void;
};

export default function TradeSearch(props: Props) {
  const [open, setOpen] = useState(false);
  const shortcut = /Mac|iPad|iPhone/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "k" || event.isComposing) return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="global-search-trigger" aria-label="搜索供需" aria-haspopup="dialog">
      <Search size={16} /><span>搜索供需</span><kbd>{shortcut}</kbd>
    </button>
    {open && <SearchPanel {...props} onClose={() => setOpen(false)} />}
  </>;
}

function SearchPanel({ stocks, demands, onChoose, onClose }: Props & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [limit, setLimit] = useState(25);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const records = useMemo(() => [
    ...stocks.map((item, position): Result => ({ kind: "stock", item, position })),
    ...demands.map((item, position): Result => ({ kind: "market", item, position })),
  ].sort((a, b) => compareChronology(tradeChronology(a.item), tradeChronology(b.item))), [stocks, demands]);
  const keyword = query.trim().toLocaleLowerCase();
  const matches = useMemo(() => {
    if (!keyword) return records;
    const terms = keyword.split(/\s+/);
    return records.filter(({ item, kind }) => {
      const fields = [kind === "stock" ? "供应" : "需求", kindLabel(kind, item), item.tradeMode === "RENTAL" ? "租赁" : "", item.title, item.gpuModel, item.locationCity, item.sourceContact,
        item.sourceSender, item.sourceChatName, ...item.configItems.map(field => field.value)].join(" ").toLocaleLowerCase();
      return terms.every(term => fields.includes(term));
    });
  }, [records, keyword]);
  const visible = matches.slice(0, keyword ? limit : 6);
  const selected = Math.min(index, visible.length - 1);
  function choose(result: Result) {
    dialog.current?.close();
    onClose();
    onChoose(result.kind, result.item.id, result.position);
  }
  return <dialog ref={dialog} aria-labelledby="trade-search-title" className="search-dialog"
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className="search-panel">
      <h2 id="trade-search-title" className="sr-only">搜索已入库的供需</h2>
      <div className="search-prompt"><Search size={21} />
        <input autoFocus aria-label="搜索已入库的供需" role="combobox" aria-autocomplete="list" aria-controls="trade-search-results" aria-expanded="true"
          aria-activedescendant={selected >= 0 ? `trade-search-hit-${selected}` : undefined} placeholder="搜索型号、发言人或群名"
          value={query} onChange={event => { setQuery(event.target.value); setIndex(0); setLimit(25); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || !visible.length) return;
            if (event.key === "Enter") { event.preventDefault(); choose(visible[selected]); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const next = (selected + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
              setIndex(next);
              document.getElementById(`trade-search-hit-${next}`)?.scrollIntoView({ block: "nearest" });
            }
          }} />
        <button aria-label="关闭搜索" type="button" onClick={onClose}><X size={18} /></button>
      </div>
      <p className="search-section" role="status">{keyword ? `找到 ${matches.length} 条供需` : "最近供需"}</p>
      <div className="search-results" role="listbox" id="trade-search-results" aria-label="供需结果">
        {visible.map((result, i) => {
          const { item, kind } = result;
          return <button key={kind + item.id} id={`trade-search-hit-${i}`} tabIndex={-1} type="button" role="option"
            aria-selected={selected === i} onPointerEnter={() => setIndex(i)} onClick={() => choose(result)}>
            <span className={`search-kind kind-${kind}`}>{kindLabel(kind, item)}</span>
            <span className="search-hit"><strong>{item.title || item.gpuModel}</strong>
              <small>{[item.sourceContact || item.sourceSender, item.sourceChatName, item.locationCity, item.quantity > 0 && `${item.quantity}${item.quantityUnit}`].filter(Boolean).join(" · ")}</small>
              <small className="search-time">{tradeTimeCaption(item)}</small></span>
            <ArrowUpRight size={15} />
          </button>;
        })}
      </div>
      {keyword && matches.length > visible.length && <button className="search-more" type="button" onClick={() => setLimit(value => value + 25)}>显示更多结果</button>}
      {!visible.length && <p className="search-empty">{records.length ? "没有找到记录，试试其他型号或群名。" : "供应库和需求库还是空的。消息入库后就能在这里搜索。"}</p>}
    </div>
  </dialog>;
}
