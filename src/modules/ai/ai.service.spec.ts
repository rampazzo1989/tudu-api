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
    };

    mockOpenAi = {
      id: 'openai',
      suggestEmojis: jest.fn(),
      suggestTasks: jest.fn(),
      parseList: jest.fn(),
    };

    mockConfig = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'AI_ROUTING_STRATEGY') return 'fallback';
        if (key === 'AI_DEFAULT_PROVIDER') return 'deepseek';
        if (key === 'AI_MAX_EMOJI_PER_DAY') return 5;
        if (key === 'AI_MAX_PARSE_PER_DAY') return 3;
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
    });
  });
});
