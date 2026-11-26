import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUpRight, Box, ChevronDown, Building2, CircleUserRound, GitCompareArrows, Inbox, ListFilter, LogOut, Store, WalletCards } from "lucide-react";
import type { TabKey } from "../workspace-navigation";
import EditionBadge, { assistantEdition } from "./EditionBadge";

const destinations = [
  { key: "input", label: "消息", icon: Inbox },
  { key: "stock", label: "供应库", icon: Box },
  { key: "market", label: "需求库", icon: ListFilter },
  { key: "match", label: "匹配", icon: GitCompareArrows },
  { key: "circle", label: "内圈", icon: Store },
  { key: "account", label: "我的", icon: CircleUserRound },
] as const;

type NavigationProps = { activeTab: TabKey; onNavigate: (tab: TabKey) => void; messageHref: string; matchHref?: string; unread: number };

function NavigationLinks({ activeTab, onNavigate, messageHref, matchHref, unread }: NavigationProps) {
  return destinations.filter(item => item.key !== "account").map(({ key, icon: Icon, label }) => (
    <a key={key} href={key === "input" ? messageHref : key === "match" && matchHref ? matchHref : `#${key}`}
      aria-current={key === activeTab ? "page" : undefined} className="workspace-link"
      aria-label={key === "input" && unread > 0 ? `消息，${unread} 条同行未读` : undefined}
      onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(key);
      }}>
      <Icon size={17} strokeWidth={1.7} aria-hidden="true" />{key === "match" && matchHref ? "商机" : label}
      {key === "input" && unread > 0 && <b className="circle-unread nav-unread" aria-hidden="true">{unread > 99 ? "99+" : unread}</b>}
    </a>
  ));
}

export function WorkbenchHeader({ activeTab, onNavigate, messageHref, matchHref, unread, workspace, maskedPhone, credits, onCredits, onAccount, onEnterprise, company, onLogout, children }: NavigationProps & {
  workspace: string; maskedPhone: string; credits: number|null; company: boolean; onEnterprise:()=>void;
  onCredits: () => void; onAccount: () => void; onLogout: () => void; children: ReactNode;
}) {
  const account = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (account.current && event.target instanceof Node && !account.current.contains(event.target)) account.current.open = false;
    };
    const close = () => { if (account.current) account.current.open = false; };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("hashchange", close);
    return () => { window.removeEventListener("pointerdown", dismiss); window.removeEventListener("hashchange", close); };
  }, []);
  function select(action: () => void) {
    if (account.current) account.current.open = false;
    action();
  }
  const brand = <a href={messageHref} className="masthead-brand" aria-label="货记，打开消息工作台">
    <img alt="" src="/huoji-icon.png" width="30" height="30" /><strong>货记</strong>
  </a>;
  return <header className="masthead"><div className="masthead-inner">
    {assistantEdition() ? <div className="masthead-identity">{brand}<EditionBadge /></div> : brand}
    <nav className="workspace-menu" aria-label="主导航"><NavigationLinks activeTab={activeTab} onNavigate={onNavigate} messageHref={messageHref} matchHref={matchHref} unread={unread} /></nav>
    <div className="masthead-tools">
      {children}
      <details ref={account} className="account-dropdown" onKeyDown={event => {
        if (event.key === "Escape" && account.current?.open) {
          event.stopPropagation(); account.current.open = false; account.current.querySelector("summary")?.focus();
        }
      }} onBlur={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}>
        <summary aria-label={`账户菜单，${maskedPhone}`}>
          <CircleUserRound size={20} strokeWidth={1.6} /><span>{maskedPhone}</span><ChevronDown size={13} />
        </summary>
        <div className="account-popover">
          <div className="account-identity"><strong>{maskedPhone}</strong><span>{workspace}</span></div>
          <button type="button" onClick={()=>select(onEnterprise)}><Building2 size={16} />企业工作台<ArrowUpRight size={14}/></button>
          {!company && <button type="button" onClick={() => select(onAccount)}><CircleUserRound size={16} />个人中心<ArrowUpRight size={14} /></button>}
          <button type="button" onClick={() => select(onCredits)}><WalletCards size={16} />{company?"企业货记分":"货记分余额"}<b>{credits?.toLocaleString("zh-CN")??"—"}</b></button>
          <button type="button" onClick={() => select(onLogout)}><LogOut size={16} />退出登录</button>
        </div>
      </details>
    </div>
  </div></header>;
}

export function MobileNavigation(props: NavigationProps) {
  return <nav aria-label="移动导航" className="workspace-mobile-nav"><NavigationLinks {...props} /></nav>;
}
