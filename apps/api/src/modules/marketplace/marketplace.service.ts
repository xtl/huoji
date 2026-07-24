import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../common/database.module';
import { camelizeRow, omitNullish } from '../../common/row-mapper';
import type { WorkspaceContext } from '../../common/workspace-scope.guard';

@Injectable()
export class MarketplaceService {
  constructor(private readonly db: DatabaseService) {}

  async list(filter: {
    type?: 'GOODS' | 'DEMAND';
    mode?: TradeMode;
    productCategory?: string;
    gpuModel?: string;
  }): Promise<Array<Record<string, unknown>>> {
    const result = await this.db.query(
      `
      SELECT id, trade_mode, post_type, title, summary, product_category, gpu_model, gpu_count,
             quantity, quantity_unit, location_city, price_amount, currency,
             contact_method, snapshot, published_at
      FROM marketplace_posts
      WHERE deleted_at IS NULL
        AND status = 'PUBLISHED'
        AND ($1::text IS NULL OR post_type = $1)
        AND ($2::text IS NULL OR trade_mode = $2)
        AND ($3::text IS NULL OR product_category = $3)
        AND ($4::text IS NULL OR gpu_model ILIKE '%' || $4 || '%')
      ORDER BY published_at DESC
      LIMIT 100
      `,
      [
        filter.type ?? null,
        normalizeTradeMode(filter.mode),
        asString(filter.productCategory),
        filter.gpuModel ?? null,
      ],
    );
    return result.rows.map((row) => omitNullish(camelizeRow(row)));
  }

  async publishGoods(
    ctx: WorkspaceContext,
    goodsId: string,
    input: { contactMethod?: string; priceAmount?: number; tradeMode?: TradeMode },
  ): Promise<Record<string, unknown>> {
    const goods = await this.db.one<Record<string, unknown>>(
      `
      SELECT *
      FROM goods_offers
      WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
      `,
      [goodsId, ctx.workspaceId],
    );
    if (!goods) {
      throw new NotFoundException({ code: 'GOODS_NOT_FOUND', message: '货源不存在' });
    }
    return this.insertPost(ctx, {
      tradeMode: normalizeTradeMode(input.tradeMode) ?? tradeModeFromAvailability(goods.availability_type),
      postType: 'GOODS',
      sourceType: 'GOODS',
      sourceId: goodsId,
      title: String(goods.title ?? buildGoodsTitle(goods)),
      summary: String(goods.raw_summary ?? ''),
      productCategory: asString(goods.product_category),
      gpuModel: asString(goods.gpu_model),
      gpuCount: asNumber(goods.gpu_count),
      quantity: asNumber(goods.quantity_available),
      quantityUnit: asString(goods.quantity_unit),
      locationCity: asString(goods.location_city),
      priceAmount: asNumber(input.priceAmount),
      currency: 'CNY',
      contactMethod: input.contactMethod,
      snapshot: {
        verificationLevel: goods.verification_level,
        condition: goods.condition,
        availabilityType: goods.availability_type,
        deliveryDaysMin: goods.delivery_days_min,
        deliveryDaysMax: goods.delivery_days_max,
        cpuSpec: goods.cpu_spec,
        memorySpec: goods.memory_spec,
        storageSpec: goods.storage_spec,
        networkSpec: goods.network_spec,
        normalizedSpec: goods.normalized_spec,
      },
    });
  }

  async publishDemand(
    ctx: WorkspaceContext,
    demandId: string,
    input: { contactMethod?: string; tradeMode?: TradeMode },
  ): Promise<Record<string, unknown>> {
    const demand = await this.db.one<Record<string, unknown>>(
      `
      SELECT *
      FROM demands
      WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
      `,
      [demandId, ctx.workspaceId],
    );
    if (!demand) {
      throw new NotFoundException({ code: 'DEMAND_NOT_FOUND', message: '需求不存在' });
    }
    return this.insertPost(ctx, {
      tradeMode: normalizeTradeMode(input.tradeMode) ?? 'SPOT',
      postType: 'DEMAND',
      sourceType: 'DEMAND',
      sourceId: demandId,
      title: `${demand.gpu_model ?? 'GPU'} 求购 ${demand.quantity_required ?? ''}${demand.quantity_required ? '台' : ''}`,
      summary: asString(demand.location_requirement) ?? '',
      productCategory: asString(demand.product_category),
      gpuModel: asString(demand.gpu_model),
      gpuCount: asNumber(demand.gpu_count),
      quantity: asNumber(demand.quantity_required),
      quantityUnit: '台',
      locationCity: asString(demand.location_requirement),
      priceAmount: asNumber(demand.budget_max),
      currency: asString(demand.currency) ?? 'CNY',
      contactMethod: input.contactMethod,
      snapshot: {
        priority: demand.priority,
        brandRequirements: demand.brand_requirements,
        requiredSpec: demand.required_spec,
        conditionRequirement: demand.condition_requirement,
        warrantyRequirement: demand.warranty_requirement,
      },
    });
  }

