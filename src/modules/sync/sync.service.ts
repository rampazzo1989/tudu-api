import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncSnapshotDto } from './dto/sync-snapshot.dto';
import { SyncDeltaDto } from './dto/sync-delta.dto';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Imports or updates complete local data snapshot (used on subscription activation).
   */
  async importSnapshot(userId: string, dto: SyncSnapshotDto) {
    this.logger.log(`Importing initial data snapshot for user ${userId}`);
    const data = dto.data;

    let importedLists = 0;
    let importedTasks = 0;
    let importedCounters = 0;

    await this.prisma.$transaction(async tx => {
      // 1. Process Lists (myLists and archivedLists)
      const allLists = [...(data.myLists || []), ...(data.archivedLists || [])];
      for (const [id, listObj] of allLists) {
        if (!id || !listObj?.name) continue;
        await tx.list.upsert({
          where: { id },
          update: {
            name: listObj.name,
            color: listObj.color || null,
            icon: listObj.icon || null,
            order: typeof listObj.order === 'number' ? listObj.order : 0,
            isArchived: !!listObj.isArchived,
            deletedAt: null,
          },
          create: {
            id,
            userId,
            name: listObj.name,
            color: listObj.color || null,
            icon: listObj.icon || null,
            order: typeof listObj.order === 'number' ? listObj.order : 0,
            isArchived: !!listObj.isArchived,
          },
        });
        importedLists++;
      }

      // 2. Process Tasks (tudus, archivedTudus, unlistedTudus)
      // data.tudus is [listId, [taskId, taskObj][]][]
      const nestedTaskGroups = [...(data.tudus || []), ...(data.archivedTudus || [])];
      for (const [listId, taskPairs] of nestedTaskGroups) {
        if (!Array.isArray(taskPairs)) continue;
        for (const [id, task] of taskPairs) {
          if (!id || !task?.title) continue;
          await tx.task.upsert({
            where: { id },
            update: {
              listId: listId || null,
              title: task.title,
              description: task.description || null,
              done: !!task.done,
              starred: !!task.starred,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              order: typeof task.order === 'number' ? task.order : 0,
              isArchived: !!task.isArchived,
              isUnlisted: false,
              deletedAt: null,
            },
            create: {
              id,
              userId,
              listId: listId || null,
              title: task.title,
              description: task.description || null,
              done: !!task.done,
              starred: !!task.starred,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              order: typeof task.order === 'number' ? task.order : 0,
              isArchived: !!task.isArchived,
              isUnlisted: false,
            },
          });
          importedTasks++;
        }
      }

      // Process unlisted tasks
      if (Array.isArray(data.unlistedTudus)) {
        for (const [id, task] of data.unlistedTudus) {
          if (!id || !task?.title) continue;
          await tx.task.upsert({
            where: { id },
            update: {
              title: task.title,
              description: task.description || null,
              done: !!task.done,
              starred: !!task.starred,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              order: typeof task.order === 'number' ? task.order : 0,
              isUnlisted: true,
              deletedAt: null,
            },
            create: {
              id,
              userId,
              title: task.title,
              description: task.description || null,
              done: !!task.done,
              starred: !!task.starred,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              order: typeof task.order === 'number' ? task.order : 0,
              isUnlisted: true,
            },
          });
          importedTasks++;
        }
      }

      // 3. Process Counters
      if (Array.isArray(data.counters)) {
        for (const [id, counter] of data.counters) {
          if (!id || !counter?.name) continue;
          await tx.counter.upsert({
            where: { id },
            update: {
              name: counter.name,
              count: typeof counter.count === 'number' ? counter.count : 0,
              step: typeof counter.step === 'number' ? counter.step : 1,
              color: counter.color || null,
              icon: counter.icon || null,
              order: typeof counter.order === 'number' ? counter.order : 0,
              deletedAt: null,
            },
            create: {
              id,
              userId,
              name: counter.name,
              count: typeof counter.count === 'number' ? counter.count : 0,
              step: typeof counter.step === 'number' ? counter.step : 1,
              color: counter.color || null,
              icon: counter.icon || null,
              order: typeof counter.order === 'number' ? counter.order : 0,
            },
          });
          importedCounters++;
        }
      }

      // 4. Process Settings
      if (data.settings) {
        await tx.userSettings.upsert({
          where: { userId },
          update: {
            notificationSettings: data.settings.notificationSettings || undefined,
            backupPreferences: data.settings.backupPreferences || undefined,
            generalSettings: {
              showOutdatedTudus: data.settings.showOutdatedTudus,
              hasSeenOnboarding: data.settings.hasSeenOnboarding,
            },
            emojiUsage: data.emojiUsage ? Object.fromEntries(data.emojiUsage) : undefined,
          },
          create: {
            userId,
            notificationSettings: data.settings.notificationSettings || null,
            backupPreferences: data.settings.backupPreferences || null,
            generalSettings: {
              showOutdatedTudus: data.settings.showOutdatedTudus,
              hasSeenOnboarding: data.settings.hasSeenOnboarding,
            },
            emojiUsage: data.emojiUsage ? Object.fromEntries(data.emojiUsage) : null,
          },
        });
      }

      // 5. Log sync
      await tx.syncLog.create({
        data: {
          userId,
          clientTime: new Date(),
          serverTime: new Date(),
          syncedCount: importedLists + importedTasks + importedCounters,
        },
      });
    });

    this.logger.log(
      `Snapshot imported: ${importedLists} lists, ${importedTasks} tasks, ${importedCounters} counters for user ${userId}`,
    );

    return {
      success: true,
      syncTimestamp: Date.now(),
      summary: { importedLists, importedTasks, importedCounters },
    };
  }

  /**
   * Bidirectional incremental delta sync using Last-Write-Wins.
   */
  async syncDelta(userId: string, dto: SyncDeltaDto) {
    const serverTimestamp = Date.now();
    const lastSyncDate = new Date(dto.lastSyncTimestamp || 0);

    // 1. Apply Incoming Mutations from Client
    if (dto.lists && dto.lists.length > 0) {
      for (const item of dto.lists) {
        const deletedAt = item.deletedAt ? new Date(item.deletedAt) : null;
        await this.prisma.list.upsert({
          where: { id: item.id },
          update: {
            name: item.name,
            color: item.color || null,
            icon: item.icon || null,
            order: item.order ?? 0,
            isArchived: !!item.isArchived,
            deletedAt,
            updatedAt: new Date(item.updatedAt),
          },
          create: {
            id: item.id,
            userId,
            name: item.name,
            color: item.color || null,
            icon: item.icon || null,
            order: item.order ?? 0,
            isArchived: !!item.isArchived,
            deletedAt,
            updatedAt: new Date(item.updatedAt),
          },
        });
      }
    }

    if (dto.tasks && dto.tasks.length > 0) {
      for (const item of dto.tasks) {
        const deletedAt = item.deletedAt ? new Date(item.deletedAt) : null;
        await this.prisma.task.upsert({
          where: { id: item.id },
          update: {
            listId: item.listId || null,
            title: item.title,
            description: item.description || null,
            done: !!item.done,
            starred: !!item.starred,
            dueDate: item.dueDate ? new Date(item.dueDate) : null,
            order: item.order ?? 0,
            isArchived: !!item.isArchived,
            isUnlisted: !!item.isUnlisted,
            deletedAt,
            updatedAt: new Date(item.updatedAt),
          },
          create: {
            id: item.id,
            userId,
            listId: item.listId || null,
            title: item.title,
            description: item.description || null,
            done: !!item.done,
            starred: !!item.starred,
            dueDate: item.dueDate ? new Date(item.dueDate) : null,
            order: item.order ?? 0,
            isArchived: !!item.isArchived,
            isUnlisted: !!item.isUnlisted,
            deletedAt,
            updatedAt: new Date(item.updatedAt),
          },
        });
      }
    }

    if (dto.counters && dto.counters.length > 0) {
      for (const item of dto.counters) {
        const deletedAt = item.deletedAt ? new Date(item.deletedAt) : null;
        await this.prisma.counter.upsert({
          where: { id: item.id },
          update: {
            name: item.name,
            count: item.count,
            step: item.step ?? 1,
            color: item.color || null,
            icon: item.icon || null,
            order: item.order ?? 0,
            deletedAt,
            updatedAt: new Date(item.updatedAt),
          },
          create: {
            id: item.id,
            userId,
            name: item.name,
            count: item.count,
            step: item.step ?? 1,
            color: item.color || null,
            icon: item.icon || null,
            order: item.order ?? 0,
            deletedAt,
            updatedAt: new Date(item.updatedAt),
          },
        });
      }
    }

    if (dto.settings) {
      await this.prisma.userSettings.upsert({
        where: { userId },
        update: {
          notificationSettings: dto.settings.notificationSettings || undefined,
          backupPreferences: dto.settings.backupPreferences || undefined,
          generalSettings: dto.settings.generalSettings || undefined,
        },
        create: {
          userId,
          notificationSettings: dto.settings.notificationSettings || null,
          backupPreferences: dto.settings.backupPreferences || null,
          generalSettings: dto.settings.generalSettings || null,
        },
      });
    }

    // 2. Fetch Remote Changes Since lastSyncDate
    const remoteLists = await this.prisma.list.findMany({
      where: {
        userId,
        updatedAt: { gt: lastSyncDate },
      },
    });

    const remoteTasks = await this.prisma.task.findMany({
      where: {
        userId,
        updatedAt: { gt: lastSyncDate },
      },
    });

    const remoteCounters = await this.prisma.counter.findMany({
      where: {
        userId,
        updatedAt: { gt: lastSyncDate },
      },
    });

    const remoteSettings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });

    return {
      syncTimestamp: serverTimestamp,
      delta: {
        lists: remoteLists.map(l => ({
          ...l,
          updatedAt: l.updatedAt.getTime(),
          deletedAt: l.deletedAt ? l.deletedAt.getTime() : null,
        })),
        tasks: remoteTasks.map(t => ({
          ...t,
          dueDate: t.dueDate ? t.dueDate.toISOString() : null,
          updatedAt: t.updatedAt.getTime(),
          deletedAt: t.deletedAt ? t.deletedAt.getTime() : null,
        })),
        counters: remoteCounters.map(c => ({
          ...c,
          updatedAt: c.updatedAt.getTime(),
          deletedAt: c.deletedAt ? c.deletedAt.getTime() : null,
        })),
        settings: remoteSettings,
      },
    };
  }

  /**
   * Exports full cloud backup formatted as TuduBackupPayload.
   */
  async exportBackup(userId: string) {
    const lists = await this.prisma.list.findMany({
      where: { userId, deletedAt: null },
    });

    const tasks = await this.prisma.task.findMany({
      where: { userId, deletedAt: null },
    });

    const counters = await this.prisma.counter.findMany({
      where: { userId, deletedAt: null },
    });

    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });

    const myLists: [string, any][] = [];
    const archivedLists: [string, any][] = [];

    lists.forEach(l => {
      const entry: [string, any] = [
        l.id,
        {
          id: l.id,
          name: l.name,
          color: l.color,
          icon: l.icon,
          order: l.order,
          isArchived: l.isArchived,
        },
      ];
      if (l.isArchived) {
        archivedLists.push(entry);
      } else {
        myLists.push(entry);
      }
    });

    const tudusMap = new Map<string, [string, any][]>();
    const archivedTudusMap = new Map<string, [string, any][]>();
    const unlistedTudus: [string, any][] = [];

    tasks.forEach(t => {
      const taskObj = {
        id: t.id,
        title: t.title,
        description: t.description,
        done: t.done,
        starred: t.starred,
        dueDate: t.dueDate ? t.dueDate.toISOString() : undefined,
        order: t.order,
        isArchived: t.isArchived,
      };

      if (t.isUnlisted || !t.listId) {
        unlistedTudus.push([t.id, taskObj]);
      } else if (t.isArchived) {
        const listTasks = archivedTudusMap.get(t.listId) || [];
        listTasks.push([t.id, taskObj]);
        archivedTudusMap.set(t.listId, listTasks);
      } else {
        const listTasks = tudusMap.get(t.listId) || [];
        listTasks.push([t.id, taskObj]);
        tudusMap.set(t.listId, listTasks);
      }
    });

    return {
      metadata: {
        version: 1,
        appName: 'tudu-cloud-api',
        createdAt: new Date().toISOString(),
      },
      data: {
        myLists,
        archivedLists,
        tudus: Array.from(tudusMap.entries()),
        archivedTudus: Array.from(archivedTudusMap.entries()),
        unlistedTudus,
        counters: counters.map(c => [c.id, c]),
        settings,
      },
    };
  }
}
