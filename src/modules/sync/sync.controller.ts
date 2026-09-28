import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncSnapshotDto } from './dto/sync-snapshot.dto';
import { SyncDeltaDto } from './dto/sync-delta.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/sync')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('snapshot')
  @HttpCode(HttpStatus.OK)
  async importSnapshot(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SyncSnapshotDto,
  ) {
    return this.syncService.importSnapshot(user.id, dto);
  }

  @Post('delta')
  @HttpCode(HttpStatus.OK)
  async syncDelta(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SyncDeltaDto,
  ) {
    return this.syncService.syncDelta(user.id, dto);
  }

  @Get('export')
  async exportBackup(@CurrentUser() user: CurrentUserData) {
    return this.syncService.exportBackup(user.id);
  }
}
