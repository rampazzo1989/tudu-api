import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { OpenAiProvider } from './providers/openai.provider';
import {
  EmojiSuggestionParams,
  IAiProvider,
  ParsedListResult,
  ParseListParams,
  TaskSuggestionParams,
} from './interfaces/ai-types';
import { sanitizeInputText } from '../../common/sanitizers/prompt-sanitizer';

interface UserDailyUsage {
  date: string;
  emojisCount: number;
  tasksCount: number;
  parsesCount: number;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly strategy: string;
  private readonly defaultProvider: string;
  private readonly maxEmojisPerDay: number;
  private readonly maxParsesPerDay: number;

  // In-memory daily quota tracker (userId -> UserDailyUsage)
  private readonly usageMap = new Map<string, UserDailyUsage>();

  constructor(
    private readonly deepSeekProvider: DeepSeekProvider,
    private readonly openAiProvider: OpenAiProvider,
    private readonly configService: ConfigService,
  ) {
    this.strategy = this.configService.get<string>('AI_ROUTING_STRATEGY', 'fallback');
    this.defaultProvider = this.configService.get<string>('AI_DEFAULT_PROVIDER', 'deepseek');
    this.maxEmojisPerDay = Number(this.configService.get('AI_MAX_EMOJI_PER_DAY', 200));
    this.maxParsesPerDay = Number(this.configService.get('AI_MAX_PARSE_PER_DAY', 50));
  }

  async suggestEmojis(userId: string, params: EmojiSuggestionParams): Promise<{ emojis: string[]; providerUsed: string }> {
    this.checkAndIncrementQuota(userId, 'emojis');

    // Input sanitization against injection
    const cleanTitle = sanitizeInputText(params.title, 'title', 100);
    const cleanListName = params.listName ? sanitizeInputText(params.listName, 'listName', 50) : undefined;

    const sanitizedParams: EmojiSuggestionParams = {
      type: params.type,
      title: cleanTitle,
      listName: cleanListName,
    };

    return this.executeWithStrategy(
      async (provider, signal) => provider.suggestEmojis(sanitizedParams, signal),
      'suggestEmojis',
    ).then(res => ({
      emojis: res.data,
      providerUsed: res.providerUsed,
    }));
  }

  async suggestTasks(userId: string, params: TaskSuggestionParams): Promise<{ suggestions: string[]; providerUsed: string }> {
    this.checkAndIncrementQuota(userId, 'tasks');

    const cleanListName = sanitizeInputText(params.listName, 'listName', 50);
    const cleanCurrentInput = params.currentInput ? sanitizeInputText(params.currentInput, 'currentInput', 50) : undefined;
    const cleanExisting = params.existingTasks
      ? params.existingTasks.slice(0, 30).map(t => sanitizeInputText(t, 'existingTask', 80))
      : undefined;

    const sanitizedParams: TaskSuggestionParams = {
      listName: cleanListName,
      existingTasks: cleanExisting,
      currentInput: cleanCurrentInput,
      count: params.count || 5,
    };

    return this.executeWithStrategy(
      async (provider, signal) => provider.suggestTasks(sanitizedParams, signal),
      'suggestTasks',
    ).then(res => ({
      suggestions: res.data,
      providerUsed: res.providerUsed,
    }));
  }

  async parseList(userId: string, params: ParseListParams): Promise<{ result: ParsedListResult; providerUsed: string }> {
    this.checkAndIncrementQuota(userId, 'parses');

    const cleanText = sanitizeInputText(params.rawText, 'rawText', 3000);
    const cleanCustomPrompt = params.customPrompt ? sanitizeInputText(params.customPrompt, 'customPrompt', 200) : undefined;

    const sanitizedParams: ParseListParams = {
      rawText: cleanText,
      orderingType: params.orderingType || 'none',
      customPrompt: cleanCustomPrompt,
    };

    return this.executeWithStrategy(
      async (provider, signal) => provider.parseList(sanitizedParams, signal),
      'parseList',
    ).then(res => ({
      result: res.data,
      providerUsed: res.providerUsed,
    }));
  }

