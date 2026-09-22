Vercel AI SDK Research Report: Building a Second Brain Agent
This report provides a comprehensive technical breakdown of the Vercel AI SDK for building a second brain agent, covering core APIs, loop control, multi-provider switching (Ollama, OpenAI, Anthropic), session history, Zod tool definitions, streaming vs non-streaming, and persistent memory patterns.

1. Project Setup (Node.js & TypeScript)
Installation
bash

# Core SDK and schemas
npm install ai zod dotenv
# Providers
npm install @ai-sdk/openai @ai-sdk/anthropic ollama-ai-provider-v2 @ai-sdk/openai-compatible
# Development dependencies
npm install -D typescript tsx @types/node
tsconfig.json
json

{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
.env Example
bash

AI_PROVIDER="ollama" # "ollama" | "openai" | "anthropic"
AI_MODEL_NAME="llama3.2" # or "gpt-4o", "claude-3-5-sonnet-latest"
OLLAMA_BASE_URL="http://localhost:11434/api"
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
2. Tool Definitions with Zod Schemas
Tools are declared using the tool() helper function from ai. The LLM receives the tool's description and JSON schema generated from the Zod parameters (or inputSchema).

Anatomy of a Tool
typescript

import { tool } from 'ai';
import { z } from 'zod';
export const searchNotesTool = tool({
  description: 'Search personal second brain notes by semantic keywords or tags.',
  parameters: z.object({
    query: z.string().describe('The search query or keywords to look up in notes'),
    tags: z.array(z.string()).optional().describe('Optional tags to filter results (e.g. ["tech", "ideas"])'),
    limit: z.number().int().min(1).max(20).default(5).describe('Maximum number of results to retrieve'),
  }),
  execute: async ({ query, tags, limit }, { abortSignal, toolCallId }) => {
    // TypeScript automatically infers the types:
    // query: string, tags: string[] | undefined, limit: number
    try {
      const results = await noteDatabase.search({ query, tags, limit }, { signal: abortSignal });
      return { success: true, count: results.length, data: results };
    } catch (err: any) {
      // Returning error object inside execute allows the LLM to inspect the failure
      // and self-correct during the next step of the loop.
      return { success: false, error: err.message };
    }
  },
});
Key Tool Features
Schema Property Names: Both parameters and inputSchema are supported. parameters is standard in AI SDK Core.
Descriptions are Critical: Use .describe('...') on every Zod field. The LLM reads these descriptions to generate valid arguments.
Execute Context Argument: The 2nd argument { abortSignal, toolCallId, messages }:
abortSignal: Used to cancel underlying HTTP/DB calls if the model call is aborted.
toolCallId: Unique ID of the tool call (matches the ID in the messages array).
Error Handling Strategy: Don't throw unhandled errors in execute if you want the agent to auto-recover; return { error: message } so the LLM can see the error in tool-result and retry with different parameters.
3. Exact API for generateText with Tools
generateText executes synchronous (non-streaming) LLM generations, automatically handling multi-step tool execution when configured.

typescript

import { generateText, isStepCount } from 'ai';
import { getLanguageModel } from './providers.js';
import { searchNotesTool, saveNoteTool } from './tools.js';
const model = getLanguageModel();
const result = await generateText({
  model, // LanguageModel instance
  system: 'You are an intelligent Second Brain assistant. Help the user organize thoughts and retrieve knowledge.',
  prompt: 'Find my notes about vector databases and write a 2-sentence summary.',
  // Or multi-turn messages:
  // messages: conversationHistory,
  // Tool configuration
  tools: {
    searchNotes: searchNotesTool,
    saveNote: saveNoteTool,
  },
  // Tool choice mode:
  // 'auto' (default: model decides whether to call a tool or respond directly)
  // 'none' (disallows tool calls)
  // 'required' (forces at least one tool call)
  // { type: 'tool', toolName: 'searchNotes' } (forces specific tool)
  toolChoice: 'auto',
  // Loop control:
  // stopWhen: isStepCount(5), // modern v5+ condition
  // maxSteps: 5,             // supported step count shorthand
  // Model parameters
  temperature: 0.2,
  maxTokens: 1000,
  abortSignal: undefined,
  // Per-step completion hook
  onStepFinish: async ({ text, toolCalls, toolResults, finishReason, usage }) => {
    console.log(`Step finished (${finishReason}). Tool calls: ${toolCalls.length}`);
  },
});
// Accessing results:
console.log('Final Text:', result.text);
console.log('Finish Reason:', result.finishReason);
console.log('Total Usage:', result.usage); // { promptTokens, completionTokens, totalTokens }
console.log('All Tool Calls:', result.toolCalls);
console.log('All Tool Results:', result.toolResults);
// Full step history
for (const step of result.steps) {
  console.log(`Step ${step.stepType}: text=${step.text.length} chars, tools=${step.toolCalls.length}`);
}
// All messages generated during this run (assistant tool calls + tool results + final text):
const generatedMessages = result.response.messages;
4. How maxSteps and Loop Control Work for Auto-Improving Loops
The Problem with Single-Step Calls (maxSteps = 1)
In maxSteps: 1, if the model determines it needs a tool, it emits a tool-call. The SDK executes tool.execute(). Then execution stops. The caller gets the tool output, but the LLM never gets to read the tool output to construct a natural response!

The Multi-Step Execution Loop (maxSteps > 1 or stopWhen: isStepCount(n))
When maxSteps > 1 (e.g. 5):

Step 1: The LLM analyzes user query and returns a tool-call (e.g. searchNotes({ query: "AI architectures" })).
SDK Interception: The AI SDK executes searchNotes.execute(...).
Step 2 (Auto-continuation): The SDK appends the assistant's tool-call and the tool's result to the message list and immediately invokes the model again.
Self-Correction & Improvement:
Scenario A (Success): Model finds sufficient notes, generates final answer, and produces no tool calls. Finish reason becomes 'stop' and the loop completes.
Scenario B (Refinement / Chaining): The initial query returned 0 notes. The model sees { data: [] } in the tool result, realizes the query was too narrow, and issues a 2nd tool call searchNotes({ query: "agent architectures" }) -> Step 3.
Scenario C (Tool Error Recovery): Tool returns { success: false, error: "Authentication failed" }. The model catches this and suggests the user authenticate, or switches to a fallback tool.
Termination Conditions:
Natural completion: Model returns plain text without tool calls (finishReason !== 'tool-calls').
Reaching max step limit: Step count reaches maxSteps or isStepCount(n).
Custom stopWhen rule evaluates to true.
Modern Loop Control Primitives
Vercel AI SDK provides dedicated control primitives:

isStepCount(n): Stops loop after n iterations.
hasToolCall(...toolNames): Terminates early if specific tools are called (useful for human confirmation or escalation tools).
isLoopFinished(): Runs until natural model conclusion.
prepareStep: Hook called before each step to dynamically mutate settings:
typescript

const result = await generateText({
  model,
  tools: { searchNotesTool, saveNoteTool },
  stopWhen: isStepCount(6),
  prepareStep: async ({ stepNumber, messages }) => {
    // Example: On step 5, force model to summarize instead of searching endlessly
    if (stepNumber >= 5) {
      return {
        toolChoice: 'none', // Disallow further tool calls
        system: 'You have reached your search limit. Synthesize the findings now.',
      };
    }
    return {};
  },
});
5. Dedicated Agent Abstraction: ToolLoopAgent
In addition to generateText, the AI SDK provides ToolLoopAgent for agent-first workflows:

typescript

import { ToolLoopAgent, isStepCount } from 'ai';
export const brainAgent = new ToolLoopAgent({
  model: getLanguageModel(),
  instructions: `You are a Second Brain personal assistant. 
Always search user notes before answering factual questions about personal projects.`,
  tools: {
    searchNotes: searchNotesTool,
    saveNote: saveNoteTool,
  },
  stopWhen: isStepCount(10), // Default safety bound
  prepareStep: async ({ stepNumber, messages }) => {
    return {}; // Customize context or tools per step
  },
});
// Invocation (Non-Streaming)
const response = await brainAgent.generate({
  prompt: 'What was the decision on using SQLite vs DuckDB from last week?',
});
console.log(response.text);
// Invocation (Streaming)
const stream = await brainAgent.stream({
  prompt: 'Organize all notes tagged #meeting into a bulleted summary.',
});
for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
6. Configuring Ollama as a Provider
Ollama can run locally (e.g. http://localhost:11434) and can be integrated into the Vercel AI SDK using either the dedicated community provider or OpenAI compatibility.

Approach 1: Dedicated Community Provider (ollama-ai-provider-v2)
bash

npm install ollama-ai-provider-v2
typescript

import { createOllama, ollama } from 'ollama-ai-provider-v2';
// 1. Default instance (points to http://localhost:11434/api)
const defaultModel = ollama('llama3.2');
// 2. Custom instance (remote server or custom port)
export const localOllama = createOllama({
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/api',
  headers: {
    // Optional headers if behind basic auth / reverse proxy
  },
});
export const ollamaModel = localOllama('llama3.2'); // or 'qwen2.5:14b', 'deepseek-r1:8b'
Approach 2: @ai-sdk/openai-compatible (Zero Extra Community Deps)
Ollama natively provides an OpenAI-compatible REST API at http://localhost:11434/v1.

typescript

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
export const ollamaCompatible = createOpenAICompatible({
  name: 'ollama',
  baseURL: 'http://localhost:11434/v1',
});
export const ollamaModel = ollamaCompatible('llama3.2');
Approach 3: @ai-sdk/openai Pointed at Ollama
typescript

import { createOpenAI } from '@ai-sdk/openai';
export const ollamaViaOpenAI = createOpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama', // Dummy key required by OpenAI client
});
export const ollamaModel = ollamaViaOpenAI('llama3.2');
7. Switching Providers (Ollama, OpenAI, Anthropic) with the Same Code
The AI SDK standardizes language models under the LanguageModel interface. Your agent logic, prompt formatting, and tools remain 100% identical regardless of provider.

