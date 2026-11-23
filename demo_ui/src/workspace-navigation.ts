import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

export type TabKey = "input" | "stock" | "market" | "match" | "account" | "circle";
export type IntakeView = "wechat" | "paste" | "review" | "talk";
type InboxView = Exclude<IntakeView, "paste">;
export const TALK_HASH = "#input/talk";
export type AccountSection = "overview" | "credits" | "ledger" | "deepseek" | "enterprise";
export const DEEPSEEK_SETTINGS_HASH = "#settings/deepseek";

const onNavigation = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  window.addEventListener("popstate", notify);
  return () => {
    window.removeEventListener("hashchange", notify);
    window.removeEventListener("popstate", notify);
  };
};

export function useWorkspaceRoute() {
  const locationHash = useSyncExternalStore(onNavigation, () => window.location.hash);
  const hash = locationHash === "#account/membership"
    ? "#account/credits"
    : locationHash.replace(/^#talk(?=\/|$)/, TALK_HASH);
  useEffect(() => {
    if (hash !== locationHash && window.location.hash === locationHash) navigateWorkspace(hash, true);
  }, [locationHash, hash]);
  const [page, section] = hash.slice(1).split("/");
  let activeTab: TabKey = "input";
  if (page === "market" || page === "stock" || page === "account" || page === "match" || page === "circle") activeTab = page;
  const intakeView: IntakeView = page === "input" && (section === "paste" || section === "review" || section === "talk") ? section : "wechat";
  let accountSection: AccountSection = "overview";
  if (hash === DEEPSEEK_SETTINGS_HASH) {
    activeTab = "account";
    accountSection = "deepseek";
  } else if (page === "account" && (section === "enterprise" || section === "credits" || section === "ledger")) {
    accountSection = section;
  }
  return { activeTab, intakeView, accountSection, hash };
}

export function navigateWorkspace(hash: string, replace = false) {
  if (window.location.hash === hash) return;
  if (replace) window.history.replaceState(window.history.state, "", hash);
  else window.history.pushState(null, "", hash);
  window.dispatchEvent(new Event("hashchange"));
}

export function setIntakeView(view: IntakeView) {
  navigateWorkspace(`#input/${view}`);
}

export function useMessageEntry(scope: string, hash: string, view: IntakeView, unread: number, connected: boolean) {
  const key = "huoji_message_view:" + scope;
  const stored = useMemo((): InboxView => {
    try {
      const value = localStorage.getItem(key);
      if (value === "talk" || value === "review") return value;
    } catch { /* Use the current tab's in-memory preference. */ }
    return "wechat";
  }, [key]);
  const [remembered, remember] = useState<{ key: string; view: InboxView } | null>(null);
  const last = remembered?.key === key ? remembered.view : stored;
  const landing = !hash || hash === "#input" || hash === "#input/";
  const href = unread > 0 ? TALK_HASH : "#input/" + last;
  useEffect(() => {
    if (!scope || !hash.startsWith("#input/") || landing || view === "paste" || last === view) return;
    remember({ key, view });
    try { localStorage.setItem(key, view); } catch { /* Keep the in-memory preference. */ }
  }, [scope, hash, landing, view, last, key]);
  useEffect(() => {
    if (!scope || !landing) return;
    const enter = () => { if (window.location.hash === hash) navigateWorkspace(href, true); };
    if (connected) { enter(); return; }
    // Keep local collection usable even if the conversation service is unavailable.
    const timer = setTimeout(enter, 800);
    return () => clearTimeout(timer);
  }, [scope, hash, landing, href, connected]);
  return { href, last, landing };
}

export function setAccountSection(section: AccountSection) {
  navigateWorkspace(section === "deepseek" ? DEEPSEEK_SETTINGS_HASH : section === "overview" ? "#account" : `#account/${section}`);
}
