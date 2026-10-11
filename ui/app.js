const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const state = { view: 'assistant', sessionId: 'default', sessionName: 'Assistant', sessions: [], files: [], brainTab: 'graph', events: [], busy: false, overview: null };
const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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
    else if (!line.trim()) { flushParagraph(); flushList(); flushQuote(); }
    else { flushList(); flushQuote(); paragraph.push(line); }
  }
  flushParagraph(); flushList(); flushQuote(); flushCode();
  return blocks.join('');
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
function activity(title, text, time = new Date()) {
  state.events.unshift({ title, text, time }); state.events = state.events.slice(0, 4);
  $('#recent-activity').innerHTML = state.events.map((item) => `<div class="activity-entry"><span class="activity-marker"></span><div><strong>${esc(item.title)}</strong><small>${esc(item.text)}</small></div><time>${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(item.time)}</time></div>`).join('');
}
function relativeDate(date) {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
}
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
    const [meaning, next] = findingGuidance[finding.kind] || ['The linter found a structural pattern that may need attention.', 'Ask Brain to inspect the note and suggest a safe next step.'];
    return `<article class="finding-card ${finding.severity}"><div class="finding-symbol" aria-hidden="true">${finding.severity === 'error' ? '!' : '·'}</div><div class="finding-content"><div class="finding-title-row"><strong>${esc(finding.file)}</strong><span class="finding-badge ${finding.severity}">${esc(finding.severity)}</span></div><p>${esc(meaning)}</p><small class="finding-evidence">${esc(finding.detail)}</small><div class="finding-next"><b>Suggested next step</b><span>${esc(next)}</span></div><button class="finding-review" data-review-finding="${esc(JSON.stringify(finding))}">Ask Brain to review →</button></div></article>`;
  }).join('');
}
async function reviewLintFinding(finding) {
  if (state.busy) { toast('Assistant is busy', 'Wait for the current response before starting a lint review.', 'error'); return; }
  try {
    const session = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ name: `Lint review · ${finding.file}` }) });
    state.sessions.unshift(session); await loadSession(session.id); await refreshSessions();
    const prompt = `Review this lint finding using the application-gathered vault evidence. Return two separate judgments: (1) structural status — genuine issue, warning, or false positive; (2) author intent — explicit evidence of intent, or unknown. For a missing link target, the structural defect is genuine unless the linter resolved the path incorrectly. A broken link does not prove the author made a mistake. Never infer intentionality or oversight from a missing reference; use explicit note content or metadata, and quote the evidence. Cite the exact vault paths read, explain confidence, and give one safe, exact next step. Do not write, move, archive, or delete anything; wait for my approval.\n\nFinding: ${finding.severity} · ${finding.kind}\nFile: ${finding.file}\nLint detail: ${finding.detail}`;
    switchView('assistant'); sendMessage(prompt, { lintFinding: { severity: finding.severity, kind: finding.kind, file: finding.file, detail: finding.detail } });
  } catch (error) { toast('Could not open lint review', error.message, 'error'); }
}
function switchView(view) {
  state.view = view; $$('.view').forEach((item) => item.classList.toggle('active', item.id === `view-${view}`));
  $$('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  $('#crumb-current').textContent = ({ assistant: 'Assistant', brain: 'Brain', projects: 'Projects', inbox: 'Inbox', tasks: 'Tasks', agents: 'Background agents', settings: 'Settings', email: 'Email', meetings: 'Meetings', calendar: 'Calendar', apps: 'Apps' })[view] || view;
  if (view === 'brain') loadBrain(); if (view === 'inbox') loadReview();
  if (view === 'projects') loadProjects(); if (view === 'agents') loadAgents(); if (view === 'tasks') loadTasks();
}
function renderSources(node, sources = []) {
  let section = node.querySelector('.message-sources');
  if (section) section.remove();
  if (!sources.length) return;
  section = document.createElement('section'); section.className = 'message-sources';
  const grouped = [
    ['memory', 'From your brain'],
    ['web', 'Public web'],
    ['status', 'Research status'],
    ['skill', 'Skills used'],
  ].map(([kind, label]) => ({ kind, label, items: sources.filter((source) => source.kind === kind) })).filter((group) => group.items.length);
  section.innerHTML = `<div class="sources-heading"><strong>Sources</strong><span>${sources.length}</span></div>${grouped.map((group) => `<div class="source-group"><div class="source-group-label">${esc(group.label)}</div><div class="source-items">${group.items.map((source) => {
    if (source.kind === 'web' && source.url) {
      let host = ''; try { host = new URL(source.url).hostname.replace(/^www\./, ''); } catch { /* invalid URLs are omitted by server validation */ }
      return `<a class="source-item" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer"><span class="source-kind">${source.verified ? 'Verified page' : 'Search result'}</span><strong>${esc(source.title)}</strong><small>${esc(host || source.url)}</small></a>`;
    }
    if (source.kind === 'memory' && source.path) { const memoryLabel = source.access === 'read' ? 'Read note' : source.access === 'catalog' ? 'Vault index' : 'Retrieved note'; return `<button class="source-item memory-source" data-note="${esc(source.path)}"><span class="source-kind">${memoryLabel}</span><strong>${esc(source.title)}</strong><small>${esc(source.path)}</small></button>`; }
    if (source.kind === 'status') return `<div class="source-item status-source"><span class="source-kind">No verified source</span><strong>${esc(source.title)}</strong></div>`;
    return `<div class="source-item skill-source"><span class="source-kind">Loaded locally</span><strong>${esc(source.title)}</strong>${source.path ? `<small>${esc(source.path)}</small>` : ''}</div>`;
  }).join('')}</div></div>`).join('')}`;
  (node.querySelector('.message-main') || node).append(section); bindNotes();
  if (node.parentElement?.lastElementChild === node) $('#conversation-scroll').scrollTop = $('#conversation-scroll').scrollHeight;
}
function addMessage(role, text, { streaming = false, sources = [] } = {}) {
  $('#welcome').hidden = true;
  const node = document.createElement('div'); node.className = `message ${role}`;
  node.innerHTML = `<span class="message-mark" aria-hidden="true">${role === 'user' ? 'YOU' : '✳'}</span><div class="message-main">${streaming ? '<div class="message-status" aria-live="polite">Preparing your answer…</div>' : ''}<div class="message-body ${streaming ? 'thinking' : ''}">${role === 'assistant' && !streaming ? renderMarkdown(text) : esc(text)}</div></div>`;
  $('#messages').append(node); $('#conversation-scroll').scrollTop = $('#conversation-scroll').scrollHeight;
  if (role === 'assistant' && !streaming) renderSources(node, sources);
  return node.querySelector('.message-body');
}
async function loadSession(id = state.sessionId) {
  try {
    const messages = await api(`/api/sessions/${encodeURIComponent(id)}/messages`);
    state.sessionId = id; localStorage.setItem('brain.activeSessionId', id); $('#messages').replaceChildren();
    for (const item of messages) addMessage(item.role, item.content, { sources: item.sources || [] });
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
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', text = '', sources = [];
    while (true) {
      const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n'); buffer = blocks.pop();
      for (const block of blocks) {
        const eventName = block.match(/^event: (.+)$/m)?.[1];
        const dataLine = block.match(/^data: (.+)$/m); if (!dataLine) continue;
        const data = JSON.parse(dataLine[1]);
        if (eventName === 'delta') { text += data.text; output.innerHTML = renderMarkdown(text); output.classList.remove('thinking'); }
        if (eventName === 'tool') { const status = output.closest('.message')?.querySelector('.message-status'); if (status) status.textContent = toolStatus(data.name); activity('Using your brain', `${data.name} is working with local context.`); }
        if (eventName === 'sources') { sources = data.sources || []; }
        if (eventName === 'error') throw new Error(data.error);
      }
      $('#conversation-scroll').scrollTop = $('#conversation-scroll').scrollHeight;
    }
    if (!text) output.textContent = 'I could not find a response. Please try again.';
    else output.innerHTML = renderMarkdown(text);
    output.classList.remove('thinking'); output.closest('.message')?.querySelector('.message-status')?.remove();
    renderSources(output.closest('.message'), sources); activity('Assistant responded', 'Your conversation and its source trail are saved locally.');
    await refreshSessions();
  } catch (error) { output.classList.remove('thinking'); output.classList.add('error-text'); output.textContent = error.message; output.closest('.message')?.querySelector('.message-status')?.remove(); toast('Assistant needs attention', error.message, 'error'); await refreshSessions().catch(() => {}); }
  finally { state.busy = false; $('#send').disabled = false; renderSessionList(); $('#connection-label').textContent = 'Local · Ready'; $('#prompt').focus(); }
}
function toolStatus(name) {
  const labels = { vaultSearch: 'Searching your notes', vaultRead: 'Reading a note', vaultList: 'Checking your folders', vaultCatalog: 'Reviewing your vault index', webSearch: 'Searching public sources', webRead: 'Opening a source page', skillLoad: 'Loading a matching skill', vaultWrite: 'Updating your vault' };
  return labels[name] || 'Working through your request';
}
async function loadOverview() {
  try {
    const info = await api('/api/overview'); state.overview = info; state.files = await api('/api/brain/files');
    const onboarding = await api('/api/onboarding'); if (onboarding.required && (!state.onboarding || state.onboarding.index !== onboarding.index)) showOnboarding(onboarding);
    if (!state.events.length && info.recentRuns?.length) state.events = info.recentRuns.map((line) => ({ title: 'Earlier brain activity', text: line.replace(/^-\s*/, ''), time: new Date() }));
    $('#file-count').textContent = info.fileCount; $('#review-count').textContent = info.reviewCount; $('#vault-name').textContent = info.vault; $('#model-name').textContent = info.model; $('#composer-model').textContent = info.model.replace(/^ollama:/, '') + ' · Local';
    $('#settings-model').textContent = info.model; $('#settings-vault').textContent = info.vaultPath; $('#settings-schedule').textContent = `${info.schedule} · ${info.timezone}`; $('#schedule-label').textContent = info.schedule.includes('30') ? 'Every 30 minutes' : info.schedule; $('#heartbeat-time').textContent = info.timezone;
    $('#settings-audit').textContent = info.audit?.auditedAt
      ? `${info.audit.filesScanned} notes checked · ${info.audit.summary.errors} errors · ${info.audit.summary.warnings} warnings`
      : `Not run yet · scheduled ${info.auditSchedule}`;
    renderAudit(info.audit);
    $('#attention-total').textContent = info.reviewCount;
    $('#attention-list').innerHTML = info.review.length ? info.review.map((item) => `<div class="attention-card" data-review="${esc(item.source)}"><span class="attention-marker">↳</span><div><div class="attention-title">${esc(item.source.split('/').pop())}</div><div class="attention-copy">${esc(item.message)}</div></div></div>`).join('') : '<div class="empty-rail">Nothing waiting. You’re all caught up.</div>';
    $('#attention-list').onclick = () => switchView('inbox');
    if (info.lastActivity) handleActivity(info.lastActivity, false);
    if (state.view === 'agents') renderAgentStatus();
  } catch (error) { $('#connection-label').textContent = 'Local · Offline'; toast('Could not reach your brain', error.message, 'error'); }
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
function renderProactive(event) {
  const group = event.type.startsWith('ingest') ? 'ingest' : event.type.startsWith('heartbeat') ? 'heartbeat' : null;
  if (!group) return;
  const id = `proactive-${group}`;
  let card = document.getElementById(id);
  if (!card) { $('#welcome').hidden = true; card = document.createElement('article'); card.id = id; card.className = 'proactive-card'; $('#messages').prepend(card); }
  const completed = event.type.endsWith('done'); const stats = event.stats;
  const title = completed ? (group === 'heartbeat' ? 'A fresh look at your brain' : 'Your inbox has been sorted') : (group === 'heartbeat' ? 'Checking in on your brain' : 'Sorting new notes into place');
  const summary = completed && stats ? `${stats.scanned} notes checked · ${stats.created} created · ${stats.updated} updated${stats.needsReview ? ` · ${stats.needsReview} need your eye` : ''}` : completed ? event.message : 'Your local notes are being reviewed. You can keep chatting while this runs.';
  const changed = (stats?.items || []).flatMap((item) => item.targetPaths?.length ? item.targetPaths : item.targetPath ? [item.targetPath] : []).slice(0, 3);
  card.innerHTML = `<div class="proactive-head"><span class="proactive-mark">✧</span><div><div class="eyebrow">A NOTE FROM YOUR BRAIN</div><strong>${esc(title)}</strong></div><span class="proactive-live ${completed ? 'complete' : ''}">${completed ? 'JUST NOW' : 'WORKING'}</span></div><p>${esc(summary)}</p>${changed.length ? `<div class="proactive-links">${changed.map((file) => `<button data-note="${esc(file)}">Open ${esc(file.split('/').pop().replace(/\.md$/i,''))} ↗</button>`).join('')}</div>` : ''}${stats?.needsReview ? '<button class="proactive-action" data-view="inbox">Review the items I held back →</button>' : ''}`;
  bindNotes(); $('#conversation-scroll').scrollTop = $('#conversation-scroll').scrollHeight;
}
function handleActivity(event, notify = true) {
  if (!event) return;
  const labels = { 'ingest-start': ['Processing inbox', 'The local brain is sorting new notes.'], 'ingest-done': ['Inbox processed', event.message], 'heartbeat-start': ['Brain check started', 'Reviewing your local notes and inbox.'], 'heartbeat-done': ['Brain check complete', event.message], 'audit-start': ['Vault lint started', 'Checking links, empty notes, and Inbox state.'], 'audit-done': ['Vault lint complete', event.message], thinking: ['Assistant is thinking', 'Searching your knowledge and preparing a response.'], error: ['Something needs attention', event.message], assistant: ['Assistant responded', event.message] };
  const [title, text] = labels[event.type] || ['Brain activity', event.message || 'Background work updated.'];
  const eventKey = `${event.type}:${event.at}`;
  if (state.lastActivityKey !== eventKey) activity(title, text, new Date(event.at));
  state.lastActivityKey = eventKey;
  if (notify) renderProactive(event);
  if (notify && ['heartbeat-start','heartbeat-done','ingest-start','ingest-done','audit-start','audit-done','error'].includes(event.type)) { state.events.unshift({ title, text, time: new Date(event.at) }); state.events = state.events.slice(0, 10); if (state.view === 'agents') loadAgents(); }
  if (notify && ['ingest-start', 'ingest-done', 'heartbeat-start', 'heartbeat-done', 'audit-start', 'audit-done', 'error'].includes(event.type)) toast(title, text, event.type === 'error' ? 'error' : 'success');
  if (event.stats) { $('#review-count').textContent = event.stats.needsReview || 0; $('#attention-total').textContent = event.stats.needsReview || 0; }
}
function connectEvents() { const stream = new EventSource('/api/events'); stream.addEventListener('activity', (event) => { const data = JSON.parse(event.data); handleActivity(data); loadOverview(); }); stream.addEventListener('ready', (event) => { const data = JSON.parse(event.data); if (data.lastActivity) handleActivity(data.lastActivity, false); }); stream.onerror = () => { $('#connection-label').textContent = 'Reconnecting…'; }; }
async function loadBrain() {
  const q = $('#brain-search').value.trim(); $('#brain-panel').innerHTML = '<div class="empty-state">Opening your brain…</div>';
  try {
    const data = q ? await api(`/api/brain/search?q=${encodeURIComponent(q)}`) : await api('/api/brain/files');
    if (q) { const rows = data.results || []; $('#brain-results-label').textContent = `${rows.length} matching notes`; $('#brain-panel').innerHTML = rows.length ? `<div class="file-grid">${rows.map((item) => `<article class="file-card" data-note="${esc(item.path)}"><div class="file-card-top"><span class="file-icon">⌕</span><div><strong>${esc(item.title || item.path)}</strong><small>${esc(item.path)}</small></div></div><p>${esc((item.matches || []).join(' · ') || item.snippet || item.description || 'Matching note')}</p></article>`).join('')}</div>` : '<div class="empty-state">No notes surfaced for that search.</div>'; bindNotes(); return; }
    state.files = data; $('#brain-results-label').textContent = `${data.length} notes across ${new Set(data.map((x) => x.folder)).size} folders`;
    if (state.brainTab === 'base') renderTable(data); else if (state.brainTab === 'files') renderFiles(data); else renderGraph(data);
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
  $('#agent-schedule-text').textContent = info.schedule; $('#agent-timezone-text').textContent = info.timezone;
  $('#agent-status-title').textContent = info.busy ? 'Your brain is working right now' : 'Automatic check is scheduled';
  $('#agent-status-copy').textContent = info.busy ? 'The local agent is sorting notes or answering a question.' : 'The agent checks your local Inbox and updates its daily log during active hours.';
  $('#agent-activity').innerHTML = state.events.length ? state.events.slice(0,8).map((item) => `<div class="agent-event"><span class="activity-marker"></span><div><strong>${esc(item.title)}</strong><small>${esc(item.text)}</small></div><time>${new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(item.time)}</time></div>`).join('') : '<div class="empty-state">No runs yet. Your schedule is active.</div>';
}
async function loadAgents() { await loadOverview(); renderAgentStatus(); }
function renderFiles(files) { $('#brain-panel').innerHTML = files.length ? `<div class="file-grid">${files.map((file) => `<article class="file-card" data-note="${esc(file.path)}"><div class="file-card-top"><span class="file-icon">▤</span><div><strong>${esc(file.name)}</strong><small>${esc(file.folder)} · ${relativeDate(file.modified)}</small></div></div><p>${(file.bytes / 1024).toFixed(1)} KB · Open note</p></article>`).join('')}</div>` : '<div class="empty-state">No Markdown notes in this vault yet.</div>'; bindNotes(); }
function renderTable(files) { $('#brain-panel').innerHTML = files.length ? `<table class="brain-table"><thead><tr><th>Name</th><th>Folder</th><th>Size</th><th>Last modified</th></tr></thead><tbody>${files.map((file) => `<tr><td data-note="${esc(file.path)}">${esc(file.name)}</td><td>${esc(file.folder)}</td><td>${(file.bytes / 1024).toFixed(1)} KB</td><td>${new Date(file.modified).toLocaleDateString()}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">Your notes will appear here.</div>'; bindNotes(); }
async function renderGraph(files) {
  const sample = files.slice(0, 28); const notes = await Promise.all(sample.map(async (f) => { try { return { ...f, text: (await api(`/api/brain/note?path=${encodeURIComponent(f.path)}`)).content }; } catch { return { ...f, text: '' }; } }));
  const centers = notes.slice(0, 16); const mid = Math.floor(centers.length / 2); const linkIndex = new Map(centers.map((n, i) => [n.name.toLowerCase(), i]));
  const links = [];
  for (const [i, note] of centers.entries()) for (const [, raw] of note.text.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)) { const j = linkIndex.get(raw.trim().replace(/\.md$/i, '').split('/').pop().toLowerCase()); if (j !== undefined && j !== i && !links.some(([a,b]) => a === i && b === j || a === j && b === i)) links.push([i,j]); }
  const positions = centers.map((_, i) => { const angle = (Math.PI * 2 * i / Math.max(centers.length, 1)) - Math.PI / 2; const radius = i === 0 ? 0 : .36 + (i % 3) * .06; return { x: i === 0 ? 50 : 50 + Math.cos(angle) * radius * 100, y: i === 0 ? 50 : 50 + Math.sin(angle) * radius * 74 }; });
  $('#brain-panel').innerHTML = centers.length ? `<div class="graph-view"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${links.map(([a,b]) => `<line x1="${positions[a].x}" y1="${positions[a].y}" x2="${positions[b].x}" y2="${positions[b].y}" stroke="#cbd5c8" stroke-width=".22"/>`).join('')}</svg>${centers.map((n,i) => `<button class="graph-node ${i === 0 ? 'central' : ''}" style="left:${positions[i].x}%;top:${positions[i].y}%" data-note="${esc(n.path)}">${esc(n.name)}</button>`).join('')}<span class="graph-caption">${links.length} explicit note links · select a note to open</span></div>` : '<div class="empty-state">No notes yet. Ingest a note to begin.</div>'; bindNotes();
}
function bindNotes() { $$('[data-note]').forEach((el) => { if (el.dataset.noteBound) return; el.dataset.noteBound = 'true'; el.addEventListener('click', () => openNote(el.dataset.note)); }); }
async function openNote(file) { try { const note = await api(`/api/brain/note?path=${encodeURIComponent(file)}`); $('#modal-title').textContent = file; $('#modal-content').textContent = note.content; $('#modal').hidden = false; } catch (error) { toast('Could not open note', error.message, 'error'); } }
async function loadReview() {
  try { const items = await api('/api/review'); $('#review-count').textContent = items.length; $('#attention-total').textContent = items.length; $('#review-panel').innerHTML = items.length ? items.map((item) => `<div class="review-row"><span class="review-icon">↳</span><div class="review-copy"><strong>${esc(item.source)}</strong><p>${esc(item.message)}</p><div class="review-guidance-wrap"><input class="review-guidance" data-source="${esc(item.source)}" placeholder="Add a correction or exact destination path…"><button class="secondary-button retry-review" data-source="${esc(item.source)}">Resolve →</button></div></div><span class="review-status">${esc(item.status.replace('_',' '))}</span></div>`).join('') : '<div class="empty-state" style="margin-top:18px">Nothing needs review. The inbox is clear.</div>'; $$('.retry-review').forEach((button) => button.addEventListener('click', () => retryReview(button.dataset.source))); }
  catch (error) { $('#review-panel').innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; }
}
async function retryReview(source) { const input = $(`.review-guidance[data-source="${CSS.escape(source)}"]`); const guidance = input?.value.trim(); if (!guidance) { toast('A little guidance needed', 'Add a destination path or short correction first.', 'error'); input?.focus(); return; } const button = $(`.retry-review[data-source="${CSS.escape(source)}"]`); button.disabled = true; button.textContent = 'Working…'; try { await api('/api/review/retry', { method: 'POST', body: JSON.stringify({ source, guidance }) }); toast('Note resolved', 'The inbox compiler has handled your guidance.'); loadReview(); loadOverview(); } catch (error) { toast('Could not resolve note', error.message, 'error'); button.disabled = false; button.textContent = 'Resolve →'; } }
async function runIngest(button = $('#ingest-now')) { button.disabled = true; const old = button.textContent; button.textContent = 'Processing…'; try { const stats = await api('/api/ingest', { method: 'POST', body: '{}' }); toast('Inbox processed', `${stats.created} created · ${stats.updated} updated · ${stats.needsReview} to review`); await loadOverview(); await loadReview(); } catch (error) { toast('Ingestion paused', error.message, 'error'); } finally { button.disabled = false; button.textContent = old; } }
async function runHeartbeat(button) { button.disabled = true; const old = button.textContent; button.textContent = 'Checking…'; try { const result = await api('/api/heartbeat', { method: 'POST', body: '{}' }); const stats = result.ingestion; toast('Brain check complete', `${stats.scanned} notes checked · ${stats.created} created · ${stats.needsReview} to review`); await loadOverview(); } catch (error) { toast('Brain check couldn’t finish', error.message, 'error'); } finally { button.disabled = false; button.textContent = old; } }
async function runVaultAudit(button) { button.disabled = true; const old = button.textContent; button.textContent = 'Linting…'; try { const report = await api('/api/audit', { method: 'POST', body: '{}' }); toast('Vault lint complete', `${report.filesScanned} notes · ${report.summary.errors} errors · ${report.summary.warnings} warnings`); await loadOverview(); } catch (error) { toast('Vault lint failed', error.message, 'error'); } finally { button.disabled = false; button.textContent = old; } }
async function newSession() { try { const session = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ name: 'New conversation' }) }); state.sessions.unshift(session); await loadSession(session.id); await refreshSessions(); $('#chat-title').textContent = 'A little more room to think.'; switchView('assistant'); $('#prompt').focus(); } catch (error) { toast('Could not start conversation', error.message, 'error'); } }

document.addEventListener('click', async (event) => {
  const session = event.target.closest('[data-session]'); if (session) { if (!state.busy) { await loadSession(session.dataset.session); switchView('assistant'); $('#history-dialog').close(); } return; }
  const finding = event.target.closest('[data-review-finding]'); if (finding) { try { reviewLintFinding(JSON.parse(finding.dataset.reviewFinding)); } catch { toast('Could not open lint review', 'The finding details were invalid.', 'error'); } return; }
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
$('#run-heartbeat').addEventListener('click', (event) => runHeartbeat(event.currentTarget)); $('#settings-run').addEventListener('click', (event) => runHeartbeat(event.currentTarget)); $('#ingest-now').addEventListener('click', (event) => runIngest(event.currentTarget)); $('#activity-refresh').addEventListener('click', () => { loadOverview(); toast('Activity refreshed', 'Your local brain is up to date.'); });
$('#audit-run').addEventListener('click', (event) => runVaultAudit(event.currentTarget));
$('#agent-run').addEventListener('click', (event) => runHeartbeat(event.currentTarget)); $('#agent-ingest').addEventListener('click', () => runIngest($('#agent-ingest')));
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
