import { useCallback, useEffect, useState } from "react";

export async function circleApi<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch("/api/circle" + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + token,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || "暂时无法连接广场，请重试。");
  return data as T;
}
export const postCircle = <T>(token: string, path: string, body: object, method = "POST") =>
  circleApi<T>(token, path, { method, body: JSON.stringify(body) });
type Signal = { actor: string; name: string; revision: string; unread: number };
const empty: Signal = { actor: "", name: "", revision: "", unread: 0 };
export function useCircleLive(token?: string, scope?: string) {
  const [loaded, setLoaded] = useState<{ token: string; scope: string; state: Signal } | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  useEffect(() => {
    if (!token || !scope) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>,
      revision = "";
    async function poll() {
      try {
        const next = await circleApi<Signal>(
          token,
          "/sync" + (revision ? "?after=" + encodeURIComponent(revision) : ""),
          { signal: ctrl.signal },
        );
        if (ctrl.signal.aborted) return;
        if (typeof next.revision !== "string" || !next.actor) throw new Error();
        if (next.revision !== revision) {
          revision = next.revision;
          setLoaded({ token, scope, state: next });
        }
        timer = setTimeout(poll, 80);
      } catch {
        if (!ctrl.signal.aborted) timer = setTimeout(poll, 4500);
      }
    }
    void poll();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [token, scope]);
  useEffect(() => {
    if (!token || !scope) return;
    let released = false,
      dispose: (() => void) | undefined,
      renewal: ReturnType<typeof setTimeout>;
    async function connect() {
      try {
        const info = await circleApi<{ appId: number; userId: string; userSig: string }>(token, "/im");
        if (!info.appId || released) return;
        const { default: SDK } = await import("@tencentcloud/lite-chat");
        if (released) return;
        const chat = SDK.create({ SDKAppID: info.appId });
        const onMessage = () => {
          if (!released) refresh();
        };
        chat.on(SDK.EVENT.MESSAGE_RECEIVED, onMessage);
        dispose = () => {
          chat.off(SDK.EVENT.MESSAGE_RECEIVED, onMessage);
          void chat.destroy().catch(() => {});
        };
        await chat.login({ userID: info.userId, userSig: info.userSig });
        async function renew() {
          const next = await circleApi<typeof info>(token, "/im");
          if (released) return;
          if (!next.appId) {
            dispose?.();
            dispose = undefined;
            return;
          }
          await chat.login({ userID: next.userId, userSig: next.userSig });
          if (!released) renewal = setTimeout(() => void renew().catch(() => {}), 50 * 60000);
        }
        if (!released) renewal = setTimeout(() => void renew().catch(() => {}), 50 * 60000);
      } catch {
        /* The authenticated business subscription also delivers new activity. */
      }
    }
    void connect();
    return () => {
      released = true;
      clearTimeout(renewal);
      dispose?.();
    };
  }, [token, scope, refresh]);
  const state = loaded?.token === token && loaded?.scope === scope && loaded ? loaded.state : empty;
  return { ...state, version: state.revision + "." + tick, refresh };
}
export function useCircleData<T>(token: string, path: string, version: string) {
  const [saved, setSaved] = useState<{ path: string; token: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    circleApi<T>(token, path, { signal: ctrl.signal })
      .then((data) => {
        if (!ctrl.signal.aborted) setSaved({ path, token, data });
      })
      .catch((e) => {
        if (!ctrl.signal.aborted)
          setSaved((previous) => ({
            path,
            token,
            data: previous?.path === path && previous.token === token ? previous.data : undefined,
            error: e.message,
          }));
      });
    return () => ctrl.abort();
  }, [token, path, version]);
  return saved?.path === path && saved?.token === token ? saved : { data: undefined, error: "" };
}
export function localDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}
