import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CaptureType } from '@huoji/domain-types';
import type { AiExtractionResult } from '@huoji/domain-types';
import { DatabaseService } from '../../common/database.module';
import { camelizeRow, omitNullish } from '../../common/row-mapper';
import type { WorkspaceContext } from '../../common/workspace-scope.guard';
import { GoodsService } from '../goods/goods.service';

/**
 * BE-02 文件与采集（说明书 6.4/10.8/12 章）。
 * 链路：创建 CaptureItem -> 提交 AI 任务(异步队列) -> 前端轮询结果 -> 用户确认 -> 创建正式货源。
 * 约束（28 章）：AI 抽取结果必须经用户确认才能成为正式业务数据；
 * AI 任务必须异步执行，前端不能阻塞等待。
 */
@Injectable()
export class CaptureService {
  constructor(
    private readonly db: DatabaseService,
    private readonly goods: GoodsService,
  ) {}

  async create(
    ctx: WorkspaceContext,
    input: { captureType: CaptureType; rawText?: string; fileId?: string },
  ): Promise<Record<string, unknown>> {
    if (!Object.values(CaptureType).includes(input.captureType)) {
      throw new BadRequestException({ code: 'CAPTURE_TYPE_INVALID', message: '采集类型无效' });
    }
    if (!input.rawText && !input.fileId) {
      throw new BadRequestException({ code: 'CAPTURE_CONTENT_REQUIRED', message: '文本或文件必须至少提供一项' });
    }
    return this.db.tx(async (client) => {
      const capture = await client.query(
        `
        INSERT INTO capture_items(
          workspace_id, capture_type, raw_text, file_id, source_channel,
          processing_status, target_type, created_by
        )
        VALUES ($1, $2, $3, $4, 'MANUAL', 'PENDING', 'UNKNOWN', $5)
        RETURNING *
        `,
        [ctx.workspaceId, input.captureType, input.rawText ?? null, input.fileId ?? null, ctx.userId],
      );
      const captureRow = capture.rows[0] as Record<string, unknown>;
      await client.query(
        `
        INSERT INTO ai_extraction_jobs(
          capture_item_id, model_provider, model_name, schema_version, request_payload, status
        )
        VALUES ($1, $2, $3, 'v1', $4, 'PENDING')
        `,
        [
          captureRow.id,
          process.env.AI_PROVIDER ?? 'mock',
          process.env.AI_MODEL ?? 'huoji-extractor-mock',
          JSON.stringify({ captureType: input.captureType, rawText: input.rawText ?? null, fileId: input.fileId ?? null }),
        ],
      );
      await client.query(
        `
        INSERT INTO event_outbox(event_type, workspace_id, payload)
        VALUES ('capture.created', $1, $2)
        `,
        [ctx.workspaceId, JSON.stringify({ captureItemId: captureRow.id })],
      );
      return omitNullish(camelizeRow(captureRow));
    });
  }

  async getResult(ctx: WorkspaceContext, id: string): Promise<Record<string, unknown>> {
    const row = await this.db.one<{
      id: string;
      capture_type: string;
      raw_text: string | null;
      processing_status: string;
      target_type: string | null;
      confirmed: boolean;
      job_id: string | null;
      job_status: string | null;
      result_payload: AiExtractionResult | null;
      error_message: string | null;
      created_at: string;
    }>(
      `
      SELECT
        c.id, c.capture_type, c.raw_text, c.processing_status, c.target_type, c.confirmed,
        j.id AS job_id, j.status AS job_status, j.result_payload, j.error_message, c.created_at
      FROM capture_items c
      LEFT JOIN LATERAL (
        SELECT id, status, result_payload, error_message
        FROM ai_extraction_jobs
        WHERE capture_item_id = c.id
        ORDER BY created_at DESC
        LIMIT 1
      ) j ON true
      WHERE c.id = $1 AND c.workspace_id = $2 AND c.deleted_at IS NULL
      `,
      [id, ctx.workspaceId],
    );
    if (!row) {
      throw new NotFoundException({ code: 'CAPTURE_NOT_FOUND', message: '采集记录不存在' });
    }
    return omitNullish(camelizeRow(row));
  }

  async confirm(
    ctx: WorkspaceContext,
    id: string,
    corrections: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const capture = await this.db.one<{
      id: string;
      result_payload: AiExtractionResult | null;
      confirmed: boolean;
    }>(
      `
      SELECT c.id, j.result_payload
      FROM capture_items c
      LEFT JOIN LATERAL (
        SELECT result_payload
        FROM ai_extraction_jobs
        WHERE capture_item_id = c.id AND status = 'DONE'
        ORDER BY created_at DESC
        LIMIT 1
      ) j ON true
      WHERE c.id = $1 AND c.workspace_id = $2 AND c.deleted_at IS NULL
      `,
      [id, ctx.workspaceId],
    );
    if (!capture) {
      throw new NotFoundException({ code: 'CAPTURE_NOT_FOUND', message: '采集记录不存在' });
    }
    const payload = normalizeConfirmation(capture.result_payload, corrections);
    const goods = await this.goods.createFromCapture(ctx, id, payload, 'AI');
    await this.db.query(
      `
      UPDATE capture_items
      SET confirmed = true,
          confirmed_by = $1,
          confirmed_at = now(),
          processing_status = 'DONE',
          target_type = 'GOODS'
      WHERE id = $2 AND workspace_id = $3
      `,
      [ctx.userId, id, ctx.workspaceId],
    );
    return { captureId: id, goods };
  }
}

function normalizeConfirmation(
  result: AiExtractionResult | null,
  corrections: Record<string, unknown>,
): Record<string, unknown> {
  const goods = result?.goods ?? {};
  const commercial = result?.commercial ?? {};
  const location = goods.location ?? {};
  return {
    productCategory: corrections.productCategory ?? corrections.product_category ?? goods.product_category,
    gpuModel: corrections.gpuModel ?? corrections.gpu_model ?? goods.gpu_model,
    gpuFormFactor: corrections.gpuFormFactor ?? corrections.gpu_form_factor ?? goods.gpu_form_factor,
    gpuCount: corrections.gpuCount ?? corrections.gpu_count ?? goods.gpu_count,
    serverBrand: corrections.serverBrand ?? corrections.server_brand ?? goods.server_brand,
    serverModel: corrections.serverModel ?? corrections.server_model ?? goods.server_model,
    quantity: corrections.quantity ?? goods.quantity,
    quantityUnit: corrections.quantityUnit ?? corrections.quantity_unit ?? goods.quantity_unit,
    condition: corrections.condition ?? goods.condition,
    availabilityType: corrections.availabilityType ?? corrections.availability_type ?? goods.availability_type,
    locationCountry: corrections.locationCountry ?? corrections.location_country ?? location.country,
    locationProvince: corrections.locationProvince ?? corrections.location_province ?? location.province,
    locationCity: corrections.locationCity ?? corrections.location_city ?? location.city,
    price: corrections.price ?? commercial.price,
    currency: corrections.currency ?? commercial.currency,
    deliveryDaysMin: corrections.deliveryDaysMin ?? commercial.delivery_days_min,
    deliveryDaysMax: corrections.deliveryDaysMax ?? commercial.delivery_days_max,
    aiConfidence: averageConfidence(result?.field_confidence),
    rawSummary: corrections.rawSummary ?? corrections.raw_summary,
    normalizedSpec: { ai: result, corrections },
    status: 'UNVERIFIED',
  };
}

function averageConfidence(confidence: Record<string, number> | undefined): number | null {
  const values = Object.values(confidence ?? {}).filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
}
