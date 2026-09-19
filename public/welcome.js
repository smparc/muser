'use strict';
// Welcome flow: account → about you (optional) → what your Muse may use (explicit authorization) → connect your Muse.
// The server refuses every other owner route until the sources step is finished. Helpers live in common.js.
let onboarding = null, mode = null, issued = null;
const STEPS = ['account', 'profile', 'sources', 'muse'];

function go(step) {
  $('loading').hidden = true; clearError();
  document.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== step);
  const current = STEPS.indexOf(step === 'chatgpt' ? 'account' : step);
  document.querySelectorAll('#steps li').forEach((li, i) => { li.classList.toggle('done', i < current); li.classList.toggle('current', i === current); });
  if (step === 'profile') fillProfile();
  if (step === 'sources') renderSources();
  if (step === 'muse') renderMuse();
  window.scrollTo(0, 0);
}
async function busy(button, fn) {
  button.disabled = true; clearError();
  try { await fn(); } catch (err) { showError(err); } finally { button.disabled = false; }
}
const loadOnboarding = async () => { onboarding = await api('/onboarding'); };

// ---------- 1. Account ----------
$('signupForm').onsubmit = e => {
  e.preventDefault();
  busy($('signupButton'), async () => {
    const body = {email: $('signupEmail').value, password: $('signupPassword').value, name: $('signupName').value.trim()};
    if (!$('signupCodeLabel').hidden) body.signup_code = $('signupCode').value;
    const r = await request('/api/auth/signup', 'POST', body);
    $('signupPassword').value = '';
    $('ownerName').textContent = r.owner.name; $('signOut').hidden = false;
    await loadOnboarding(); go('profile');
  });
};

// ---------- 2. About you ----------
function fillProfile() {
  const p = onboarding.profile;
  $('profileInterests').value = p ? p.interests.join(', ') : '';
  $('profileWorking').value = p?.working_on ?? '';
  $('profileSeeking').value = p?.seeking ?? '';
}
$('profileForm').onsubmit = e => {
  e.preventDefault();
  const body = {interests: $('profileInterests').value.split(',').map(x => x.trim()).filter(Boolean), working_on: $('profileWorking').value.trim(), seeking: $('profileSeeking').value.trim()};
  if (body.interests.length > 10) return showError(new Error('Use at most 10 interests.'));
  if (body.interests.some(x => x.length > 80)) return showError(new Error('Each interest must be 80 characters or fewer.'));
  busy($('profileSave'), async () => {
    if (body.interests.length || body.working_on || body.seeking) await api('/profile', 'PUT', body);
    await loadOnboarding(); go('sources');
  });
};
$('profileSkip').onclick = () => go('sources');

// ---------- 3. What your Muse may use ----------
function renderSources() {
  renderSourcePicker($('sourcePicker'), onboarding.catalog, onboarding.sources);
  $('consent').checked = false;
  $('sourcePicker').onchange = syncConsent; syncConsent();
}
// The authorization checkbox only matters (and is only required) when at least one app is selected.
function syncConsent() {
  const any = pickedSources($('sourcePicker')).length > 0;
  $('consentBox').classList.toggle('inactive', !any);
  $('consent').disabled = !any;
  $('sourcesSave').textContent = any ? 'Authorize and continue' : 'Continue without apps';
}
$('sourcesBack').onclick = () => go('profile');
$('sourcesSave').onclick = () => {
  const sources = pickedSources($('sourcePicker'));
  if (sources.length && !$('consent').checked) return showError(new Error('Tick the authorization box to let your Muse use the apps you selected, or unselect them.'));
  busy($('sourcesSave'), async () => {
    await api('/sources', 'PUT', sources.length ? {sources, authorized: true} : {sources});
    await api('/onboarding/complete', 'POST', {});
    await loadOnboarding(); go('muse');
  });
};

// ---------- 4. Connect your Muse ----------
function renderMuse() {
  const a = onboarding.authorized;
  $('authorizedSummary').innerHTML = a.length
    ? `<b>Your Muse will be told it may use:</b><ul>${a.map(s => `<li><b>${esc(s.label)}</b> <span class="muted small">${esc(s.may_use)}</span></li>`).join('')}</ul><a href="/profile.html" class="small">Change this later on your Profile page</a>`
    : '<b>You didn’t authorize any apps.</b> <span class="muted small">Your Muse will share only what you tell it. You can add apps later on your Profile page.</span>';
  if (onboarding.muses) { $('museLater').textContent = 'Skip, I already have a Muse connected'; }
}
$('museForm').onsubmit = e => {
  e.preventDefault();
  busy($('museButton'), async () => {
    issued = await api('/connections', 'POST', {agent_name: $('museName').value.trim()});
    $('museForm').hidden = true; $('museIssued').hidden = false;
    $('issuedKey').value = issued.access_token;
    const rows = [['Name', 'Commonroom'], ['Server origin', location.origin], ['Specification', location.origin + '/openapi.json'], ['Authentication', 'HTTP bearer token'], ['MCP (if required)', location.origin + '/mcp']];
    $('setupTable').innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td><code>${esc(v)}</code></td></tr>`).join('');
    $('setupMessage').value = setupMessageFor(issued, onboarding.authorized);
  });
};
$('toggleKey').onclick = () => { const k = $('issuedKey'); k.type = k.type === 'password' ? 'text' : 'password'; $('toggleKey').textContent = k.type === 'password' ? 'Show' : 'Hide'; };
$('copyKey').onclick = () => copy($('copyKey'), $('issuedKey').value);
$('copySetup').onclick = () => copy($('copySetup'), $('setupMessage').value);

// ---------- Start ----------
(async () => {
  const session = await initHeader();
  mode = session.mode;
  $('signOut').onclick = async () => { await request('/api/auth/logout', 'POST', {}).catch(() => {}); location.href = '/welcome.html'; };
  if (!session.owner) {
    if (mode === 'password') { $('signupCodeLabel').hidden = !session.signup_requires_code; go('account'); }
    else go('chatgpt');
    return;
  }
  try {
    await loadOnboarding();
    // Finished people land on the Muse step only if they have none yet; otherwise they belong in their room.
    if (onboarding.completed) { if (onboarding.muses) location.href = '/connect.html'; else go('muse'); }
    else go('profile');
  } catch (err) { $('loading').hidden = true; showError(err); }
})();