Pattern 1: createProviderRegistry (Recommended SDK Built-in)
The createProviderRegistry allows addressing models using providerId:modelName strings:

typescript

import { createProviderRegistry } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { createOllama } from 'ollama-ai-provider-v2';
// Register all available providers
export const registry = createProviderRegistry({
  openai,
  anthropic,
  ollama: createOllama({
    baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/api',
  }),
});
// Retrieve model dynamically based on environment or user preference
// Format: "provider:model"
// e.g.: "ollama:llama3.2" OR "openai:gpt-4o" OR "anthropic:claude-3-5-sonnet-latest"
const activeModelId = process.env.ACTIVE_MODEL || 'ollama:llama3.2';
export const activeModel = registry.languageModel(activeModelId);
Pattern 2: Model Resolver Factory
typescript

import type { LanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { createOllama } from 'ollama-ai-provider-v2';
export function getLanguageModel(): LanguageModel {
  const provider = (process.env.AI_PROVIDER || 'ollama').toLowerCase();
  const modelName = process.env.AI_MODEL_NAME;
  switch (provider) {
    case 'openai':
      return openai(modelName || 'gpt-4o');
    case 'anthropic':
      return anthropic(modelName || 'claude-3-5-sonnet-latest');
    case 'ollama':
    default: {
      const ollama = createOllama({
        baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/api',
      });
      return ollama(modelName || 'llama3.2');
    }
  }
}
8. Session / Chat History Management
Message Structures (ModelMessage / CoreMessage)
In the AI SDK Core, messages passed to generateText and streamText are structured as ModelMessage (also known as CoreMessage):

typescript

import type { ModelMessage } from 'ai';
// 1. User Message
const userMsg: ModelMessage = {
  role: 'user',
  content: 'What notes do I have on machine learning?',
};
// 2. Assistant Message with Tool Calls
const assistantMsg: ModelMessage = {
  role: 'assistant',
  content: [
    {
      type: 'tool-call',
      toolCallId: 'call_123',
      toolName: 'searchNotes',
      args: { query: 'machine learning' },
    },
  ],
};
// 3. Tool Result Message
const toolMsg: ModelMessage = {
  role: 'tool',
  content: [
    {
      type: 'tool-result',
      toolCallId: 'call_123',
      toolName: 'searchNotes',
      result: { count: 2, data: ['Note A', 'Note B'] },
    },
  ],
};
Persistence Pattern: Capturing response.messages
When generateText or streamText finishes a multi-step run, it executes several tool calls and tool responses internally. You must persist all intermediate messages so subsequent turns remember what tools were executed:

typescript

import { generateText, isStepCount, type ModelMessage } from 'ai';
class ConversationManager {
  private history: ModelMessage[] = [];
  async sendMessage(userInput: string, model: any, tools: any): Promise<string> {
    // 1. Append user message
    this.history.push({ role: 'user', content: userInput });
    // 2. Generate response with tool execution
    const result = await generateText({
      model,
      system: 'You are an AI Second Brain assistant.',
      messages: this.history,
      tools,
      stopWhen: isStepCount(5),
    });
    // 3. CRITICAL: result.response.messages contains all assistant tool calls,
    // tool results, and the final assistant response message!
    this.history.push(...result.response.messages);
    // 4. Save this.history to database (SQLite / PostgreSQL / JSON)
    await this.persistToDb(this.history);
    return result.text;
  }
  private async persistToDb(messages: ModelMessage[]) {
    // Write JSON-serialized messages to DB
  }
}
Converting Between UI and Model Messages
If building a web UI with @ai-sdk/react (useChat):

Frontend uses UIMessage[] (contains id, createdAt, parts).
Backend converts to model messages using:
typescript

import { convertToModelMessages } from 'ai';
export async function POST(req: Request) {
  const { messages: uiMessages } = await req.json();
  const modelMessages = convertToModelMessages(uiMessages);
  
  return streamText({
    model: getLanguageModel(),
    messages: modelMessages,
  }).toDataStreamResponse();
}
9. Streaming vs Non-Streaming
When to Use Which
Aspect	Non-Streaming (generateText)	Streaming (streamText)
Primary Use	Background jobs, cron indexers, automated scrapers	Chat UIs, terminal interfaces, real-time UX
Output Delivery	All at once after full completion	Incremental tokens as they arrive
Tool Visibility	Inspect result.steps after execution	Observe tool calls in real time via fullStream
Response Object	Available immediately upon resolution	Available via await result.response
Streaming API Details (streamText)
typescript

import { streamText, isStepCount } from 'ai';
const streamResult = streamText({
  model: getLanguageModel(),
  system: 'You are a Second Brain agent.',
  prompt: 'Review my weekly goals and find relevant journal entries.',
  tools: { searchNotesTool },
  stopWhen: isStepCount(5),
  onStepFinish: async ({ text, toolCalls, toolResults, finishReason }) => {
    // Step hook fires as each loop step completes
  },
  onFinish: async ({ text, response, usage }) => {
    // Save response.messages to DB once entire stream completes
    await saveHistory(response.messages);
  },
});
// Option A: Stream only the assistant's text output
for await (const textDelta of streamResult.textStream) {
  process.stdout.write(textDelta);
}
// Option B: Stream full events (text, tool calls, and tool results)
for await (const part of streamResult.fullStream) {
  switch (part.type) {
    case 'text-delta':
      process.stdout.write(part.textDelta);
      break;
    case 'tool-call':
      console.log(`\n[Agent executing tool: ${part.toolName} with args:`, part.args, ']');
      break;
    case 'tool-result':
      console.log(`\n[Tool ${part.toolName} returned result]`);
      break;
    case 'finish':
      console.log('\n[Stream finished. Tokens used:', part.usage.totalTokens, ']');
      break;
    case 'error':
      console.error('\n[Stream error:', part.error, ']');
      break;
  }
}
// Option C: HTTP API Route (Express / Next.js)
// res.setHeader('Content-Type', 'text/plain; charset=utf-8');
// streamResult.pipeTextStreamToResponse(res);
// OR for useChat frontend:
// return streamResult.toDataStreamResponse();
10. Memory and Knowledge Persistence Patterns for a Second Brain Agent
A second brain requires three tiers of memory:

Working Memory (Session Context): Active conversation history (SQLite/PostgreSQL).
Semantic Knowledge Base (Episodic/Reference Memory): Markdown files or vector embeddings in SQLite (sqlite-vec) / pgvector accessed via tools.
Context Management (Compaction/Pruning): Keeping message length bounded within model context windows.
Pattern: The Complete Second Brain Agent Implementation
typescript

import { generateText, tool, isStepCount, type ModelMessage } from 'ai';
import { z } from 'zod';
import { getLanguageModel } from './providers.js';
// 1. Toolset for Long-term Second Brain Knowledge
const brainTools = {
  searchKnowledgeBase: tool({
    description: 'Perform semantic search over user personal notes, books, and thoughts.',
    parameters: z.object({
      query: z.string().describe('Search query or topic'),
      limit: z.number().default(4).describe('Number of snippets to retrieve'),
    }),
    execute: async ({ query, limit }) => {
      // Query vector store / SQLite database
      return [
        { id: 'note-42', title: 'Reading Notes: Building a Second Brain', content: 'CODE framework: Capture, Organize, Distill, Express.' },
        { id: 'note-89', title: 'Agent Ideas', content: 'Use local Ollama for fast offline queries; Claude for complex synthesis.' }
      ];
    },
  }),
  captureNote: tool({
    description: 'Save a new note, thought, or insight into the permanent Second Brain repository.',
    parameters: z.object({
      title: z.string().describe('Title of the note'),
      content: z.string().describe('Markdown formatted note content'),
      tags: z.array(z.string()).describe('Tags for categorization'),
    }),
    execute: async ({ title, content, tags }) => {
      // Save to disk / database
      console.log(`Saved note: "${title}" with tags [${tags.join(', ')}]`);
      return { success: true, noteId: `note-${Date.now()}` };
    },
  }),
};
// 2. Second Brain Agent Runner with Context Compaction
export class SecondBrainService {
  private dbMessages: ModelMessage[] = [];
  constructor(private userId: string) {}
  async handleUserQuery(userPrompt: string): Promise<string> {
    this.dbMessages.push({ role: 'user', content: userPrompt });
    // Context Window Compaction: If history exceeds 20 messages, prune or summarize
    const activeMessages = this.compactHistory(this.dbMessages);
    const result = await generateText({
      model: getLanguageModel(),
      system: `You are the user's Second Brain personal intelligence. 
You possess direct access to their notes, journal, and knowledge archive.
Always verify facts by calling searchKnowledgeBase before answering questions about their work.`,
      messages: activeMessages,
      tools: brainTools,
      stopWhen: isStepCount(6), // Multi-step reasoning loop bound
      prepareStep: async ({ stepNumber, messages }) => {
        // Dynamic step adjustment:
        // If step >= 4, instruct model to stop searching and summarize
        if (stepNumber >= 4) {
          return { toolChoice: 'none' };
        }
        return {};
      },
      onStepFinish: ({ toolCalls, toolResults }) => {
        if (toolCalls.length > 0) {
          console.log(`Executed ${toolCalls.length} tool calls in this step.`);
        }
      },
    });
    // Append all intermediate tool calls and responses to persistent history
    this.dbMessages.push(...result.response.messages);
    return result.text;
  }
  private compactHistory(messages: ModelMessage[]): ModelMessage[] {
    const MAX_RECENT_MESSAGES = 16;
    if (messages.length <= MAX_RECENT_MESSAGES) return messages;
    // Keep first 2 (initial user/system grounding) and last 14
    return [...messages.slice(0, 2), ...messages.slice(-MAX_RECENT_MESSAGES)];
  }
}
11. Summary & Recommendations
API Selection: Use generateText with tools and stopWhen: isStepCount(n) (or ToolLoopAgent) for backend agentic loops.
Provider Swapping: Use createProviderRegistry to register ollama, openai, and anthropic. This enables zero-code-change switching across environments via registry.languageModel(process.env.ACTIVE_MODEL).
Local Ollama Support: Use ollama-ai-provider-v2 or @ai-sdk/openai-compatible pointing to http://localhost:11434/v1. Both implement the standard LanguageModel interface.
Self-Correction Loops: Enable auto-improving loops by setting stopWhen: isStepCount(5) and having tool execute() functions return structured { success: false, error: ... } objects rather than throwing fatal exceptions.
History Management: Always persist result.response.messages (which includes assistant tool-call parts and tool-result messages) to ensure full context preservation across conversations.
