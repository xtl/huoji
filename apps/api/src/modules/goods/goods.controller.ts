import { Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { GoodsService } from './goods.service';
import type { GoodsOfferStatus, PriceType, QuantityChangeReason } from '@huoji/domain-types';
import { WorkspaceCtx } from '../../common/request-context';
import type { WorkspaceContext } from '../../common/workspace-scope.guard';

/**
 * 说明书 18.3 货源接口。
 * 所有修改接口接受 Idempotency-Key 与 If-Match: version（22.2 乐观锁）。
 */
@Controller('goods')
export class GoodsController {
  constructor(private readonly goods: GoodsService) {}

  @Get()
  list(@WorkspaceCtx() ctx: WorkspaceContext) {
    return this.goods.list(ctx);
  }

  @Post()
  create(@WorkspaceCtx() ctx: WorkspaceContext, @Body() body: Record<string, unknown>) {
    return this.goods.create(ctx, body);
  }

  @Post(':id/prices')
  addPrice(
    @Param('id') id: string,
    @Headers('if-match') version: string,
    @Body() body: { priceType: PriceType; amount: number },
    @WorkspaceCtx() ctx: WorkspaceContext,
  ) {
    return this.goods.addPrice(ctx, id, parseIfMatch(version), body);
  }

  @Post(':id/quantities')
  addQuantity(
    @Param('id') id: string,
    @Headers('if-match') version: string,
    @Body() body: { quantityAfter: number; reason: QuantityChangeReason },
    @WorkspaceCtx() ctx: WorkspaceContext,
  ) {
    return this.goods.addQuantityChange(ctx, id, parseIfMatch(version), body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Headers('if-match') version: string,
    @Body() body: { status?: GoodsOfferStatus; title?: string; rawSummary?: string },
    @WorkspaceCtx() ctx: WorkspaceContext,
  ) {
    return this.goods.update(ctx, id, parseIfMatch(version), body);
  }
}

function parseIfMatch(value: string | undefined): number {
  if (!value) return Number.NaN;
  return Number(value.replace(/^W\//, '').replaceAll('"', '').trim());
}
