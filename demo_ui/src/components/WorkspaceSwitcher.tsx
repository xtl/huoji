import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown, UserRound } from "lucide-react";
import type { AuthSession } from "../App";
import { companyRequest } from "./enterprise-client";

export default function WorkspaceSwitcher({
  session,
  onSwitch,
  onManage,
}: {
  session: AuthSession;
  onSwitch: (next: AuthSession) => void;
  onManage: () => void;
}) {
  const space = session.workspaces.find((w) => w.id === session.currentWorkspaceId)!;
  const menu = useRef<HTMLDetailsElement>(null);
  const [spaces, setSpaces] = useState(session.workspaces),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node)) menu.current.open = false;
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);
  async function refresh() {
    try {
      const result = await fetch("/api/auth/me", {
        headers: { Authorization: "Bearer " + session.token },
        cache: "no-store",
      });
      if (result.ok) setSpaces((await result.json()).workspaces);
    } catch {
      /* Cached choices remain available. */
    }
  }
  async function choose(id: string) {
    if (id === space.id) {
      menu.current!.open = false;
      return;
    }
    setBusy(true);
    setError("");
    try {
      onSwitch(await companyRequest<AuthSession>(session.token, "/switch", "POST", { workspaceId: id }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "切换失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="space-picker"
      ref={menu}
      onToggle={(e) => {
        if (e.currentTarget.open) void refresh();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && menu.current?.open) {
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className="space-entry" aria-label="切换个人版或企业版">
        {space.type === "ENTERPRISE" ? <Building2 size={15} /> : <UserRound size={15} />}
        <span>{space.type === "ENTERPRISE" ? space.name : "个人版"}</span>
        <ChevronDown size={14} />
      </summary>
      <div className="space-options">
        {spaces.map((w) => (
          <button type="button" key={w.id} disabled={busy} onClick={() => void choose(w.id)}>
            {w.type === "PERSONAL" ? "个人版" : w.name}
            {w.id === space.id && <Check size={15} />}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            menu.current!.open = false;
            onManage();
          }}
        >
          企业工作台
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}
