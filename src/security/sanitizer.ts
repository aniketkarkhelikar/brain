/** Normalize common invisible characters and flag common prompt-injection phrases.
 * This is only a cleanup aid: callers and the agent prompt must still treat the
 * resulting text as untrusted data.
 */

const INVISIBLE = /[\u200B-\u200D\uFEFF\u00A0\u200E\u200F\u202A-\u202E\u2060-\u206F]/g;
const OVERRIDE_PHRASES = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules|commands)\b/gi,
  /\bdisregard\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)\b/gi,
  /\bnew\s+system\s+(?:prompt|directive|instruction)\b/gi,
  /\breveal\s+(?:the\s+)?(?:system\s+prompt|secrets|credentials)\b/gi,
];

export type SanitizationResult = {
  text: string;
  injectionsNeutralized: number;
  invisibleCharsStripped: number;
  hasAdversarialMarkers: boolean;
};

export function sanitizeUntrustedContent(raw: string): SanitizationResult {
  let invisibleCharsStripped = 0;
  let text = raw.replace(INVISIBLE, () => { invisibleCharsStripped += 1; return ' '; });
  let injectionsNeutralized = 0;
  for (const pattern of OVERRIDE_PHRASES) {
    text = text.replace(pattern, () => { injectionsNeutralized += 1; return '[untrusted instruction-like text]'; });
  }
  return { text, injectionsNeutralized, invisibleCharsStripped, hasAdversarialMarkers: injectionsNeutralized > 0 };
}
