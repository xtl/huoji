import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verify } from 'jsonwebtoken';
import { DatabaseService } from './database.module';

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
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header = String(req.headers.authorization ?? '');
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!token) {
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: '请先登录' });
    }

    let payload: { sub?: string; type?: string };
    try {
      payload = verify(token, process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret') as {
        sub?: string;
        type?: string;
      };
    } catch {
      throw new UnauthorizedException({ code: 'ACCESS_TOKEN_INVALID', message: '登录态无效或已过期' });
    }
    if (!payload.sub || payload.type !== 'access') {
      throw new UnauthorizedException({ code: 'ACCESS_TOKEN_INVALID', message: '登录态无效或已过期' });
    }

    const requestedWorkspaceId = req.headers['x-workspace-id'];
    const membership = await this.db.one<{
      user_id: string;
      workspace_id: string;
      workspace_type: 'PERSONAL' | 'ENTERPRISE';
      workspace_status: string;
      data_scope: WorkspaceContext['dataScope'];
      permissions: string[];
    }>(
      `
      SELECT
        m.user_id,
        w.id AS workspace_id,
        w.type AS workspace_type,
        w.status AS workspace_status,
        m.data_scope,
        COALESCE(array_agg(rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
      FROM memberships m
      JOIN workspaces w ON w.id = m.workspace_id
      LEFT JOIN membership_roles mr ON mr.membership_id = m.id
      LEFT JOIN role_permissions rp ON rp.role_id = mr.role_id
      WHERE m.user_id = $1
        AND m.status = 'ACTIVE'
        AND ($2::uuid IS NULL OR m.workspace_id = $2::uuid)
      GROUP BY m.user_id, w.id, w.type, w.status, m.data_scope
      ORDER BY w.type = 'PERSONAL' DESC
      LIMIT 1
      `,
      [payload.sub, typeof requestedWorkspaceId === 'string' ? requestedWorkspaceId : null],
    );
    if (!membership) {
      throw new UnauthorizedException({ code: 'WORKSPACE_ACCESS_DENIED', message: '无权访问该工作空间' });
    }
    if (membership.workspace_status !== 'ACTIVE') {
      throw new UnauthorizedException({ code: 'WORKSPACE_SUSPENDED', message: '工作空间已停用' });
    }

    req.workspaceContext = {
      userId: membership.user_id,
      workspaceId: membership.workspace_id,
      workspaceType: membership.workspace_type,
      dataScope: membership.data_scope,
      permissionCodes: membership.permissions ?? [],
    } satisfies WorkspaceContext;
    return true;
  }
}
