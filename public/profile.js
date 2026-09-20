'use strict';
// Profile page: the person's own profile and where it is shared. Helpers live in common.js.
let state = null, ownerName = '', onboarding = null;

const readForm = () => ({
  interests: $('profileInterests').value.split(',').map(x => x.trim()).filter(Boolean),
  working_on: $('profileWorking').value.trim(),
  seeking: $('profileSeeking').value.trim(),
});

function renderPreview() {
  const p = readForm();
  const lines = `${p.interests.length ? `<p><b>Interests:</b> ${esc(p.interests.join(', '))}</p>` : ''}${p.working_on ? `<p><b>Working on:</b> ${esc(p.working_on)}</p>` : ''}${p.seeking ? `<p><b>Looking for:</b> ${esc(p.seeking)}</p>` : ''}`;
  $('preview').innerHTML = `<div class="preview-head"><span class="avatar">${esc(initials(ownerName))}</span><span class="person-name">${esc(ownerName)}</span></div>${lines || '<p class="muted small">Nothing to show yet.</p>'}`;
}

function render() {
  const p = state.my_profile;
  if (!$('profileForm').dataset.dirty) {
    $('profileInterests').value = p ? p.interests.join(', ') : '';
    $('profileWorking').value = p?.working_on ?? '';
    $('profileSeeking').value = p?.seeking ?? '';
  }
  $('profileUpdated').textContent = p ? 'Saved ' + ago(p.updated_at) : 'Not saved yet';
  renderPreview();
  $('sharingList').innerHTML = state.rooms.map(r => `<label class="share-row"><span><b>${esc(r.name)}</b> <span class="muted small">${r.role === 'host' ? 'your room' : 'hosted by ' + esc(r.host_name)}</span></span>
    <input type="checkbox" class="switch" data-room="${esc(r.id)}"${r.profile_shared ? ' checked' : ''}></label>`).join('');
  document.querySelectorAll('[data-room]').forEach(box => box.onchange = async () => {
    box.disabled = true; clearError();
    try { await api('/rooms/' + box.dataset.room + '/sharing', 'PUT', {profile_shared: box.checked}); await load(); }
    catch (err) { box.checked = !box.checked; showError(err); } finally { box.disabled = false; }
  });
}

async function load() {
  state = await loadState();
  ownerName = state.owner.name;
  render();
}

// ---------- What your Muse may use ----------
async function loadSources() {
  onboarding = await api('/onboarding');
  renderSourcePicker($('sourcePicker'), onboarding.catalog, onboarding.sources);
  $('sourcePicker').onchange = syncConsent; syncConsent();
  $('sourcesStatus').textContent = onboarding.authorized_at ? 'Last changed ' + ago(onboarding.authorized_at) : '';
}
// Re-authorization is needed whenever the selection gains an app; removing apps needs no consent.
function syncConsent() {
  const picked = pickedSources($('sourcePicker')), adding = picked.some(s => !onboarding.sources.includes(s));
  $('consentBox').hidden = !adding; if (!adding) $('consent').checked = false;
}
$('sourcesSave').onclick = async () => {
  const sources = pickedSources($('sourcePicker')), adding = sources.some(s => !onboarding.sources.includes(s));
  if (adding && !$('consent').checked) return showError(new Error('Tick the authorization box to add apps.'));
  const removing = onboarding.sources.filter(s => !sources.includes(s));
  if (removing.length && !confirm('Turning off ' + removing.map(id => onboarding.catalog.find(c => c.id === id).label).join(', ') + ' deletes every fact your Muses shared from it, in every room. Continue?')) return;
  $('sourcesSave').disabled = true; clearError();
  try {
    const r = await api('/sources', 'PUT', sources.length ? {sources, authorized: true} : {sources});
    await loadSources();
    $('sourcesStatus').textContent = 'Saved' + (r.removed.length ? ' · facts from removed apps deleted' : '') + (r.sync_tasks_queued ? ` · asked ${r.sync_tasks_queued} Muse${r.sync_tasks_queued === 1 ? '' : 's'} to sync` : '');
  } catch (err) { showError(err); } finally { $('sourcesSave').disabled = false; }
};