  async publishManual(ctx: WorkspaceContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const postType = asString(input.postType ?? input.post_type);
    if (postType !== 'GOODS' && postType !== 'DEMAND') {
      throw new BadRequestException({ code: 'MARKETPLACE_TYPE_INVALID', message: '广场类型必须是 GOODS 或 DEMAND' });
    }
    const title = asString(input.title);
    if (!title) {
      throw new BadRequestException({ code: 'MARKETPLACE_TITLE_REQUIRED', message: '标题不能为空' });
    }
    return this.insertPost(ctx, {
      tradeMode: normalizeTradeMode(input.tradeMode ?? input.trade_mode) ?? 'SPOT',
      postType,
      sourceType: 'MANUAL',
      sourceId: null,
      title,
      summary: asString(input.summary) ?? '',
      productCategory: asString(input.productCategory ?? input.product_category),
      gpuModel: asString(input.gpuModel ?? input.gpu_model),
      gpuCount: asNumber(input.gpuCount ?? input.gpu_count),
      quantity: asNumber(input.quantity),
      quantityUnit: asString(input.quantityUnit ?? input.quantity_unit),
      locationCity: asString(input.locationCity ?? input.location_city),
      priceAmount: asNumber(input.priceAmount ?? input.price_amount),
      currency: asString(input.currency) ?? 'CNY',
      contactMethod: asString(input.contactMethod ?? input.contact_method),
      snapshot: buildManualSnapshot(input),
    });
  }

  private async insertPost(ctx: WorkspaceContext, input: MarketplacePostInput): Promise<Record<string, unknown>> {
    const result = await this.db.query(
      `
      INSERT INTO marketplace_posts(
        workspace_id, trade_mode, post_type, source_type, source_id, title, summary, product_category,
        gpu_model, gpu_count, quantity, quantity_unit, location_city, price_amount,
        currency, contact_method, snapshot, published_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *
      `,
      [
        ctx.workspaceId,
        input.tradeMode,
        input.postType,
        input.sourceType,
        input.sourceId,
        input.title,
        input.summary,
        input.productCategory,
        input.gpuModel,
        input.gpuCount,
        input.quantity,
        input.quantityUnit,
        input.locationCity,
        input.priceAmount,
        input.currency,
        input.contactMethod,
        JSON.stringify(input.snapshot),
        ctx.userId,
      ],
    );
    const post = result.rows[0] as Record<string, unknown>;
    await this.db.query(
      `
      INSERT INTO audit_logs(workspace_id, user_id, action, object_type, object_id, after_data)
      VALUES ($1, $2, 'MARKETPLACE_PUBLISH', 'MARKETPLACE_POST', $3, $4)
      `,
      [ctx.workspaceId, ctx.userId, post.id, JSON.stringify(post)],
    );
    return omitNullish(camelizeRow(post));
  }
}

interface MarketplacePostInput {
  tradeMode: TradeMode;
  postType: 'GOODS' | 'DEMAND';
  sourceType: 'GOODS' | 'DEMAND' | 'MANUAL';
  sourceId: string | null;
  title: string;
  summary: string;
  productCategory: string | null;
  gpuModel: string | null;
  gpuCount: number | null;
  quantity: number | null;
  quantityUnit: string | null;
  locationCity: string | null;
  priceAmount: number | null;
  currency: string;
  contactMethod?: string | null;
  snapshot: Record<string, unknown>;
}

type TradeMode = 'SPOT' | 'FUTURES' | 'RENTAL';

function normalizeTradeMode(value: unknown): TradeMode | null {
  if (value === 'SPOT' || value === 'FUTURES' || value === 'RENTAL') return value;
  if (value === '现货') return 'SPOT';
  if (value === '期货') return 'FUTURES';
  if (value === '租赁') return 'RENTAL';
  return null;
}

function tradeModeFromAvailability(value: unknown): TradeMode {
  if (value === 'FUTURES') return 'FUTURES';
  return 'SPOT';
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function buildGoodsTitle(goods: Record<string, unknown>): string {
  return [goods.server_brand, goods.server_model, goods.gpu_model].filter(Boolean).join(' ') || 'GPU 货源';
}

function buildManualSnapshot(input: Record<string, unknown>): Record<string, unknown> {
  const { snapshot: nestedSnapshot, ...rest } = input;
  return {
    ...rest,
    ...asRecord(nestedSnapshot),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
