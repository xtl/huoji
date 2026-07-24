import { Body, Controller, Get, Post } from '@nestjs/common';
import { WorkspaceCtx } from '../../common/request-context';
import type { WorkspaceContext } from '../../common/workspace-scope.guard';
import { DemandService } from './demand.service';

@Controller('demands')
export class DemandController {
  constructor(private readonly demands: DemandService) {}

  @Get()
  list(@WorkspaceCtx() ctx: WorkspaceContext) {
    return this.demands.list(ctx);
  }

  @Post()
  create(@WorkspaceCtx() ctx: WorkspaceContext, @Body() body: Record<string, unknown>) {
    return this.demands.create(ctx, body);
  }
}
