import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  GOODS_STATUS_TRANSITIONS,
  GoodsOfferStatus,
  PriceType,
  QuantityChangeReason,
} from '@huoji/domain-types';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database.module';
import { camelizeRow, omitNullish } from '../../common/row-mapper';
import { stripUnauthorizedFields } from '../../common/field-policy';
import type { WorkspaceContext } from '../../common/workspace-scope.guard';

/**
 * BE-03 货源（说明书 6.4/10.10-10.14/15.1 章）。
 * 不可违反的约束（28 章）：
 * - 改价写 goods_price_history（底价/成本/对外价分行），改数量写 goods_quantity_history
 * - 重大修改写 goods_offer_versions 快照，禁止只覆盖
 * - 更新走乐观锁（If-Match: version），冲突返回 DATA_VERSION_CONFLICT
 * - 市场货源与 inventory_lots 分开，转库存走 convert-to-inventory
 */
@Injectable()
export class GoodsService {
  constructor(private readonly db: DatabaseService) {}

  /** 15.1 状态机唯一校验入口 */
  assertTransition(from: GoodsOfferStatus, to: GoodsOfferStatus): void {
    const allowed = GOODS_STATUS_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException({
        code: 'GOODS_STATUS_TRANSITION_DENIED',
        message: `货源状态不允许从 ${from} 流转到 ${to}`,
      });
    }
  }

  async list(ctx: WorkspaceContext): Promise<Array<Record<string, unknown>>> {
    const result = await this.db.query(
      `
      SELECT *
      FROM goods_offers
      WHERE workspace_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [ctx.workspaceId],
    );
    return result.rows.map((row) =>
      stripUnauthorizedFields(omitNullish(camelizeRow(row)), ctx),
    );
  }

  async create(ctx: WorkspaceContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.createFromCapture(ctx, null, input, 'USER');
  }

  async createFromCapture(
    ctx: WorkspaceContext,
    captureItemId: string | null,
    input: Record<string, unknown>,
    changeSource: 'USER' | 'AI' | 'IMPORT' | 'SYSTEM' = 'AI',
  ): Promise<Record<string, unknown>> {
    return this.db.tx(async (client) => {
      const offerNo = await this.nextOfferNo(client, ctx.workspaceId);
      const quantity = asNumber(input.quantityTotal ?? input.quantity ?? input.quantity_available);
      const price = asNumber(input.externalPrice ?? input.price);
      const row = await client.query(
        `
        INSERT INTO goods_offers(
          workspace_id, offer_no, title, record_type, direction, product_category,
          gpu_model, gpu_form_factor, gpu_count, server_brand, server_model,
          quantity_total, quantity_available, quantity_unit, condition,
          availability_type, location_country, location_province, location_city,
          delivery_days_min, delivery_days_max, status, verification_level,
          raw_summary, normalized_spec, ai_confidence, capture_item_id,
          data_classification, visibility_scope, owner_user_id, created_by
        )
        VALUES (
          $1, $2, $3, COALESCE($4, 'MARKET_LEAD'), COALESCE($5, 'SELL'), COALESCE($6, 'SERVER'),
          $7, $8, $9, $10, $11,
          $12, $13, COALESCE($14, '台'), $15,
          $16, $17, $18, $19,
          $20, $21, COALESCE($22, 'UNVERIFIED'), COALESCE($23, 'L0'),
          $24, $25, $26, $27,
          'INTERNAL', 'PRIVATE', $28, $28
        )
        RETURNING *
        `,
        [
          ctx.workspaceId,
          offerNo,
          asString(input.title) ?? buildTitle(input),
          asString(input.recordType),
          asString(input.direction),
          asString(input.productCategory ?? input.product_category),
          asString(input.gpuModel ?? input.gpu_model),
          asString(input.gpuFormFactor ?? input.gpu_form_factor),
          asNumber(input.gpuCount ?? input.gpu_count),
          asString(input.serverBrand ?? input.server_brand),
          asString(input.serverModel ?? input.server_model),
          quantity,
          quantity,
          asString(input.quantityUnit ?? input.quantity_unit),
          asString(input.condition),
          asString(input.availabilityType ?? input.availability_type),
          asString(input.locationCountry ?? input.location_country),
          asString(input.locationProvince ?? input.location_province),
          asString(input.locationCity ?? input.location_city),
          asNumber(input.deliveryDaysMin ?? input.delivery_days_min),
          asNumber(input.deliveryDaysMax ?? input.delivery_days_max),
          asString(input.status),
          asString(input.verificationLevel ?? input.verification_level),
          asString(input.rawSummary ?? input.raw_summary),
          JSON.stringify(input.normalizedSpec ?? input.normalized_spec ?? input),
          asNumber(input.aiConfidence ?? input.ai_confidence),
          captureItemId,
          ctx.userId,
        ],
      );
      const goods = row.rows[0] as Record<string, unknown>;
      await this.writeVersion(client, goods, 1, changeSource, 'created');
      if (quantity !== null) {
        await client.query(
          `
          INSERT INTO goods_quantity_history(goods_offer_id, quantity_after, quantity_delta, reason, created_by)
          VALUES ($1, $2, $2, 'INITIAL', $3)
          `,
          [goods.id, quantity, ctx.userId],
        );
      }
      if (price !== null) {
        await client.query(
          `
          INSERT INTO goods_price_history(goods_offer_id, price_type, amount, currency, unit, created_by)
          VALUES ($1, 'EXTERNAL_PRICE', $2, $3, 'PER_UNIT', $4)
          `,
          [goods.id, price, asString(input.currency) ?? 'CNY', ctx.userId],
        );
      }
      await client.query(
        `
        INSERT INTO audit_logs(workspace_id, user_id, action, object_type, object_id, after_data)
        VALUES ($1, $2, 'GOODS_CREATE', 'GOODS', $3, $4)
        `,
        [ctx.workspaceId, ctx.userId, goods.id, JSON.stringify(goods)],
      );
      return stripUnauthorizedFields(omitNullish(camelizeRow(goods)), ctx);
    });
  }

  async addPrice(
    ctx: WorkspaceContext,
    goodsId: string,
    version: number,
    price: { priceType: PriceType; amount: number },
  ): Promise<Record<string, unknown>> {
    if (!Number.isInteger(version)) throwVersionRequired();
    if (!Object.values(PriceType).includes(price.priceType) || price.amount <= 0) {
      throw new BadRequestException({ code: 'GOODS_PRICE_INVALID', message: '价格类型或金额无效' });
    }
    return this.db.tx(async (client) => {
      const goods = await this.lockGoods(client, ctx, goodsId, version);
      await client.query(
        `
        INSERT INTO goods_price_history(goods_offer_id, price_type, amount, currency, unit, created_by)
        VALUES ($1, $2, $3, 'CNY', 'PER_UNIT', $4)
        `,
        [goodsId, price.priceType, price.amount, ctx.userId],
      );
      const updated = await this.bumpGoodsVersion(client, ctx, goodsId, version);
      await this.writeVersion(client, updated, Number(updated.version), 'USER', `price:${price.priceType}`);
      await this.audit(client, ctx, 'GOODS_PRICE_CHANGE', goodsId, goods, updated);
      return stripUnauthorizedFields(omitNullish(camelizeRow(updated)), ctx);
    });
  }

  async addQuantityChange(
    ctx: WorkspaceContext,
    goodsId: string,
    version: number,
    change: { quantityAfter: number; reason: QuantityChangeReason },
  ): Promise<Record<string, unknown>> {
    if (!Number.isInteger(version)) throwVersionRequired();
    if (!Object.values(QuantityChangeReason).includes(change.reason) || change.quantityAfter < 0) {
      throw new BadRequestException({ code: 'GOODS_QUANTITY_INVALID', message: '数量或变更原因无效' });
    }
    return this.db.tx(async (client) => {
      const goods = await this.lockGoods(client, ctx, goodsId, version);
      const before = asNumber(goods.quantity_available);
      await client.query(
        `
        INSERT INTO goods_quantity_history(
          goods_offer_id, quantity_before, quantity_after, quantity_delta, reason, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          goodsId,
          before,
          change.quantityAfter,
          before === null ? null : change.quantityAfter - before,
          change.reason,
          ctx.userId,
        ],
      );
      const updatedResult = await client.query(
        `
        UPDATE goods_offers
        SET quantity_available = $1, updated_by = $2, updated_at = now(), version = version + 1
        WHERE id = $3 AND workspace_id = $4 AND version = $5 AND deleted_at IS NULL
        RETURNING *
        `,
        [change.quantityAfter, ctx.userId, goodsId, ctx.workspaceId, version],
      );
      const updated = updatedResult.rows[0] as Record<string, unknown> | undefined;
      if (!updated) throwConflict();
      await this.writeVersion(client, updated, Number(updated.version), 'USER', `quantity:${change.reason}`);
      await this.audit(client, ctx, 'GOODS_QUANTITY_CHANGE', goodsId, goods, updated);
      return stripUnauthorizedFields(omitNullish(camelizeRow(updated)), ctx);
    });
  }

  async update(
    ctx: WorkspaceContext,
    goodsId: string,
    version: number,
    input: { status?: GoodsOfferStatus; title?: string; rawSummary?: string },
  ): Promise<Record<string, unknown>> {
    if (!Number.isInteger(version)) throwVersionRequired();
    return this.db.tx(async (client) => {
      const goods = await this.lockGoods(client, ctx, goodsId, version);
      const nextStatus = input.status ?? (goods.status as GoodsOfferStatus);
      if (input.status && input.status !== goods.status) {
        this.assertTransition(goods.status as GoodsOfferStatus, input.status);
      }
      const updatedResult = await client.query(
        `
        UPDATE goods_offers
        SET status = $1,
            title = COALESCE($2, title),
            raw_summary = COALESCE($3, raw_summary),
            updated_by = $4,
            updated_at = now(),
            version = version + 1
        WHERE id = $5 AND workspace_id = $6 AND version = $7 AND deleted_at IS NULL
        RETURNING *
        `,
        [nextStatus, input.title ?? null, input.rawSummary ?? null, ctx.userId, goodsId, ctx.workspaceId, version],
      );
      const updated = updatedResult.rows[0] as Record<string, unknown> | undefined;
      if (!updated) throwConflict();
      await this.writeVersion(client, updated, Number(updated.version), 'USER', 'update');
      await this.audit(client, ctx, 'GOODS_UPDATE', goodsId, goods, updated);
      return stripUnauthorizedFields(omitNullish(camelizeRow(updated)), ctx);
    });
  }

  private async nextOfferNo(client: PoolClient, workspaceId: string): Promise<string> {
    const result = await client.query<{ next_no: string }>(
      `
      SELECT 'GO' || to_char(now(), 'YYYYMMDD') || '-' ||
        lpad((count(*) + 1)::text, 4, '0') AS next_no
      FROM goods_offers
      WHERE workspace_id = $1 AND created_at::date = now()::date
      `,
      [workspaceId],
    );
    return result.rows[0].next_no;
  }

  private async lockGoods(
    client: PoolClient,
    ctx: WorkspaceContext,
    goodsId: string,
    version: number,
  ): Promise<Record<string, unknown>> {
    const result = await client.query(
      `
      SELECT *
      FROM goods_offers
      WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
      FOR UPDATE
      `,
      [goodsId, ctx.workspaceId],
    );
    const goods = result.rows[0] as Record<string, unknown> | undefined;
    if (!goods) {
      throw new NotFoundException({ code: 'GOODS_NOT_FOUND', message: '货源不存在' });
    }
    if (Number(goods.version) !== version) throwConflict();
    return goods;
  }

  private async bumpGoodsVersion(
    client: PoolClient,
    ctx: WorkspaceContext,
    goodsId: string,
    version: number,
  ): Promise<Record<string, unknown>> {
    const result = await client.query(
      `
      UPDATE goods_offers
      SET updated_by = $1, updated_at = now(), version = version + 1
      WHERE id = $2 AND workspace_id = $3 AND version = $4 AND deleted_at IS NULL
      RETURNING *
      `,
      [ctx.userId, goodsId, ctx.workspaceId, version],
    );
    const updated = result.rows[0] as Record<string, unknown> | undefined;
    if (!updated) throwConflict();
    return updated;
  }

  private async writeVersion(
    client: PoolClient,
    goods: Record<string, unknown>,
    versionNo: number,
    changeSource: string,
    changeReason: string,
  ): Promise<void> {
    await client.query(
      `
      INSERT INTO goods_offer_versions(
        goods_offer_id, version_no, spec_snapshot, quantity_snapshot, price_snapshot,
        status_snapshot, change_source, change_reason, created_by
      )
      VALUES ($1, $2, $3, $4, '{}', $5, $6, $7, $8)
      `,
      [
        goods.id,
        versionNo,
        JSON.stringify({
          productCategory: goods.product_category,
          gpuModel: goods.gpu_model,
          gpuCount: goods.gpu_count,
          serverBrand: goods.server_brand,
          serverModel: goods.server_model,
          normalizedSpec: goods.normalized_spec,
        }),
        JSON.stringify({
          quantityTotal: goods.quantity_total,
          quantityAvailable: goods.quantity_available,
          quantityUnit: goods.quantity_unit,
        }),
        goods.status,
        changeSource,
        changeReason,
        goods.updated_by ?? goods.created_by,
      ],
    );
  }

  private async audit(
    client: PoolClient,
    ctx: WorkspaceContext,
    action: string,
    goodsId: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `
      INSERT INTO audit_logs(workspace_id, user_id, action, object_type, object_id, before_data, after_data)
      VALUES ($1, $2, $3, 'GOODS', $4, $5, $6)
      `,
      [ctx.workspaceId, ctx.userId, action, goodsId, JSON.stringify(before), JSON.stringify(after)],
    );
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

function buildTitle(input: Record<string, unknown>): string {
  const gpu = asString(input.gpuModel ?? input.gpu_model);
  const brand = asString(input.serverBrand ?? input.server_brand);
  const model = asString(input.serverModel ?? input.server_model);
  return [brand, model, gpu].filter(Boolean).join(' ') || '未命名货源';
}

function throwVersionRequired(): never {
  throw new BadRequestException({ code: 'IF_MATCH_REQUIRED', message: '修改请求必须携带 If-Match 版本号' });
}

function throwConflict(): never {
  throw new ConflictException({ code: 'DATA_VERSION_CONFLICT', message: '数据版本已变化，请刷新后重试' });
}
