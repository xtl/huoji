import type { VerificationEntry } from "./supply-verification";

export function matchHistoryPrefix(userId: string, workspaceId: string, demandId: string, stockId: string): string {
  return "huoji_match_verification_v1:" + JSON.stringify([userId, workspaceId, demandId, stockId]) + ":";
}

export function readMatchHistory(storage: Storage, prefix: string): VerificationEntry[] {
  const entries: VerificationEntry[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    const entry = JSON.parse(raw) as VerificationEntry;
    if (!entry || key !== prefix + entry.id || !Number.isFinite(Date.parse(entry.recordedAt)) ||
        typeof entry.reply !== "string" || typeof entry.confirmedBy !== "string" ||
        (entry.role !== "seller" && entry.role !== "buyer")) {
      throw new Error("这笔匹配的核实记录无法读取。");
    }
    entries.push(entry);
  }
  return entries.sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt) || left.id.localeCompare(right.id));
}

// Independent keys keep simultaneous replies from different tabs from overwriting one another.
export function appendMatchHistory(storage: Storage, prefix: string, entry: VerificationEntry): void {
  const key = prefix + entry.id;
  const raw = JSON.stringify(entry);
  const existing = storage.getItem(key);
  if (existing === raw) return;
  if (existing !== null) throw new Error("这条记录已被保存，请重新打开核实记录。");
  storage.setItem(key, raw);
}
