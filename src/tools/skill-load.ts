/** Loads a matching local skill on demand, keeping other instructions out of context. */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { loadSkill, type SkillLoadResult } from '../skills/loader.js';

type SkillLoadInput = { skillName: string; resource?: string };

export const skillLoad: Tool<SkillLoadInput, SkillLoadResult> = tool({
  description: 'Load the full instructions for an available local skill, or one named reference file within that skill.',
  inputSchema: z.object({
    skillName: z.string().min(1).max(100).describe('The exact skill name shown in available_skills.'),
    resource: z.string().max(300).optional().describe('Optional relative path to a reference file inside the skill.'),
  }),
  execute: async ({ skillName, resource }) => loadSkill(skillName, resource),
});
