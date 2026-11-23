import { wechatClockMarker, type WechatPublishedTime } from "./wechat-published-time";

export type TimedTrade = {
  sourceSentAt?: string | null;
  sourcePublishedTime?: WechatPublishedTime | null;
  sourceObservedAt?: string | null;
  createdAt?: string | null;
  publishedAt?: string | null;
};

export type ChronologyKey = { published: number | null; recorded: number };

function epoch(value?: string | null): number | null {
  if (!value) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

export function publicationEpoch(sentAt?: string | null, evidence?: WechatPublishedTime | null, observedAt?: string | null): number | null {
  const exact = epoch(sentAt);
  if (exact !== null || !evidence) return exact;
  switch (evidence.kind) {
    case "WECHAT_MINUTE":
    case "WECHAT_MARKER": return epoch(evidence.at);
    case "WECHAT_CLOCK": return epoch(wechatClockMarker(evidence.clock, observedAt)?.at);
    case "WECHAT_DATE": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.date)) return null;
      const midnight = epoch(evidence.date + "T00:00:00+08:00");
      return midnight !== null && new Date(midnight + 8 * 3600000).toISOString().slice(0, 10) === evidence.date ? midnight : null;
    }
    case "WECHAT_RANGE": {
      const lower = epoch(evidence.from), upper = epoch(evidence.to);
      return lower !== null && upper !== null && lower <= upper ? upper : null;
    }
    default: return null;
  }
}

export function tradeChronology(item: TimedTrade): ChronologyKey {
  return {
    published: publicationEpoch(item.sourceSentAt, item.sourcePublishedTime, item.sourceObservedAt),
    recorded: epoch(item.sourceObservedAt) ?? epoch(item.createdAt) ?? epoch(item.publishedAt) ?? 0,
  };
}

export function compareChronology(a: ChronologyKey, b: ChronologyKey): number {
  if (a.published === null && b.published === null) return b.recorded - a.recorded;
  if (a.published === null) return 1;
  if (b.published === null) return -1;
  return b.published - a.published || b.recorded - a.recorded;
}

export function sortTradesByTime<T extends TimedTrade>(items: readonly T[]): T[] {
  return items.map(item => ({ item, time: tradeChronology(item) }))
    .sort((a, b) => compareChronology(a.time, b.time)).map(entry => entry.item);
}
