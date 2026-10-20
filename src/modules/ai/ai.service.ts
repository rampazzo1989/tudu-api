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
  ParseVoiceTuduParams,
  ParsedVoiceTuduResult,
  ReorderListParams,
  TaskSuggestionParams,
} from './interfaces/ai-types';
import { sanitizeInputText } from '../../common/sanitizers/prompt-sanitizer';
import { ParseVoiceTuduDto } from './dto/parse-voice-tudu.dto';

interface UserDailyUsage {
  date: string;
  emojisCount: number;
  tasksCount: number;
  parsesCount: number;
  voiceCount: number;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly strategy: string;
  private readonly defaultProvider: string;
  private readonly maxEmojisPerDay: number;
  private readonly maxParsesPerDay: number;
  private readonly maxVoicePerDay: number;

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
    this.maxVoicePerDay = Number(this.configService.get('AI_MAX_VOICE_PER_DAY', 100));
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

    const cleanText = sanitizeInputText(params.rawText, 'rawText', 6000);
    const cleanCustomPrompt = params.customPrompt ? sanitizeInputText(params.customPrompt, 'customPrompt', 400) : undefined;

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

  async reorderList(userId: string, params: ReorderListParams): Promise<{ result: ParsedListResult; providerUsed: string }> {
    this.checkAndIncrementQuota(userId, 'parses');

    const cleanCustomPrompt = params.customPrompt ? sanitizeInputText(params.customPrompt, 'customPrompt', 300) : undefined;
    const cleanListName = params.listName ? sanitizeInputText(params.listName, 'listName', 100) : undefined;
    const cleanItems = params.items.slice(0, 100).map(it => sanitizeInputText(it, 'item', 150));
    const cleanSections = params.currentSections?.slice(0, 30).map(sec => sanitizeInputText(sec, 'section', 80));

    const sanitizedParams: ReorderListParams = {
      items: cleanItems,
      currentSections: cleanSections,
      customPrompt: cleanCustomPrompt,
      listName: cleanListName,
    };

    return this.executeWithStrategy(
      async (provider, signal) => provider.reorderList(sanitizedParams, signal),
      'reorderList',
    ).then(res => ({
      result: res.data,
      providerUsed: res.providerUsed,
    }));
  }

