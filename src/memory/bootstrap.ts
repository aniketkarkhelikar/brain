import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

type Question = { key: string; prompt: string };

const questions: Question[] = [
  { key: 'Name', prompt: 'What name should I use for you?' },
  { key: 'Primary email', prompt: 'What is your primary email address? You can say "skip" if you do not want to add it.' },
  { key: 'Role', prompt: 'What do you do (for example, student, software engineer, or designer)?' },
  { key: 'Active projects', prompt: 'What are you working on now? List project names, or say "none".' },
  { key: 'Communication style', prompt: 'How should my replies sound and how long should they be? Examples: "short and direct", "detailed", or "casual". Say "skip" if unsure.' },
  { key: 'Suggestions', prompt: 'Should I offer ideas without being asked, or only when you ask? Reply "offer ideas", "only when asked", or "skip".' },
  { key: 'Active hours', prompt: 'When are you usually available? Example: "9 AM–6 PM IST". You can say "unknown".' },
  { key: 'Regular commitments', prompt: 'Do you have regular meetings or commitments? List them, or say "none".' },
  { key: 'Key people', prompt: 'Who are the main people you work with? Give names and roles, or say "none".' },
  { key: 'Email integration', prompt: 'Which email account should I monitor? Say "skip" if you are not setting this up now.' },
  { key: 'Calendar integration', prompt: 'Which calendar provider do you use? Example: Google Calendar. Say "skip" if unsure. Do not paste a private calendar URL; configure that locally in .env later.' },
  { key: 'Proactivity level', prompt: 'Choose one: Observer (only answer), Advisor (suggest, do not act), Assistant (routine internal tasks; ask about complex or external actions), or Partner (broad routine internal autonomy; ask before external or irreversible actions). Reply with the level name.' },
];

type BootstrapProgress = { answers: string[]; complete: boolean };
type BootstrapIO = {
  ask: (prompt: string) => Promise<string>;
  write: (text: string) => void;
};

const legacyProgressMarker = /<!-- brain-bootstrap-progress:(.*?) -->/s;
const legacyAnswerSection = /\n?## Onboarding Answers\n[\s\S]*$/;
const proactivityLevels = ['Observer', 'Advisor', 'Assistant', 'Partner'] as const;

function progressPath(vaultPath: string): string {
  const vaultId = createHash('sha256').update(path.resolve(vaultPath)).digest('hex').slice(0, 16);
  return path.resolve(vaultPath, '..', 'state', `bootstrap-${vaultId}.json`);
}

function validProgress(value: unknown): value is BootstrapProgress {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BootstrapProgress>;
  return Array.isArray(candidate.answers) &&
    candidate.answers.length <= questions.length &&
    candidate.answers.every((answer) => typeof answer === 'string') &&
    typeof candidate.complete === 'boolean';
}

async function readProgress(filePath: string, userFile: string): Promise<BootstrapProgress> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!validProgress(parsed)) throw new Error('Onboarding progress file has an invalid format.');
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  // Read progress written by the first Phase 8 implementation so an interrupted
  // onboarding can continue after this upgrade.
  const legacy = userFile.match(legacyProgressMarker);
  if (legacy) {
    try {
      const parsed: unknown = JSON.parse(legacy[1]);
      if (validProgress(parsed)) return parsed;
    } catch {
      // Ignore malformed legacy state and start a fresh interview.
    }
  }
  return { answers: [], complete: false };
}

