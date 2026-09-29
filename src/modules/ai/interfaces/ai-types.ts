export type AIProviderId = 'deepseek' | 'openai';

export interface EmojiSuggestionParams {
  type: 'tudu' | 'list';
  title: string;
  listName?: string;
}

export interface TaskSuggestionParams {
  listName: string;
  existingTasks?: string[];
  currentInput?: string;
  count?: number;
}

export interface ParsedSectionResult {
  title: string;
  items: string[];
}

export interface ParsedListResult {
  title: string;
  items: string[];
  sections?: ParsedSectionResult[];
}

export interface ParseListParams {
  rawText: string;
  orderingType?: 'none' | 'smart' | 'custom';
  customPrompt?: string;
}

export interface ReorderListParams {
  items: string[];
  currentSections?: string[];
  customPrompt?: string;
  listName?: string;
}

export interface IAiProvider {
  readonly id: AIProviderId;
  suggestEmojis(params: EmojiSuggestionParams, signal?: AbortSignal): Promise<string[]>;
  suggestTasks(params: TaskSuggestionParams, signal?: AbortSignal): Promise<string[]>;
  parseList(params: ParseListParams, signal?: AbortSignal): Promise<ParsedListResult>;
  reorderList(params: ReorderListParams, signal?: AbortSignal): Promise<ParsedListResult>;
}
