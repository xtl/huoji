/** Minute-level evidence read from the chat timeline of a complete text bubble. */
export type WechatPublishedTime =
  | { kind: "WECHAT_MINUTE"; at: string }
  | { kind: "WECHAT_MARKER"; at: string }
  | { kind: "WECHAT_CLOCK"; clock: string }
  | { kind: "WECHAT_DATE"; date: string }
  | { kind: "WECHAT_RANGE"; from: string; to: string };

export function wechatShanghaiDate(value?: string | null): string | undefined {
  if (!value || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? new Date(epoch + 8 * 3_600_000).toISOString().slice(0, 10) : undefined;
}

/** Older collectors stored only the clock shown on the day of the screenshot. */
export function wechatClockMarker(clock: string, observedAt?: string | null): { kind: "WECHAT_MARKER"; at: string } | undefined {
  const date = wechatShanghaiDate(observedAt);
  if (!date || !observedAt || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) return undefined;
  const instant = Date.parse(`${date}T${clock}:00+08:00`);
  return instant <= Date.parse(observedAt) ? { kind: "WECHAT_MARKER", at: new Date(instant).toISOString() } : undefined;
}

/** Compare evidence only after confirming that it belongs to the same observation. */
export function improvesPublishedTime(prior: WechatPublishedTime | undefined, next: WechatPublishedTime): boolean {
  if (!prior) return true;
  if (next.kind === "WECHAT_CLOCK" || next.kind === "WECHAT_DATE" || prior.kind === "WECHAT_MINUTE") return false;
  const first = next.kind === "WECHAT_RANGE" ? next.from : next.at;
  if (prior.kind === "WECHAT_DATE") {
    return wechatShanghaiDate(first) === prior.date && (next.kind !== "WECHAT_RANGE" || wechatShanghaiDate(next.to) === prior.date);
  }
  if (prior.kind === "WECHAT_CLOCK") {
    const utc = Date.parse(first);
    if (!Number.isFinite(utc)) return false;
    const shanghaiClock = new Date(utc + 8 * 3_600_000).toISOString().slice(11, 16);
    return shanghaiClock === prior.clock;
  }
  if (prior.kind === "WECHAT_MARKER") return next.kind === "WECHAT_MINUTE" && Date.parse(next.at) >= Date.parse(prior.at);
  const lower = Date.parse(prior.from), upper = Date.parse(prior.to);
  if (next.kind === "WECHAT_MARKER") return Date.parse(next.at) === lower;
  if (next.kind === "WECHAT_MINUTE") return Date.parse(next.at) >= lower && Date.parse(next.at) <= upper;
  const from = Date.parse(next.from), to = Date.parse(next.to);
  return from >= lower && to <= upper && (from > lower || to < upper);
}
