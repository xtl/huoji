import type { WorkspaceContext } from './workspace-scope.guard';

/**
 * 字段级权限裁剪（说明书 16.3 章）。
 * 原则：无权限的字段【从响应中删除】，而不是置 null 或加 hidden 标记。
 */
const SENSITIVE_FIELD_PERMISSIONS: Record<string, string[]> = {
  // 字段名 -> 需要的任一权限码
  ownerPartyId: ['goods.read_supplier'],
  sourcePartyId: ['goods.read_supplier'],
  costPrice: ['goods.read_cost', 'quote.read_cost'],
  marginAmount: ['quote.read_margin'],
  marginRate: ['quote.read_margin'],
  commissionNote: ['finance.read'],
};

export function stripUnauthorizedFields<T extends Record<string, unknown>>(
  entity: T,
  ctx: WorkspaceContext,
): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity)) {
    const required = SENSITIVE_FIELD_PERMISSIONS[key];
    if (!required || required.some((p) => ctx.permissionCodes.includes(p))) {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}
