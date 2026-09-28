import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmojiSuggestionParams,
  IAiProvider,
  ParsedListResult,
  ParseListParams,
  TaskSuggestionParams,
} from '../interfaces/ai-types';
import { extractValidEmojis } from '../../../common/sanitizers/prompt-sanitizer';

@Injectable()
export class DeepSeekProvider implements IAiProvider {
  readonly id = 'deepseek' as const;
  private readonly logger = new Logger(DeepSeekProvider.name);

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly modelFast: string;
  private readonly modelReasoning: string;

  constructor(configService: ConfigService) {
    this.apiKey = configService.get<string>('DEEPSEEK_API_KEY', '');
    this.baseUrl = configService.get<string>('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1');
    this.modelFast = configService.get<string>('DEEPSEEK_MODEL_FAST', 'deepseek-chat');
    this.modelReasoning = configService.get<string>('DEEPSEEK_MODEL_REASONING', 'deepseek-chat');
  }

  async suggestEmojis(params: EmojiSuggestionParams, signal?: AbortSignal): Promise<string[]> {
    const userPrompt =
      params.type === 'list'
        ? `Nome da lista: "${params.title}"\nSugira entre 5 e 10 emojis relacionados ao tema ou categoria desta lista.`
        : params.listName
        ? `Lista: "${params.listName}"\nTarefa: "${params.title}"\nSugira entre 5 e 10 emojis específicos e adequados para esta tarefa dentro desta lista.`
        : `Tarefa: "${params.title}"\nSugira entre 5 e 10 emojis específicos e adequados para esta tarefa.`;

    const systemPrompt =
      'You are a specialized sub-routine for a todo app. Suggest relevant emojis for tasks and lists. ' +
      'Return ONLY a valid JSON array of 5 to 10 emoji characters, like ["🛒", "🍎", "🥛"]. ' +
      'Do not include markdown codeblocks, explanations, or any text. If input is not a task, return [].';

    const raw = await this.callChatApi(
      this.modelFast,
      systemPrompt,
      userPrompt,
      100,
      0.2,
      signal,
    );

    return extractValidEmojis(raw, 10);
  }

  async suggestTasks(params: TaskSuggestionParams, signal?: AbortSignal): Promise<string[]> {
    const existingStr =
      params.existingTasks && params.existingTasks.length > 0
        ? `Tarefas já existentes:\n${params.existingTasks.map(t => `- ${t}`).join('\n')}`
        : '';
    const currentInputStr = params.currentInput ? `O usuário começou a digitar: "${params.currentInput}"` : '';

    const userPrompt =
      `Lista: "${params.listName}"\n` +
      `${existingStr}\n` +
      `${currentInputStr}\n` +
      `Sugira ${params.count || 5} novas tarefas concisas e pertinentes.`;

    const systemPrompt =
      'You are an assistant for a todo list app. Suggest concise, highly relevant next tasks for the user list. ' +
      'Every item MUST start with an appropriate emoji character followed by a space and the task title in the language of the prompt ' +
      '(e.g. ["🥖 Comprar pão de forma", "🧀 Queijo prato"]). Return ONLY a valid JSON array of strings. Do not include markdown codeblocks or explanations.';

    const raw = await this.callChatApi(
      this.modelFast,
      systemPrompt,
      userPrompt,
      350,
      0.3,
      signal,
    );

    try {
      const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed.filter(item => typeof item === 'string' && item.trim().length > 0).slice(0, 10);
      }
    } catch (e) {
      this.logger.warn(`Failed to parse tasks JSON: ${e.message}`);
    }

    return [];
  }

  async parseList(params: ParseListParams, signal?: AbortSignal): Promise<ParsedListResult> {
    const systemPrompt =
      'You are an intelligent organization assistant in a todo app (Tudú). Your job is to extract, organize, categorize into sections, and reorder todo list items.\n' +
      'Rules:\n' +
      '1. Extract only real, actionable tasks/items and preserve quantities, units, and conditions.\n' +
      '2. Filter out chat metadata (timestamps, dates, sender names, greetings, conversational filler).\n' +
      '3. Understand the list topic / domain (e.g. Movies, Groceries, Books, Travel) and interpret all items strictly within that domain.\n' +
      '4. Every item in the list MUST start with an appropriate emoji.\n' +
      '5. When categorizing or reordering, ALWAYS group items into well-defined thematic sections with descriptive titles and emojis.\n' +
      '6. Return STRICTLY a valid JSON object matching this schema:\n' +
      '{\n' +
      '  "title": "String title with emoji",\n' +
      '  "sections": [\n' +
      '    {\n' +
      '      "title": "Emoji + Section Name",\n' +
      '      "items": ["emoji item 1", "emoji item 2"]\n' +
      '    }\n' +
      '  ],\n' +
      '  "items": ["emoji item 1", "emoji item 2"]\n' +
      '}\n' +
      'Do not include markdown codeblocks, explanations, or any text outside the JSON object.';

    let userPrompt = `Texto bruto para processar:\n"""\n${params.rawText}\n"""\n`;
    if (params.orderingType === 'smart') {
      userPrompt += `\nModo de ordenação: Inteligente. Agrupe logicamente os itens em seções temáticas descritivas com emojis.`;
    }
    if (params.customPrompt) {
      userPrompt += `\nInstrução adicional de organização: ${params.customPrompt}`;
    }

    const raw = await this.callChatApi(
      this.modelReasoning,
      systemPrompt,
      userPrompt,
      1500,
      0.2,
      signal,
    );

    try {
      const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        title: typeof parsed.title === 'string' ? parsed.title : 'Lista Tudú',
        items: Array.isArray(parsed.items) ? parsed.items : [],
        sections: Array.isArray(parsed.sections) ? parsed.sections : undefined,
      };
    } catch (e) {
      this.logger.error(`Failed to parse list result: ${e.message}`);
      return {
        title: 'Lista Tudú',
        items: params.rawText.split('\n').filter(line => line.trim().length > 0).slice(0, 50),
      };
    }
  }

  private async callChatApi(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number,
    temperature: number,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('DeepSeek API Key is not configured in Tudú API.');
    }

    const url = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message = errorData?.error?.message || `DeepSeek API Error (${response.status})`;
      throw new Error(message);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
  }
}
