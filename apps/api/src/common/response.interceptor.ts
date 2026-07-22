import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { randomUUID } from 'crypto';
import type { ApiResponse } from '@huoji/domain-types';

/** 统一响应包装（说明书 18 章）：{ success, data, requestId } */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<unknown>> {
    const req = context.switchToHttp().getRequest();
    const requestId: string = req.headers['x-request-id'] ?? `req_${randomUUID()}`;
    req.requestId = requestId;
    return next.handle().pipe(map((data) => ({ success: true as const, data, requestId })));
  }
}
