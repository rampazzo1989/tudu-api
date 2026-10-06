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
      $transaction: jest.fn(async (arg: any) => {
        if (typeof arg === 'function') {
          return arg(mockTx);
        }
        return Promise.all(arg);
      }),
      list: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn().mockReturnValue(Promise.resolve({})),
        create: jest.fn().mockReturnValue(Promise.resolve({})),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      task: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn().mockReturnValue(Promise.resolve({})),
        create: jest.fn().mockReturnValue(Promise.resolve({})),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      counter: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn().mockReturnValue(Promise.resolve({})),
        create: jest.fn().mockReturnValue(Promise.resolve({})),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
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
    it('should create items when they do not exist in DB', async () => {
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
      mockPrisma.list.findMany.mockImplementation(async (query: any) => {
        if (query?.where?.id?.in) return [];
        return [
          {
            id: 'list-remote',
            userId: 'user-1',
            name: 'Lista Remota',
            updatedAt: now,
            deletedAt: null,
          },
        ];
      });
      mockPrisma.task.findMany.mockImplementation(async (query: any) => {
        if (query?.where?.id?.in) return [];
        return [];
      });
      mockPrisma.counter.findMany.mockResolvedValue([]);
      mockPrisma.userSettings.findUnique.mockResolvedValue(null);

      const response = await service.syncDelta('user-1', deltaDto);

      expect(response.syncTimestamp).toBeDefined();
      expect(response.delta.lists.length).toBe(1);
      expect(response.delta.lists[0].id).toBe('list-remote');
      expect(mockPrisma.list.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ id: 'list-10' })]) }),
      );
      expect(mockPrisma.task.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ id: 'task-10' })]) }),
      );
    });

    it('should update item when incoming timestamp is newer than existing record in DB', async () => {
      const deltaDto = {
        lastSyncTimestamp: 1700000000000,
        tasks: [
          {
            id: 'task-10',
            title: 'Título Novo do Cliente',
            done: true,
            updatedAt: 1700000060000,
          },
        ],
      };

      mockPrisma.task.findMany.mockImplementation(async (query: any) => {
        if (query?.where?.id?.in) {
          return [
            {
              id: 'task-10',
              userId: 'user-1',
              title: 'Título Antigo do Banco',
              updatedAt: new Date(1700000050000), // DB is older than client (50000 < 60000)
            },
          ];
        }
        return [];
      });
      mockPrisma.list.findMany.mockResolvedValue([]);
      mockPrisma.counter.findMany.mockResolvedValue([]);
      mockPrisma.userSettings.findUnique.mockResolvedValue(null);

      await service.syncDelta('user-1', deltaDto);

      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-10' },
          data: expect.objectContaining({ title: 'Título Novo do Cliente' }),
        }),
      );
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should skip update and preserve DB record when existing DB timestamp is newer (Last-Write-Wins conflict protection)', async () => {
      const deltaDto = {
        lastSyncTimestamp: 1700000000000,
        tasks: [
          {
            id: 'task-conflict',
            title: 'Edição Desatualizada do Cliente',
            updatedAt: 1700000040000,
          },
        ],
      };

      const dbUpdatedAt = new Date(1700000090000); // DB is NEWER (90000 > 40000)
      mockPrisma.task.findMany.mockImplementation(async (query: any) => {
        return [
          {
            id: 'task-conflict',
            userId: 'user-1',
            title: 'Edição Mais Recente Feita na Web',
            updatedAt: dbUpdatedAt,
          },
        ];
      });
      mockPrisma.list.findMany.mockResolvedValue([]);
      mockPrisma.counter.findMany.mockResolvedValue([]);
      mockPrisma.userSettings.findUnique.mockResolvedValue(null);

      const response = await service.syncDelta('user-1', deltaDto);

      // Verify client's outdated update was rejected
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
      // Verify authoritative DB record is included in delta returned to client
      expect(response.delta.tasks.some(t => t.id === 'task-conflict')).toBe(true);
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            OR: expect.arrayContaining([
              { id: { in: ['task-conflict'] } },
            ]),
          }),
        }),
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

      mockPrisma.list.findMany.mockImplementation(async (query: any) => {
        if (query?.where?.id?.in) {
          return [
            {
              id: 'list-deleted',
              userId: 'user-1',
              name: 'Lista Ativa',
              updatedAt: new Date(deletedAt - 1000),
            },
          ];
        }
        return [];
      });
      mockPrisma.task.findMany.mockResolvedValue([]);
      mockPrisma.counter.findMany.mockResolvedValue([]);
      mockPrisma.userSettings.findUnique.mockResolvedValue(null);

      await service.syncDelta('user-1', deltaDto);

      expect(mockPrisma.list.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'list-deleted' },
          data: expect.objectContaining({ deletedAt: new Date(deletedAt) }),
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
