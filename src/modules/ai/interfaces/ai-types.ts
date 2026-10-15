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

export type RecurrenceType = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface VoiceListContext {
  id: string;
  name: string;
}

export interface ParseVoiceTuduParams {
  transcript: string;
  locale?: string;
  now: string;
  timezone?: string;
  lists?: VoiceListContext[];
}

export interface ParsedVoiceTuduResult {
  isTask: boolean;
  reason?: 'not_a_task' | 'unintelligible';
  label: string;
  listId: string | null;
  date: string | null; // 'YYYY-MM-DD'
  time: string | null; // 'HH:mm'
  recurrence: RecurrenceType | null;
  starred: boolean;
}

export interface IAiProvider {
  readonly id: AIProviderId;
  suggestEmojis(params: EmojiSuggestionParams, signal?: AbortSignal): Promise<string[]>;
  suggestTasks(params: TaskSuggestionParams, signal?: AbortSignal): Promise<string[]>;
  parseList(params: ParseListParams, signal?: AbortSignal): Promise<ParsedListResult>;
  reorderList(params: ReorderListParams, signal?: AbortSignal): Promise<ParsedListResult>;
  parseVoiceTudu(params: ParseVoiceTuduParams, signal?: AbortSignal): Promise<ParsedVoiceTuduResult>;
}
