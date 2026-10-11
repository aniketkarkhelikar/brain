/**
 * sanitizer.ts — Security Sentinel: Prompt Injection Defense & Epistemic Isolation
 *
 * Sanitizes untrusted text (scraped web pages, raw inbox dumps, external files)
 * to prevent prompt injection attacks, zero-width evasion tokens, and instructions
 * that attempt to override the system prompt or tamper with the user's vault.
 */

// Zero-width characters and invisible control code ranges often used to bypass filters
const INVISIBLE_UNICODE_REGEX = /[\u200B-\u200D\uFEFF\u00A0\u200E\u200F\u202A-\u202E\u2060-\u206F]/g;

// High-confidence adversarial injection patterns that attempt to hijack model execution
const ADVERSARIAL_PATTERNS = [
  /\b(?:ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules|commands))\b/gi,
  /\b(?:disregard\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules))\b/gi,
  /\b(?:system\s+(?:prompt|instruction|override)\s*:\s*)/gi,
  /\b(?:you\s+are\s+now\s+(?:in\s+developer\s+mode|dan|unrestricted|an\s+ai\s+without\s+rules))\b/gi,
  /\b(?:bypass\s+(?:safety|all)\s+guidelines)\b/gi,
  /\b(?:treat\s+everything\s+above\s+as\s+a\s+joke)\b/gi,
  /\b(?:new\s+system\s+directive\s*:)/gi,
  /\b(?:delete\s+(?:the\s+)?(?:vault|all\s+files|memory\.md))\b/gi,
];

export type SanitizationResult = {
  text: string;
  injectionsNeutralized: number;
  invisibleCharsStripped: number;
  hasAdversarialMarkers: boolean;
};

/**
 * Strips invisible evasion characters from untrusted text.
 */
export function stripInvisibleCharacters(raw: string): { cleaned: string; strippedCount: number } {
  let count = 0;
  const cleaned = raw.replace(INVISIBLE_UNICODE_REGEX, () => {
    count++;
    return ' ';
  });
  return { cleaned, strippedCount: count };
}

/**
 * Sanitizes untrusted content (web pages, raw inbox notes) before it enters
 * the model reasoning loop. Neutralizes injection directives by escaping them
 * into inert commentary without destroying legitimate textual meaning.
 */
export function sanitizeUntrustedContent(raw: string): SanitizationResult {
  if (!raw || typeof raw !== 'string') {
    return {
      text: '',
      injectionsNeutralized: 0,
      invisibleCharsStripped: 0,
      hasAdversarialMarkers: false,
    };
  }

  // 1. Strip invisible/evasion unicode
  const { cleaned: stripped, strippedCount } = stripInvisibleCharacters(raw);

  // 2. Scan and neutralize adversarial override directives
  let neutralizedCount = 0;
  let resultText = stripped;

  for (const pattern of ADVERSARIAL_PATTERNS) {
    resultText = resultText.replace(pattern, () => {
      neutralizedCount++;
      return '[neutralized untrusted directive]';
    });
  }

  return {
    text: resultText,
    injectionsNeutralized: neutralizedCount,
    invisibleCharsStripped: strippedCount,
    hasAdversarialMarkers: neutralizedCount > 0,
  };
}