  async parseVoiceTudu(userId: string, dto: ParseVoiceTuduDto): Promise<{ result: ParsedVoiceTuduResult; providerUsed: string }> {
    this.checkAndIncrementQuota(userId, 'voice');

    const cleanTranscript = sanitizeInputText(dto.transcript, 'transcript', 500);
    const cleanNow = sanitizeInputText(dto.now, 'now', 50);
    const cleanTimezone = dto.timezone ? sanitizeInputText(dto.timezone, 'timezone', 50) : undefined;
    const cleanLocale = dto.locale ? sanitizeInputText(dto.locale, 'locale', 20) : undefined;

    const cleanLists = dto.lists
      ? dto.lists.slice(0, 50).map(l => ({
          id: sanitizeInputText(l.id, 'list.id', 64),
          name: sanitizeInputText(l.name, 'list.name', 100),
        }))
      : undefined;

    const sanitizedParams: ParseVoiceTuduParams = {
      transcript: cleanTranscript,
      now: cleanNow,
      timezone: cleanTimezone,
      locale: cleanLocale,
      lists: cleanLists,
    };

    const res = await this.executeWithStrategy(
      async (provider, signal) => provider.parseVoiceTudu(sanitizedParams, signal),
      'parseVoiceTudu',
    );

    const result = res.data;

    // Server-side normalization & safety guarantees
    if (result.isTask) {
      // Validate listId exists in user lists
      if (result.listId && cleanLists) {
        const found = cleanLists.some(l => l.id === result.listId);
        if (!found) {
          result.listId = null;
        }
      } else if (!cleanLists || cleanLists.length === 0) {
        result.listId = null;
      }

      // Validate date format YYYY-MM-DD
      if (result.date && !/^\d{4}-\d{2}-\d{2}$/.test(result.date)) {
        result.date = null;
      }

      // Validate time format HH:mm
      if (result.time && !/^\d{2}:\d{2}$/.test(result.time)) {
        result.time = null;
      }

      // Validate recurrence enum
      if (result.recurrence && !['daily', 'weekly', 'monthly', 'yearly'].includes(result.recurrence)) {
        result.recurrence = null;
      }

      // Safety check: label cannot be empty
      if (!result.label || !result.label.trim()) {
        result.isTask = false;
        result.reason = 'not_a_task';
      }
    } else {
      // Safety net: check if the user transcript actually represents an actionable task, habit, wake-up alarm or reminder
      // that the model incorrectly flagged as not_a_task
      const lower = cleanTranscript.toLowerCase().trim();
      const hasActionOrReminder = /\b(wake(\s+me)?\s+up|acordar|despertar|sveglia|despierta|lembr|remind|tomar|take|comprar|buy|fazer|do|call|ligar|ir|go|reuni|meet|pagar|pay|trein|workout|gym|academia|beber|drink|limpar|clean|exerc|dormir|sleep)\b/i.test(lower);
      const hasTimeOrDate = /\b(amanh[aã]|tomorrow|mañana|domani|hoje|today|hoy|oggi|\d{1,2}(:\d{2}|h|\s*(am|pm))|segunda|terça|quarta|quinta|sexta|s[aá]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(lower);

      if (hasActionOrReminder || hasTimeOrDate) {
        result.isTask = true;
        result.reason = null;
        if (!result.label || !result.label.trim()) {
          const emoji = /\b(wake|acordar|despertar|sveglia|despierta|alarm|hor[aá]rio)\b/i.test(lower)
            ? '⏰'
            : /\b(tomar|rem[eé]dio|pill|medicine|medica)\b/i.test(lower)
            ? '💊'
            : '📝';
          result.label = `${emoji} ${cleanTranscript.charAt(0).toUpperCase() + cleanTranscript.slice(1)}`;
        }
      }
    }

    return {
      result,
      providerUsed: res.providerUsed,
    };
  }

  async parseVoiceAudio(
    userId: string,
    params: {
      audioBuffer: Buffer;
      mimeType: string;
      now: string;
      timezone?: string;
      locale?: string;
      lists?: Array<{ id: string; name: string }>;
    },
  ): Promise<{ transcript: string; result: ParsedVoiceTuduResult; providerUsed: string }> {
    const transcript = await this.openAiProvider.transcribeAudio(
      params.audioBuffer,
      params.mimeType,
      params.locale,
    );

    if (!transcript || !transcript.trim()) {
      return {
        transcript: '',
        result: {
          isTask: false,
          reason: 'unintelligible',
          label: '',
          listId: null,
          date: null,
          time: null,
          recurrence: null,
          starred: false,
        },
        providerUsed: 'openai',
      };
    }

    const parsed = await this.parseVoiceTudu(userId, {
      transcript,
      now: params.now,
      timezone: params.timezone,
      locale: params.locale,
      lists: params.lists,
    });

    return {
      transcript,
      result: parsed.result,
      providerUsed: parsed.providerUsed,
    };
  }

  getQuotaStatus(userId: string) {
    const today = this.getTodayDateString();
    const usage = this.usageMap.get(userId);

    const emojisUsed = usage?.date === today ? usage.emojisCount : 0;
    const parsesUsed = usage?.date === today ? usage.parsesCount : 0;
    const voiceUsed = usage?.date === today ? usage.voiceCount : 0;

    return {
      dailyEmojiLimit: this.maxEmojisPerDay,
      emojisUsedToday: emojisUsed,
      emojisRemainingToday: Math.max(0, this.maxEmojisPerDay - emojisUsed),
      dailyParseLimit: this.maxParsesPerDay,
      parsesUsedToday: parsesUsed,
      parsesRemainingToday: Math.max(0, this.maxParsesPerDay - parsesUsed),
      dailyVoiceLimit: this.maxVoicePerDay,
      voiceUsedToday: voiceUsed,
      voiceRemainingToday: Math.max(0, this.maxVoicePerDay - voiceUsed),
    };
  }

  private checkAndIncrementQuota(userId: string, type: 'emojis' | 'tasks' | 'parses' | 'voice') {
    const today = this.getTodayDateString();
    let usage = this.usageMap.get(userId);

    if (!usage || usage.date !== today) {
      usage = { date: today, emojisCount: 0, tasksCount: 0, parsesCount: 0, voiceCount: 0 };
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
    } else if (type === 'voice') {
      if (usage.voiceCount >= this.maxVoicePerDay) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Limite diário de criação por voz com IA (${this.maxVoicePerDay}/dia) atingido. O limite será renovado à meia-noite.`,
            code: 'DAILY_QUOTA_EXCEEDED',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      usage.voiceCount++;
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
