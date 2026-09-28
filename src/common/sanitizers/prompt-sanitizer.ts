import { BadRequestException } from '@nestjs/common';

/**
 * Common prompt injection and jailbreak patterns.
 */
const SUSPICIOUS_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|directives|prompts)/i,
  /disregard\s+(all\s+)?(previous|prior)\s+(instructions|prompts)/i,
  /system\s*:\s*/i,
  /assistant\s*:\s*/i,
  /developer\s+mode/i,
  /dan\s+mode/i,
  /jailbreak/i,
  /output\s+(your\s+)?(initial|system)\s+prompt/i,
  /repeat\s+(everything|the\s+words)\s+above/i,
  /you\s+are\s+now\s+a\s+/i,
  /bypass\s+(safety|content)\s+filter/i,
];

/**
 * Sanitizes input text and validates against prompt injection.
 */
export function sanitizeInputText(input: string, fieldName: string = 'text', maxLength: number = 200): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  const cleaned = input.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  if (cleaned.length > maxLength) {
    throw new BadRequestException(`Field "${fieldName}" exceeds maximum allowed length of ${maxLength} characters.`);
  }

  // Check for prompt injection keywords
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(cleaned)) {
      throw new BadRequestException(`Input in "${fieldName}" contains forbidden prompt injection pattern.`);
    }
  }

  return cleaned;
}

/**
 * Regex for valid unicode emojis (including compound, modifiers, ZWJ sequences).
 */
export const UNICODE_EMOJI_REGEX = /(\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200d\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)/gu;

/**
 * Validates and extracts only valid emojis from an LLM response string.
 * Discards any conversational filler, markdown, or malicious output.
 */
export function extractValidEmojis(rawOutput: string, maxCount: number = 10): string[] {
  if (!rawOutput || typeof rawOutput !== 'string') {
    return [];
  }

  // Try parsing JSON array first (e.g. ["🍎", "🛒"])
  try {
    const cleaned = rawOutput
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      const emojis = parsed
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(item => isStrictlyEmoji(item));

      if (emojis.length > 0) {
        return Array.from(new Set(emojis)).slice(0, maxCount);
      }
    }
  } catch {
    // Continue to regex extraction fallback
  }

  // Regex fallback: extract emojis directly
  const matches = rawOutput.match(UNICODE_EMOJI_REGEX) || [];
  const unique = Array.from(new Set(matches.map(m => m.trim()))).filter(isStrictlyEmoji);
  return unique.slice(0, maxCount);
}

/**
 * Validates that a string contains only emojis (and no alphanumeric words or injection payloads).
 */
export function isStrictlyEmoji(str: string): boolean {
  if (!str || str.length === 0) return false;
  // If it contains alphanumeric latin or cyrillic characters, reject it
  if (/[a-zA-Z0-9_\u0400-\u04FF]/.test(str)) {
    return false;
  }
  const emojiRegex = /\p{Extended_Pictographic}/u;
  return emojiRegex.test(str);
}
