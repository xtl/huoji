export function toCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

export function camelizeRow<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    mapped[toCamelKey(key)] = value;
  }
  return mapped;
}

export function omitNullish<T extends Record<string, unknown>>(row: T): Partial<T> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== null && value !== undefined) mapped[key] = value;
  }
  return mapped as Partial<T>;
}
