import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { agentGenerate } from './agent.js';

function toolNames(messages: unknown[]): string[] {
  const names: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    if ((item.type === 'tool-call' || item.type === 'tool-result') && typeof item.toolName === 'string') {
      names.push(item.toolName);
    }
    Object.values(item).forEach(visit);
  };
  visit(messages);
  return names;
}

function toolInputs(messages: unknown[], toolName: string): Array<Record<string, unknown>> {
  const inputs: Array<Record<string, unknown>> = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    if (item.type === 'tool-call' && item.toolName === toolName && item.input && typeof item.input === 'object') {
      inputs.push(item.input as Record<string, unknown>);
    }
    Object.values(item).forEach(visit);
  };
  visit(messages);
  return inputs;
}

const previousVaultPath = process.env.VAULT_PATH;
const tempVault = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-brain-agent-smoke-'));
const marker = `phase3-smoke-${randomUUID()}`;
const answerToken = `ANSWER-${randomUUID()}`;

try {
  process.env.VAULT_PATH = tempVault;
  await fs.mkdir(path.join(tempVault, 'Knowledgebase', 'concepts'), { recursive: true });
  await fs.writeFile(path.join(tempVault, 'SOUL.md'), 'Use the available vault tools carefully.\n');
  await fs.writeFile(path.join(tempVault, 'USER.md'), 'This is a synthetic smoke test.\n');
  await fs.writeFile(path.join(tempVault, 'MEMORY.md'), 'No personal data is present in this test vault.\n');
  await fs.writeFile(path.join(tempVault, 'Knowledgebase', 'concepts', 'smoke.md'), `marker: ${marker}\nanswer: ${answerToken}\n`);

  const searchRead = await agentGenerate(
    `Find the exact marker ${marker} with vaultSearch, then read the returned file with vaultRead. Do not write any files. Reply with only the answer token from that file.`,
    [],
    { maxSteps: 5 },
  );
  const searchReadNames = toolNames(searchRead.messages);
  assert.ok(searchReadNames.includes('vaultSearch'), 'agent should invoke vaultSearch');
  assert.ok(searchReadNames.includes('vaultRead'), 'agent should invoke vaultRead after search');
  assert.ok(
    toolInputs(searchRead.messages, 'vaultRead').some((input) => input.filePath === 'Knowledgebase/concepts/smoke.md'),
    'agent should read the exact path returned by vaultSearch',
  );
  if (!searchRead.text.includes(answerToken)) {
    console.error('Synthetic agent response:', JSON.stringify({ text: searchRead.text, messages: searchRead.messages }));
  }
  assert.ok(searchRead.text.includes(answerToken), 'agent answer should be grounded in the synthetic note');
  console.log('Live agent search → read: passed');

  const listing = await agentGenerate(
    'Use vaultList to list the Knowledgebase/concepts directory. Reply with the name of the markdown file it contains. Do not write any files.',
    [],
    { maxSteps: 3 },
  );
  assert.ok(toolNames(listing.messages).includes('vaultList'), 'agent should invoke vaultList');
  assert.match(listing.text, /smoke\.md/i, 'agent should report the listed file');
  console.log('Live agent list: passed');

  const writeRead = await agentGenerate(
    `Use vaultWrite to create Knowledgebase/concepts/loop.md with exactly this content: loop-marker ${answerToken}. Then use vaultRead on that path to verify the content and reply with only the token. Do not write anywhere else.`,
    [],
    { maxSteps: 5 },
  );
  const writeReadNames = toolNames(writeRead.messages);
  assert.ok(writeReadNames.includes('vaultWrite'), 'agent should invoke vaultWrite');
  assert.ok(writeReadNames.includes('vaultRead'), 'agent should verify its write with vaultRead');
  assert.equal(await fs.readFile(path.join(tempVault, 'Knowledgebase', 'concepts', 'loop.md'), 'utf8'), `loop-marker ${answerToken}`);
  assert.ok(writeRead.text.includes(answerToken), 'agent should confirm the token it read back');
  console.log('Live agent write → read verification: passed');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Live agent smoke test failed.');
  process.exitCode = 1;
} finally {
  if (previousVaultPath === undefined) delete process.env.VAULT_PATH;
  else process.env.VAULT_PATH = previousVaultPath;
  await fs.rm(tempVault, { recursive: true, force: true });
}
