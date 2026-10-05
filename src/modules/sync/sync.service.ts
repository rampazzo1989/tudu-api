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
        if (!id) continue;
        const listName = listObj?.name || listObj?.label;
        if (!listName) continue;
        await tx.list.upsert({
          where: { id },
          update: {
            name: listName,
            color: listObj.color || null,
            icon: listObj.icon || null,
            order: typeof listObj.order === 'number' ? listObj.order : 0,
            isArchived: !!listObj.isArchived,
            groupName: listObj.groupName || null,
            sections: listObj.sections || null,
            orderingPrompt: listObj.orderingPrompt || null,
            deletedAt: null,
          },
          create: {
            id,
            userId,
            name: listName,
            color: listObj.color || null,
            icon: listObj.icon || null,
            order: typeof listObj.order === 'number' ? listObj.order : 0,
            isArchived: !!listObj.isArchived,
            groupName: listObj.groupName || null,
            sections: listObj.sections || null,
            orderingPrompt: listObj.orderingPrompt || null,
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
          if (!id) continue;
          const taskTitle = task?.title || task?.label;
          if (!taskTitle) continue;
          const taskOrder = typeof task.scheduledOrder === 'number' ? task.scheduledOrder : (typeof task.order === 'number' ? task.order : 0);
          await tx.task.upsert({
            where: { id },
            update: {
              listId: listId || null,
              title: taskTitle,
              description: task.description || null,
              done: !!task.done,
              starred: !!task.starred,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              hasTime: !!task.hasTime,
              order: taskOrder,
              isArchived: !!task.isArchived,
              isUnlisted: false,
              recurrence: task.recurrence || null,
              sectionId: task.sectionId || null,
              deletedAt: null,
            },
            create: {
              id,
              userId,
              listId: listId || null,
              title: taskTitle,
              description: task.description || null,
              done: !!task.done,
              starred: !!task.starred,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              hasTime: !!task.hasTime,
              order: taskOrder,
              isArchived: !!task.isArchived,
              isUnlisted: false,
              recurrence: task.recurrence || null,
              sectionId: task.sectionId || null,
            },
          });
          importedTasks++;
        }
      }

      // Process unlisted tasks
      if (Array.isArray(data.unlistedTudus)) {
        for (const [id, task] of data.unlistedTudus) {
          if (!id) continue;
          const taskTitle = task?.title || task?.label;
          if (!taskTitle) continue;
          const taskOrder = typeof task.scheduledOrder === 'number' ? task.scheduledOrder : (typeof task.order === 'number' ? task.order : 0);
          await tx.task.upsert({
            where: { id },
            update: {
              title: taskTitle,
              description: task.description || null,
              done: !!task.done,
              starred: !!task.starred,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              hasTime: !!task.hasTime,
              order: taskOrder,
              isUnlisted: true,
              recurrence: task.recurrence || null,
              sectionId: task.sectionId || null,
              deletedAt: null,
            },
            create: {
              id,
              userId,
              title: taskTitle,
              description: task.description || null,
              done: !!task.done,
              starred: !!task.starred,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              hasTime: !!task.hasTime,
              order: taskOrder,
              isUnlisted: true,
              recurrence: task.recurrence || null,
              sectionId: task.sectionId || null,
            },
          });
          importedTasks++;
        }
      }

      // 3. Process Counters
      if (Array.isArray(data.counters)) {
        for (const [id, counter] of data.counters) {
          if (!id) continue;
          const counterName = counter?.name || counter?.title;
          if (!counterName) continue;
          const count = typeof counter.count === 'number' ? counter.count : (typeof counter.value === 'number' ? counter.value : 0);
          const step = typeof counter.step === 'number' ? counter.step : (typeof counter.pace === 'number' ? counter.pace : 1);
          await tx.counter.upsert({
            where: { id },
            update: {
              name: counterName,
              count,
              step,
              color: counter.color || null,
              icon: counter.icon || null,
              order: typeof counter.order === 'number' ? counter.order : 0,
              deletedAt: null,
            },
            create: {
              id,
              userId,
              name: counterName,
              count,
              step,
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
        const listName = item.name || item.label || 'Lista';
        await this.prisma.list.upsert({
          where: { id: item.id },
          update: {
            name: listName,
            color: item.color || null,
            icon: item.icon || null,
            order: item.order ?? 0,
            isArchived: !!item.isArchived,
            groupName: item.groupName || null,
            sections: item.sections || null,
            orderingPrompt: item.orderingPrompt || null,
            deletedAt,
            updatedAt: new Date(item.updatedAt || Date.now()),
          },
          create: {
            id: item.id,
            userId,
            name: listName,
            color: item.color || null,
            icon: item.icon || null,
            order: item.order ?? 0,
            isArchived: !!item.isArchived,
            groupName: item.groupName || null,
            sections: item.sections || null,
            orderingPrompt: item.orderingPrompt || null,
            deletedAt,
            updatedAt: new Date(item.updatedAt || Date.now()),
          },
        });
      }
    }

    if (dto.tasks && dto.tasks.length > 0) {
      for (const item of dto.tasks) {
        const deletedAt = item.deletedAt ? new Date(item.deletedAt) : null;
        const taskTitle = item.title || item.label || 'Tarefa';
        const taskOrder = typeof item.scheduledOrder === 'number' ? item.scheduledOrder : (typeof item.order === 'number' ? item.order : 0);
        await this.prisma.task.upsert({
          where: { id: item.id },
          update: {
            listId: item.listId || null,
            title: taskTitle,
            description: item.description || null,
            done: !!item.done,
            starred: !!item.starred,
            dueDate: item.dueDate ? new Date(item.dueDate) : null,
            hasTime: !!item.hasTime,
            order: taskOrder,
            isArchived: !!item.isArchived,
            isUnlisted: !!item.isUnlisted,
            recurrence: item.recurrence || null,
            sectionId: item.sectionId || null,
            deletedAt,
            updatedAt: new Date(item.updatedAt || Date.now()),
          },
          create: {
            id: item.id,
            userId,
            listId: item.listId || null,
            title: taskTitle,
            description: item.description || null,
            done: !!item.done,
            starred: !!item.starred,
            dueDate: item.dueDate ? new Date(item.dueDate) : null,
            hasTime: !!item.hasTime,
            order: taskOrder,
            isArchived: !!item.isArchived,
            isUnlisted: !!item.isUnlisted,
            recurrence: item.recurrence || null,
            sectionId: item.sectionId || null,
            deletedAt,
            updatedAt: new Date(item.updatedAt || Date.now()),
          },
        });
      }
    }

    if (dto.counters && dto.counters.length > 0) {
      for (const item of dto.counters) {
        const deletedAt = item.deletedAt ? new Date(item.deletedAt) : null;
        const counterName = item.name || item.title || 'Contador';
        const count = typeof item.count === 'number' ? item.count : (typeof item.value === 'number' ? item.value : 0);
        const step = typeof item.step === 'number' ? item.step : (typeof item.pace === 'number' ? item.pace : 1);
        await this.prisma.counter.upsert({
          where: { id: item.id },
          update: {
            name: counterName,
            count,
            step,
            color: item.color || null,
            icon: item.icon || null,
            order: item.order ?? 0,
            deletedAt,
            updatedAt: new Date(item.updatedAt || Date.now()),
          },
          create: {
            id: item.id,
            userId,
            name: counterName,
            count,
            step,
            color: item.color || null,
            icon: item.icon || null,
            order: item.order ?? 0,
            deletedAt,
            updatedAt: new Date(item.updatedAt || Date.now()),
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
          label: l.name,
          groupName: l.groupName || undefined,
          sections: l.sections || undefined,
          orderingPrompt: l.orderingPrompt || undefined,
          updatedAt: l.updatedAt.getTime(),
          deletedAt: l.deletedAt ? l.deletedAt.getTime() : null,
        })),
        tasks: remoteTasks.map(t => ({
          ...t,
          label: t.title,
          scheduledOrder: t.order,
          hasTime: t.hasTime,
          recurrence: t.recurrence || undefined,
          sectionId: t.sectionId || undefined,
          dueDate: t.dueDate ? t.dueDate.toISOString() : null,
          updatedAt: t.updatedAt.getTime(),
          deletedAt: t.deletedAt ? t.deletedAt.getTime() : null,
        })),
        counters: remoteCounters.map(c => ({
          ...c,
          title: c.name,
          value: c.count,
          pace: c.step,
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
          label: l.name,
          color: l.color,
          icon: l.icon,
          order: l.order,
          isArchived: l.isArchived,
          groupName: l.groupName || undefined,
          sections: l.sections || undefined,
          orderingPrompt: l.orderingPrompt || undefined,
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
        label: t.title,
        description: t.description,
        done: t.done,
        starred: t.starred,
        dueDate: t.dueDate ? t.dueDate.toISOString() : undefined,
        hasTime: t.hasTime,
        order: t.order,
        scheduledOrder: t.order,
        recurrence: t.recurrence || undefined,
        sectionId: t.sectionId || undefined,
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

    const exportedCounters: [string, any][] = counters.map(c => [
      c.id,
      {
        id: c.id,
        name: c.name,
        title: c.name,
        count: c.count,
        value: c.count,
        step: c.step,
        pace: c.step,
        color: c.color,
        icon: c.icon,
        order: c.order,
      },
    ]);

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
        counters: exportedCounters,
        settings,
      },
    };
  }
}
