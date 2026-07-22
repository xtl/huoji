import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { sign, SignOptions, verify } from 'jsonwebtoken';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database.module';

/**
 * BE-01 身份与工作空间（说明书 6.1 章）。
 * 负责：微信小程序登录、手机号登录、Token 刷新、会话与设备管理。
 * 规则：首次登录自动创建个人空间（一个用户仅一个，见 uq_personal_workspace 索引）。
 */
@Injectable()
export class IdentityService {
  constructor(private readonly db: DatabaseService) {}

  async wechatLogin(code: string): Promise<LoginResult> {
    if (!code) {
      throw new BadRequestException({ code: 'WECHAT_CODE_REQUIRED', message: '缺少微信登录 code' });
    }
    // TODO(BE-01): 接微信 code2session。当前按兼容接口落库，便于小程序/前端联调。
    const identifier = `wx:${createHash('sha256').update(code).digest('hex').slice(0, 32)}`;
    return this.loginOrCreateUser({
      identityType: 'WECHAT_MINIAPP',
      identifier,
      displayName: `微信用户${identifier.slice(-6)}`,
    });
  }

  async mobileLogin(mobile: string, smsCode: string): Promise<LoginResult> {
    if (!mobile || !smsCode) {
      throw new BadRequestException({ code: 'MOBILE_LOGIN_INVALID', message: '手机号和验证码不能为空' });
    }
    const devCode = process.env.DEV_SMS_CODE ?? '000000';
    if (smsCode !== devCode) {
      throw new UnauthorizedException({ code: 'SMS_CODE_INVALID', message: '验证码错误' });
    }
    const identifier = createHash('sha256').update(`mobile:${mobile}`).digest('hex');
    return this.loginOrCreateUser({
      identityType: 'MOBILE',
      identifier,
      displayName: `用户${mobile.slice(-4)}`,
      mobile,
    });
  }

  async refresh(refreshToken: string): Promise<LoginResult> {
    let payload: { sub?: string; sid?: string; type?: string };
    try {
      payload = verify(refreshToken, process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret') as {
        sub?: string;
        sid?: string;
        type?: string;
      };
    } catch {
      throw new UnauthorizedException({ code: 'REFRESH_TOKEN_INVALID', message: '刷新令牌无效' });
    }
    if (!payload.sub || !payload.sid || payload.type !== 'refresh') {
      throw new UnauthorizedException({ code: 'REFRESH_TOKEN_INVALID', message: '刷新令牌无效' });
    }
    const session = await this.db.one<{ id: string }>(
      `
      SELECT id
      FROM user_sessions
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()
      `,
      [payload.sid, payload.sub],
    );
    if (!session) {
      throw new UnauthorizedException({ code: 'REFRESH_TOKEN_REVOKED', message: '刷新令牌已失效' });
    }
    return this.issueLoginResult(payload.sub);
  }

  private async loginOrCreateUser(input: {
    identityType: 'WECHAT_MINIAPP' | 'MOBILE';
    identifier: string;
    displayName: string;
    mobile?: string;
  }): Promise<LoginResult> {
    const userId = await this.db.tx(async (client) => {
      const existing = await client.query<{ user_id: string }>(
        'SELECT user_id FROM user_identities WHERE identity_type = $1 AND identifier = $2',
        [input.identityType, input.identifier],
      );
      if (existing.rows[0]) {
        await client.query('UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1', [
          existing.rows[0].user_id,
        ]);
        return existing.rows[0].user_id;
      }

      const created = await client.query<{ id: string }>(
        `
        INSERT INTO users(display_name, mobile, last_login_at)
        VALUES ($1, $2, now())
        RETURNING id
        `,
        [input.displayName, input.mobile ?? null],
      );
      const newUserId = created.rows[0].id;
      await client.query(
        `
        INSERT INTO user_identities(user_id, identity_type, identifier)
        VALUES ($1, $2, $3)
        `,
        [newUserId, input.identityType, input.identifier],
      );
      await this.createPersonalWorkspace(client, newUserId, input.displayName);
      return newUserId;
    });

    return this.issueLoginResult(userId);
  }

