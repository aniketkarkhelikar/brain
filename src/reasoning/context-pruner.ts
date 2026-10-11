/**
 * context-pruner.ts — Progressive Context Window Pruner for Agent Loops
 *
 * Plugs directly into Vercel AI SDK's `prepareStep` hook.
 * Inspects accumulated tool execution outputs and replaces oversized payloads (>2,500 chars)
 * with a compact pointer and preview, saving the raw data to disk via the scratchpad.
 */

import type { ModelMessage } from 'ai';
import { offloadToScratchpad, MAX_INLINE_CHARS } from './scratchpad.js';

export async function pruneStepMessages(messages: ModelMessage[]): Promise<ModelMessage[]> {
  const pruned: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.role !== 'tool' || !Array.isArray(msg.content)) {
      pruned.push(msg);
      continue;
    }

    const updatedParts: any[] = [];
    let modified = false;

    for (const part of msg.content) {
      if (part.type !== 'tool-result' || !part.output) {
        updatedParts.push(part);
        continue;
      }

      const output = part.output;
      let textToInspect = '';
      let isJsonWrapper = false;
      let isTextWrapper = false;

      if (typeof output === 'string') {
        textToInspect = output;
      } else if (typeof output === 'object' && output !== null) {
        if ('type' in output && output.type === 'text' && typeof (output as any).value === 'string') {
          isTextWrapper = true;
          textToInspect = (output as any).value;
        } else if ('type' in output && output.type === 'json' && (output as any).value !== undefined) {
          isJsonWrapper = true;
          const val = (output as any).value;
          if (typeof val === 'string') {
            textToInspect = val;
          } else if (typeof val === 'object' && val !== null) {
            if ('content' in val && typeof val.content === 'string') {
              textToInspect = val.content;
            } else {
              const jsonStr = JSON.stringify(val);
              if (jsonStr.length > MAX_INLINE_CHARS) {
                textToInspect = jsonStr;
              }
            }
          }
        } else if ('content' in output && typeof (output as any).content === 'string') {
          textToInspect = (output as any).content;
        } else if ('results' in output && Array.isArray((output as any).results)) {
          const jsonStr = JSON.stringify(output);
          if (jsonStr.length > MAX_INLINE_CHARS) {
            textToInspect = jsonStr;
          }
        }
      }

      if (textToInspect.length > MAX_INLINE_CHARS) {
        modified = true;
        const toolName = part.toolName || 'tool';
        const offloaded = await offloadToScratchpad(toolName, textToInspect);

        const pointerNotice = `[Offloaded to Scratchpad: ${offloaded.scratchPath} (${offloaded.totalChars} chars)]\n\nPreview:\n${offloaded.preview}\n\n[Use scratchpadRead with scratchPath "${offloaded.scratchPath}" if full text is required.]`;

        if (isTextWrapper) {
          updatedParts.push({
            ...part,
            output: {
              ...output,
              type: 'text',
              value: pointerNotice,
            },
          });
        } else if (isJsonWrapper) {
          const origVal = (output as any).value;
          const newVal =
            typeof origVal === 'object' && origVal !== null
              ? {
                  ...origVal,
                  content: pointerNotice,
                  scratchPath: offloaded.scratchPath,
                  isOffloaded: true,
                }
              : {
                  summary: pointerNotice,
                  scratchPath: offloaded.scratchPath,
                  isOffloaded: true,
                };
          updatedParts.push({
            ...part,
            output: {
              ...output,
              type: 'json',
              value: newVal,
            },
          });
        } else if (typeof output === 'string') {
          updatedParts.push({ ...part, output: pointerNotice });
        } else if (typeof output === 'object' && output !== null && 'content' in output) {
          updatedParts.push({
            ...part,
            output: {
              ...output,
              content: pointerNotice,
              scratchPath: offloaded.scratchPath,
              isOffloaded: true,
            },
          });
        } else {
          updatedParts.push({
            ...part,
            output: {
              summary: pointerNotice,
              scratchPath: offloaded.scratchPath,
              isOffloaded: true,
            },
          });
        }
      } else {
        updatedParts.push(part);
      }
    }

    if (modified) {
      pruned.push({ ...msg, content: updatedParts });
    } else {
      pruned.push(msg);
    }
  }

  return pruned;
}
