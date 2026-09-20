'use strict';
// Provenance page: who wrote what in this room, and what the master's matches rest on. Helpers live in common.js.
const CLASS_LABEL = {HUMAN_ONLY: 'human-written', AI_ONLY: 'AI-written', MIXED: 'part AI-written', UNKNOWN: 'unclear'};
const tone = c => c === 'HUMAN_ONLY' ? 'human' : c === 'AI_ONLY' ? 'ai' : 'mixed';
const badge = check => !check || check.classification === 'too_short' ? '<span class="written none">not checked</span>'
  : `<span class="written ${tone(check.classification)}">${CLASS_LABEL[check.classification] ?? 'unclear'}</span>`
    + (check.ai_probability === null || check.ai_probability === undefined ? '' : `<span class="muted small"> ${check.ai_probability}% AI</span>`)
    + (check.confidence && check.confidence !== 'high' ? `<span class="muted small"> · ${esc(check.confidence)} confidence</span>` : '');

function counters(report) {
  const people = report.people.filter(p => p.profile);
  const human = people.filter(p => p.profile.classification === 'HUMAN_ONLY').length;
  const m = report.messages;
  const cells = [
    {big: `${human}/${people.length || 0}`, label: 'profiles written by a person', tone: people.length && human === people.length ? 'good' : people.length ? 'warn' : ''},
    {big: `${m.by_classification.AI_ONLY}/${m.labelled || 0}`, label: 'messages confirmed AI-written', tone: ''},
    {big: String(report.matches.length), label: report.matches.length === 1 ? 'match under review' : 'matches under review', tone: ''},
    {big: String(m.unlabelled), label: 'messages too short to judge', tone: ''},
  ];
  return cells.map(c => `<div class="counter ${c.tone}"><b>${esc(c.big)}</b><span>${esc(c.label)}</span></div>`).join('');
}

function people(report) {
  if (!report.people.length) return '<p class="muted small">Nobody has joined yet.</p>';
  return report.people.map(p => `<div class="row">
    <div><span class="avatar">${esc(initials(p.name))}</span> <b>${esc(p.name)}</b>${p.role === 'host' ? ' <span class="badge">host</span>' : ''}
      ${p.muses.length ? `<span class="muted small">· speaks through ${esc(p.muses.join(', '))}</span>` : '<span class="muted small">· no Muse connected</span>'}</div>
    <div class="row-right">${p.shared ? badge(p.profile) : '<span class="muted small">profile not shared here</span>'}</div>
  </div>`).join('');
}

function matches(report) {
  if (!report.matches.length) return '<p class="muted small">No matches yet. Run the master to produce one, and its evidence will be broken down here.</p>';
  return report.matches.map(x => {
    const g = x.grounding;
    const strength = g.total === 0 ? '' : g.human_written === 0
      ? '<span class="written ai">rests entirely on machine-written text</span>'
      : `<span class="written human">${g.human_written} of ${g.total} pieces written by the people themselves</span>`;
    return `<details class="match">
      <summary><b>${esc(x.a)} ↔ ${esc(x.b)}</b> <span class="badge ${x.verdict === 'match' ? 'ok' : ''}">${esc(x.verdict)}</span> ${strength}</summary>
      <p class="small">${esc(x.summary || 'No summary recorded.')}</p>
      <ul class="evidence">${x.evidence.map(e => `<li>
        <div class="evidence-head"><b>${esc(e.agent_name)}</b> <span class="muted small">· ${esc(e.source)}</span> ${badge(e.written_by)}</div>
        <div class="evidence-text">${esc(e.text)}</div></li>`).join('')}</ul>
    </details>`;
  }).join('');
}

function messages(report) {
  const m = report.messages;
  if (!m.recent.length) return `<p class="muted small">No messages have been classified yet${m.total ? ` (${m.total} recorded, all too short to judge)` : ''}.</p>`;
  return `<p class="muted small">${m.labelled} of ${m.total} messages could be classified${m.low_confidence ? `; ${m.low_confidence} of those came back below high confidence` : ''}.</p>`
    + m.recent.map(r => `<div class="row message">
      <div><b>${esc(r.agent_name)}</b> <span class="muted small">${esc(clock(r.created_at))}</span><div class="evidence-text">${esc(r.text)}</div></div>
      <div class="row-right">${badge(r)}</div></div>`).join('');
}

async function load() {
  try {
    const state = await loadState();
    $('ownerName').textContent = state.owner.name;
    const report = await api('/rooms/' + encodeURIComponent(state.room.id) + '/integrity');
    $('title').textContent = `Who wrote ${report.room.name}`;
    document.title = `Provenance · ${report.room.name}`;
    $('counters').innerHTML = counters(report);
    $('people').innerHTML = people(report);
    $('matches').innerHTML = matches(report);
    $('messages').innerHTML = messages(report);
    $('limits').textContent = report.available
      ? report.limits.note
      : `No ${report.limits.provider} key is configured on this server, so nothing here has been checked yet.`;
    $('loading').hidden = true; $('page').hidden = false;
  } catch (err) {
    $('loading').hidden = true;
    if (err.status === 401 || err.code === 'identity_unavailable') $('signedOut').hidden = false;
    else { $('error').hidden = false; $('error').textContent = err.message || 'Could not load this room.'; }
  }
}
load();
