/**
 * planner.ts — Structured Query Decomposition & Planning Engine (Phase 2C)
 *
 * Breaks compound or complex user queries into discrete, isolated execution steps
 * so local models (qwen2.5:14b) do not suffer from recency bias or tool distraction.
 */

export type StepKind =
  | 'vault_profile'
  | 'vault_query'
  | 'connections'
  | 'web_search'
  | 'general';

export interface PlanStep {
  id: number;
  title: string;
  kind: StepKind;
  query: string;
  contextHint?: string;
}

export interface ExecutionPlan {
  isCompound: boolean;
  intent: 'chat' | 'connections' | 'compound' | 'single';
  steps: PlanStep[];
}

/**
 * Decomposes a user prompt into a structured execution plan.
 * Uses fast deterministic parsing for clear multi-task patterns,
 * preventing local LLM tool distraction and recency bias.
 */
export function createExecutionPlan(prompt: string): ExecutionPlan {
  const trimmed = prompt.trim();
  const normalized = trimmed.toLowerCase();

  // 1. Simple Greetings & Fast Chat
  if (/^(?:hi|hello|hey|thanks|thank you|good morning|good afternoon|good evening|who are you)[!.\s]*$/i.test(normalized)) {
    return {
      isCompound: false,
      intent: 'chat',
      steps: [
        {
          id: 1,
          title: 'Direct Response',
          kind: 'general',
          query: trimmed,
        },
      ],
    };
  }

  // 2. Note Connection & Synthesis Prompts
  if (
    /\b(?:find|show|explore|look for|see)?\s*(?:connections?|dots|relationships?|links?|patterns?)\s*(?:between|among|in|across)?\s*(?:my\s+)?(?:recent\s+)?(?:notes?|files?|vault|thoughts?)/i.test(normalized) ||
    /\bconnect\s+the\s+dots\b/i.test(normalized)
  ) {
    return {
      isCompound: false,
      intent: 'connections',
      steps: [
        {
          id: 1,
          title: 'Note Connections Analysis',
          kind: 'connections',
          query: trimmed,
        },
      ],
    };
  }

  // 3. Explicit Multi-Task Prompts: "1ST TASK ... 2ND TASK ..." or "Task 1 ... Task 2 ..."
  const taskNumberRegex = /(?:(?:^|\n|\s+)(?:(?:1st|2nd|3rd|\d+(?:st|nd|rd|th)?)\s+task|task\s+\d+)[:\s]+)([\s\S]+?)(?=(?:(?:^|\n|\s+)(?:(?:1st|2nd|3rd|\d+(?:st|nd|rd|th)?)\s+task|task\s+\d+)[:\s]+)|$)/gi;
  const taskMatches = [...trimmed.matchAll(taskNumberRegex)];

  if (taskMatches.length >= 2) {
    const steps: PlanStep[] = taskMatches.map((m, index) => {
      const taskText = m[1].trim();
      const kind = inferStepKind(taskText);
      return {
        id: index + 1,
        title: inferStepTitle(taskText, kind, index + 1),
        kind,
        query: cleanSubTaskQuery(taskText, kind),
      };
    });

    return {
      isCompound: true,
      intent: 'compound',
      steps,
    };
  }

  // 4. Compound Prompts with Conjunctions: "X ALSO DO A SEARCH FOR Y" or "X AND ALSO SEARCH Y"
  const alsoSearchRegex = /^([\s\S]+?)\s+(?:also\s+(?:do\s+a\s+)?search\s+(?:for\s+|the\s+web\s+for\s+|online\s+for\s+)|and\s+search\s+(?:the\s+web\s+for\s+|for\s+))([\s\S]+)$/i;
  const alsoMatch = trimmed.match(alsoSearchRegex);
  if (alsoMatch) {
    const part1 = alsoMatch[1].trim();
    const part2 = alsoMatch[2].trim();
    const kind1 = inferStepKind(part1);
    const kind2: StepKind = 'web_search';

    return {
      isCompound: true,
      intent: 'compound',
      steps: [
        {
          id: 1,
          title: inferStepTitle(part1, kind1, 1),
          kind: kind1,
          query: cleanSubTaskQuery(part1, kind1),
        },
        {
          id: 2,
          title: 'Live Web Updates',
          kind: kind2,
          query: cleanSubTaskQuery(part2, kind2),
        },
      ],
    };
  }

  // 5. Single Dedicated Identity Query
  if (
    /\b(?:what (?:do you know|have you learned|do you remember)\s+about me|tell\s+me\s+about\s+(?:myself|me)|who\s+am\s+i|about\s+myself|my\s+(?:profile|background|role|schedule|team|preferences))\b/i.test(normalized) &&
    !/\b(?:web\s*search|search\s+for|latest\s+news)\b/i.test(normalized)
  ) {
    return {
      isCompound: false,
      intent: 'single',
      steps: [
        {
          id: 1,
          title: 'About You',
          kind: 'vault_profile',
          query: trimmed,
        },
      ],
    };
  }

  // 6. Single Web Search Query
  if (
    /\b(?:web\s*search|search\s+(?:the\s+)?(?:web|internet|online)|latest\s+(?:news|updates|information)|live\s+updates)\b/i.test(normalized)
  ) {
    return {
      isCompound: false,
      intent: 'single',
      steps: [
        {
          id: 1,
          title: 'Web Research',
          kind: 'web_search',
          query: trimmed,
        },
      ],
    };
  }

  // 7. General Single Task
  return {
    isCompound: false,
    intent: 'single',
    steps: [
      {
        id: 1,
        title: 'Response',
        kind: 'general',
        query: trimmed,
      },
    ],
  };
}

