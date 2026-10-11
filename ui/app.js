const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const state = { view: 'assistant', sessionId: 'default', sessionName: 'Assistant', sessions: [], files: [], brainTab: 'graph', events: [], recentRuns: [], busy: false, overview: null };
const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const setText = (selector, value) => { const element = $(selector); if (element) element.textContent = value; };
function inlineMarkdown(value) {
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*/g;
  let html = '', cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    html += esc(value.slice(cursor, index));
    if (match[1] !== undefined) {
      try {
        const link = new URL(match[2]);
        if (['https:', 'http:'].includes(link.protocol) && !link.username && !link.password) html += `<a href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(match[1])}</a>`;
        else html += esc(match[1]);
      } catch { html += esc(match[1]); }
    } else if (match[3] !== undefined) html += `<code>${esc(match[3])}</code>`;
    else if (match[4] !== undefined || match[5] !== undefined) html += `<strong>${esc(match[4] || match[5])}</strong>`;
    else html += `<em>${esc(match[6])}</em>`;
    cursor = index + match[0].length;
  }
  return html + esc(value.slice(cursor));
}
function renderMarkdown(value) {
  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = []; let paragraph = [], listType = '', listItems = [], quote = [], code = [], inCode = false;
  const flushParagraph = () => { if (paragraph.length) blocks.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`); paragraph = []; };
  const flushList = () => { if (listItems.length) blocks.push(`<${listType}>${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</${listType}>`); listItems = []; listType = ''; };
  const flushQuote = () => { if (quote.length) blocks.push(`<blockquote>${quote.map(inlineMarkdown).join('<br>')}</blockquote>`); quote = []; };
  const flushCode = () => { if (code.length) blocks.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = []; };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flushParagraph(); flushList(); flushQuote();
      if (inCode) flushCode();
      inCode = !inCode; continue;
    }
    if (inCode) { code.push(line); continue; }
    const heading = line.match(/^\s*(#{1,4})\s+(.+?)\s*#*\s*$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const quoteLine = line.match(/^\s*>\s?(.*)$/);
    if (heading) { flushParagraph(); flushList(); flushQuote(); blocks.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`); }
    else if (bullet || ordered) { flushParagraph(); flushQuote(); const type = bullet ? 'ul' : 'ol'; if (listType && listType !== type) flushList(); listType = type; listItems.push((bullet || ordered)[1]); }
    else if (quoteLine) { flushParagraph(); flushList(); quote.push(quoteLine[1]); }
    else if (/^\s*([-*_])\1\1+\s*$/.test(line)) { flushParagraph(); flushList(); flushQuote(); blocks.push('<hr>'); }
    else if (!line.trim()) { flushParagraph(); flushQuote(); }
    else { flushList(); flushQuote(); paragraph.push(line); }
  }
  flushParagraph(); flushList(); flushQuote(); flushCode();
  return blocks.join('');
}
function renderNotePreview(value) {
  const links = [];
  const cleaned = String(value || '')
    .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
    .replace(/<!--\s*ai-brain-(?:state|source-sha256):[^>]*-->/g, '')
    .replace(/>\s*Superseded (\d{4}-\d{2}-\d{2}) — see the current state and append-only log:\s*/g, '**Superseded $1:** ')
    .replace(/^\s*>\s*Superseded (\d{4}-\d{2}-\d{2}) —\s*/gm, '**Superseded $1:** ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?(?:#[^\]]*)?\]\]/g, (match, rawPath, rawLabel) => {
      const target = String(rawPath).trim().replace(/\\/g, '/');
      if (!target || target.startsWith('/') || target.split('/').includes('..')) return match;
      const filePath = target.toLowerCase().endsWith('.md') ? target : `${target}.md`;
      const token = `BRAINWIKILINKTOKEN${links.length}END`;
      links.push({ token, filePath, label: String(rawLabel || target).trim() });
      return token;
    });
  let html = renderMarkdown(cleaned);
  for (const link of links) {
    html = html.replace(link.token, `<button class="note-wikilink" type="button" data-note="${esc(link.filePath)}">${esc(link.label)}</button>`);
  }
  return html;
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function toast(title, text, type = 'success') {
  const el = document.createElement('div'); el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${type === 'error' ? '!' : '✳'}</span><div><strong>${esc(title)}</strong><small>${esc(text || '')}</small></div>`;
  $('#toast-stack').append(el); setTimeout(() => el.remove(), 5200);
}
function relativeDate(date) {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
}
function friendlySchedule(expression, kind) {
  if (kind === 'inbox' && expression === '*/30 8-22 * * *') return 'every 30 minutes, 08:00–22:30';
  if (kind === 'brain' && expression === '30 3 * * *') return 'daily at 03:30';
  return `custom schedule (${expression})`;
}
function countLabel(count, singular, plural = `${singular}s`) { return `${count} ${count === 1 ? singular : plural}`; }
const findingGuidance = {
  'broken-link': ['This note links to a target that does not exist in the vault.', 'Check for a renamed or moved note. Update the link to an exact existing path, or create a note only if the missing topic is real.'],
  'ambiguous-link': ['This link matches multiple notes with the same name.', 'Use a full relative path in the wikilink so it points to one specific note.'],
  'empty-note': ['This Markdown file has no content.', 'Check whether it is a placeholder, a failed capture, or intentional. Add content or remove/archive it only after confirming.'],
  'orphan-note': ['No other note links to this note, and it contains no outgoing wikilinks.', 'This may be intentional. If it belongs to a project or topic, link it from the relevant note; otherwise keep it standalone.'],
  'processed-inbox-item': ['The note is marked as processed but still sits in Inbox.', 'Run the Inbox processor to archive it and preserve its links, or review the processing journal if it was left there intentionally.'],
};
function renderAudit(report) {
  const panel = $('#audit-findings'); if (!panel) return;
  if (!report?.auditedAt) { $('#audit-last-run').textContent = 'No run yet'; panel.innerHTML = '<div class="empty-state">Run the checks to look for broken links, empty notes, ambiguous links, and Inbox items that still need filing.</div>'; return; }
  $('#audit-last-run').textContent = `Checked ${report.filesScanned} notes · ${new Date(report.auditedAt).toLocaleString()}`;
  if (!report.findings?.length) { panel.innerHTML = '<div class="audit-clear"><span>✓</span><div><strong>No structural issues found</strong><small>The checked notes have no broken or ambiguous links, empty files, or Inbox state that needs attention.</small></div></div>'; return; }
  panel.innerHTML = report.findings.map((finding) => {
    const [meaning, next] = findingGuidance[finding.kind] || ['The linter found a structural pattern that may need attention.', 'The background checker recorded the finding for this vault review.'];
    return `<article class="finding-card ${finding.severity}"><div class="finding-symbol" aria-hidden="true">${finding.severity === 'error' ? '!' : '·'}</div><div class="finding-content"><div class="finding-title-row"><strong>${esc(finding.file)}</strong><span class="finding-badge ${finding.severity}">${esc(finding.severity)}</span></div><p>${esc(meaning)}</p><small class="finding-evidence">${esc(finding.detail)}</small><div class="finding-next"><b>Checker guidance</b><span>${esc(next)}</span></div></div></article>`;
  }).join('');
}
function renderMemoryAudit(report) {
  const panel = $('#memory-audit-findings'); if (!panel) return;
  const coverage = $('#memory-audit-coverage');
  if (!report?.auditedAt) {
    setText('#memory-audit-last-run', 'No run yet');
    if (coverage) coverage.textContent = 'The first audit checks always-loaded memory files and notes with a Current State section.';
    panel.innerHTML = '<div class="empty-state">No memory review yet. Run Brain checks to compare current claims with evidence already in your vault.</div>';
    return;
  }
  const counts = report.summary || {};
  setText('#memory-audit-last-run', `Audited ${new Date(report.auditedAt).toLocaleString()}`);
  if (coverage) coverage.textContent = `${report.filesAudited} of ${report.candidateFiles} candidate notes checked · ${countLabel(report.claimsChecked, 'claim')} · ${countLabel(report.coverage?.remainingFiles || 0, 'note')} remaining. ${report.coverage?.scope || ''}${report.errors?.length ? ` ${countLabel(report.errors.length, 'note')} could not be checked.` : ''}`;
  if (!report.findings?.length) {
    panel.innerHTML = report.coverage?.complete && !report.errors?.length
      ? '<div class="audit-clear"><span>✓</span><div><strong>No contradicted or unsupported current claims found</strong><small>Confirmed claims are counted in the report. Historical and event notes were left alone.</small></div></div>'
      : '<div class="empty-state">No findings in this batch. The coverage line above shows what remains to check.</div>';
    if (report.errors?.length) panel.innerHTML += `<div class="memory-audit-errors"><strong>Could not check ${report.errors.length} notes</strong>${report.errors.map((error) => `<small>${esc(error)}</small>`).join('')}</div>`;
    return;
  }
  panel.innerHTML = report.findings.map((finding) => {
    const status = finding.action === 'auto-fixed' ? 'Auto-corrected' : finding.status === 'unsupported' ? 'Uncorroborated · review' : finding.status === 'unclear' ? 'Unclear · review' : 'Contradicted · review';
    return `<article class="memory-finding ${finding.action === 'auto-fixed' ? 'resolved' : 'pending'}"><div class="memory-finding-head"><strong>${esc(finding.file)}</strong><span class="finding-badge ${finding.action === 'auto-fixed' ? 'warning' : 'error'}">${esc(status)}</span></div><blockquote>${esc(finding.claim)}</blockquote><p>${esc(finding.rationale)}</p>${finding.evidencePath && finding.evidenceQuote ? `<div class="memory-evidence"><small>Evidence · ${esc(finding.evidencePath)}${finding.evidenceDate ? ` · ${esc(finding.evidenceDate)}` : ''}</small><blockquote>${esc(finding.evidenceQuote)}</blockquote></div>` : ''}${finding.autoFixReason ? `<small class="memory-audit-errors">Correction held: ${esc(finding.autoFixReason)}</small>` : ''}<small>Confidence ${Math.round((finding.confidence || 0) * 100)}% · ${esc(finding.id)}</small></article>`;
  }).join('');
  if (report.errors?.length) panel.innerHTML += `<div class="memory-audit-errors"><strong>Could not check ${report.errors.length} notes</strong>${report.errors.map((error) => `<small>${esc(error)}</small>`).join('')}</div>`;
}
function switchView(view) {
  state.view = view; $$('.view').forEach((item) => item.classList.toggle('active', item.id === `view-${view}`));
  $$('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  $('#crumb-current').textContent = ({ assistant: 'Assistant', brain: 'Brain', projects: 'Projects', inbox: 'Inbox', tasks: 'Tasks', agents: 'Background agents', skills: 'Skills', settings: 'Settings', email: 'Email', meetings: 'Meetings', calendar: 'Calendar', apps: 'Apps' })[view] || view;
  if (view === 'brain') loadBrain(); if (view === 'inbox') loadReview();
  if (view === 'projects') loadProjects(); if (view === 'agents') loadAgents(); if (view === 'tasks') loadTasks(); if (view === 'skills') loadSkills();
}
async function loadSkills() {
  const panel = $('#skills-panel'); panel.innerHTML = '<div class="empty-state">Finding available skills…</div>';
  try {
    const skills = await api('/api/skills');
    $('#skill-count').textContent = String(skills.length);
    $('#skills-summary').textContent = `${skills.length} available`;
    panel.innerHTML = skills.length ? skills.map((skill) => `<article class="skill-card"><div class="skill-card-mark" aria-hidden="true">✳</div><div class="skill-card-copy"><h2>${esc(skill.name.replaceAll('-', ' '))}</h2><p>${esc(skill.description)}</p><small>Loaded when relevant · ${esc(skill.dirName)}</small></div></article>`).join('') : '<div class="empty-state">No skills found in the local skills folder.</div>';
  } catch (error) { panel.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; }
}
function renderSources(node, sources = []) {
  let section = node.querySelector('.message-sources');
  if (section) section.remove();
  const evidence = sources.filter((source) => source.kind === 'web' || source.kind === 'memory');
  if (!evidence.length) return;
  section = document.createElement('details'); section.className = 'message-sources';
  const memoryCount = evidence.filter((source) => source.kind === 'memory').length;
  const webCount = evidence.filter((source) => source.kind === 'web').length;
  const grouped = [
    ['memory', 'From your brain'],
    ['web', 'Public web'],
  ].map(([kind, label]) => ({ kind, label, items: evidence.filter((source) => source.kind === kind) })).filter((group) => group.items.length);
  section.innerHTML = `<summary class="sources-summary"><span>Sources</span><small>${memoryCount ? `${memoryCount} from your brain` : ''}${memoryCount && webCount ? ' · ' : ''}${webCount ? `${webCount} from the web` : ''}</small><b aria-hidden="true">${evidence.length}</b></summary><div class="sources-content">${grouped.map((group) => `<div class="source-group"><div class="source-group-label">${esc(group.label)}</div><div class="source-items">${group.items.map((source) => {
    if (source.kind === 'web' && source.url) {
      let host = ''; try { host = new URL(source.url).hostname.replace(/^www\./, ''); } catch { /* invalid URLs are omitted by server validation */ }
      return `<a class="source-item" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer"><span class="source-kind">${source.verified ? 'Opened page' : 'Search result'}</span><span class="source-title">${esc(source.title)}</span><small>${esc(host || source.url)}</small></a>`;
    }
    if (source.kind === 'memory' && source.path) { const memoryLabel = source.access === 'read' ? 'Read note' : source.access === 'catalog' ? 'Vault index' : 'Retrieved note'; return `<button class="source-item memory-source" data-note="${esc(source.path)}"><span class="source-kind">${memoryLabel}</span><span class="source-title">${esc(source.title)}</span><small>${esc(source.path)}</small></button>`; }
    return '';
  }).join('')}</div></div>`).join('')}</div>`;
  (node.querySelector('.message-main') || node).append(section); bindNotes();
  if (node.parentElement?.lastElementChild === node) $('#conversation-scroll').scrollTop = $('#conversation-scroll').scrollHeight;
}
function traceLabel(step) {
  const labels = { vaultSearch: 'Searched your vault', vaultRead: 'Read a vault note', vaultList: 'Checked vault folders', vaultCatalog: 'Checked the vault index', webSearch: 'Searched the web', webRead: 'Opened a web page', vaultWrite: 'Updated a vault note', memoryAudit: 'Audited current memory against vault evidence' };
  if (step.name === 'skillLoad') return `Loaded skill: ${(step.skillName || 'matched skill').replaceAll('-', ' ')}`;
  return labels[step.name] || 'Worked through the request';
}
function renderTrace(node, trace = []) {
  let section = node.querySelector('.message-trace');
  const wasOpen = section?.open || false;
  if (section) section.remove();
  const steps = trace.filter((step) => step && ['vaultSearch', 'vaultRead', 'vaultList', 'vaultCatalog', 'webSearch', 'webRead', 'skillLoad', 'vaultWrite', 'memoryAudit'].includes(step.name)).slice(0, 32);
  if (!steps.length) return;
  section = document.createElement('details'); section.className = 'message-trace';
  section.open = wasOpen;
  section.innerHTML = `<summary><span>Thinking</span><small>${steps.length} step${steps.length === 1 ? '' : 's'}</small></summary><ol>${steps.map((step) => `<li>${esc(traceLabel(step))}</li>`).join('')}</ol>`;
  (node.querySelector('.message-main') || node).append(section);
}
function addMessage(role, text, { streaming = false, sources = [], toolTrace = [] } = {}) {
  $('#welcome').hidden = true;
  const node = document.createElement('div'); node.className = `message ${role}`;
  node.innerHTML = `<span class="message-mark" aria-hidden="true">${role === 'user' ? 'YOU' : '✳'}</span><div class="message-main">${streaming ? '<div class="message-status" aria-live="polite">Preparing your answer…</div>' : ''}<div class="message-body ${streaming ? 'thinking' : ''}">${role === 'assistant' && !streaming ? renderMarkdown(text) : esc(text)}</div></div>`;
  $('#messages').append(node); $('#conversation-scroll').scrollTop = $('#conversation-scroll').scrollHeight;
  if (role === 'assistant' && !streaming) { renderTrace(node, toolTrace); renderSources(node, sources); }
  return node.querySelector('.message-body');
}
async function loadSession(id = state.sessionId) {
  try {
    const messages = await api(`/api/sessions/${encodeURIComponent(id)}/messages`);
    state.sessionId = id; localStorage.setItem('brain.activeSessionId', id); $('#messages').replaceChildren();
    for (const item of messages) addMessage(item.role, item.content, { sources: item.sources || [], toolTrace: item.toolTrace || [] });
    $('#welcome').hidden = messages.length > 0;
    state.sessionName = state.sessions.find((session) => session.id === id)?.name || (id === 'default' ? 'Assistant' : state.sessionName);
    $('#session-picker').textContent = state.sessionName;
    renderSessionList();
  }
  catch (error) { toast('Could not open conversation', error.message, 'error'); }
}
function renderSessionList() {
  const panels = [$('#session-list'), $('#dialog-session-list')].filter(Boolean);
  const visibleSessions = state.sessions.filter((session) => session.messageCount > 0 || session.id === state.sessionId).slice(0, 24);
  const rows = visibleSessions.length ? visibleSessions.map((session) => `<button class="session-row ${session.id === state.sessionId ? 'selected' : ''}" data-session="${esc(session.id)}" ${state.busy ? 'disabled' : ''}><span class="session-row-title">${esc(session.name)}</span><small>${session.messageCount ? `${session.messageCount} messages` : 'No messages yet'}</small></button>`).join('') : '<div class="history-empty">Your conversations will appear here.</div>';
  panels.forEach((panel) => { panel.innerHTML = rows; });
}
async function refreshSessions() {
  state.sessions = await api('/api/sessions'); renderSessionList();
  const current = state.sessions.find((session) => session.id === state.sessionId);
  if (current) { state.sessionName = current.name; $('#session-picker').textContent = current.name; }
}
async function sendMessage(value, options = {}) {
  const prompt = (value ?? $('#prompt').value).trim(); if (!prompt || state.busy) return;
  $('#prompt').value = ''; $('#prompt').style.height = 'auto'; addMessage('user', prompt);
  const output = addMessage('assistant', 'Finding the useful threads', { streaming: true }); state.busy = true; $('#send').disabled = true; $('#connection-label').textContent = 'Thinking…';
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, sessionId: state.sessionId, ...(options.lintFinding ? { lintFinding: options.lintFinding } : {}) }) });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Chat failed.'); }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', text = '', sources = [], toolTrace = [];
    while (true) {
      const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n'); buffer = blocks.pop();
      for (const block of blocks) {
        const eventName = block.match(/^event: (.+)$/m)?.[1];
        const dataLine = block.match(/^data: (.+)$/m); if (!dataLine) continue;
        const data = JSON.parse(dataLine[1]);
        if (eventName === 'delta') { text += data.text; output.innerHTML = renderMarkdown(text); output.classList.remove('thinking'); }
        if (eventName === 'tool') { toolTrace.push({ name: data.name, ...(data.skillName ? { skillName: data.skillName } : {}) }); renderTrace(output.closest('.message'), toolTrace); const status = output.closest('.message')?.querySelector('.message-status'); if (status) status.textContent = toolStatus(data.name); }
        if (eventName === 'sources') { sources = data.sources || []; }
        if (eventName === 'error') throw new Error(data.error);
      }
      $('#conversation-scroll').scrollTop = $('#conversation-scroll').scrollHeight;
    }
    if (!text) output.textContent = 'I could not find a response. Please try again.';
    else output.innerHTML = renderMarkdown(text);
    output.classList.remove('thinking'); output.closest('.message')?.querySelector('.message-status')?.remove();
    renderTrace(output.closest('.message'), toolTrace); renderSources(output.closest('.message'), sources);
    await refreshSessions();
  } catch (error) { output.classList.remove('thinking'); output.classList.add('error-text'); output.textContent = error.message; output.closest('.message')?.querySelector('.message-status')?.remove(); toast('Assistant needs attention', error.message, 'error'); await refreshSessions().catch(() => {}); }
  finally { state.busy = false; $('#send').disabled = false; renderSessionList(); $('#connection-label').textContent = 'Brain · Ready'; $('#prompt').focus(); }
}
function toolStatus(name) {
  const labels = { vaultSearch: 'Searching your notes', vaultRead: 'Reading a note', vaultList: 'Checking your folders', vaultCatalog: 'Reviewing your vault index', webSearch: 'Searching public sources', webRead: 'Opening a source page', skillLoad: 'Loading a matching skill', vaultWrite: 'Updating your vault' };
  return labels[name] || 'Working through your request';
}
async function loadOverview() {
  try {
    const info = await api('/api/overview'); state.overview = info; state.recentRuns = info.recentRuns || []; state.files = await api('/api/brain/files');
    const onboarding = await api('/api/onboarding'); if (onboarding.required && (!state.onboarding || state.onboarding.index !== onboarding.index)) showOnboarding(onboarding);
    setText('#file-count', info.fileCount); setText('#review-count', info.reviewCount);
    const provider = info.model.startsWith('openai:') ? 'OpenAI' : info.model.startsWith('ollama:') ? 'Ollama · Local' : 'Configured';
    setText('#composer-model', info.model.replace(/^(?:ollama|openai):/, '') + ' · ' + provider);
    setText('#settings-model', info.model); setText('#settings-provider', provider); setText('#settings-vault', info.vaultPath);
    renderAudit(info.audit);
    renderMemoryAudit(info.memoryAudit);
    const lastCheckAt = [info.audit?.auditedAt, info.memoryAudit?.auditedAt].filter(Boolean).sort().at(-1);
    const checkStatus = lastCheckAt
      ? `Last checked ${new Date(lastCheckAt).toLocaleString()} · ${countLabel(info.audit?.summary?.errors || 0, 'structure error')} · ${countLabel(info.audit?.summary?.warnings || 0, 'warning')} · ${countLabel(info.memoryAudit?.summary?.autoFixed || 0, 'memory update')} · ${countLabel(info.memoryAudit?.summary?.needsReview || 0, 'item', 'items')} to review · ${friendlySchedule(info.brainCheckSchedule, 'brain')}`
      : `Structure + AI memory · ${friendlySchedule(info.brainCheckSchedule, 'brain')} (${info.timezone})`;
    setText('#settings-check-status', checkStatus);
    setText('#settings-watcher', info.watcherReady ? 'Watching nested Markdown changes on this device' : 'Starting local Markdown watcher…');
    if (info.lastActivity) handleActivity(info.lastActivity, false);
    if (state.view === 'agents') renderAgentStatus();
  } catch (error) { $('#connection-label').textContent = 'Brain · Offline'; toast('Could not reach your brain', error.message, 'error'); }
}
function showOnboarding(status) {
  if (!status.required) { $('#onboarding-modal').hidden = true; return; }
  state.onboarding = status; $('#onboarding-modal').hidden = false;
  $('#onboarding-progress-label').textContent = `STEP ${status.index + 1} OF ${status.total}`;
  $('#onboarding-progress-bar').style.width = `${((status.index + 1) / status.total) * 100}%`;
  $('#onboarding-prompt').textContent = status.prompt; $('#onboarding-answer').value = '';
  $('#onboarding-error').textContent = ''; $('#onboarding-next').textContent = status.index === status.total - 1 ? 'Finish setup →' : 'Continue →';
  $('#onboarding-answer').focus();
}
$('#onboarding-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = $('#onboarding-next'); if (!state.onboarding || button.disabled) return;
  button.disabled = true;
    try { const status = await api('/api/onboarding', { method: 'POST', body: JSON.stringify({ answer: $('#onboarding-answer').value }) });
      if (status.required) showOnboarding(status); else { $('#onboarding-modal').hidden = true; state.onboarding = undefined; toast('Your brain is ready', 'Your preferences have been saved in your local vault.'); await loadOverview(); }
    } catch (error) { $('#onboarding-error').textContent = error.message; }
    finally { button.disabled = false; }
});
function handleActivity(event, notify = true) {
  if (!event) return;
  const labels = { 'ingest-start': ['Processing Inbox', 'The local brain is sorting new notes.'], 'ingest-done': ['Inbox processed', event.message], 'heartbeat-start': ['Automatic Inbox check started', 'The local background processor is checking for new Inbox notes.'], 'heartbeat-done': ['Automatic Inbox check complete', event.message], 'brain-check-start': ['Brain checks started', 'Checking vault structure and current memory.'], 'brain-check-done': ['Brain checks complete', event.message], 'vault-watch-start': ['Vault change detected', event.message], 'vault-watch-done': ['Vault updated', event.message], 'vault-watch-ready': ['Vault watch ready', event.message], thinking: ['Assistant is thinking', 'Searching your knowledge and preparing a response.'], error: ['Something needs attention', event.message], assistant: ['Assistant responded', event.message] };
  const [title, text] = labels[event.type] || ['Brain activity', event.message || 'Background work updated.'];
  const eventKey = `${event.type}:${event.at}`;
  state.lastActivityKey = eventKey;
  if (notify && ['heartbeat-start','heartbeat-done','ingest-start','ingest-done','brain-check-start','brain-check-done','vault-watch-start','vault-watch-done','error'].includes(event.type)) { state.events.unshift({ title, text, time: new Date(event.at) }); state.events = state.events.slice(0, 10); if (state.view === 'agents') loadAgents(); }
  if (notify && event.type === 'vault-watch-done' && state.view === 'inbox') loadReview();
  if (notify && event.type === 'error') toast(title, text, 'error');
  if (event.stats) setText('#review-count', event.stats.needsReview || 0);
}
function connectEvents() { const stream = new EventSource('/api/events'); const markConnected = () => { if (!state.busy) $('#connection-label').textContent = 'Brain · Ready'; }; stream.onopen = markConnected; stream.addEventListener('activity', (event) => { const data = JSON.parse(event.data); handleActivity(data); loadOverview(); }); stream.addEventListener('ready', (event) => { const data = JSON.parse(event.data); markConnected(); if (data.lastActivity) handleActivity(data.lastActivity, false); }); stream.onerror = () => { $('#connection-label').textContent = 'Reconnecting…'; }; }
async function loadBrain() {
  const q = $('#brain-search').value.trim(); $('#brain-panel').innerHTML = '<div class="empty-state">Opening your brain…</div>';
  try {
    const data = q ? await api(`/api/brain/search?q=${encodeURIComponent(q)}`) : state.brainTab === 'graph' ? await api('/api/brain/graph') : await api('/api/brain/files');
    if (q) { const rows = data.results || []; $('#brain-results-label').textContent = `${rows.length} matching notes`; $('#brain-panel').innerHTML = rows.length ? `<div class="file-grid">${rows.map((item) => `<article class="file-card" data-note="${esc(item.path)}"><div class="file-card-top"><span class="file-icon">⌕</span><div><strong>${esc(item.title || item.path)}</strong><small>${esc(item.path)}</small></div></div><p>${esc((item.matches || []).join(' · ') || item.snippet || item.description || 'Matching note')}</p></article>`).join('')}</div>` : '<div class="empty-state">No notes surfaced for that search.</div>'; bindNotes(); return; }
    if (state.brainTab === 'graph') {
      state.files = data.nodes;
      $('#brain-results-label').textContent = `${data.nodes.length} notes · ${data.edges.length} explicit references`;
      renderGraph(data);
    } else {
      state.files = data;
      $('#brain-results-label').textContent = `${data.length} notes across ${new Set(data.map((x) => x.folder)).size} folders`;
      if (state.brainTab === 'base') renderTable(data); else renderFiles(data);
    }
  } catch (error) { $('#brain-panel').innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; }
}
async function loadProjects() {
  const panel = $('#projects-panel'); panel.innerHTML = '<div class="empty-state">Finding project notes…</div>';
  try { const files = await api('/api/brain/files'); const projects = files.filter((file) => /(^|\/)(projects?|work\/projects?)(\/|$)/i.test(file.path)); panel.innerHTML = projects.length ? projects.map((file) => `<article class="file-card" data-note="${esc(file.path)}"><div class="file-card-top"><span class="file-icon">▰</span><div><strong>${esc(file.name)}</strong><small>${esc(file.folder)} · ${relativeDate(file.modified)}</small></div></div><p>${(file.bytes / 1024).toFixed(1)} KB · Open project note</p></article>`).join('') : '<div class="empty-state project-empty">Project notes will appear here as you collect them. Your current vault is browsable in Brain.</div>'; bindNotes(); }
  catch (error) { panel.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; }
}
async function loadTasks() {
  const panel = $('#tasks-panel'); panel.innerHTML = '<div class="empty-state">Finding open checklists…</div>';
  try { const tasks = await api('/api/tasks'); const open = tasks.filter((task) => !task.completed); const done = tasks.filter((task) => task.completed); panel.innerHTML = open.length || done.length ? `${open.length ? `<div class="task-group-label">TO DO <span>${open.length}</span></div>${open.map((task) => `<button class="task-row" data-note="${esc(task.path)}"><span class="task-check"></span><span class="task-text">${esc(task.text)}</span><span class="task-source">${esc(task.path)} · ${task.line}</span></button>`).join('')}` : ''}${done.length ? `<div class="task-group-label completed-label">COMPLETED <span>${done.length}</span></div>${done.slice(0,12).map((task) => `<button class="task-row completed-task" data-note="${esc(task.path)}"><span class="task-check checked">✓</span><span class="task-text">${esc(task.text)}</span><span class="task-source">${esc(task.path)}</span></button>`).join('')}` : ''}` : '<div class="empty-state">No checklist items found in your notes yet. Add a <code>- [ ] task</code> to any Markdown note and it will show up here.</div>'; bindNotes(); }
  catch (error) { panel.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; }
}
function renderAgentStatus() {
  const info = state.overview; if (!info) return;
  $('#agent-schedule-text').textContent = friendlySchedule(info.schedule, 'inbox'); setText('#agent-brain-schedule-text', friendlySchedule(info.brainCheckSchedule, 'brain')); $('#agent-timezone-text').textContent = info.timezone;
  $('#agent-status-title').textContent = info.busy ? 'Your brain is working right now' : 'Automatic work is scheduled';
  $('#agent-status-copy').textContent = info.busy ? 'The local agent is processing Inbox notes, checking memory, or answering a question.' : `Markdown changes are watched locally · Inbox processing runs ${friendlySchedule(info.schedule, 'inbox')} · brain checks run ${friendlySchedule(info.brainCheckSchedule, 'brain')} (${info.timezone}).`;
  const liveEvents = state.events.slice(0, 8).map((item) => `<div class="agent-event"><span class="activity-marker"></span><div><strong>${esc(item.title)}</strong><small>${esc(item.text)}</small></div><time>${new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(item.time)}</time></div>`);
  const loggedRuns = state.recentRuns.map((line) => `<div class="agent-event logged-run"><span class="activity-marker"></span><div><strong>From the append-only vault log</strong><small>${esc(line.replace(/^-\s*/, ''))}</small></div></div>`);
  $('#agent-activity').innerHTML = [...liveEvents, ...loggedRuns].length ? [...liveEvents, ...loggedRuns].slice(0, 10).join('') : '<div class="empty-state">No runs recorded yet. The schedule is active.</div>';
}
async function loadAgents() { await loadOverview(); renderAgentStatus(); }
function renderFiles(files) { $('#brain-panel').innerHTML = files.length ? `<div class="file-grid">${files.map((file) => `<article class="file-card" data-note="${esc(file.path)}"><div class="file-card-top"><span class="file-icon">▤</span><div><strong>${esc(file.name)}</strong><small>${esc(file.folder)} · ${relativeDate(file.modified)}</small></div></div><p>${(file.bytes / 1024).toFixed(1)} KB · Open note</p></article>`).join('')}</div>` : '<div class="empty-state">No Markdown notes in this vault yet.</div>'; bindNotes(); }
function renderTable(files) { $('#brain-panel').innerHTML = files.length ? `<table class="brain-table"><thead><tr><th>Name</th><th>Folder</th><th>Size</th><th>Last modified</th></tr></thead><tbody>${files.map((file) => `<tr><td data-note="${esc(file.path)}">${esc(file.name)}</td><td>${esc(file.folder)}</td><td>${(file.bytes / 1024).toFixed(1)} KB</td><td>${new Date(file.modified).toLocaleDateString()}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">Your notes will appear here.</div>'; bindNotes(); }
function layoutGraph(nodes, edges) {
  const width = 1000, height = 680, count = nodes.length;
  const positions = nodes.map((_, index) => {
    const angle = (Math.PI * 2 * index / Math.max(count, 1)) - Math.PI / 2;
    const radius = count <= 1 ? 0 : Math.min(255, 70 + count * 3.5);
    return { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius * .72, vx: 0, vy: 0 };
  });
  const indexByPath = new Map(nodes.map((node, index) => [node.path, index]));
  const springs = edges.flatMap((edge) => {
    const source = indexByPath.get(edge.source), target = indexByPath.get(edge.target);
    return source === undefined || target === undefined ? [] : [{ source, target }];
  });
  for (let iteration = 0; iteration < 150; iteration += 1) {
    const forces = positions.map(() => ({ x: 0, y: 0 }));
    for (let a = 0; a < count; a += 1) for (let b = a + 1; b < count; b += 1) {
      let dx = positions[b].x - positions[a].x, dy = positions[b].y - positions[a].y;
      let distance = Math.hypot(dx, dy);
      if (distance < 1) { dx = (a + 1) * .7; dy = (b + 1) * .4; distance = Math.hypot(dx, dy); }
      const force = Math.min(3.2, 2100 / (distance * distance));
      forces[a].x -= dx / distance * force; forces[a].y -= dy / distance * force;
      forces[b].x += dx / distance * force; forces[b].y += dy / distance * force;
    }
    for (const edge of springs) {
      const a = positions[edge.source], b = positions[edge.target];
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
      const force = (distance - 112) * .0015;
      forces[edge.source].x += dx / distance * force; forces[edge.source].y += dy / distance * force;
      forces[edge.target].x -= dx / distance * force; forces[edge.target].y -= dy / distance * force;
    }
    const cooling = 1 - iteration / 190;
    for (const [index, position] of positions.entries()) {
      forces[index].x += (width / 2 - position.x) * .00045;
      forces[index].y += (height / 2 - position.y) * .00045;
      position.vx = (position.vx + forces[index].x * 9) * .78 * cooling;
      position.vy = (position.vy + forces[index].y * 9) * .78 * cooling;
      position.x = Math.max(32, Math.min(width - 32, position.x + position.vx));
      position.y = Math.max(32, Math.min(height - 32, position.y + position.vy));
    }
  }
  return positions;
}
function renderGraph(graph) {
  const { nodes, edges, unresolved } = graph;
  if (!nodes.length) { $('#brain-panel').innerHTML = '<div class="empty-state">No Markdown notes to map yet. Add a note link such as <code>[[Project overview]]</code> to start a connected graph.</div>'; return; }
  const positions = layoutGraph(nodes, edges);
  const degreeRank = [...nodes].sort((a, b) => b.degree - a.degree || a.path.localeCompare(b.path));
  const showLabels = new Set(degreeRank.slice(0, Math.min(14, nodes.length)).map((node) => node.path));
  const indexByPath = new Map(nodes.map((node, index) => [node.path, index]));
  const reverse = new Set(edges.map((edge) => `${edge.target}\0${edge.source}`));
  const edgeMarkup = edges.map((edge) => {
    const source = indexByPath.get(edge.source), target = indexByPath.get(edge.target);
    const a = positions[source], b = positions[target];
    let d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    if (reverse.has(`${edge.source}\0${edge.target}`)) {
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
      const offset = edge.source.localeCompare(edge.target) < 0 ? 7 : -7;
      const mx = (a.x + b.x) / 2 - dy / distance * offset, my = (a.y + b.y) / 2 + dx / distance * offset;
      d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    return `<path class="graph-edge ${edge.kind}" d="${d}" marker-end="url(#graph-arrow)"><title>${esc(edge.source)} references ${esc(edge.target)} (${edge.kind})</title></path>`;
  }).join('');
  const nodeMarkup = nodes.map((node, index) => {
    const position = positions[index], radius = 9 + Math.min(11, Math.sqrt(node.degree) * 2.4);
    const label = showLabels.has(node.path) ? `<text class="graph-label" text-anchor="middle" y="${(radius + 16).toFixed(1)}">${esc(node.name.length > 28 ? `${node.name.slice(0, 26)}…` : node.name)}</text>` : '';
    return `<g class="graph-node ${node.degree > 4 ? 'well-connected' : ''}" transform="translate(${position.x.toFixed(1)} ${position.y.toFixed(1)})" data-note="${esc(node.path)}" tabindex="0" role="button" aria-label="Open ${esc(node.path)}; ${node.inDegree} incoming and ${node.outDegree} outgoing references"><title>${esc(node.path)} · ${node.inDegree} incoming · ${node.outDegree} outgoing</title><circle r="${radius.toFixed(1)}"></circle>${label}</g>`;
  }).join('');
  const summary = `${nodes.length} notes · ${edges.length} explicit references · ${nodes.filter((node) => !node.degree).length} unlinked`;
  $('#brain-panel').innerHTML = `<div class="graph-view"><div class="graph-summary"><strong>${summary}</strong><span>${unresolved ? `${unresolved} unresolved or ambiguous links` : 'Every displayed edge resolves to a note'}</span></div><svg viewBox="0 0 1000 680" role="img" aria-label="Vault graph with ${nodes.length} notes and ${edges.length} explicit references"><defs><marker id="graph-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L7,3.5 L0,7 Z" fill="#a9b5aa"></path></marker></defs><g class="graph-edges">${edgeMarkup}</g><g class="graph-nodes">${nodeMarkup}</g></svg><div class="graph-caption"><span><i class="graph-legend-node"></i> Note</span><span><i class="graph-legend-link"></i> Explicit link direction</span><span>Select a note to open it</span></div></div>`;
  bindNotes();
}
function bindNotes() { $$('[data-note]').forEach((el) => { if (el.dataset.noteBound) return; el.dataset.noteBound = 'true'; el.addEventListener('click', () => openNote(el.dataset.note)); el.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openNote(el.dataset.note); } }); }); }
async function openNote(file) { try { const note = await api(`/api/brain/note?path=${encodeURIComponent(file)}`); $('#modal-title').textContent = file; $('#modal-content').innerHTML = renderNotePreview(note.content); $('#modal').hidden = false; bindNotes(); } catch (error) { toast('Could not open note', error.message, 'error'); } }
async function loadReview() {
  try { const items = await api('/api/review'); setText('#review-count', items.length); $('#review-panel').innerHTML = items.length ? items.map((item) => `<div class="review-row"><span class="review-icon">↳</span><div class="review-copy"><strong>${esc(item.source)}</strong><p>${esc(item.message)}</p><div class="review-guidance-wrap"><input class="review-guidance" data-source="${esc(item.source)}" placeholder="Add a correction or exact destination path…"><button class="secondary-button retry-review" data-source="${esc(item.source)}">Resolve →</button></div></div><span class="review-status">${esc(item.status.replace('_',' '))}</span></div>`).join('') : '<div class="empty-state" style="margin-top:18px">Nothing needs review. The inbox is clear.</div>'; $$('.retry-review').forEach((button) => button.addEventListener('click', () => retryReview(button.dataset.source))); }
  catch (error) { $('#review-panel').innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; }
}
async function retryReview(source) { const input = $(`.review-guidance[data-source="${CSS.escape(source)}"]`); const guidance = input?.value.trim(); if (!guidance) { toast('A little guidance needed', 'Add a destination path or short correction first.', 'error'); input?.focus(); return; } const button = $(`.retry-review[data-source="${CSS.escape(source)}"]`); button.disabled = true; button.textContent = 'Working…'; try { await api('/api/review/retry', { method: 'POST', body: JSON.stringify({ source, guidance }) }); toast('Note resolved', 'The inbox compiler has handled your guidance.'); loadReview(); loadOverview(); } catch (error) { toast('Could not resolve note', error.message, 'error'); button.disabled = false; button.textContent = 'Resolve →'; } }
async function runIngest(button = $('#ingest-now')) { button.disabled = true; const old = button.textContent; button.textContent = 'Processing…'; try { const stats = await api('/api/ingest', { method: 'POST', body: '{}' }); toast('Inbox processed', `${stats.created} created · ${stats.updated} updated · ${stats.needsReview} to review`); await loadOverview(); await loadReview(); } catch (error) { toast('Ingestion paused', error.message, 'error'); } finally { button.disabled = false; button.textContent = old; } }
async function runBrainCheck(button = $('#brain-check-run')) { button.disabled = true; const old = button.textContent; button.textContent = 'Checking…'; try { const result = await api('/api/brain-check', { method: 'POST', body: '{}' }); renderAudit(result.audit); renderMemoryAudit(result.memoryAudit); const structure = result.audit.summary; const memory = result.memoryAudit.summary; toast('Brain checks complete', `${result.audit.filesScanned} notes · ${structure.errors} structural errors · ${result.memoryAudit.claimsChecked} memory claims · ${memory.autoFixed} corrected · ${memory.needsReview} to review`); await loadOverview(); } catch (error) { toast('Brain checks couldn’t finish', error.message, 'error'); } finally { button.disabled = false; button.textContent = old; } }
async function newSession() { try { const session = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ name: 'New conversation' }) }); state.sessions.unshift(session); await loadSession(session.id); await refreshSessions(); $('#chat-title').textContent = 'A little more room to think.'; switchView('assistant'); $('#prompt').focus(); } catch (error) { toast('Could not start conversation', error.message, 'error'); } }

