import { Body, Controller, Get, HttpCode, HttpStatus, Logger, Post, UseGuards } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncSnapshotDto } from './dto/sync-snapshot.dto';
import { SyncDeltaDto } from './dto/sync-delta.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/sync')
@UseGuards(JwtAuthGuard)
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(private readonly syncService: SyncService) {}

  @Post('snapshot')
  @UseGuards(SubscriptionGuard)
  @HttpCode(HttpStatus.OK)
  async importSnapshot(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SyncSnapshotDto,
  ) {
    const listCount = (dto.data?.myLists?.length ?? 0) + (dto.data?.archivedLists?.length ?? 0);
    const taskGroupCount = (dto.data?.tudus?.length ?? 0) + (dto.data?.archivedTudus?.length ?? 0);
    const unlistedCount = dto.data?.unlistedTudus?.length ?? 0;
    const counterCount = dto.data?.counters?.length ?? 0;

    this.logger.log(
      `📥 [Snapshot] Inbound from ${user.email} (${user.id}): ${listCount} lists, ${taskGroupCount} task groups + ${unlistedCount} unlisted, ${counterCount} counters`,
    );
    const result = await this.syncService.importSnapshot(user.id, dto);
    this.logger.log(`✅ [Snapshot] Import finished for ${user.email}`);
    return result;
  }

  @Post('delta')
  @UseGuards(SubscriptionGuard)
  @HttpCode(HttpStatus.OK)
  async syncDelta(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SyncDeltaDto,
  ) {
    const deletedLists = dto.lists?.filter(l => l.deletedAt) ?? [];
    const deletedTasks = dto.tasks?.filter(t => t.deletedAt) ?? [];
    const deletedCounters = dto.counters?.filter(c => c.deletedAt) ?? [];
    const totalDeleted = deletedLists.length + deletedTasks.length + deletedCounters.length;

    this.logger.log(
      `🔄 [Delta Sync] Inbound from ${user.email} (${user.id}): since ts=${dto.lastSyncTimestamp}, incoming=[${dto.lists?.length ?? 0} lists, ${dto.tasks?.length ?? 0} tasks, ${dto.counters?.length ?? 0} counters], deleted=[${totalDeleted}]`,
    );
    const result = await this.syncService.syncDelta(user.id, dto);
    this.logger.log(
      `✅ [Delta Sync] Processed for ${user.email}: new server ts=${result.syncTimestamp}, returned=[${result.delta.lists.length} lists, ${result.delta.tasks.length} tasks, ${result.delta.counters.length} counters]`,
    );
    return result;
  }

  @Get('export')
  async exportBackup(@CurrentUser() user: CurrentUserData) {
    this.logger.log(`📦 [Export Backup] Inbound from ${user.email} (${user.id})`);
    const result = await this.syncService.exportBackup(user.id);
    const listCount = (result.data?.myLists?.length ?? 0) + (result.data?.archivedLists?.length ?? 0);
    const taskGroupCount = (result.data?.tudus?.length ?? 0) + (result.data?.archivedTudus?.length ?? 0);
    const unlistedCount = result.data?.unlistedTudus?.length ?? 0;
    const counterCount = result.data?.counters?.length ?? 0;

    this.logger.log(
      `✅ [Export Backup] Exported for ${user.email}: ${listCount} lists, ${taskGroupCount} task groups + ${unlistedCount} unlisted, ${counterCount} counters`,
    );
    return result;
  }
}
