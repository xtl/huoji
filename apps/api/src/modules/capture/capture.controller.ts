import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CaptureService } from './capture.service';
import type { CaptureType } from '@huoji/domain-types';
import { WorkspaceCtx } from '../../common/request-context';
import type { WorkspaceContext } from '../../common/workspace-scope.guard';

/** 说明书 18.2 原始采集与 AI */
@Controller('captures')
export class CaptureController {
  constructor(private readonly captures: CaptureService) {}

  @Post()
  create(
    @WorkspaceCtx() ctx: WorkspaceContext,
    @Body() body: { captureType: CaptureType; rawText?: string; fileId?: string },
  ) {
    return this.captures.create(ctx, body);
  }

  @Get(':id/result')
  getResult(@WorkspaceCtx() ctx: WorkspaceContext, @Param('id') id: string) {
    return this.captures.getResult(ctx, id);
  }

  @Post(':id/confirm')
  confirm(
    @WorkspaceCtx() ctx: WorkspaceContext,
    @Param('id') id: string,
    @Body() corrections: Record<string, unknown>,
  ) {
    return this.captures.confirm(ctx, id, corrections);
  }
}
