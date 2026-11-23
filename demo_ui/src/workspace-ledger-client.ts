import { emptyLedger, ledgerChanges, type LedgerOperation, type LedgerReply, type LedgerSnapshot } from "./workspace-ledger";

export type SyncState = "loading" | "ready" | "pending" | "offline";

export function startLedgerSync<T extends LedgerSnapshot>(options: {
  userId: string; workspaceId: string; token: string;
  isCurrent: () => boolean; readCache: () => T; writeCache: (snapshot: T) => void;
  receive: (snapshot: T) => void; status: (state: SyncState) => void;
}) {
  const prefix = "huoji_ledger_sync:" + JSON.stringify([options.userId, options.workspaceId]);
  const queuePrefix = prefix + ":op:", seedMarker = prefix + ":seeded";
  let revision = -1, stopped = false, busy = false, sequence = 0, lastTime = 0;
  let timer: ReturnType<typeof setTimeout>;
  let request: AbortController | undefined;
  const active = () => !stopped && options.isCurrent();
  function pendingKeys() {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(queuePrefix)) keys.push(key);
    }
    return keys.sort();
  }
  function schedule(delay: number) {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(sync, delay);
  }
  async function exchange(operations: LedgerOperation[]): Promise<LedgerReply | null> {
    request = new AbortController();
    const timeout = setTimeout(() => request?.abort(), 20000);
    try {
      const url = "/api/workspace/ledger" + (!operations.length && revision >= 0 ? "?since=" + revision : "");
      const response = await fetch(url, { method: operations.length ? "POST" : "GET",
        headers: { Authorization: "Bearer " + options.token, ...(operations.length ? { "Content-Type": "application/json" } : {}) },
        body: operations.length ? JSON.stringify({ operations }) : undefined, cache: "no-store", signal: request.signal });
      if (response.status === 204) return null;
      if (!response.ok) throw new Error("账号同步暂未完成");
      const reply = await response.json() as LedgerReply;
      if (!Number.isSafeInteger(reply.revision) || reply.snapshot?.version !== 1 ||
          ![reply.snapshot.stocks, reply.snapshot.market, reply.snapshot.drafts, reply.snapshot.confirmedRpaItemKeys].every(Array.isArray)) {
        throw new Error("资料响应无效");
      }
      return reply;
    } finally { clearTimeout(timeout); }
  }
  async function sync() {
    if (busy || !active()) return;
    busy = true;
    let delay = 15000;
    try {
      const first = !localStorage.getItem(seedMarker);
      const operations: LedgerOperation[] = [];
      if (first) {
        const seed = ledgerChanges(emptyLedger(), options.readCache(), true);
        if (seed.changes.length || seed.keys.length) operations.push(seed);
      }
      const keys = pendingKeys().slice(0, 16);
      for (const key of keys) {
        const value = localStorage.getItem(key);
        if (value) operations.push(JSON.parse(value));
      }
      const reply = await exchange(operations);
      if (!active()) return;
      for (const key of keys) localStorage.removeItem(key);
      if (first) {
        try { localStorage.setItem(seedMarker, "1"); } catch { /* A later additive migration can safely retry. */ }
      }
      if (pendingKeys().length) {
        // Keystrokes or an import arrived while this request was in flight.
        // Fetch the canonical state after the remaining changes have committed.
        revision = -1;
        delay = 0;
        options.status("pending");
      } else {
        if (reply && reply.revision >= revision) {
          options.receive(reply.snapshot as T);
          revision = reply.revision;
          try { options.writeCache(reply.snapshot as T); } catch { /* The server has this revision even when this browser is full. */ }
        }
        options.status("ready");
      }
    } catch {
      if (active()) options.status("offline");
    } finally {
      busy = false;
      if (active()) schedule(delay);
    }
  }
  function commit(before: T, after: T) {
    if (!active()) throw new Error("工作空间已切换");
    const operation = ledgerChanges(before, after);
    if (!operation.changes.length && !operation.keys.length) return;
    const time = Math.max(lastTime, Date.now());
    sequence = time === lastTime ? sequence + 1 : 0;
    lastTime = time;
    const key = queuePrefix + time + "-" + String(sequence).padStart(6, "0") + "-" + operation.id;
    // Persist intent before acknowledging the action. A reload or failed
    // response can replay the same operation id without repeating a confirmation.
    localStorage.setItem(key, JSON.stringify(operation));
    try { options.writeCache(after); } catch { /* The durable queue still contains this change. */ }
    options.status("pending");
    schedule(120);
  }
  const refresh = () => schedule(0);
  const visible = () => { if (!document.hidden) refresh(); };
  const onStorage = (e: StorageEvent) => { if (e.key?.startsWith(queuePrefix)) refresh(); };
  window.addEventListener("focus", refresh);
  window.addEventListener("online", refresh);
  window.addEventListener("storage", onStorage);
  document.addEventListener("visibilitychange", visible);
  options.status("loading");
  refresh();
  return { commit, refresh, stop() {
    stopped = true; clearTimeout(timer); request?.abort();
    window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
    window.removeEventListener("storage", onStorage); document.removeEventListener("visibilitychange", visible);
  } };
}
