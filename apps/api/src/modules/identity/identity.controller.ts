import { Body, Controller, Post } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { Public } from '../../common/workspace-scope.guard';

/** 说明书 18.1 登录接口 */
@Controller('auth')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Public()
  @Post('wechat/login')
  wechatLogin(@Body() body: { code: string }) {
    return this.identity.wechatLogin(body.code);
  }

  @Public()
  @Post('mobile/login')
  mobileLogin(@Body() body: { mobile: string; smsCode: string }) {
    return this.identity.mobileLogin(body.mobile, body.smsCode);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() body: { refreshToken: string }) {
    return this.identity.refresh(body.refreshToken);
  }
}
