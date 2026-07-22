import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { WorkspaceContext } from './workspace-scope.guard';

export const WorkspaceCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceContext => {
    return ctx.switchToHttp().getRequest().workspaceContext;
  },
);
