/** Small progressive-disclosure loader for local Agent Skills. */

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

let cachedSkills: SkillMetadata[] | undefined;
let cachedSkillsDir: string | undefined;

export function getSkillsDir(customDir?: string): string {
  return path.resolve(process.cwd(), customDir || process.env.SKILLS_PATH || './skills');
}

async function regularFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.lstat(filePath);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function discoverSkills(options: { refresh?: boolean; skillsDir?: string } = {}): Promise<SkillMetadata[]> {
  const baseDir = getSkillsDir(options.skillsDir);
  if (!options.refresh && cachedSkills && cachedSkillsDir === baseDir) return cachedSkills;
  const skills: SkillMetadata[] = [];
  try {
    const baseReal = await fs.realpath(baseDir);
    const entries = await fs.readdir(baseReal, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-zA-Z0-9_-]+$/.test(entry.name)) continue;
      const skillFile = path.join(baseReal, entry.name, 'SKILL.md');
      if (!await regularFile(skillFile)) continue;
      try {
        const stats = await fs.stat(skillFile);
        if (stats.size > 32_000) continue;
        const parsed = matter(await fs.readFile(skillFile, 'utf8'));
        const name = typeof parsed.data.name === 'string' ? parsed.data.name.trim() : entry.name;
        const description = typeof parsed.data.description === 'string' ? parsed.data.description.trim() : '';
        if (name && description) {
          skills.push({ name, description, dirName: entry.name, skillPath: path.relative(process.cwd(), skillFile).replaceAll('\\', '/') });
        }
      } catch {
        // Invalid or unreadable skills do not prevent other skills from loading.
      }
    }
  } catch {
    // A missing skills directory is an empty skill set.
  }
  cachedSkills = skills;
  cachedSkillsDir = baseDir;
  return skills;
}

export function formatSkillsPrompt(skills: SkillMetadata[]): string {
  if (!skills.length) return '';
  return [
    '<available_skills>',
    'For a matching request, use any matching <loaded_skill> instructions already included in the system context. Otherwise call skillLoad before carrying out that workflow. Do not quote skill instructions unless the user asks to inspect them.',
    ...skills.flatMap((skill) => [`- name: ${skill.name}`, `  path: ${skill.skillPath}`, `  description: ${skill.description}`]),
    '</available_skills>',
  ].join('\n');
}

function resolveContained(skillDir: string, resource: string): string {
  const normalized = resource.replaceAll('\\', '/').trim();
  if (!normalized || normalized.includes('\0') || path.posix.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error('Use a relative file path inside the skill.');
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new Error('Skill resource paths cannot traverse folders.');
  const resolved = path.resolve(skillDir, ...segments);
  const relative = path.relative(skillDir, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('The skill resource must name a file inside the skill.');
  return resolved;
}

async function readRegularContained(skillDir: string, resource: string): Promise<string> {
  const skillStats = await fs.lstat(skillDir);
  if (skillStats.isSymbolicLink() || !skillStats.isDirectory()) throw new Error('The skill folder is not a safe directory.');
  const filePath = resolveContained(skillDir, resource);
  const relative = path.relative(skillDir, filePath);
  let current = skillDir;
  const segments = relative.split(path.sep);
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stats = await fs.lstat(current);
    if (stats.isSymbolicLink() || (index < segments.length - 1 ? !stats.isDirectory() : !stats.isFile())) {
      throw new Error('Skill resources must be regular files within the skill folder.');
    }
  }
  const stats = await fs.stat(filePath);
  if (stats.size > 256_000) throw new Error('Skill resource exceeds the 256 KB limit.');
  return fs.readFile(filePath, 'utf8');
}

async function listResources(skillDir: string): Promise<string[]> {
  const found: string[] = [];
  for (const folder of ['references', 'scripts']) {
    try {
      const entries = await fs.readdir(path.join(skillDir, folder), { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && !entry.isSymbolicLink() && !entry.name.startsWith('.')) found.push(`${folder}/${entry.name}`);
      }
    } catch {
      // Optional resource folders.
    }
  }
  return found.sort();
}

export async function loadSkill(
  skillName: string,
  resourcePath?: string,
  options: { skillsDir?: string } = {},
): Promise<SkillLoadResult> {
  const requested = skillName.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(requested)) return { success: false, name: skillName, error: 'Skill names may contain letters, numbers, underscores, and dashes.' };
  const skills = await discoverSkills({ skillsDir: options.skillsDir });
  const skill = skills.find((entry) => entry.name === requested || entry.dirName === requested);
  if (!skill) return { success: false, name: requested, error: `Skill not found. Available skills: ${skills.map((entry) => entry.name).join(', ') || 'none'}.` };

  try {
    const baseReal = await fs.realpath(getSkillsDir(options.skillsDir));
    const skillDir = path.join(baseReal, skill.dirName);
    const content = resourcePath?.trim()
      ? await readRegularContained(skillDir, resourcePath)
      : matter(await readRegularContained(skillDir, 'SKILL.md')).content;
    if (content.length > 32_000 && !resourcePath) throw new Error('Skill instructions exceed the 32 KB limit.');
    return {
      success: true,
      name: skill.name,
      resource: resourcePath?.trim() || undefined,
      content: content.trim(),
      availableResources: resourcePath?.trim() ? undefined : (await listResources(skillDir)).filter((entry) => entry.length < 256),
    };
  } catch (error) {
    return { success: false, name: skill.name, resource: resourcePath, error: error instanceof Error ? error.message : String(error) };
  }
}
