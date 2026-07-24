import { BadRequestException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database.module';
import { camelizeRow, omitNullish } from '../../common/row-mapper';
import type { WorkspaceContext } from '../../common/workspace-scope.guard';

/** TODO: 见 docs/00-阶段执行计划.md 对应任务包 */
@Injectable()
export class DemandService {
  constructor(private readonly db: DatabaseService) {}

  async list(ctx: WorkspaceContext): Promise<Array<Record<string, unknown>>> {
    const result = await this.db.query(
      `
      SELECT *
      FROM demands
      WHERE workspace_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [ctx.workspaceId],
    );
    return result.rows.map((row) => omitNullish(camelizeRow(row)));
  }

  async create(ctx: WorkspaceContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const gpuModel = asString(input.gpuModel ?? input.gpu_model);
    const quantity = asNumber(input.quantityRequired ?? input.quantity_required ?? input.quantity);
    if (!gpuModel || !quantity) {
      throw new BadRequestException({ code: 'DEMAND_REQUIRED_FIELDS', message: '需求必须包含 GPU 型号和数量' });
    }
    return this.db.tx(async (client) => {
      const demandNo = await this.nextDemandNo(client, ctx.workspaceId);
      const result = await client.query(
        `
        INSERT INTO demands(
          workspace_id, demand_no, product_category, gpu_model, gpu_count,
          quantity_required, budget_min, budget_max, currency, location_requirement,
          condition_requirement, delivery_deadline, priority, status, owner_user_id, created_by
        )
        VALUES (
          $1, $2, COALESCE($3, 'SERVER'), $4, $5,
          $6, $7, $8, COALESCE($9, 'CNY'), $10,
          $11, $12, COALESCE($13, 'MEDIUM'), COALESCE($14, 'ACTIVE'), $15, $15
        )
        RETURNING *
        `,
        [
          ctx.workspaceId,
          demandNo,
          asString(input.productCategory ?? input.product_category),
          gpuModel,
          asNumber(input.gpuCount ?? input.gpu_count),
          quantity,
          asNumber(input.budgetMin ?? input.budget_min),
          asNumber(input.budgetMax ?? input.budget_max ?? input.targetPrice),
          asString(input.currency),
          asString(input.locationRequirement ?? input.location_requirement ?? input.locationCity),
          asString(input.conditionRequirement ?? input.condition_requirement),
          asString(input.deliveryDeadline ?? input.delivery_deadline),
          asString(input.priority),
          asString(input.status),
          ctx.userId,
        ],
      );
      const demand = result.rows[0] as Record<string, unknown>;
      await client.query(
        `
        INSERT INTO audit_logs(workspace_id, user_id, action, object_type, object_id, after_data)
        VALUES ($1, $2, 'DEMAND_CREATE', 'DEMAND', $3, $4)
        `,
        [ctx.workspaceId, ctx.userId, demand.id, JSON.stringify(demand)],
      );
      return omitNullish(camelizeRow(demand));
    });
  }

  private async nextDemandNo(client: PoolClient, workspaceId: string): Promise<string> {
    const result = await client.query<{ next_no: string }>(
      `
      SELECT 'DE' || to_char(now(), 'YYYYMMDD') || '-' ||
        lpad((count(*) + 1)::text, 4, '0') AS next_no
      FROM demands
      WHERE workspace_id = $1 AND created_at::date = now()::date
      `,
      [workspaceId],
    );
    return result.rows[0].next_no;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}
