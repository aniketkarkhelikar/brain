/**
 * agent.ts — Core Second Brain agent
 * 
 * Uses Vercel AI SDK generateText with multi-step tool execution.
 * Loads SOUL.md + USER.md + MEMORY.md as system context.
 */

import { generateText, isStepCount, streamText, type ModelMessage, type StreamTextResult, type ToolSet } from 'ai';
import { getLanguageModel } from './providers.js';
import {
  vaultRead,
  vaultWrite,
  vaultSearch,
  vaultList,
  vaultCatalog,
  vaultDelete,
  vaultMove,
  vaultPatch,
  vaultMeta,
  webSearch,
  webRead,
  skillLoad,
  scratchpadRead,
} from './tools/index.js';

import { runVaultSearch } from './tools/vault-search.js';
import { readVaultCatalog } from './tools/vault-catalog.js';
import { discoverSkills, formatSkillsPrompt } from './skills/loader.js';
import { pruneStepMessages } from './reasoning/context-pruner.js';
import { createExecutionPlan } from './reasoning/planner.js';
import { runReasoningEngine } from './reasoning/reasoning-engine.js';
import fs from 'fs/promises';

import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

function vaultPath(): string {
  return process.env.VAULT_PATH || './vault';
}

// ─── Load vault context files ───────────────────────────────────
async function loadVaultContext(): Promise<string> {
  const files = ['SOUL.md', 'USER.md', 'MEMORY.md'];
  const parts: string[] = [];

  for (const file of files) {
    try {
      const content = await fs.readFile(path.join(vaultPath(), file), 'utf-8');
      parts.push(`=== ${file} ===\n${content}`);
    } catch {
      parts.push(`=== ${file} === (not found)`);
    }
  }

  // Also load today's daily log if it exists (strip automated audit noise so it doesn't pollute working memory)
  const today = new Date().toISOString().split('T')[0];
  try {
    const rawDailyLog = await fs.readFile(path.join(vaultPath(), `daily/${today}.md`), 'utf-8');
    const userPortions = rawDailyLog
      .replace(/###\s+Second Brain Audit[\s\S]*?(?=(?:##|\n\n[^\-\*\s]|$))/g, '')
      .replace(/##\s+Heartbeat[\s\S]*?(?=(?:##|\n\n[^\-\*\s]|$))/g, '')
      .trim();
    if (userPortions) {
      parts.push(`=== Today's Log (${today}) ===\n${userPortions}`);
    }
  } catch {
    // No daily log yet — that's fine
  }

  return parts.join('\n\n');
}

function buildSystemPrompt(
  vaultContext: string,
  override?: string,
  retrievalContext?: string,
  skillsContext?: string
): string {
  const base =
    override ||
    [
      `You are an AI Second Brain assistant. You have direct access to the user's vault of markdown files and the live web.`,
      '',
      vaultContext,
      '',
      `CRITICAL EXECUTION & OUTPUT INSTRUCTIONS:`,
      `1. USER PROFILE & IDENTITY:`,
      `   - The user's complete profile, name, current role, projects, team, schedule, and preferences are already loaded above in === USER.md === and === SOUL.md ===.`,
      `   - When the user asks "tell me about myself", "who am I", "go through vault and tell me about myself", or asks about their background, team, or schedule: synthesize and answer directly from USER.md and SOUL.md. Never claim that profile information is missing, and do NOT call vaultCatalog just to answer who the user is.`,
      '',
      `2. MULTI-GOAL & COMPOUND REQUESTS:`,
      `   - When the user's prompt contains multiple questions, tasks, or numbered instructions (e.g. "1st Task: ... 2nd Task: ...", or "Do X and also do Y"):`,
      `   - You MUST address EVERY requested task completely in your response with explicit separate markdown headings matching each part:`,
      `     ### Task 1: [Task 1 Title]`,
      `     [Complete answer for Task 1]`,
      `     ### Task 2: [Task 2 Title]`,
      `     [Complete answer for Task 2]`,
      `   - NEVER terminate or finish your response after answering only one part of a multi-part prompt.`,
      '',
      `3. LIVE WEB RESEARCH VS. VAULT:`,
      `   - You have access to webSearch and webRead to look up live, external information. For current events, latest news, live updates, or real-world facts not in personal notes (e.g. protests, live news, prices, sports, weather), call the webSearch tool proactively.`,
      `   - Do NOT search the local vault for live external news, and do NOT ask the user if they want a web search—execute webSearch directly.`,
      `   - When webSearch is called, extract and present the findings (titles, sources, and key snippets) clearly in your response.`,
      `   - Epistemic Isolation: Web search results exist ONLY in your conversation working memory for reasoning and synthesis; NEVER dump raw web search text into the vault.`,
      '',
      `4. FINDING CONNECTIONS BETWEEN NOTES:`,
      `   - When asked to "find connections between notes", look beyond log files. Examine project notes (Work/projects/), decisions (Work/decisions/), and knowledge concepts (Knowledgebase/). If the vault primarily contains logs and pending Inbox items, clearly state this to the user, summarize the open items from Inbox/, and explain how compiling them will build rich concept links.`,
      '',
      `5. VAULT TOOLS & NAVIGATION:`,
      `   - Use your tools to read, write, search, and list files in the vault. Broad inventory questions should use the complete generated index.md catalog.`,
      `   - When application retrieval evidence is provided, use it as helpful starting evidence, but call vaultSearch, vaultRead, webSearch, or other tools whenever needed to completely fulfill the user's request. Search results are candidate files: before making vault-backed factual claims, read a selected large file with vaultRead using the exact path from the result.`,
      `   - Vault Organization: Place persistent knowledge in its proper category: projects in Work/projects/, decisions in Work/decisions/, concepts in Knowledgebase/concepts/, entities in Knowledgebase/entities/, and people in Personal_context/people/. MEMORY.md is strictly reserved for core identity and top-level user priorities.`,
    ].join('\n');
  const withSkills = skillsContext ? `${base}\n\n${skillsContext}` : base;
  return retrievalContext ? `${withSkills}\n\n${retrievalContext}` : withSkills;
}

async function initialRetrievalContext(prompt: string): Promise<string | undefined> {
  const route = initialVaultRoute(prompt);
  if (!route) return undefined;
  try {
    if (route === 'vaultCatalog') {
      const result = await readVaultCatalog();
      if (result.success && result.content.length > 18_000) {
        return `=== Application retrieval (${route}; already executed) ===\n${JSON.stringify({ ...result, content: `${result.content.slice(0, 18_000)}\n\n[Catalog truncated in the prompt. Use vaultCatalog for the complete inventory.]`, truncated: true })}`;
      }
      return `=== Application retrieval (${route}; already executed) ===\n${JSON.stringify(result)}`;
    }
    const result = await runVaultSearch(prompt, 10);
    // If no substantive matches were found, do NOT inject an empty block that poisons the prompt!
    if (!result.success || result.results.length === 0) {
      return undefined;
    }
    return `=== Application retrieval (${route}; already executed) ===\n${JSON.stringify(result)}`;
  } catch (error) {
    return undefined;
  }
}

export function initialVaultRoute(prompt: string): 'vaultCatalog' | 'vaultSearch' | undefined {
  const normalized = prompt.trim();
  if (!normalized || /^(?:hi|hello|hey|thanks|thank you|good morning|good afternoon|good evening)[!.\s]*$/i.test(normalized)) {
    return undefined;
  }
  // Check if prompt is asking about the user's personal identity or context (already in USER.md / SOUL.md)
  if (/\b(?:what (?:do you know|have you learned|do you remember)\s+about me|tell\s+me\s+about\s+(?:myself|me)|who\s+am\s+i|about\s+myself|my\s+(?:name|email|role|profile|working\s+style|communication\s+style|communication\s+preferences|preferences|schedule|active\s+hours|regular\s+commitments|team|proactivity\s+level))\b/i.test(normalized)) {
    return undefined;
  }
  // If prompt is asking for web research, live updates, or external search, do NOT pre-search vault!
  if (/\b(?:web\s*search|google|duckduckgo|latest\s+(?:news|updates|info|information)|live\s+updates|search\s+(?:the\s+)?(?:web|internet|online)|search\s+for\s+.+\s+(?:updates?|news))\b/i.test(normalized)) {
    return undefined;
  }
  // If prompt is a multi-step / compound prompt (e.g. "1st task... 2nd task...", "task 1... task 2..."), let the agent's reasoning loop orchestrate tools dynamically!
  if (/\b(?:(?:1st|2nd|3rd|\d+(?:st|nd|rd|th)?)\s+task|task\s+\d+|also\s+do\s+a\s+search)\b/i.test(normalized)) {
    return undefined;
  }
  // Explicit tool requests remain available to the model without a duplicate prefetch.
  if (/\b(?:vault(?:Read|Write|List|Search|Catalog|Delete|Move|Patch|Meta)|web(?:Search|Read)|skillLoad|scratchpadRead)\b/.test(normalized)) return undefined;
  if (/\b(?:list|catalog|inventory|all|every|what|which|show)\b[\s\S]{0,80}\b(?:vault|notes?|files?|pages?|projects?|people|decisions?|topics?|folders?)\b/i.test(normalized)) {
    return 'vaultCatalog';
  }
  return 'vaultSearch';
}

// ─── All available tools ────────────────────────────────────────
const allTools: ToolSet = {
  vaultRead,
  vaultWrite,
  vaultSearch,
  vaultList,
  vaultCatalog,
  vaultDelete,
  vaultMove,
  vaultPatch,
  vaultMeta,
  webSearch,
  webRead,
  skillLoad,
  scratchpadRead,
};

export type AgentStreamResult = {
  textStream: AsyncIterable<string>;
  responseMessages: Promise<ModelMessage[]>;
};

// ─── Generate response (non-streaming, for heartbeat/background) ─
export async function agentGenerate(
  prompt: string,
  history: ModelMessage[] = [],
  options?: { maxSteps?: number; systemOverride?: string }
): Promise<{ text: string; messages: ModelMessage[] }> {
  const plan = createExecutionPlan(prompt);
  if (plan.isCompound || plan.intent === 'connections' || plan.steps.some((s) => s.kind === 'vault_profile')) {
    const engineResult = await runReasoningEngine(prompt, vaultPath());
    return {
      text: engineResult.text,
      messages: await engineResult.responseMessages,
    };
  }

  const model = getLanguageModel();
  const vaultContext = await loadVaultContext();
  const skills = await discoverSkills();
  const skillsContext = formatSkillsPrompt(skills);
  const retrievalContext = await initialRetrievalContext(prompt);
  const systemPrompt = buildSystemPrompt(vaultContext, options?.systemOverride, retrievalContext, skillsContext);

  const messages: ModelMessage[] = [
    ...history,
    { role: 'user', content: prompt },
  ];

  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    tools: allTools,
    stopWhen: isStepCount(options?.maxSteps ?? 15),
    prepareStep: async ({ messages: stepMessages }) => {
      const pruned = await pruneStepMessages(stepMessages);
      return { messages: pruned };
    },
    onStepFinish: ({ toolCalls, toolResults }) => {
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          console.log(`  [tool] ${tc.toolName}(${JSON.stringify(tc.input).slice(0, 80)}...)`);
        }
      }
    },
  });

  return {
    text: result.text,
    // In AI SDK 7 response.messages only contains the final model call. Keep
    // the accumulated assistant/tool history so later turns retain tool use.
    messages: result.responseMessages,
  };
}