document.addEventListener('click', async (event) => {
  const session = event.target.closest('[data-session]'); if (session) { if (!state.busy) { await loadSession(session.dataset.session); switchView('assistant'); $('#history-dialog').close(); } return; }
  const view = event.target.closest('[data-view]'); if (view) { switchView(view.dataset.view); return; }
  const prompt = event.target.closest('[data-prompt]'); if (prompt) { sendMessage(prompt.dataset.prompt); return; }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'new-chat') newSession(); if (action === 'open-brain') switchView('brain'); if (action === 'open-search') { switchView('brain'); setTimeout(() => $('#brain-search').focus(), 20); }
});
$('#history-refresh').addEventListener('click', () => refreshSessions().catch((error) => toast('Could not refresh history', error.message, 'error')));
$('#session-picker').addEventListener('click', () => { renderSessionList(); $('#history-dialog').showModal(); });
$('#history-close').addEventListener('click', () => $('#history-dialog').close());
$('#send').addEventListener('click', () => sendMessage());
$('#prompt').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
$('#prompt').addEventListener('input', (event) => { event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight,160)}px`; });
$('#brain-check-run').addEventListener('click', (event) => runBrainCheck(event.currentTarget)); $('#settings-ingest-run').addEventListener('click', (event) => runIngest(event.currentTarget)); $('#ingest-now').addEventListener('click', (event) => runIngest(event.currentTarget));
$$('[data-brain-tab]').forEach((button) => button.addEventListener('click', () => { state.brainTab = button.dataset.brainTab; $$('[data-brain-tab]').forEach((item) => item.classList.toggle('selected', item === button)); loadBrain(); }));
let searchTimer; $('#brain-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadBrain, 350); });
$('#modal').addEventListener('click', (event) => { if (event.target.id === 'modal' || event.target.closest('.modal-close')) $('#modal').hidden = true; });
document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); newSession(); } });
async function startApp() {
  await refreshSessions().catch((error) => toast('Could not load conversation history', error.message, 'error'));
  const remembered = localStorage.getItem('brain.activeSessionId');
  const selected = remembered && state.sessions.some((session) => session.id === remembered) ? remembered : 'default';
  await loadSession(selected);
  await refreshSessions().catch(() => {});
}
loadOverview(); startApp(); connectEvents();