function displayValue(value: string): string {
  return value.replace(/[\\`*_{}\[\]<>]/g, '\\$&');
}

function normalizedAnswer(answer: string): string {
  return answer.trim().replace(/\s*\n\s*/g, ' ');
}

function fieldValue(answer: string | undefined, fallback: string, unclearPattern?: RegExp): string {
  if (!answer || answer === '(Skipped)' || /^(skip|skipped)$/i.test(answer)) return fallback;
  if (unclearPattern?.test(answer)) return `Not set yet (onboarding answer: "${answer}")`;
  return answer;
}

function replaceLine(markdown: string, pattern: RegExp, replacement: string): string {
  if (!pattern.test(markdown)) return markdown;
  return markdown.replace(pattern, () => replacement);
}

function replaceSection(markdown: string, heading: string, body: string): string {
  const label = heading.replace(/^#{1,6}[ \\t]+/, '');
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingPattern = new RegExp(`^#{1,6}[ \\t]+${escapedLabel}[ \\t]*\\r?$`, 'gm');
  const matches = [...markdown.matchAll(headingPattern)];
  if (!matches.length) return `${markdown.trimEnd()}\n\n${heading}\n\n${body.trimEnd()}\n`;

  const nextHeadingPattern = /^#{1,6}[ \\t]+.+$/gm;
  // Work backwards so deleting legacy duplicates does not invalidate offsets.
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const contentStart = match.index! + match[0].length;
    nextHeadingPattern.lastIndex = contentStart;
    const nextMatch = nextHeadingPattern.exec(markdown);
    const sectionEnd = nextMatch?.index ?? markdown.length;
    if (index === 0) {
      markdown = `${markdown.slice(0, contentStart)}\n${body.trimEnd()}\n${markdown.slice(sectionEnd)}`;
    } else {
      markdown = `${markdown.slice(0, match.index!)}${markdown.slice(sectionEnd)}`;
    }
  }
  return markdown;
}

function renderUserFile(original: string, answers: string[]): string {
  let user = original.replace(legacyAnswerSection, '').replace(legacyProgressMarker, '').trimEnd();
  const name = fieldValue(answers[0], '(not provided)');
  const email = fieldValue(answers[1], '(not provided)');
  const role = fieldValue(answers[2], '(not provided)');
  const projects = fieldValue(answers[3], '(not provided)', /^x$/i);
  const communication = fieldValue(
    answers[4],
    '(not provided)',
    /did(?:n['’]?t| not)|din get|didnt|get the question|don['’]?t understand/i,
  );
  const suggestion = fieldValue(answers[5], '(not provided)', /^suggest$/i);
  const activeHoursAnswer = normalizedAnswer(answers[6] ?? '');
  const activeHours = /^(?:random(?:\s+times?)?|varies)$/i.test(activeHoursAnswer)
    ? 'Varies; no fixed schedule reported'
    : fieldValue(activeHoursAnswer, '(unknown)', /^(idk|unknown|not sure)$/i);
  const commitmentsAnswer = answers[7];
  const commitments = /^(no|none|nothing)$/i.test(commitmentsAnswer ?? '')
    ? 'None reported'
    : fieldValue(commitmentsAnswer, '(not provided)');
  const people = fieldValue(answers[8], '(not provided)', /^yeah?$/i);
  const emailAccount = fieldValue(answers[9], 'Not configured yet');
  const calendarAnswer = fieldValue(answers[10], 'Not configured yet');
  const calendar = /^(yes|yes\s+skip)$/i.test(calendarAnswer)
    ? 'Google Calendar is in use; private calendar URL not configured'
    : calendarAnswer;
  const level = normalizeProactivity(answers[11] ?? '') ?? '(not set)';

  user = replaceLine(user, /^- \*\*Name:\*\*.*$/m, `- **Name:** ${displayValue(name)}`);
  user = replaceLine(user, /^- \*\*Email:\*\*.*$/m, `- **Email:** ${displayValue(email)}`);
  user = replaceSection(user, '### Current Role', `- ${displayValue(role)}`);
  user = replaceSection(user, '### Key Projects', `- ${displayValue(projects)}`);
  user = replaceSection(
    user,
    '### Communication Preferences',
    `- Reply style: ${displayValue(communication)}\n- Suggestions: ${displayValue(suggestion)}`,
  );
  user = replaceSection(
    user,
    '### Schedule Patterns',
    `- Active hours: ${displayValue(activeHours)}\n- Regular commitments: ${displayValue(commitments)}\n- Best focus time: (not provided)`,
  );
  user = replaceSection(user, '### Team', `- ${displayValue(people)}`);
  user = replaceSection(user, '### Email', `- Primary: ${displayValue(emailAccount)}`);
  user = replaceSection(user, '### Calendar', `- Google Calendar: ${displayValue(calendar)}\n- Private calendar URL: configure locally in .env if needed`);
  user = replaceSection(user, '## Proactivity', `- Selected level: **${level}**`);
  return `${user}\n`;
}

function normalizeProactivity(answer: string): typeof proactivityLevels[number] | undefined {
  return proactivityLevels.find((level) => level.toLowerCase() === answer.trim().toLowerCase());
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  try {
    await fs.writeFile(temporaryPath, content, { mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function saveProgress(filePath: string, progress: BootstrapProgress): Promise<void> {
  await atomicWrite(filePath, `${JSON.stringify(progress, null, 2)}\n`);
}

async function updateSoul(soulPath: string, answers: string[]): Promise<void> {
  const descriptions: Record<typeof proactivityLevels[number], string> = {
    Observer: 'Respond only when asked. Do not make unsolicited suggestions or take proactive actions.',
    Advisor: 'Offer useful suggestions, but wait for approval before taking action, including routine internal changes.',
    Assistant: 'Handle routine internal tasks proactively. Ask before complex or external actions.',
    Partner: 'Use broad autonomy for routine internal work. Ask before irreversible or external actions.',
  };
  let soul = '';
  try {
    soul = await fs.readFile(soulPath, 'utf8');
  } catch {
    soul = '# SOUL.md — Who I Am\n';
  }

  const level = normalizeProactivity(answers[11] ?? '');
  if (level) {
    const selectedSection = `### How Bold to Be\n\n- Selected level: **${level}**.\n- ${descriptions[level]}\n- Always ask before taking actions outside the local vault.\n`;
    const sectionPattern = /### How Bold to Be\n[\s\S]*?(?=\n### |\n## |$)/;
    if (sectionPattern.test(soul)) soul = soul.replace(sectionPattern, selectedSection.trimEnd());
    else soul = `${soul.trimEnd()}\n\n${selectedSection}`;
  }

  if (answers[4] || answers[5]) {
    const communication = fieldValue(answers[4], '(not provided)', /did(?:n['’]?t| not)|din get|didnt|get the question|don['’]?t understand/i);
    const suggestion = fieldValue(answers[5], '(not provided)', /^suggest$/i);
    const preferences = `### Communication Style\n\n- Reply style: ${displayValue(communication)}\n- Suggestions: ${displayValue(suggestion)}`;
    const communicationPattern = /### Communication Style\n[\s\S]*?(?=\n### |\n## |$)/;
    if (communicationPattern.test(soul)) soul = soul.replace(communicationPattern, preferences);
    else soul = `${soul.trimEnd()}\n\n${preferences}`;
  }

  await atomicWrite(soulPath, soul);
}

async function appendCompletionLog(vaultPath: string): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const dailyPath = path.join(vaultPath, 'daily', `${date}.md`);
  await fs.mkdir(path.dirname(dailyPath), { recursive: true });
  const entry = `- ${new Date().toISOString()} — Onboarding complete`;
  let existing = '';
  try {
    existing = await fs.readFile(dailyPath, 'utf8');
  } catch {
    // First daily entry.
  }
  if (!existing.includes('Onboarding complete')) {
    await fs.appendFile(dailyPath, `${existing && !existing.endsWith('\n') ? '\n' : ''}${entry}\n`, { mode: 0o600 });
  }
}

async function completeOnboarding(
  vaultPath: string,
  progressFile: string,
  progress: BootstrapProgress,
): Promise<void> {
  progress.complete = true;
  await saveProgress(progressFile, progress);
  await updateSoul(path.join(vaultPath, 'SOUL.md'), progress.answers);
  const userPath = path.join(vaultPath, 'USER.md');
  const user = await fs.readFile(userPath, 'utf8').catch(() => '# USER.md — About You\n');
  await atomicWrite(userPath, renderUserFile(user, progress.answers));
  await appendCompletionLog(vaultPath);
  await fs.rm(path.join(vaultPath, 'BOOTSTRAP.md'));
  await fs.rm(progressFile, { force: true });
}

/** Run the resumable onboarding interview if the vault still has BOOTSTRAP.md. */
export async function runBootstrapIfNeeded(vaultPath: string, io: BootstrapIO): Promise<boolean> {
  const bootstrapPath = path.join(vaultPath, 'BOOTSTRAP.md');
  try {
    await fs.access(bootstrapPath);
  } catch {
    return false;
  }

  const userPath = path.join(vaultPath, 'USER.md');
  let user = await fs.readFile(userPath, 'utf8').catch(() => '# USER.md — About You\n');
  const statePath = progressPath(vaultPath);
  const progress = await readProgress(statePath, user);
  if (progress.complete || progress.answers.length >= questions.length) {
    await completeOnboarding(vaultPath, statePath, progress);
    io.write('\nOnboarding complete.\n');
    return true;
  }

  io.write(progress.answers.length ? '\nResuming first-run onboarding.\n' : '\nFirst-run onboarding\nAnswer each question, or say "skip" if unsure.\n');
  for (let index = progress.answers.length; index < questions.length; index += 1) {
    const question = questions[index];
    let answer = '';
    while (true) {
      answer = normalizedAnswer(await io.ask(`${index + 1}/${questions.length} ${question.prompt}\n> `));
      if (index === 1 && answer && !/^(?:skip|skipped)$/i.test(answer) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer)) {
        io.write('Please enter a valid email address or say "skip".\n');
        continue;
      }
      if (index === 10 && /(?:https?|webcal):\/\//i.test(answer)) {
        io.write('Please do not enter a private calendar URL here. Record the provider only and configure the URL in .env later.\n');
        continue;
      }
      const normalizedLevel = normalizeProactivity(answer);
      if (index !== 11 || normalizedLevel) {
        if (index === 11 && normalizedLevel) answer = normalizedLevel;
        break;
      }
      io.write('Please choose Observer, Advisor, Assistant, or Partner.\n');
    }

    progress.answers.push(answer || '(Skipped)');
    await saveProgress(statePath, progress);
    user = await fs.readFile(userPath, 'utf8').catch(() => '# USER.md — About You\n');
    const bootstrap = await fs.readFile(bootstrapPath, 'utf8');
    const status = `## Status: IN_PROGRESS (${progress.answers.length}/${questions.length})`;
    const updatedBootstrap = /^## Status:.*$/m.test(bootstrap)
      ? bootstrap.replace(/^## Status:.*$/m, status)
      : `${status}\n\n${bootstrap}`;
    await atomicWrite(bootstrapPath, updatedBootstrap);
  }

  await completeOnboarding(vaultPath, statePath, progress);
  io.write('\nOnboarding complete.\n');
  return true;
}

export type BootstrapStatus = { required: false; complete: true } | { required: true; complete: false; index: number; total: number; prompt: string };

/** Return the next resumable first-run question for browser or other interactive clients. */
export async function getBootstrapStatus(vaultPath: string): Promise<BootstrapStatus> {
  const bootstrapPath = path.join(vaultPath, 'BOOTSTRAP.md');
  try { await fs.access(bootstrapPath); } catch { return { required: false, complete: true }; }
  const userPath = path.join(vaultPath, 'USER.md');
  const user = await fs.readFile(userPath, 'utf8').catch(() => '# USER.md — About You\n');
  const statePath = progressPath(vaultPath);
  const progress = await readProgress(statePath, user);
  if (progress.complete || progress.answers.length >= questions.length) {
    await completeOnboarding(vaultPath, statePath, progress);
    return { required: false, complete: true };
  }
  return { required: true, complete: false, index: progress.answers.length, total: questions.length, prompt: questions[progress.answers.length].prompt };
}

/** Persist one validated answer using the same progress journal and finalization as the CLI interview. */
export async function submitBootstrapAnswer(vaultPath: string, rawAnswer: string): Promise<BootstrapStatus> {
  const status = await getBootstrapStatus(vaultPath);
  if (!status.required) return status;
  const answerIndex = status.index;
  let answer = normalizedAnswer(rawAnswer);
  if (answerIndex === 1 && answer && !/^(?:skip|skipped)$/i.test(answer) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer)) {
    throw new Error('Enter a valid email address or say “skip”.');
  }
  if (answerIndex === 10 && /(?:https?|webcal):\/\//i.test(answer)) {
    throw new Error('Do not enter a private calendar URL here. Record the provider only and configure the URL locally later.');
  }
  const normalizedLevel = normalizeProactivity(answer);
  if (answerIndex === 11 && !normalizedLevel) throw new Error('Choose Observer, Advisor, Assistant, or Partner.');
  if (answerIndex === 11 && normalizedLevel) answer = normalizedLevel;
  const bootstrapPath = path.join(vaultPath, 'BOOTSTRAP.md');
  const userPath = path.join(vaultPath, 'USER.md');
  const user = await fs.readFile(userPath, 'utf8').catch(() => '# USER.md — About You\n');
  const statePath = progressPath(vaultPath);
  const progress = await readProgress(statePath, user);
  progress.answers.push(answer || '(Skipped)');
  await saveProgress(statePath, progress);
  const bootstrap = await fs.readFile(bootstrapPath, 'utf8');
  const progressLabel = `## Status: IN_PROGRESS (${progress.answers.length}/${questions.length})`;
  const updatedBootstrap = /^## Status:.*$/m.test(bootstrap) ? bootstrap.replace(/^## Status:.*$/m, progressLabel) : `${progressLabel}\n\n${bootstrap}`;
  await atomicWrite(bootstrapPath, updatedBootstrap);
  if (progress.answers.length >= questions.length) {
    await completeOnboarding(vaultPath, statePath, progress);
    return { required: false, complete: true };
  }
  return { required: true, complete: false, index: progress.answers.length, total: questions.length, prompt: questions[progress.answers.length].prompt };
}

export const bootstrapQuestionCount = questions.length;