$('profileForm').oninput = () => { $('profileForm').dataset.dirty = '1'; renderPreview(); };
$('profileForm').onsubmit = async e => {
  e.preventDefault();
  const body = readForm();
  if (body.interests.length > 10) return showError(new Error('Use at most 10 interests.'));
  if (body.interests.some(x => x.length > 80)) return showError(new Error('Each interest must be 80 characters or fewer.'));
  $('profileSave').disabled = true; clearError();
  try {
    const r = await api('/profile', 'PUT', body);
    delete $('profileForm').dataset.dirty;
    $('profileSave').textContent = r.shared_in_rooms ? `Saved · shared in ${r.shared_in_rooms} room${r.shared_in_rooms === 1 ? '' : 's'}` : 'Saved';
    showWrittenBy(r.authenticity);
    setTimeout(() => $('profileSave').textContent = 'Save profile', 2500);
    await load();
  } catch (err) { showError(err); } finally { $('profileSave').disabled = false; }
};

(async () => {
  await initHeader();
  try {
    await load(); await loadSources(); await loadVoices();
    $('loading').hidden = true; $('profileWorkspace').hidden = false;
  } catch (err) {
    $('loading').hidden = true;
    if (err.status === 401 || err.code === 'identity_unavailable') $('signedOutNote').hidden = false; else showError(err);
  }
})();

// GPTZero reads the profile as you wrote it: the room shows everyone whether their words are their own.
function showWrittenBy(check) {
  const el = $('profileWrittenBy');
  if (!el) return;
  if (!check || check.classification === 'too_short') { el.hidden = true; return; }
  const ai = check.classification === 'AI_ONLY', mixed = check.classification === 'MIXED';
  el.hidden = false;
  el.className = 'status-line ' + (ai ? 'warn' : '');
  el.textContent = ai ? `GPTZero reads this profile as AI-written (${check.ai_probability}% AI). Everyone in your rooms sees that — rewrite it in your own words if that is not what you meant.`
    : mixed ? 'GPTZero reads this profile as partly AI-written. Everyone in your rooms sees that.'
    : 'GPTZero reads this profile as your own words.';
}

// ---------- Your Muse's voice ----------
// A voice belongs to a Muse, not to a room: the choice is keyed to the Muse itself and follows it everywhere,
// so it lives here with the person's other settings rather than in any one room.
async function loadVoices() {
  let catalog;
  try { catalog = await api('/voices'); } catch { return; }
  if (!catalog.available || !catalog.muses.length) {
    // No key on the server, or no Muse connected yet: say nothing rather than showing an empty menu.
    $('voiceCard').hidden = true;
    return;
  }
  $('voiceCard').hidden = false;
  $('voiceList').innerHTML = catalog.muses.map(m => {
    const known = !m.voice_id || catalog.voices.some(v => v.id === m.voice_id);
    const options = ['<option value="">Chosen for me</option>'].concat(catalog.voices.map(v =>
      `<option value="${esc(v.id)}"${v.id === m.voice_id ? ' selected' : ''}>${esc(v.name)}${v.category && v.category !== 'premade' ? ' · ' + esc(v.category) : ''}</option>`));
    return `<label class="voice-row"><span>${esc(m.name)}</span><select data-voice="${esc(m.id)}">${options.join('')}</select></label>`
      + (known ? '' : `<p class="muted small">${esc(m.name)} is set to a voice this server no longer offers. Pick another.</p>`);
  }).join('');
  document.querySelectorAll('[data-voice]').forEach(sel => sel.onchange = async () => {
    const previous = catalog.muses.find(m => m.id === sel.dataset.voice)?.voice_id ?? '';
    sel.disabled = true; clearError(); $('voiceStatus').textContent = 'Saving…';
    try {
      await api('/muses/' + sel.dataset.voice + '/voice', 'PUT', {voice_id: sel.value || null});
      $('voiceStatus').textContent = sel.value ? 'Saved. Your Muse speaks in this voice from its next reply.' : 'Saved. Each room will choose a voice for this Muse.';
      await loadVoices();
    } catch (err) { sel.value = previous; $('voiceStatus').textContent = ''; showError(err); }
    finally { sel.disabled = false; }
  });
}
