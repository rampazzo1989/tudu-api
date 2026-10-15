import { AiService } from './ai.service';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';

describe('AiService (Orchestration & Fallback)', () => {
  let service: AiService;
  let mockDeepSeek: any;
  let mockOpenAi: any;
  let mockConfig: any;

  beforeEach(() => {
    mockDeepSeek = {
      id: 'deepseek',
      suggestEmojis: jest.fn(),
      suggestTasks: jest.fn(),
      parseList: jest.fn(),
      parseVoiceTudu: jest.fn(),
    };

    mockOpenAi = {
      id: 'openai',
      suggestEmojis: jest.fn(),
      suggestTasks: jest.fn(),
      parseList: jest.fn(),
      parseVoiceTudu: jest.fn(),
    };

    mockConfig = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'AI_ROUTING_STRATEGY') return 'fallback';
        if (key === 'AI_DEFAULT_PROVIDER') return 'deepseek';
        if (key === 'AI_MAX_EMOJI_PER_DAY') return 5;
        if (key === 'AI_MAX_PARSE_PER_DAY') return 3;
        if (key === 'AI_MAX_VOICE_PER_DAY') return 2;
        return defaultValue;
      }),
    };

    service = new AiService(
      mockDeepSeek as DeepSeekProvider,
      mockOpenAi as OpenAiProvider,
      mockConfig as ConfigService,
    );
  });

  describe('suggestEmojis', () => {
    it('should call primary provider (DeepSeek) and return result when successful', async () => {
      mockDeepSeek.suggestEmojis.mockResolvedValue(['🛒', '🍎', '🥛']);

      const result = await service.suggestEmojis('user-1', {
        type: 'tudu',
        title: 'Comprar frutas',
      });

      expect(result.emojis).toEqual(['🛒', '🍎', '🥛']);
      expect(result.providerUsed).toBe('deepseek');
      expect(mockDeepSeek.suggestEmojis).toHaveBeenCalled();
      expect(mockOpenAi.suggestEmojis).not.toHaveBeenCalled();
    });

    it('should fallback to OpenAI when DeepSeek fails (e.g. 429 or timeout)', async () => {
      mockDeepSeek.suggestEmojis.mockRejectedValue(new Error('DeepSeek Rate Limit 429'));
      mockOpenAi.suggestEmojis.mockResolvedValue(['✈️', '🎟️', '🧳']);

      const result = await service.suggestEmojis('user-2', {
        type: 'tudu',
        title: 'Viajar para praia',
      });

      expect(result.emojis).toEqual(['✈️', '🎟️', '🧳']);
      expect(result.providerUsed).toBe('openai');
      expect(mockDeepSeek.suggestEmojis).toHaveBeenCalled();
      expect(mockOpenAi.suggestEmojis).toHaveBeenCalled();
    });

    it('should throw SERVICE_UNAVAILABLE if both providers fail', async () => {
      mockDeepSeek.suggestEmojis.mockRejectedValue(new Error('DeepSeek down'));
      mockOpenAi.suggestEmojis.mockRejectedValue(new Error('OpenAI down'));

      await expect(
        service.suggestEmojis('user-3', { type: 'tudu', title: 'Test failure' }),
      ).rejects.toThrow(HttpException);
    });

    it('should enforce daily quota and throw 429 when limit is reached', async () => {
      mockDeepSeek.suggestEmojis.mockResolvedValue(['⭐']);

      const userId = 'user-quota-test';

      // Limit is set to 5 in mockConfig
      for (let i = 0; i < 5; i++) {
        await service.suggestEmojis(userId, { type: 'tudu', title: `Task ${i}` });
      }

      // 6th call should be blocked by daily quota
      await expect(
        service.suggestEmojis(userId, { type: 'tudu', title: 'Blocked task' }),
      ).rejects.toThrow(HttpException);

      try {
        await service.suggestEmojis(userId, { type: 'tudu', title: 'Blocked task' });
      } catch (err: any) {
        expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(err.getResponse().code).toBe('DAILY_QUOTA_EXCEEDED');
      }
    });
  });

  describe('parseList', () => {
    it('should call parseList and return structured list', async () => {
      mockDeepSeek.parseList.mockResolvedValue({
        title: 'Compras de Mercado',
        items: ['Leite', 'Pão'],
        sections: [{ title: 'Padaria', items: ['Pão'] }],
      });

      const response = await service.parseList('user-parse-1', {
        rawText: 'Comprar: Leite e Pão',
        orderingType: 'smart',
      });

      expect(response.result.title).toBe('Compras de Mercado');
      expect(response.providerUsed).toBe('deepseek');
    });

    it('should enforce daily parse quota', async () => {
      mockDeepSeek.parseList.mockResolvedValue({ title: 'Test', items: [] });
      const userId = 'user-parse-quota';

      // Limit is 3
      for (let i = 0; i < 3; i++) {
        await service.parseList(userId, { rawText: `Lista número ${i} de mercado` });
      }

      await expect(
        service.parseList(userId, { rawText: 'Lista número 4 de mercado' }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('parseVoiceTudu', () => {
    it('should parse voice transcript into structured task successfully', async () => {
      mockDeepSeek.parseVoiceTudu.mockResolvedValue({
        isTask: true,
        label: '🦷 Marcar dentista',
        listId: 'list-1',
        date: '2026-10-15',
        time: '14:30',
        recurrence: null,
        starred: false,
      });

      const response = await service.parseVoiceTudu('user-voice-1', {
        transcript: 'marcar dentista amanhã às 14h30 na lista saúde',
        now: '2026-10-14T23:00:00-03:00',
        lists: [{ id: 'list-1', name: 'Saúde' }],
      });

      expect(response.result.isTask).toBe(true);
      expect(response.result.label).toBe('🦷 Marcar dentista');
      expect(response.result.listId).toBe('list-1');
      expect(response.result.date).toBe('2026-10-15');
      expect(response.result.time).toBe('14:30');
      expect(response.providerUsed).toBe('deepseek');
    });

    it('should normalize invalid listId to null if not present in user lists', async () => {
      mockDeepSeek.parseVoiceTudu.mockResolvedValue({
        isTask: true,
        label: '🥖 Comprar pão',
        listId: 'non-existent-list',
        date: null,
        time: null,
        recurrence: null,
        starred: false,
      });

      const response = await service.parseVoiceTudu('user-voice-2', {
        transcript: 'comprar pão',
        now: '2026-10-14T23:00:00-03:00',
        lists: [{ id: 'list-mercado', name: 'Mercado' }],
      });

      expect(response.result.listId).toBeNull();
    });

    it('should handle non-task transcripts correctly', async () => {
      mockDeepSeek.parseVoiceTudu.mockResolvedValue({
        isTask: false,
        reason: 'not_a_task',
        label: '',
        listId: null,
        date: null,
        time: null,
        recurrence: null,
        starred: false,
      });

      const response = await service.parseVoiceTudu('user-voice-3', {
        transcript: 'oi tudo bem como você está',
        now: '2026-10-14T23:00:00-03:00',
      });

      expect(response.result.isTask).toBe(false);
      expect(response.result.reason).toBe('not_a_task');
    });

    it('should enforce daily voice quota', async () => {
      mockDeepSeek.parseVoiceTudu.mockResolvedValue({
        isTask: true,
        label: 'Task',
        listId: null,
        date: null,
        time: null,
        recurrence: null,
        starred: false,
      });
      const userId = 'user-voice-quota';

      // Limit is 2 in mock
      await service.parseVoiceTudu(userId, { transcript: 'task 1', now: '2026-10-14T23:00:00Z' });
      await service.parseVoiceTudu(userId, { transcript: 'task 2', now: '2026-10-14T23:00:00Z' });

      await expect(
        service.parseVoiceTudu(userId, { transcript: 'task 3', now: '2026-10-14T23:00:00Z' }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('getQuotaStatus', () => {
    it('should return correct quota tracking metrics', async () => {
      mockDeepSeek.suggestEmojis.mockResolvedValue(['🔥']);
      const userId = 'user-stats';

      await service.suggestEmojis(userId, { type: 'tudu', title: 'Task 1' });
      await service.suggestEmojis(userId, { type: 'tudu', title: 'Task 2' });

      const status = service.getQuotaStatus(userId);
      expect(status.dailyEmojiLimit).toBe(5);
      expect(status.emojisUsedToday).toBe(2);
      expect(status.emojisRemainingToday).toBe(3);
      expect(status.dailyVoiceLimit).toBe(2);
      expect(status.voiceUsedToday).toBe(0);
      expect(status.voiceRemainingToday).toBe(2);
    });
  });
});
