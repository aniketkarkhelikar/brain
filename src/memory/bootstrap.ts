import fs from 'node:fs/promises';
import path from 'node:path';

type Question = { key: string; prompt: string };

const questions: Question[] = [
  { key: 'Name', prompt: 'What is your name?' },
  { key: 'Primary email', prompt: 'What is your primary email address?' },
  { key: 'Role', prompt: 'What do you do (role, title, or profession)?' },
  { key: 'Active projects', prompt: 'What are your current active projects?' },
  { key: 'Communication style', prompt: 'How do you prefer to be communicated with?' },
  { key: 'Suggestions', prompt: 'How should I handle suggestions: always suggest, only when asked, or another preference?' },
  { key: 'Active hours', prompt: 'What are your typical active hours and timezone?' },
  { key: 'Regular commitments', prompt: 'Any regular meetings or commitments I should know about?' },
  { key: 'Key people', prompt: 'Who are the key people you work with (names and roles)?' },
  { key: 'Email integration', prompt: 'Which email account should I monitor? You can skip this for now.' },
  { key: 'Calendar integration', prompt: 'Do you use Google Calendar? Share the provider only and skip any private .ics URL; it can be configured in .env later.' },
  { key: 'Proactivity level', prompt: 'Choose a proactivity level: Observer, Advisor, Assistant, or Partner.' },
];

type BootstrapProgress = { answers: string[]; complete: boolean };
type BootstrapIO = {
  ask: (prompt: string) => Promise<string>;
  write: (text: string) => void;
};

const progressMarker = /\n?<!-- brain-bootstrap-progress:(.*?) -->\s*$/s;
const answerSection = /\n?## Onboarding Answers\n[\s\S]*$/;

function progressFromUserFile(content: string): BootstrapProgress {
  const match = content.match(progressMarker);
  if (!match) return { answers: [], complete: false };
  try {
    const parsed = JSON.parse(match[1]) as BootstrapProgress;
    if (!Array.isArray(parsed.answers) || parsed.answers.some((answer) => typeof answer !== 'string')) {
      return { answers: [], complete: false };
    }
    return { answers: parsed.answers.slice(0, questions.length), complete: parsed.complete === true };
  } catch {
    return { answers: [], complete: false };
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+.!|>]/g, '\\$&');
}

function renderUserFile(original: string, progress: BootstrapProgress): string {
  const base = original.replace(answerSection, '').trimEnd();
  const rows = questions.slice(0, progress.answers.length).map((question, index) =>
    `- **${question.key}:** ${escapeMarkdown(progress.answers[index])}`,
  );
  return `${base}\n\n## Onboarding Answers\n\n${rows.join('\n')}\n\n<!-- brain-bootstrap-progress:${JSON.stringify(progress)} -->\n`;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  try {
    await fs.writeFile(temporaryPath, content, { mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function updateSoul(soulPath: string, answers: string[]): Promise<void> {
  const descriptions: Record<string, string> = {
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
  const level = answers[11] ?? '';
  const description = descriptions[level];
  if (description) {
    const selectedSection = `### How Bold to Be\n\n- Selected level: **${level}**.\n- ${description}\n- Always ask before taking actions outside the local vault.\n`;
    const sectionPattern = /### How Bold to Be\n[\s\S]*?(?=\n### |\n## |$)/;
    if (sectionPattern.test(soul)) {
      soul = soul.replace(sectionPattern, selectedSection.trimEnd());
    } else {
      soul = `${soul.trimEnd()}\n\n${selectedSection}`;
    }
  }

  if (answers[4] || answers[5]) {
    const preferences = [
      '### Communication Style',
      '',
      ...(answers[4] ? [`- Follow the user's preference: ${escapeMarkdown(answers[4])}.`] : []),
      ...(answers[5] ? [`- Suggestions preference: ${escapeMarkdown(answers[5])}.`] : []),
    ].join('\n');
    const communicationPattern = /### Communication Style\n[\s\S]*?(?=\n### |\n## |$)/;
    if (communicationPattern.test(soul)) {
      soul = soul.replace(communicationPattern, preferences);
    } else {
      soul = `${soul.trimEnd()}\n\n${preferences}`;
    }
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

async function completeOnboarding(vaultPath: string, progress: BootstrapProgress): Promise<void> {
  await updateSoul(path.join(vaultPath, 'SOUL.md'), progress.answers);
  const userPath = path.join(vaultPath, 'USER.md');
  let user = '';
  try {
    user = await fs.readFile(userPath, 'utf8');
  } catch {
    user = '# USER.md — About You\n';
  }
  await atomicWrite(userPath, renderUserFile(user, { ...progress, complete: true }));
  await appendCompletionLog(vaultPath);
  await fs.rm(path.join(vaultPath, 'BOOTSTRAP.md'));
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
  let user = '';
  try {
    user = await fs.readFile(userPath, 'utf8');
  } catch {
    user = '# USER.md — About You\n';
  }
  const progress = progressFromUserFile(user);
  if (progress.complete || progress.answers.length >= questions.length) {
    await completeOnboarding(vaultPath, { ...progress, answers: progress.answers, complete: true });
    io.write('\nOnboarding complete.\n');
    return true;
  }

  io.write(progress.answers.length ? '\nResuming first-run onboarding.\n' : '\nFirst-run onboarding\nAnswer each question, or leave it blank to skip.\n');
  for (let index = progress.answers.length; index < questions.length; index += 1) {
    const question = questions[index];
    let answer = '';
    while (true) {
      answer = (await io.ask(`${index + 1}/${questions.length} ${question.prompt}\n> `)).trim().replace(/\s*\n\s*/g, ' ');
      if (index === 10 && /(?:https?|webcal):\/\//i.test(answer)) {
        io.write('Please do not enter a private calendar URL here. Record the provider only and configure the URL in .env later.\n');
        continue;
      }
      if (index !== 11 || ['observer', 'advisor', 'assistant', 'partner'].includes(answer.toLowerCase())) break;
      io.write('Please choose Observer, Advisor, Assistant, or Partner.\n');
    }
    progress.answers.push(answer || '(Skipped)');
    user = await fs.readFile(userPath, 'utf8').catch(() => '# USER.md — About You\n');
    await atomicWrite(userPath, renderUserFile(user, progress));
    await updateSoul(path.join(vaultPath, 'SOUL.md'), progress.answers);

    const bootstrap = await fs.readFile(bootstrapPath, 'utf8');
    const status = `## Status: IN_PROGRESS (${progress.answers.length}/${questions.length})`;
    const updatedBootstrap = /^## Status:.*$/m.test(bootstrap)
      ? bootstrap.replace(/^## Status:.*$/m, status)
      : `${status}\n\n${bootstrap}`;
    await atomicWrite(bootstrapPath, updatedBootstrap);
  }

  progress.complete = true;
  await completeOnboarding(vaultPath, progress);
  io.write('\nOnboarding complete.\n');
  return true;
}

export const bootstrapQuestionCount = questions.length;
