import { SyncService } from './sync.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('SyncService (Offline-First Cloud Sync)', () => {
  let service: SyncService;
  let mockPrisma: any;
  let mockTx: any;

  beforeEach(() => {
    mockTx = {
      list: { upsert: jest.fn() },
      task: { upsert: jest.fn() },
      counter: { upsert: jest.fn() },
      userSettings: { upsert: jest.fn() },
      syncLog: { create: jest.fn() },
    };

    mockPrisma = {
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
      list: {
        upsert: jest.fn(),
        findMany: jest.fn(),
      },
      task: {
        upsert: jest.fn(),
        findMany: jest.fn(),
      },
      counter: {
        upsert: jest.fn(),
        findMany: jest.fn(),
      },
      userSettings: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    service = new SyncService(mockPrisma as PrismaService);
  });

  describe('importSnapshot', () => {
    it('should import full snapshot into database within an atomic transaction', async () => {
      const snapshotDto = {
        data: {
          myLists: [
            ['list-1', { name: 'Mercado', color: '#FF5733', icon: '🛒', order: 0 }],
          ] as [string, any][],
          tudus: [
            [
              'list-1',
              [
                ['task-1', { title: 'Comprar Leite', done: false, starred: true }],
                ['task-2', { title: 'Comprar Pão', done: true, starred: false }],
              ],
            ],
          ] as [string, [string, any][]][],
          counters: [
            ['counter-1', { name: 'Cafés tomados', count: 3, step: 1 }],
          ] as [string, any][],
          settings: {
            showOutdatedTudus: true,
            notificationSettings: { dailyDigestEnabled: true },
          },
        },
      };

      const result = await service.importSnapshot('user-1', snapshotDto);

      expect(result.success).toBe(true);
      expect(result.summary.importedLists).toBe(1);
      expect(result.summary.importedTasks).toBe(2);
      expect(result.summary.importedCounters).toBe(1);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockTx.list.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'list-1' } }),
      );
      expect(mockTx.task.upsert).toHaveBeenCalledTimes(2);
      expect(mockTx.counter.upsert).toHaveBeenCalledTimes(1);
      expect(mockTx.userSettings.upsert).toHaveBeenCalled();
    });
  });

  describe('syncDelta', () => {
    it('should process client delta mutations and fetch server changes', async () => {
      const deltaDto = {
        lastSyncTimestamp: 1700000000000,
        lists: [
          {
            id: 'list-10',
            name: 'Viagem atualizada',
            updatedAt: 1700000050000,
          },
        ],
        tasks: [
          {
            id: 'task-10',
            title: 'Mala pronta',
            done: true,
            updatedAt: 1700000060000,
          },
        ],
      };

      const now = new Date();
      mockPrisma.list.upsert.mockResolvedValue({});
      mockPrisma.task.upsert.mockResolvedValue({});
      mockPrisma.list.findMany.mockResolvedValue([
        {
          id: 'list-remote',
          userId: 'user-1',
          name: 'Lista Remota',
          updatedAt: now,
          deletedAt: null,
        },
      ]);
      mockPrisma.task.findMany.mockResolvedValue([]);
      mockPrisma.counter.findMany.mockResolvedValue([]);
      mockPrisma.userSettings.findUnique.mockResolvedValue(null);

      const response = await service.syncDelta('user-1', deltaDto);

      expect(response.syncTimestamp).toBeDefined();
      expect(response.delta.lists.length).toBe(1);
      expect(response.delta.lists[0].id).toBe('list-remote');
      expect(mockPrisma.list.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'list-10' } }),
      );
      expect(mockPrisma.task.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-10' } }),
      );
    });

    it('should handle soft delete (tombstones) in delta mutations', async () => {
      const deletedAt = Date.now();
      const deltaDto = {
        lastSyncTimestamp: 1700000000000,
        lists: [
          {
            id: 'list-deleted',
            name: 'Lista Removida',
            updatedAt: deletedAt,
            deletedAt: deletedAt,
          },
        ],
      };

      mockPrisma.list.upsert.mockResolvedValue({});
      mockPrisma.list.findMany.mockResolvedValue([]);
      mockPrisma.task.findMany.mockResolvedValue([]);
      mockPrisma.counter.findMany.mockResolvedValue([]);
      mockPrisma.userSettings.findUnique.mockResolvedValue(null);

      await service.syncDelta('user-1', deltaDto);

      expect(mockPrisma.list.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'list-deleted' },
          update: expect.objectContaining({ deletedAt: new Date(deletedAt) }),
        }),
      );
    });
  });

  describe('exportBackup', () => {
    it('should export all active cloud data formatted as TuduBackupPayload', async () => {
      mockPrisma.list.findMany.mockResolvedValue([
        { id: 'l1', name: 'Lista 1', isArchived: false, color: '#fff', icon: '⭐', order: 0 },
      ]);
      mockPrisma.task.findMany.mockResolvedValue([
        { id: 't1', listId: 'l1', title: 'Task 1', done: false, starred: false, order: 0, isArchived: false },
      ]);
      mockPrisma.counter.findMany.mockResolvedValue([]);
      mockPrisma.userSettings.findUnique.mockResolvedValue({ generalSettings: { showOutdatedTudus: true } });

      const backup = await service.exportBackup('user-1');

      expect(backup.metadata.appName).toBe('tudu-cloud-api');
      expect(backup.data.myLists.length).toBe(1);
      expect(backup.data.myLists[0][0]).toBe('l1');
      expect(backup.data.tudus.length).toBe(1);
      expect(backup.data.tudus[0][0]).toBe('l1');
    });
  });
});
