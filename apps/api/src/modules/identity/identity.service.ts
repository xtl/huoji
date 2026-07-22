import { Injectable, NotImplementedException } from '@nestjs/common';

/**
 * BE-01 身份与工作空间（说明书 6.1 章）。
 * 负责：微信小程序登录、手机号登录、Token 刷新、会话与设备管理。
 * 规则：首次登录自动创建个人空间（一个用户仅一个，见 uq_personal_workspace 索引）。
 */
@Injectable()
export class IdentityService {
  async wechatLogin(_code: string): Promise<never> {
    // TODO(BE-01): code2session -> user_identities 匹配/创建 -> 签发 Access/Refresh Token
    throw new NotImplementedException({ code: 'NOT_IMPLEMENTED', message: 'BE-01 待实现' });
  }

  async mobileLogin(_mobile: string, _smsCode: string): Promise<never> {
    throw new NotImplementedException({ code: 'NOT_IMPLEMENTED', message: 'BE-01 待实现' });
  }

  async refresh(_refreshToken: string): Promise<never> {
    throw new NotImplementedException({ code: 'NOT_IMPLEMENTED', message: 'BE-01 待实现' });
  }
}
