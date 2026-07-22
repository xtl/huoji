import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  GOODS_STATUS_TRANSITIONS,
  GoodsOfferStatus,
  PriceType,
  QuantityChangeReason,
} from '@huoji/domain-types';

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
  /** 15.1 状态机唯一校验入口 */
  assertTransition(from: GoodsOfferStatus, to: GoodsOfferStatus): void {
    const allowed = GOODS_STATUS_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new NotImplementedException({
        code: 'GOODS_STATUS_TRANSITION_DENIED',
        message: `货源状态不允许从 ${from} 流转到 ${to}`,
      });
    }
  }

  async list(): Promise<never> {
    throw new NotImplementedException({ code: 'NOT_IMPLEMENTED', message: 'BE-03 待实现' });
  }

  async addPrice(_goodsId: string, _price: { priceType: PriceType; amount: number }): Promise<never> {
    throw new NotImplementedException({ code: 'NOT_IMPLEMENTED', message: 'BE-03 待实现' });
  }

  async addQuantityChange(
    _goodsId: string,
    _change: { quantityAfter: number; reason: QuantityChangeReason },
  ): Promise<never> {
    throw new NotImplementedException({ code: 'NOT_IMPLEMENTED', message: 'BE-03 待实现' });
  }
}
