import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AlexaService } from './alexa.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ALEXA_INTENTS } from './alexa.constants';

describe('AlexaService', () => {
  let service: AlexaService;
  let prisma: any;
  let jwtService: any;

  const mockUser = {
    id: 'user-123',
    email: 'test@tudu.app',
    name: 'Felipe',
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === mockUser.id) return Promise.resolve(mockUser);
          return Promise.resolve(null);
        }),
      },
      userSettings: {
        findUnique: jest.fn().mockResolvedValue({
          userId: mockUser.id,
          generalSettings: {},
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      task: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      },
      list: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock_jwt_token'),
      verify: jest.fn().mockImplementation((token: string) => {
        if (token === 'valid_auth_code') {
          return { sub: mockUser.id, email: mockUser.email, type: 'alexa_auth_code' };
        }
        if (token === 'valid_user_access_token') {
          return { sub: mockUser.id, email: mockUser.email };
        }
        throw new Error('Invalid token');
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlexaService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('mock_secret') } },
      ],
    }).compile();

    service = module.get<AlexaService>(AlexaService);
  });

  describe('Pairing Code Flow', () => {
    it('generates a 6-digit numeric pairing code', async () => {
      const result = await service.generatePairingCode(mockUser.id);
      expect(result.code).toMatch(/^\d{6}$/);
      expect(result.expiresInSeconds).toBe(600);
      expect(prisma.userSettings.upsert).toHaveBeenCalled();
    });

    it('verifies a valid pairing code and returns an authorization code', async () => {
      const { code } = await service.generatePairingCode(mockUser.id);
      const authCode = await service.verifyPairingCode({
        code,
        state: 'xyz',
        redirect_uri: 'https://pitangui.amazon.com/api/call-back',
      });

      expect(authCode).toBe('mock_jwt_token');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: mockUser.id, type: 'alexa_auth_code' }),
        expect.anything(),
      );
    });

    it('throws UnauthorizedException for invalid pairing code', async () => {
      await expect(
        service.verifyPairingCode({
          code: '000000',
          state: 'xyz',
          redirect_uri: 'https://pitangui.amazon.com/api/call-back',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Token Exchange', () => {
    it('exchanges valid auth code for access token', async () => {
      const res = await service.exchangeToken({
        grant_type: 'authorization_code',
        code: 'valid_auth_code',
        client_id: 'tudu-alexa',
      });

      expect(res.access_token).toBe('mock_jwt_token');
      expect(res.token_type).toBe('Bearer');
      expect(res.expires_in).toBeGreaterThan(0);
      expect(prisma.userSettings.upsert).toHaveBeenCalled();
    });

    it('rejects invalid grant_type', async () => {
      await expect(
        service.exchangeToken({
          grant_type: 'client_credentials',
          code: 'valid_auth_code',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Alexa Webhook Handling', () => {
    it('prompts LinkAccount card when no access token is provided', async () => {
      const response = await service.handleAlexaWebhook({
        request: { type: 'LaunchRequest' },
      });

      expect(response.response.card?.type).toBe('LinkAccount');
      expect(response.response.outputSpeech.text).toContain('vincular sua conta');
    });

    it('handles LaunchRequest and reports today tasks', async () => {
      prisma.task.findMany.mockResolvedValueOnce([
        { id: '1', title: 'Comprar pão' },
        { id: '2', title: 'Reunião com equipe' },
      ]);

      const response = await service.handleAlexaWebhook({
        session: { user: { accessToken: 'valid_user_access_token' } },
        request: { type: 'LaunchRequest' },
      });

      expect(response.response.outputSpeech.text).toContain('Você tem 2 tarefas para hoje');
      expect(response.response.outputSpeech.text).toContain('Comprar pão');
      expect(response.response.shouldEndSession).toBe(false);
    });

    it('handles GetTodayTasksIntent when no tasks exist', async () => {
      prisma.task.findMany.mockResolvedValueOnce([]);

      const response = await service.handleAlexaWebhook({
        session: { user: { accessToken: 'valid_user_access_token' } },
        request: {
          type: 'IntentRequest',
          intent: { name: ALEXA_INTENTS.GET_TODAY_TASKS },
        },
      });

      expect(response.response.outputSpeech.text).toContain('Você não tem nenhuma tarefa pendente para hoje');
      expect(response.response.shouldEndSession).toBe(true);
    });

    it('handles CreateTaskIntent and creates task in database with default date Today', async () => {
      const response = await service.handleAlexaWebhook({
        session: { user: { accessToken: 'valid_user_access_token' } },
        request: {
          type: 'IntentRequest',
          intent: {
            name: ALEXA_INTENTS.CREATE_TASK,
            slots: {
              taskTitle: { value: 'pagar conta de água' },
            },
          },
        },
      });

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: mockUser.id,
            title: 'Pagar conta de água',
            done: false,
          }),
        }),
      );
      expect(response.response.outputSpeech.text).toContain('Pagar conta de água');
      expect(response.response.outputSpeech.text).toContain('hoje');
    });

    it('handles CreateTaskIntent with scheduled date and time', async () => {
      const response = await service.handleAlexaWebhook({
        session: { user: { accessToken: 'valid_user_access_token' } },
        request: {
          type: 'IntentRequest',
          intent: {
            name: ALEXA_INTENTS.CREATE_TASK,
            slots: {
              taskTitle: { value: 'levar o carro na oficina' },
              date: { value: '2026-10-25' },
              time: { value: '14:30' },
            },
          },
        },
      });

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Levar o carro na oficina',
            hasTime: true,
          }),
        }),
      );
      expect(response.response.outputSpeech.text).toContain('14 horas e 30');
    });

    it('handles GetNotificationsIntent when there are overdue tasks', async () => {
      prisma.task.findMany.mockResolvedValueOnce([
        { id: '1', title: 'Enviar relatório mensal' },
      ]);

      const response = await service.handleAlexaWebhook({
        session: { user: { accessToken: 'valid_user_access_token' } },
        request: {
          type: 'IntentRequest',
          intent: { name: ALEXA_INTENTS.GET_NOTIFICATIONS },
        },
      });

      expect(response.response.outputSpeech.text).toContain('1 tarefa atrasada');
      expect(response.response.outputSpeech.text).toContain('Enviar relatório mensal');
    });

    it('handles HelpIntent, StopIntent, and Fallback', async () => {
      const helpRes = await service.handleAlexaWebhook({
        session: { user: { accessToken: 'valid_user_access_token' } },
        request: {
          type: 'IntentRequest',
          intent: { name: ALEXA_INTENTS.HELP },
        },
      });
      expect(helpRes.response.outputSpeech.text).toContain('Com o Tudú na Alexa');

      const stopRes = await service.handleAlexaWebhook({
        session: { user: { accessToken: 'valid_user_access_token' } },
        request: {
          type: 'IntentRequest',
          intent: { name: ALEXA_INTENTS.STOP },
        },
      });
      expect(stopRes.response.outputSpeech.text).toContain('Até logo');
      expect(stopRes.response.shouldEndSession).toBe(true);
    });

    it('returns empty 200 response without card or speech for AlexaHouseholdListEvent even without accessToken', async () => {
      const response = await service.handleAlexaWebhook({
        context: {
          System: {
            user: { userId: 'amzn1.ask.account.test' },
            apiEndpoint: 'https://api.amazonalexa.com',
            apiAccessToken: 'mock_api_token',
          },
        },
        request: {
          type: 'AlexaHouseholdListEvent.ItemsCreated',
          body: {
            listId: 'mock_list_id',
            listItemIds: ['item_1'],
          },
        },
      });

      expect(response).toEqual({ version: '1.0', response: {} });
      expect(response.response.card).toBeUndefined();
      expect(response.response.outputSpeech).toBeUndefined();
    });

    it('associates amazonUserId with user during interactive requests', async () => {
      await service.handleAlexaWebhook({
        context: {
          System: {
            user: {
              userId: 'amzn1.ask.account.12345',
              accessToken: 'valid_user_access_token',
            },
          },
        },
        request: { type: 'LaunchRequest' },
      });

      expect(prisma.userSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: mockUser.id },
          update: expect.objectContaining({
            generalSettings: expect.objectContaining({
              alexaUserId: 'amzn1.ask.account.12345',
            }),
          }),
        }),
      );
    });
  });
});
