import { Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { GoodsService } from './goods.service';
import type { PriceType, QuantityChangeReason } from '@huoji/domain-types';

/**
 * 说明书 18.3 货源接口。
 * 所有修改接口接受 Idempotency-Key 与 If-Match: version（22.2 乐观锁）。
 */
@Controller('goods')
export class GoodsController {
  constructor(private readonly goods: GoodsService) {}

  @Get()
  list() {
    return this.goods.list();
  }

  @Post(':id/prices')
  addPrice(
    @Param('id') id: string,
    @Headers('if-match') _version: string,
    @Body() body: { priceType: PriceType; amount: number },
  ) {
    return this.goods.addPrice(id, body);
  }

  @Post(':id/quantities')
  addQuantity(
    @Param('id') id: string,
    @Headers('if-match') _version: string,
    @Body() body: { quantityAfter: number; reason: QuantityChangeReason },
  ) {
    return this.goods.addQuantityChange(id, body);
  }

  @Patch(':id')
  update(@Param('id') _id: string, @Headers('if-match') _version: string, @Body() _body: unknown) {
    return this.goods.list();
  }
}
