import { wechatClockMarker, wechatShanghaiDate, type WechatPublishedTime } from "./wechat-published-time";
import type { TimedTrade } from "./trade-chronology";

const shanghaiMinute = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function wechatTimestamp(value?: string | null): string {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? shanghaiMinute.format(time) : "未识别";
}

interface WechatTimeReading {
  value: string;
  rangeEnd?: string;
  basis: string;
  fullLabel: string;
}

export function readWechatTime(sentAt?: string | null, evidence?: WechatPublishedTime, observedAt?: string | null): WechatTimeReading | undefined {
  const exact = wechatTimestamp(sentAt);
  if (exact !== "未识别") return { value: exact, basis: "微信原消息", fullLabel: `微信发布 ${exact}` };
  if (evidence?.kind === "WECHAT_MINUTE" || evidence?.kind === "WECHAT_MARKER") {
    const minute = wechatTimestamp(evidence.at);
    if (minute !== "未识别") return evidence.kind === "WECHAT_MINUTE"
      ? { value: minute, basis: "精确到分钟", fullLabel: `微信发布 ${minute}（分钟）` }
      : { value: minute, basis: "相邻微信时间标记", fullLabel: `微信时间标记 ${minute}` };
  }
  if (evidence?.kind === "WECHAT_CLOCK" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(evidence.clock)) {
    const marker = wechatClockMarker(evidence.clock, observedAt);
    if (marker) return readWechatTime(null, marker);
    if (!observedAt) return { value: evidence.clock, basis: "微信时间标记 · 日期未知", fullLabel: `微信时间标记 ${evidence.clock}（采集日期缺失）` };
  }
  if (evidence?.kind === "WECHAT_DATE" && evidence.date && wechatShanghaiDate(`${evidence.date}T00:00:00+08:00`) === evidence.date) {
    return { value: evidence.date, basis: "微信日期标记", fullLabel: `微信日期标记 ${evidence.date}` };
  }
  if (evidence?.kind === "WECHAT_RANGE") {
    const from = wechatTimestamp(evidence.from);
    const to = wechatTimestamp(evidence.to);
    if (from !== "未识别" && to !== "未识别" && Date.parse(evidence.from) <= Date.parse(evidence.to)) {
      const end = from.slice(0, 10) === to.slice(0, 10) ? to.slice(11) : to;
      return { value: from, rangeEnd: end, basis: "发布时间范围", fullLabel: `微信发布时间范围 ${from} 至 ${end}` };
    }
  }
  return undefined;
}

export function wechatTimeLabel(sentAt?: string | null, evidence?: WechatPublishedTime, observedAt?: string | null): string {
  return readWechatTime(sentAt, evidence, observedAt)?.fullLabel ?? "微信发布时间未识别";
}

export function tradeTimeCaption(item: TimedTrade, legacyRecorded?: number): string {
  const published = readWechatTime(item.sourceSentAt, item.sourcePublishedTime, item.sourceObservedAt);
  if (published) return published.fullLabel;
  const observed = wechatTimestamp(item.sourceObservedAt);
  if (observed !== "未识别") return `采集于 ${observed}`;
  const recorded = wechatTimestamp(item.createdAt || item.publishedAt || (legacyRecorded ? new Date(legacyRecorded).toISOString() : undefined));
  return recorded !== "未识别" ? `录入于 ${recorded}` : "发布时间待确认";
}
