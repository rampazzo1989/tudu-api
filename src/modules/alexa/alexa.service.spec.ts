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

    it('elicts taskTitle with Dialog.ElicitSlot when user says "adicionar uma nova tarefa" without title', async () => {
      const response = await service.handleAlexaWebhook({
        session: { user: { accessToken: 'valid_user_access_token' } },
        request: {
          type: 'IntentRequest',
          intent: {
            name: ALEXA_INTENTS.CREATE_TASK,
            slots: {},
          },
        },
      });

      expect(response.response.outputSpeech.text).toBe('Qual o nome da tarefa?');
      expect(response.response.shouldEndSession).toBe(false);
      expect(response.sessionAttributes).toEqual(
        expect.objectContaining({ awaitingTaskTitle: true }),
      );
      expect(response.response.directives).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'Dialog.ElicitSlot',
            slotToElicit: 'taskTitle',
          }),
        ]),
      );
    });

    it('completes task creation when user responds with taskTitle in second turn', async () => {
      const response = await service.handleAlexaWebhook({
        session: {
          user: { accessToken: 'valid_user_access_token' },
          attributes: {
            awaitingTaskTitle: true,
            date: '2026-10-22',
          },
        },
        request: {
          type: 'IntentRequest',
          intent: {
            name: ALEXA_INTENTS.CREATE_TASK,
            slots: {
              taskTitle: { value: 'comprar pão na padaria' },
            },
          },
        },
      });

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Comprar pão na padaria',
          }),
        }),
      );
      expect(response.response.outputSpeech.text).toContain('Comprar pão na padaria');
      expect(response.response.shouldEndSession).toBe(true);
    });

    it('cleans carrier prefixes like "o nome é ..." or "adicionar ..."', async () => {
      const response = await service.handleAlexaWebhook({
        session: {
          user: { accessToken: 'valid_user_access_token' },
          attributes: { awaitingTaskTitle: true },
        },
        request: {
          type: 'IntentRequest',
          intent: {
            name: ALEXA_INTENTS.CREATE_TASK,
            slots: {
              taskTitle: { value: 'o nome é estudar física' },
            },
          },
        },
      });

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Estudar física',
          }),
        }),
      );
      expect(response.response.outputSpeech.text).toContain('Estudar física');
    });

    it('reprompts with Dialog.ElicitSlot if FallbackIntent is triggered while awaitingTaskTitle', async () => {
      const response = await service.handleAlexaWebhook({
        session: {
          user: { accessToken: 'valid_user_access_token' },
          attributes: { awaitingTaskTitle: true },
        },
        request: {
          type: 'IntentRequest',
          intent: {
            name: ALEXA_INTENTS.FALLBACK,
          },
        },
      });

      expect(response.response.outputSpeech.text).toContain('Não consegui entender o nome da tarefa');
      expect(response.response.shouldEndSession).toBe(false);
      expect(response.response.directives).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'Dialog.ElicitSlot',
            slotToElicit: 'taskTitle',
          }),
        ]),
      );
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

    it('prompts to hear more when user has more than 3 tasks on LaunchRequest', async () => {
      prisma.task.findMany.mockResolvedValueOnce([
        { id: '1', title: 'Regar as plantas' },
        { id: '2', title: 'Fazer compras no Assaí' },
        { id: '3', title: 'Beijar a Daiana' },
        { id: '4', title: 'Levar o Speed para passear' },
        { id: '5', title: 'Lavar a louça' },
      ]);

      const response = await service.handleAlexaWebhook({
        session: { user: { accessToken: 'valid_user_access_token' } },
        request: { type: 'LaunchRequest' },
      });

      expect(response.response.outputSpeech.text).toContain('Você tem 5 tarefas para hoje no Tudú');
      expect(response.response.outputSpeech.text).toContain('1, Regar as plantas');
      expect(response.response.outputSpeech.text).toContain('Deseja ouvir mais ou adicionar um novo tudú?');
      expect(response.sessionAttributes.awaitingMoreTasks).toBe(true);
      expect(response.sessionAttributes.alreadyReadCount).toBe(3);
    });

    it('reads remaining tasks when user responds with YesIntent / ouvir mais', async () => {
      prisma.task.findMany.mockResolvedValueOnce([
        { id: '1', title: 'Regar as plantas' },
        { id: '2', title: 'Fazer compras no Assaí' },
        { id: '3', title: 'Beijar a Daiana' },
        { id: '4', title: 'Levar o Speed para passear' },
        { id: '5', title: 'Lavar a louça' },
      ]);

      const response = await service.handleAlexaWebhook({
        session: {
          user: { accessToken: 'valid_user_access_token' },
          attributes: { awaitingMoreTasks: true, alreadyReadCount: 3 },
        },
        request: {
          type: 'IntentRequest',
          intent: { name: ALEXA_INTENTS.YES },
        },
      });

      expect(response.response.outputSpeech.text).toContain('As tarefas restantes de hoje são');
      expect(response.response.outputSpeech.text).toContain('4, Levar o Speed para passear');
      expect(response.response.outputSpeech.text).toContain('5, Lavar a louça');
      expect(response.response.outputSpeech.text).toContain('Total de 5 tarefas para hoje');
      expect(response.sessionAttributes.awaitingMoreTasks).toBe(false);
    });

    it('intercepts "ouvir mais" in CreateTaskIntent and reads remaining tasks instead of creating a task', async () => {
      prisma.task.findMany.mockResolvedValueOnce([
        { id: '1', title: 'Regar as plantas' },
        { id: '2', title: 'Fazer compras no Assaí' },
        { id: '3', title: 'Beijar a Daiana' },
        { id: '4', title: 'Levar o Speed para passear' },
        { id: '5', title: 'Lavar a louça' },
      ]);

      const response = await service.handleAlexaWebhook({
        session: {
          user: { accessToken: 'valid_user_access_token' },
          attributes: { awaitingMoreTasks: true, alreadyReadCount: 3 },
        },
        request: {
          type: 'IntentRequest',
          intent: {
            name: ALEXA_INTENTS.CREATE_TASK,
            slots: {
              taskTitle: { value: 'ouvir mais' },
            },
          },
        },
      });

      expect(prisma.task.create).not.toHaveBeenCalled();
      expect(response.response.outputSpeech.text).toContain('As tarefas restantes de hoje são');
      expect(response.response.outputSpeech.text).toContain('4, Levar o Speed para passear');
      expect(response.response.outputSpeech.text).toContain('5, Lavar a louça');
    });

    it('handles NoIntent when user does not want to hear more tasks', async () => {
      const response = await service.handleAlexaWebhook({
        session: {
          user: { accessToken: 'valid_user_access_token' },
          attributes: { awaitingMoreTasks: true },
        },
        request: {
          type: 'IntentRequest',
          intent: { name: ALEXA_INTENTS.NO },
        },
      });

      expect(response.response.outputSpeech.text).toBe('Tudo bem! Até logo.');
      expect(response.response.shouldEndSession).toBe(true);
    });
  });
});
