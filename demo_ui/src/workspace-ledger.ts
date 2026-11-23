export const ledgerTables = ["stocks", "market", "drafts"] as const;
export type LedgerTable = typeof ledgerTables[number];
export type LedgerRow = { id: string; sourceItemKey?: string };
export interface LedgerSnapshot {
  version: 1;
  stocks: LedgerRow[];
  market: LedgerRow[];
  drafts: LedgerRow[];
  confirmedRpaItemKeys: string[];
}
export const emptyLedger = (): LedgerSnapshot => ({ version: 1, stocks: [], market: [], drafts: [], confirmedRpaItemKeys: [] });
export type LedgerChange =
  | { table: LedgerTable; action: "add"; row: LedgerRow }
  | { table: LedgerTable; action: "edit"; id: string; fields: Record<string, unknown>; unset: string[] }
  | { table: LedgerTable; action: "remove"; id: string };
export interface LedgerOperation { id: string; seed: boolean; changes: LedgerChange[]; keys: string[] }
export interface LedgerReply { revision: number; snapshot: LedgerSnapshot }

export function ledgerChanges(before: LedgerSnapshot, after: LedgerSnapshot, seed = false): LedgerOperation {
  const changes: LedgerChange[] = [];
  for (const table of ledgerTables) {
    if (before[table] === after[table]) continue;
    const old = new Map(before[table].map(row => [row.id, row]));
    for (const row of after[table]) {
      const previous = old.get(row.id);
      old.delete(row.id);
      if (!previous) changes.push({ table, action: "add", row });
      else if (row !== previous) {
        const fields = Object.fromEntries(Object.entries(row).filter(([field, value]) =>
          value !== undefined && JSON.stringify(value) !== JSON.stringify(Reflect.get(previous, field))));
        const unset = Object.keys(previous).filter(field => Reflect.get(previous, field) !== undefined && Reflect.get(row, field) === undefined);
        if (Object.keys(fields).length || unset.length) changes.push({ table, action: "edit", id: row.id, fields, unset });
      }
    }
    for (const id of old.keys()) changes.push({ table, action: "remove", id });
  }
  const known = new Set(before.confirmedRpaItemKeys);
  return { id: crypto.randomUUID(), seed, changes, keys: after.confirmedRpaItemKeys.filter(key => !known.has(key)) };
}
