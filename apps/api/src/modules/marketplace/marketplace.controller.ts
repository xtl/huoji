import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { WorkspaceCtx } from '../../common/request-context';
import type { WorkspaceContext } from '../../common/workspace-scope.guard';
import { MarketplaceService } from './marketplace.service';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get()
  list(@Query('type') type?: 'GOODS' | 'DEMAND', @Query('gpuModel') gpuModel?: string) {
    return this.marketplace.list({ type, gpuModel });
  }

  @Post('goods/:goodsId/publish')
  publishGoods(
    @WorkspaceCtx() ctx: WorkspaceContext,
    @Param('goodsId') goodsId: string,
    @Body() body: { contactMethod?: string; priceAmount?: number },
  ) {
    return this.marketplace.publishGoods(ctx, goodsId, body);
  }

  @Post('demands/:demandId/publish')
  publishDemand(
    @WorkspaceCtx() ctx: WorkspaceContext,
    @Param('demandId') demandId: string,
    @Body() body: { contactMethod?: string },
  ) {
    return this.marketplace.publishDemand(ctx, demandId, body);
  }

  @Post()
  publishManual(@WorkspaceCtx() ctx: WorkspaceContext, @Body() body: Record<string, unknown>) {
    return this.marketplace.publishManual(ctx, body);
  }
}