  getQuotaStatus(userId: string) {
    const today = this.getTodayDateString();
    const usage = this.usageMap.get(userId);

    const emojisUsed = usage?.date === today ? usage.emojisCount : 0;
    const parsesUsed = usage?.date === today ? usage.parsesCount : 0;

    return {
      dailyEmojiLimit: this.maxEmojisPerDay,
      emojisUsedToday: emojisUsed,
      emojisRemainingToday: Math.max(0, this.maxEmojisPerDay - emojisUsed),
      dailyParseLimit: this.maxParsesPerDay,
      parsesUsedToday: parsesUsed,
      parsesRemainingToday: Math.max(0, this.maxParsesPerDay - parsesUsed),
    };
  }

  private checkAndIncrementQuota(userId: string, type: 'emojis' | 'tasks' | 'parses') {
    const today = this.getTodayDateString();
    let usage = this.usageMap.get(userId);

    if (!usage || usage.date !== today) {
      usage = { date: today, emojisCount: 0, tasksCount: 0, parsesCount: 0 };
      this.usageMap.set(userId, usage);
    }

    if (type === 'emojis' || type === 'tasks') {
      if (usage.emojisCount + usage.tasksCount >= this.maxEmojisPerDay) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Limite diário de sugestões de IA (${this.maxEmojisPerDay}/dia) atingido. O limite será renovado à meia-noite.`,
            code: 'DAILY_QUOTA_EXCEEDED',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (type === 'emojis') usage.emojisCount++;
      if (type === 'tasks') usage.tasksCount++;
    } else if (type === 'parses') {
      if (usage.parsesCount >= this.maxParsesPerDay) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Limite diário de estruturação de listas (${this.maxParsesPerDay}/dia) atingido. O limite será renovado à meia-noite.`,
            code: 'DAILY_QUOTA_EXCEEDED',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      usage.parsesCount++;
    }
  }

  private getTodayDateString(): string {
    return new Date().toISOString().split('T')[0];
  }

  private async executeWithStrategy<T>(
    operation: (provider: IAiProvider, signal: AbortSignal) => Promise<T>,
    operationName: string,
  ): Promise<{ data: T; emojis?: T; providerUsed: string }> {
    const primary: IAiProvider = this.defaultProvider === 'openai' ? this.openAiProvider : this.deepSeekProvider;
    const secondary: IAiProvider = this.defaultProvider === 'openai' ? this.deepSeekProvider : this.openAiProvider;

    // Timeout controller (6 seconds for primary before attempting fallback)
    const primaryController = new AbortController();
    const primaryTimeout = setTimeout(() => primaryController.abort(), 6000);

    try {
      this.logger.debug(`Executing ${operationName} with primary provider: ${primary.id}`);
      const result = await operation(primary, primaryController.signal);
      clearTimeout(primaryTimeout);
      return { data: result, emojis: result, providerUsed: primary.id };
    } catch (primaryError) {
      clearTimeout(primaryTimeout);

      if (this.strategy !== 'fallback') {
        this.logger.error(`Primary provider ${primary.id} failed and strategy is '${this.strategy}': ${primaryError.message}`);
        throw new HttpException(
          `AI service unavailable from provider ${primary.id}: ${primaryError.message}`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      this.logger.warn(
        `Primary provider ${primary.id} failed for ${operationName} (${primaryError.message}). Activating fallback to ${secondary.id}...`,
      );

      const secondaryController = new AbortController();
      const secondaryTimeout = setTimeout(() => secondaryController.abort(), 10000);

      try {
        const result = await operation(secondary, secondaryController.signal);
        clearTimeout(secondaryTimeout);
        this.logger.log(`Fallback to ${secondary.id} succeeded for ${operationName}`);
        return { data: result, emojis: result, providerUsed: secondary.id };
      } catch (secondaryError) {
        clearTimeout(secondaryTimeout);
        this.logger.error(`Both AI providers failed for ${operationName}: ${secondaryError.message}`);
        throw new HttpException(
          `All AI providers failed: ${secondaryError.message}`,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }
  }
}
