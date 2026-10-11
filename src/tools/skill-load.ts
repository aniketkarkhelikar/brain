/**
 * skill-load.ts — Tool for loading agent skill instructions and references.
 * Enables progressive disclosure: skills stay lightweight in metadata until loaded.
 */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { loadSkill, type SkillLoadResult } from '../skills/loader.js';

const skillLoadSchema = z.object({
  skillName: z
    .string()
    .min(1)
    .max(100)
    .describe('The name of the skill to load (e.g. "purchase-advisor", "second-brain-audit")'),
  resource: z
    .string()
    .optional()
    .describe('Optional relative subpath to a Level 3 reference or script (e.g. "references/pdi-checklist.md")'),
});

type SkillLoadInput = z.infer<typeof skillLoadSchema>;
type SkillLoadOutput = SkillLoadResult;

export const skillLoad: Tool<SkillLoadInput, SkillLoadOutput> = tool({
  description:
    'Loads the full procedural instructions (Level 2) or reference checklists (Level 3) for an installed agent skill. Invoke this tool when the user request matches an available skill from the prompt index.',
  inputSchema: skillLoadSchema,
  execute: async ({ skillName, resource }) => {
    return await loadSkill(skillName, resource);
  },
});