  private async createPersonalWorkspace(
    client: PoolClient,
    userId: string,
    displayName: string,
  ): Promise<void> {
    const workspace = await client.query<{ id: string }>(
      `
      INSERT INTO workspaces(type, name, owner_user_id)
      VALUES ('PERSONAL', $1, $2)
      RETURNING id
      `,
      [`${displayName}的个人空间`, userId],
    );
    const workspaceId = workspace.rows[0].id;
    const membership = await client.query<{ id: string }>(
      `
      INSERT INTO memberships(workspace_id, user_id, status, data_scope, joined_at)
      VALUES ($1, $2, 'ACTIVE', 'ALL', now())
      RETURNING id
      `,
      [workspaceId, userId],
    );
    const role = await client.query<{ id: string }>(
      `
      INSERT INTO roles(workspace_id, code, name, is_system)
      VALUES ($1, 'owner', '空间所有者', true)
      RETURNING id
      `,
      [workspaceId],
    );
    const permissions = [
      'goods.read_supplier',
      'goods.read_cost',
      'goods.write',
      'capture.write',
      'party.write',
      'quote.read_cost',
      'quote.read_margin',
    ];
    for (const permission of permissions) {
      await client.query('INSERT INTO role_permissions(role_id, permission_code) VALUES ($1, $2)', [
        role.rows[0].id,
        permission,
      ]);
    }
    await client.query('INSERT INTO membership_roles(membership_id, role_id) VALUES ($1, $2)', [
      membership.rows[0].id,
      role.rows[0].id,
    ]);
    await client.query('UPDATE users SET default_workspace_id = $1 WHERE id = $2', [workspaceId, userId]);
  }

  private async issueLoginResult(userId: string): Promise<LoginResult> {
    const user = await this.db.one<{
      id: string;
      display_name: string;
      default_workspace_id: string;
    }>('SELECT id, display_name, default_workspace_id FROM users WHERE id = $1 AND status = $2', [
      userId,
      'ACTIVE',
    ]);
    if (!user) {
      throw new UnauthorizedException({ code: 'USER_DISABLED', message: '账号已禁用' });
    }
    const workspaces = await this.db.query<{
      id: string;
      type: 'PERSONAL' | 'ENTERPRISE';
      name: string;
      status: string;
      plan_code: string;
    }>(
      `
      SELECT w.id, w.type, w.name, w.status, w.plan_code
      FROM memberships m
      JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1 AND m.status = 'ACTIVE'
      ORDER BY w.type = 'PERSONAL' DESC, w.created_at ASC
      `,
      [userId],
    );
    const sessionId = randomUUID();
    const refreshToken = sign(
      { sub: userId, sid: sessionId, type: 'refresh' },
      process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
      { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? '30d') as SignOptions['expiresIn'] },
    );
    await this.db.query(
      `
      INSERT INTO user_sessions(id, user_id, refresh_token_hash, expires_at)
      VALUES ($1, $2, $3, now() + interval '30 days')
      `,
      [sessionId, userId, createHash('sha256').update(refreshToken).digest('hex')],
    );

    return {
      accessToken: sign(
        { sub: userId, type: 'access' },
        process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
        { expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? '2h') as SignOptions['expiresIn'] },
      ),
      refreshToken,
      user: {
        id: user.id,
        displayName: user.display_name,
        defaultWorkspaceId: user.default_workspace_id,
      },
      workspaces: workspaces.rows.map((row) => ({
        id: row.id,
        type: row.type,
        name: row.name,
        status: row.status,
        planCode: row.plan_code,
      })),
    };
  }
}

interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    displayName: string;
    defaultWorkspaceId: string;
  };
  workspaces: Array<{
    id: string;
    type: 'PERSONAL' | 'ENTERPRISE';
    name: string;
    status: string;
    planCode: string;
  }>;
}
