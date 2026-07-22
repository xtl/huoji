import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

/**
 * 统一错误响应（说明书 18 章）：
 * { success: false, error: { code, message }, requestId }
 * 业务错误码示例：GOODS_PRICE_PERMISSION_DENIED / DATA_VERSION_CONFLICT / WORKSPACE_SUSPENDED
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let code = 'INTERNAL_ERROR';
    let message = '服务器内部错误';
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'code' in body) {
        code = String((body as Record<string, unknown>).code);
        message = String((body as Record<string, unknown>).message ?? exception.message);
      } else {
        code = `HTTP_${status}`;
        message = exception.message;
      }
    }

    res.status(status).json({
      success: false,
      error: { code, message },
      requestId: req.requestId ?? 'req_unknown',
    });
  }
}
