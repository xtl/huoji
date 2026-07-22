import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/** 标记无需空间上下文的路由（登录、平台管理入口等） */
export const PUBLIC_ROUTE = 'public_route';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

export interface WorkspaceContext {
  userId: string;
  workspaceId: string;
  workspaceType: 'PERSONAL' | 'ENTERPRISE';
  dataScope: 'SELF' | 'DEPARTMENT' | 'ALL';
  permissionCodes: string[];
}

/**
 * 租户隔离守卫（说明书 23.1 / 6.3 章）。
 * 四层判断：空间成员 → 操作权限 → 记录范围 → 字段权限。
 * 本守卫落实第一层并注入 WorkspaceContext；
 * 后两层由各模块 Service + 字段裁剪器（field-policy）完成。
 *
 * TODO(BE-01): 接入真实会话（Access Token 校验 + membership 查询）。
 * 约束：workspace_id 一律取自会话上下文，禁止信任前端传入的任意 workspaceId。
 */
@Injectable()
export class WorkspaceScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    // TODO(BE-01): 替换为真实鉴权。骨架阶段注入占位上下文以便联调。
    req.workspaceContext = {
      userId: 'dev-user',
      workspaceId: 'dev-workspace',
      workspaceType: 'PERSONAL',
      dataScope: 'SELF',
      permissionCodes: [],
    } satisfies WorkspaceContext;
    return true;
  }
}
