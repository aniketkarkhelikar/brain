/**
 * loader.ts — Anthropic Agent Skills Standard Loader
 *
 * Implements progressive disclosure:
 * - Level 1: Discovers skills on the filesystem and extracts YAML frontmatter
 *   (name, description) to inject a minimal (~80 tokens/skill) index into system prompt.
 * - Level 2: Loads full procedural instructions (SKILL.md markdown body) on demand.
 * - Level 3: Loads specialized references or scripts on demand.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

export interface SkillMetadata {
  name: string;
  description: string;
  dirName: string;
  skillPath: string;
}

export interface SkillLoadResult {
  success: boolean;
  name: string;
  resource?: string;
  content?: string;
  availableResources?: string[];
  error?: string;
}

let cachedSkills: SkillMetadata[] | null = null;
let cachedSkillsDir: string | null = null;

export function getSkillsDir(customDir?: string): string {
  if (customDir) return path.resolve(process.cwd(), customDir);
  return path.resolve(process.cwd(), process.env.SKILLS_PATH || './skills');
}

/**
 * Discovers and parses all valid skills in the skills directory.
 */
export async function discoverSkills(options?: { refresh?: boolean; skillsDir?: string }): Promise<SkillMetadata[]> {
  const baseDir = getSkillsDir(options?.skillsDir);

  if (!options?.refresh && cachedSkills && cachedSkillsDir === baseDir) {
    return cachedSkills;
  }

  const results: SkillMetadata[] = [];

  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDirPath = path.join(baseDir, entry.name);
      const skillFilePath = path.join(skillDirPath, 'SKILL.md');

      try {
        const raw = await fs.readFile(skillFilePath, 'utf-8');
        const parsed = matter(raw);
        const name = typeof parsed.data.name === 'string' ? parsed.data.name.trim() : entry.name;
        const description = typeof parsed.data.description === 'string' ? parsed.data.description.trim() : '';

        if (name && description) {
          results.push({
            name,
            description,
            dirName: entry.name,
            skillPath: path.relative(process.cwd(), skillFilePath).replaceAll('\\', '/'),
          });
        }
      } catch {
        // Missing SKILL.md or invalid frontmatter in this folder — skip cleanly
      }
    }
  } catch {
    // Skills directory does not exist or cannot be read
  }

  // Sort alphabetically by name
  results.sort((a, b) => a.name.localeCompare(b.name));

  cachedSkills = results;
  cachedSkillsDir = baseDir;
  return results;
}

/**
 * Formats Level 1 metadata into an Anthropic-standard <available_skills> XML block for prompt injection.
 */
export function formatSkillsPrompt(skills: SkillMetadata[]): string {
  if (skills.length === 0) return '';

  const lines = [
    '<available_skills>',
    'The following filesystem-based agent skills are available. When a user request matches a skill description, use the `skillLoad` tool to retrieve the procedural instructions (Level 2) and execute the specialized workflow.',
    '',
  ];

  for (const s of skills) {
    lines.push(`- name: ${s.name}`);
    lines.push(`  path: ${s.skillPath}`);
    lines.push(`  description: ${s.description}`);
    lines.push('');
  }

  lines.push('</available_skills>');
  return lines.join('\n');
}

/**
 * Validates a resource relative subpath to prevent path traversal.
 */
function sanitizeResourcePath(skillDir: string, resource: string): string {
  if (resource.includes('\0')) {
    throw new Error('Resource path cannot contain a null character.');
  }

  const normalized = resource.replaceAll('\\', '/').trim();
  if (path.posix.isAbsolute(normalized) || /^[a-zA-Z]:/.test(resource)) {
    throw new Error('Absolute paths are prohibited.');
  }

  const resolved = path.resolve(skillDir, normalized);
  const relative = path.relative(skillDir, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Resource path traverses outside the skill directory.');
  }

  return resolved;
}

/**
 * Scans a skill folder for available Level 3 resources (e.g. references/*, scripts/*).
 */
async function listSkillResources(skillDir: string): Promise<string[]> {
  const resources: string[] = [];
  const subdirs = ['references', 'scripts'];

  for (const sub of subdirs) {
    const fullSub = path.join(skillDir, sub);
    try {
      const entries = await fs.readdir(fullSub, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isFile() && !ent.name.startsWith('.')) {
          resources.push(`${sub}/${ent.name}`);
        }
      }
    } catch {
      // Subdirectory not present
    }
  }

  return resources.sort();
}

/**
 * Loads the procedural instructions (Level 2) or reference materials (Level 3) for a skill.
 */
export async function loadSkill(
  skillName: string,
  resourcePath?: string,
  options?: { skillsDir?: string }
): Promise<SkillLoadResult> {
  const trimmedName = skillName.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
    return {
      success: false,
      name: skillName,
      error: `Invalid skill name "${skillName}". Use alphanumeric characters, dashes, or underscores.`,
    };
  }

  const allSkills = await discoverSkills({ skillsDir: options?.skillsDir });
  const matched = allSkills.find((s) => s.name === trimmedName || s.dirName === trimmedName);

  if (!matched) {
    return {
      success: false,
      name: trimmedName,
      error: `Skill "${trimmedName}" not found. Available skills: ${allSkills.map((s) => s.name).join(', ') || 'none'}.`,
    };
  }

  const baseDir = getSkillsDir(options?.skillsDir);
  const skillDir = path.join(baseDir, matched.dirName);

  try {
    if (resourcePath && resourcePath.trim()) {
      const safeResourcePath = sanitizeResourcePath(skillDir, resourcePath);
      const content = await fs.readFile(safeResourcePath, 'utf-8');
      return {
        success: true,
        name: matched.name,
        resource: resourcePath.trim(),
        content: content.trim(),
      };
    }

    // Load Level 2 instructions (SKILL.md markdown body)
    const skillFilePath = path.join(skillDir, 'SKILL.md');
    const raw = await fs.readFile(skillFilePath, 'utf-8');
    const parsed = matter(raw);
    const availableResources = await listSkillResources(skillDir);

    return {
      success: true,
      name: matched.name,
      content: parsed.content.trim(),
      availableResources: availableResources.length > 0 ? availableResources : undefined,
    };
  } catch (error) {
    return {
      success: false,
      name: matched.name,
      resource: resourcePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
