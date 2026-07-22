import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CaptureService } from './capture.service';
import type { CaptureType } from '@huoji/domain-types';

/** 说明书 18.2 原始采集与 AI */
@Controller('captures')
export class CaptureController {
  constructor(private readonly captures: CaptureService) {}

  @Post()
  create(@Body() body: { captureType: CaptureType; rawText?: string; fileId?: string }) {
    return this.captures.create(body);
  }

  @Get(':id/result')
  getResult(@Param('id') id: string) {
    return this.captures.getResult(id);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Body() corrections: Record<string, unknown>) {
    return this.captures.confirm(id, corrections);
  }
}
