import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';

@Module({
  controllers: [SyncController],
  providers: [SyncService, SubscriptionGuard],
  exports: [SyncService],
})
export class SyncModule {}
