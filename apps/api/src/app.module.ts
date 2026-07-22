import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { IdentityModule } from './modules/identity/identity.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { CaptureModule } from './modules/capture/capture.module';
import { GoodsModule } from './modules/goods/goods.module';
import { PartyModule } from './modules/party/party.module';
import { DemandModule } from './modules/demand/demand.module';
import { TaskModule } from './modules/task/task.module';
import { QuoteModule } from './modules/quote/quote.module';
import { PlatformModule } from './modules/platform/platform.module';
import { WorkspaceScopeGuard } from './common/workspace-scope.guard';

/**
 * 模块化单体（说明书 3.1 / 28 章约束 10）：
 * 模块间只能通过明确导出的 Service 或领域事件（event_outbox）通信，
 * 禁止跨模块直接访问对方数据表。
 */
@Module({
  imports: [
    IdentityModule,
    WorkspaceModule,
    CaptureModule,
    GoodsModule,
    PartyModule,
    DemandModule,
    TaskModule,
    QuoteModule,
    PlatformModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: WorkspaceScopeGuard }],
})
export class AppModule {}
