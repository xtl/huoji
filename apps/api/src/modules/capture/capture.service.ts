import { Injectable, NotImplementedException } from '@nestjs/common';
import type { CaptureType } from '@huoji/domain-types';

/**
 * BE-02 文件与采集（说明书 6.4/10.8/12 章）。
 * 链路：创建 CaptureItem -> 提交 AI 任务(异步队列) -> 前端轮询结果 -> 用户确认 -> 创建正式货源。
 * 约束（28 章）：AI 抽取结果必须经用户确认才能成为正式业务数据；
 * AI 任务必须异步执行，前端不能阻塞等待。
 */
@Injectable()
export class CaptureService {
  async create(_input: { captureType: CaptureType; rawText?: string; fileId?: string }): Promise<never> {
    // TODO(BE-02): 落库 capture_items(status=PENDING) + event_outbox 写 capture.created
    throw new NotImplementedException({ code: 'NOT_IMPLEMENTED', message: 'BE-02 待实现' });
  }

  async getResult(_id: string): Promise<never> {
    // TODO(BE-02): 返回 ai_extraction_jobs.result_payload（含置信度/缺失项/冲突项）
    throw new NotImplementedException({ code: 'NOT_IMPLEMENTED', message: 'BE-02 待实现' });
  }

  async confirm(_id: string, _corrections: Record<string, unknown>): Promise<never> {
    // TODO(BE-02): 确认后调用 GoodsService.createFromCapture，写确认人/确认时间
    throw new NotImplementedException({ code: 'NOT_IMPLEMENTED', message: 'BE-02 待实现' });
  }
}
