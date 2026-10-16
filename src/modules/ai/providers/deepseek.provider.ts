import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmojiSuggestionParams,
  IAiProvider,
  ParsedListResult,
  ParseListParams,
  ParseVoiceTuduParams,
  ParsedVoiceTuduResult,
  ReorderListParams,
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

  async reorderList(params: ReorderListParams, signal?: AbortSignal): Promise<ParsedListResult> {
    const itemsText = params.items.map(t => `- ${t}`).join('\n');
    const listContext = params.listName ? `Título / Tema da Lista: "${params.listName}"\n\n` : '';
    const sectionsContext = params.currentSections?.length
      ? `Seções existentes atualmente na lista:\n${params.currentSections.map(s => `- ${s}`).join('\n')}\n\n`
      : '';

    let rule = '';
    if (params.customPrompt?.trim()) {
      rule = `Instruções específicas de ordenação fornecidas pelo usuário:\n"""\n${params.customPrompt.trim()}\n"""\nRegra principal: Agrupe os itens nas seções correspondentes e ordene-os seguindo com rigor as instruções acima.`;
    } else {
      rule =
        `Diretrizes de Agrupamento e Ordenação Inteligente:\n` +
        `- Contexto Temático: Identifique o domínio da lista e de seus itens.\n` +
        `- Seções Especializadas: Agrupe OBRIGATORIAMENTE todos os itens em seções temáticas naturais com emoji relevante.\n` +
        `- Sequência Prática: Ordene as seções e os itens internos na sequência mais lógica.`;
    }

    const systemPrompt =
      'You are an intelligent organization assistant in a todo app (Tudú). Your job is to organize, categorize into sections, and reorder todo list items.\n' +
      'Rules:\n' +
      '1. ALL original items MUST be preserved and distributed across the created sections. Do NOT omit any item.\n' +
      '2. Keep emojis and original text of each item.\n' +
      '3. Return STRICTLY a valid JSON object matching this schema:\n' +
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
      'Do not include markdown codeblocks or text outside JSON.';

    const userPrompt = `${listContext}Itens da lista para reorganizar:\n${itemsText}\n\n${sectionsContext}${rule}`;

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
        title: typeof parsed.title === 'string' ? parsed.title : (params.listName || 'Lista Tudú'),
        items: Array.isArray(parsed.items) ? parsed.items : params.items,
        sections: Array.isArray(parsed.sections) ? parsed.sections : undefined,
      };
    } catch (e) {
      this.logger.error(`Failed to parse reordered list result: ${e.message}`);
      return {
        title: params.listName || 'Lista Tudú',
        items: params.items,
      };
    }
  }

  async parseVoiceTudu(params: ParseVoiceTuduParams, signal?: AbortSignal): Promise<ParsedVoiceTuduResult> {
    const cleanLocale = (params.locale || 'pt-BR').toLowerCase().replace('_', '-');
    let targetLanguage = 'Portuguese';
    let targetExample = '"🥖 Comprar pão", "🏛️ Roma", "🥛 Leite integral", "🦷 Marcar dentista", "🎬 Interestelar", "🧳 Passaporte"';
    let fillerExamples = '"oi tudo bem", "que horas são", "bom dia", "como vai você"';

    if (cleanLocale.startsWith('en')) {
      targetLanguage = 'English';
      targetExample = '"🥖 Buy bread", "🏛️ Rome", "🥛 Whole milk", "🦷 Dentist appointment", "🎬 Interstellar", "🧳 Passport"';
      fillerExamples = '"hello how are you", "what time is it", "good morning", "how are you doing"';
    } else if (cleanLocale.startsWith('es')) {
      targetLanguage = 'Spanish';
      targetExample = '"🥖 Comprar pan", "🏛️ Roma", "🥛 Leche entera", "🦷 Cita con el dentista", "🎬 Interestelar", "🧳 Pasaporte"';
      fillerExamples = '"hola cómo estás", "qué hora es", "buenos días", "cómo te va"';
    } else if (cleanLocale.startsWith('it')) {
      targetLanguage = 'Italian';
      targetExample = '"🥖 Comprare il pane", "🏛️ Roma", "🥛 Latte intero", "🦷 Dentista", "🎬 Interstellar", "🧳 Passaporto"';
      fillerExamples = '"ciao come stai", "che ore sono", "buongiorno", "come va"';
    }

    const listsContext =
      params.lists && params.lists.length > 0
        ? `\nUser's existing lists (ID | Name):\n` +
          params.lists.map(l => `- "${l.id}" | "${l.name}"`).join('\n')
        : '\nUser has no custom lists.';

    const systemPrompt =
      `You are an intelligent voice assistant in a todo and checklist app (Tudú). Your job is to analyze natural language speech transcripts from the user and parse them into a structured task or checklist item.\n` +
      `CRITICAL LANGUAGE REQUIREMENT: The user's app is in ${targetLanguage}. The output task "label" MUST be written strictly in ${targetLanguage} (e.g. ${targetExample}). NEVER return the label in Portuguese or any other language unless ${targetLanguage} is Portuguese.\n\n` +
      `Rules:\n` +
      `1. What is a task / tudú item? (BROAD CHECKLIST RECOGNITION):\n` +
      `   - In Tudú, a task is ANY item that belongs to a to-do list, checklist, packing list, grocery list, or idea list. It DOES NOT need to contain an action verb.\n` +
      `   - VALID TASKS INCLUDE:\n` +
      `     a) Nouns, places, travel destinations, or cities (e.g., "Roma", "Paris", "Tóquio") for travel/places lists.\n` +
      `     b) Groceries, supermarket items, ingredients, products (e.g., "Leite", "Café", "Pão", "Detergente").\n` +
      `     c) Media, books, movies, games, or topics (e.g., "Matrix", "Interestelar", "Clean Code").\n` +
      `     d) Packing, gear, or personal items (e.g., "Passaporte", "Protetor solar", "Carregador").\n` +
      `     e) Single words, short phrases, nouns, checklist checkables, or notes.\n` +
      `     f) Traditional action items and chores with verbs (e.g., "Limpar o chão", "Marcar dentista", "Pagar boleto").\n` +
      `   - ONLY return {"isTask": false, "reason": "not_a_task"} if the speech is truly empty, conversational filler/pleasantries (e.g. ${fillerExamples}), casual chatter, assistant queries (e.g. "que horas são", "quem é você"), microphone noise, or incomprehensible babble.\n` +
      `   - If the user dictates a single noun or entity (e.g., "Roma", "Banana", "Chuveiro"), IT IS A VALID TASK (isTask: true).\n\n` +
      `2. Task Title / Label:\n` +
      `   - Extract the clean item or task description.\n` +
      `   - Strip out conversational command preambles such as "adicionar", "colocar", "anotar", "põe", "inserir", "lembrar de", "add", "put", "record", "new task" if they are merely meta-instructions to create the item.\n` +
      `   - Strip out date, time, list name, and recurrence keywords from the label so the title remains clean.\n` +
      `   - It MUST start with an appropriate emoji corresponding to the item or action (e.g., "🏛️ Roma", "🥖 Pão", "🎬 Inception", "🧹 Limpar o chão", "🥛 Leite").\n` +
      `   - It MUST be expressed in ${targetLanguage}.\n` +
      `   - Capitalize the first letter properly.\n\n` +
      `3. List Assignment:\n` +
      `   - If the user mentions adding to a specific list (e.g. "na lista cidades", "em compras", "para viagem"), match it semantically to the closest list from the provided user lists and set "listId" to that list's exact ID.\n` +
      `   - If the speech clearly targets an existing list name or domain from the user's lists, set "listId" accordingly.\n` +
      `   - If no matching list is found or the user did not specify any list, set "listId": null.\n\n` +
      `4. Due Date & Time:\n` +
      `   - Resolve relative dates based on reference date/time (e.g. today/hoje, tomorrow/amanhã, next monday). Format "date" strictly as "YYYY-MM-DD". If no date is mentioned, set "date": null.\n` +
      `   - Resolve specific times (e.g. at 8, 14:30). Format "time" strictly as 24-hour "HH:mm". If no time is mentioned, set "time": null.\n\n` +
      `5. Recurrence:\n` +
      `   - Detect recurring patterns: "daily", "weekly", "monthly", "yearly". Otherwise set "recurrence": null.\n\n` +
      `6. Starred / Important:\n` +
      `   - If the user indicates urgency or importance ("urgent", "important", "starred", "importante", "urgente"), set "starred": true, otherwise false.\n\n` +
      `7. Return strictly valid JSON matching this schema:\n` +
      `{\n` +
      `  "isTask": boolean,\n` +
      `  "reason": "not_a_task" | "unintelligible" | null,\n` +
      `  "label": string,\n` +
      `  "listId": string | null,\n` +
      `  "date": "YYYY-MM-DD" | null,\n` +
      `  "time": "HH:mm" | null,\n` +
      `  "recurrence": "daily" | "weekly" | "monthly" | "yearly" | null,\n` +
      `  "starred": boolean\n` +
      `}\n` +
      `Do not include markdown codeblocks or text outside the JSON object.`;

    const userPrompt =
      `Current Reference Date/Time: ${params.now}\n` +
      `Timezone: ${params.timezone || 'UTC'}\n` +
      `Target Language for output label: ${targetLanguage} (${params.locale || 'pt-BR'})\n` +
      `${listsContext}\n\n` +
      `User Speech Transcript:\n"""\n${params.transcript}\n"""`;

    const raw = await this.callChatApi(
      this.modelFast,
      systemPrompt,
      userPrompt,
      300,
      0.1,
      signal,
    );

    try {
      const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.isTask === false) {
        return {
          isTask: false,
          reason: parsed.reason || 'not_a_task',
          label: '',
          listId: null,
          date: null,
          time: null,
          recurrence: null,
          starred: false,
        };
      }

      return {
        isTask: true,
        label: typeof parsed.label === 'string' ? parsed.label : params.transcript,
        listId: typeof parsed.listId === 'string' ? parsed.listId : null,
        date: typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
        time: typeof parsed.time === 'string' && /^\d{2}:\d{2}$/.test(parsed.time) ? parsed.time : null,
        recurrence: ['daily', 'weekly', 'monthly', 'yearly'].includes(parsed.recurrence) ? parsed.recurrence : null,
        starred: Boolean(parsed.starred),
      };
    } catch (e) {
      this.logger.error(`Failed to parse voice tudu result: ${e.message}`);
      return {
        isTask: true,
        label: params.transcript,
        listId: null,
        date: null,
        time: null,
        recurrence: null,
        starred: false,
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