function inferStepKind(text: string): StepKind {
  const norm = text.toLowerCase();
  if (/\b(?:tell\s+me\s+about\s+(?:myself|me)|who\s+am\s+i|about\s+myself|my\s+profile|my\s+background|go\s+through\s+vault\s+and\s+tell\s+me\s+about\s+myself)\b/i.test(norm)) {
    return 'vault_profile';
  }
  if (/\b(?:search|latest\s+updates?|news|live\s+updates?|web|online|google|twitter|cjp|protest|what'?s\s+happening)\b/i.test(norm)) {
    return 'web_search';
  }
  if (/\b(?:connections?|connect\s+the\s+dots|how\s+are\s+my\s+notes\s+related)\b/i.test(norm)) {
    return 'connections';
  }
  if (/\b(?:vault|notes?|file|read|search|catalog|index)\b/i.test(norm)) {
    return 'vault_query';
  }
  return 'general';
}

function inferStepTitle(text: string, kind: StepKind, index: number): string {
  switch (kind) {
    case 'vault_profile':
      return 'About You (Vault Profile)';
    case 'web_search': {
      // Extract subject if possible
      const topicMatch = text.match(/(?:for|about|on)\s+([A-Za-z0-9\s]+?)(?:\s+latest|\s+updates|\s+news|\s+and|$)/i);
      if (topicMatch && topicMatch[1].trim()) {
        return `${topicMatch[1].trim()} Updates`;
      }
      return 'Web Research & Updates';
    }
    case 'connections':
      return 'Note Connections';
    case 'vault_query':
      return 'Vault Search';
    default:
      return `Task ${index}`;
  }
}

function cleanSubTaskQuery(text: string, kind: StepKind): string {
  if (kind === 'web_search') {
    // Strip trailing conversational noise like "and then tell me whats happen"
    return text
      .replace(/^(?:also\s+)?(?:do\s+a\s+)?search\s+(?:for\s+|the\s+web\s+for\s+|online\s+for\s+)/i, '')
      .replace(/\s+(?:and\s+then\s+tell\s+me\s+whats?\s+happein.*|and\s+tell\s+me\s+whats?\s+happening.*)$/i, '')
      .trim();
  }
  return text.trim();
}
