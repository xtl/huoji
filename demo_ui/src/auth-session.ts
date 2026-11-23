export interface StoredSessionShape {
  token: string;
  expiresAt: string;
  user: { id: string };
  currentWorkspaceId: string;
  workspaces: Array<{ id: string }>;
}

export const SESSION_EXPIRED_NOTICE = "登录已过期，请重新登录。原有草稿和记录已保留，请使用原账号继续。";

export function sessionHasExpired(session: Pick<StoredSessionShape, "expiresAt">, now = Date.now()): boolean {
  const expiration = Date.parse(session.expiresAt);
  return !Number.isFinite(expiration) || expiration <= now;
}

export function readStoredSession<T extends StoredSessionShape>(
  storage: Pick<Storage, "getItem">,
  key: string,
  now = Date.now(),
): { session: T | null; expired: boolean } {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { session: null, expired: false };
    const value = JSON.parse(raw) as T | null;
    if (!value || typeof value.token !== "string" || !value.token.trim()
        || !value.user || typeof value.user.id !== "string" || !value.user.id
        || typeof value.currentWorkspaceId !== "string" || !value.currentWorkspaceId
        || !Array.isArray(value.workspaces)
        || !value.workspaces.some((workspace) => workspace?.id === value.currentWorkspaceId)) {
      return { session: null, expired: false };
    }
    if (sessionHasExpired(value, now)) {
      return { session: null, expired: true };
    }
    return { session: value, expired: false };
  } catch {
    return { session: null, expired: false };
  }
}

export function removeExpiredStoredSession(storage: Pick<Storage, "getItem" | "removeItem">, key: string, now = Date.now()): boolean {
  if (!readStoredSession(storage, key, now).expired) return false;
  storage.removeItem(key);
  return true;
}

type Timer = ReturnType<typeof setTimeout> | number;
interface SessionMonitorOptions {
  session: Pick<StoredSessionShape, "token" | "expiresAt">;
  currentToken: () => string | null;
  onExpired: () => void;
  request?: (input: string, init: RequestInit) => Promise<{ status: number }>;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => Timer;
  cancel?: (timer: Timer) => void;
}

/** Local expiry and authoritative 401s invalidate only the monitored session. */
export function monitorSession(options: SessionMonitorOptions): { check: () => void; stop: () => void } {
  const request = options.request ?? fetch;
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let stopped = false;
  let invalidated = false;
  let inFlight = false;
  let pollTimer: Timer | undefined;
  let expiryTimer: Timer | undefined;
  let requestTimer: Timer | undefined;
  let requestController: AbortController | undefined;
  const active = () => !stopped && !invalidated && options.currentToken() === options.session.token;

  function clearTimers() {
    for (const timer of [pollTimer, expiryTimer, requestTimer]) if (timer !== undefined) cancel(timer);
    requestController?.abort();
  }

  function expire() {
    if (!active()) return;
    invalidated = true;
    clearTimers();
    options.onExpired();
  }

  function check() {
    if (!active()) return;
    if (sessionHasExpired(options.session, now())) { expire(); return; }
    if (inFlight) return;
    inFlight = true;
    const controller = new AbortController();
    requestController = controller;
    requestTimer = schedule(() => controller.abort(), 10_000);
    void request("/api/auth/me", { headers: { Authorization: `Bearer ${options.session.token}` }, signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted && active() && response.status === 401) expire(); })
      .catch(() => { /* Offline, timeout and server failures do not revoke a valid login. */ })
      .finally(() => {
        if (requestTimer !== undefined) cancel(requestTimer);
        requestTimer = undefined;
        if (requestController === controller) requestController = undefined;
        inFlight = false;
      });
  }

  function scheduleExpiry() {
    if (!active()) return;
    const remaining = Date.parse(options.session.expiresAt) - now();
    if (!Number.isFinite(remaining) || remaining <= 0) { expire(); return; }
    expiryTimer = schedule(scheduleExpiry, Math.min(remaining, 2_147_483_647));
  }

  function poll() {
    check();
    if (active()) pollTimer = schedule(poll, 60_000);
  }

  scheduleExpiry();
  poll();
  return { check, stop: () => { stopped = true; clearTimers(); } };
}
