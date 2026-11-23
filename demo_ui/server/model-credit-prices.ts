// CNY cents per million tokens, per https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
// Beijing holiday schedules published by the State Council for 2026 and 2027.
const holidays: Record<string, [string, string][]> = {
  "2026": [
    ["01-01", "01-03"],
    ["02-15", "02-23"],
    ["04-04", "04-06"],
    ["05-01", "05-05"],
    ["06-19", "06-21"],
    ["09-25", "09-27"],
    ["10-01", "10-07"],
  ],
  "2027": [
    ["01-01", "01-03"],
    ["02-05", "02-13"],
    ["04-03", "04-05"],
    ["05-01", "05-05"],
    ["06-09", "06-09"],
    ["09-15", "09-15"],
    ["10-01", "10-07"],
  ],
};
export function modelPrices(model: string, now: Date, pointsPerCostYuan: number) {
  const flash = ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"].includes(model);
  if (!flash && model !== "deepseek-v4-pro") throw Error("该模型尚未配置积分价格，请联系平台管理员。");
  const bj = new Date(now.getTime() + 8 * 3600000);
  const day = bj.toISOString().slice(5, 10),
    year = String(bj.getUTCFullYear()),
    hour = bj.getUTCHours();
  const calendar = holidays[year];
  if (!calendar) throw Error("模型计费日历待更新，请联系平台管理员。");
  const peak =
    bj.getUTCDay() >= 1 &&
    bj.getUTCDay() <= 5 &&
    ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)) &&
    !calendar.some(([from, to]) => from <= day && day <= to);
  const rates = flash ? [2, 100, 400] : [15, 450, 1350];
  const [hit, miss, out] = rates.map((rate) => (rate * (peak ? 2 : 1) * pointsPerCostYuan) / 10);
  return { hit, miss, out, model, peak, pointsPerCostYuan, version: "2026-11-23" };
}
export function actualCharge(rates: ReturnType<typeof modelPrices>, usage: any): number | null {
  const token = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
  if (!usage || !token(usage.prompt_tokens) || !token(usage.completion_tokens)) return null;
  const hit =
    usage.prompt_cache_hit_tokens ??
    (token(usage.prompt_cache_miss_tokens) ? usage.prompt_tokens - usage.prompt_cache_miss_tokens : null);
  const miss = usage.prompt_tokens - hit;
  if (
    !token(hit) ||
    miss < 0 ||
    (usage.prompt_cache_miss_tokens != null && usage.prompt_cache_miss_tokens !== miss)
  )
    return null;
  const units = hit * rates.hit + miss * rates.miss + usage.completion_tokens * rates.out;
  return Number.isSafeInteger(units) ? units : null;
}