// ─── Stream response (for CLI chat) ─────────────────────────────
export async function agentStream(
  prompt: string,
  history: ModelMessage[] = [],
  options?: { maxSteps?: number; onToolActivity?: (toolName: string, input: unknown) => void }
): Promise<AgentStreamResult> {
  const plan = createExecutionPlan(prompt);
  if (plan.isCompound || plan.intent === 'connections' || plan.steps.some((s) => s.kind === 'vault_profile')) {
    const engineResult = await runReasoningEngine(prompt, vaultPath(), {
      onStepActivity: (stepNum, title) => {
        if (options?.onToolActivity) {
          options.onToolActivity(`task-${stepNum}`, { title });
        } else {
          process.stdout.write(`\n  [reasoning] Step ${stepNum}: ${title}\n`);
        }
      },
    });
    return {
      textStream: engineResult.textStream,
      responseMessages: engineResult.responseMessages,
    };
  }

  const model = getLanguageModel();
  const vaultContext = await loadVaultContext();
  const skills = await discoverSkills();
  const skillsContext = formatSkillsPrompt(skills);
  const retrievalContext = await initialRetrievalContext(prompt);
  const systemPrompt = buildSystemPrompt(vaultContext, undefined, retrievalContext, skillsContext);

  const messages: ModelMessage[] = [
    ...history,
    { role: 'user', content: prompt },
  ];

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    tools: allTools,
    stopWhen: isStepCount(options?.maxSteps ?? 15),
    prepareStep: async ({ messages: stepMessages }) => {
      const pruned = await pruneStepMessages(stepMessages);
      return { messages: pruned };
    },
    onStepFinish: ({ toolCalls }) => {
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          if (options?.onToolActivity) options.onToolActivity(tc.toolName, tc.input);
          else process.stdout.write(`\n  [tool] ${tc.toolName}(${JSON.stringify(tc.input).slice(0, 80)})\n`);
        }
      }
    },
  });

  return {
    textStream: result.textStream,
    responseMessages: result.responseMessages as Promise<ModelMessage[]>,
  };
}

export { loadVaultContext, allTools };
