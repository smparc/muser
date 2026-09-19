'use strict';
// Helpers shared by the Room (connect.html) and Profile (profile.html) pages.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = t => t ? new Date(t).toLocaleString() : '—';
const clock = t => new Date(t).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
const ago = t => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
};
const initials = name => String(name || '?').replace(/'s muse$/i, '').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

async function request(path, method = 'GET', data) {
  const r = await fetch(path, {method, credentials: 'same-origin', headers: data ? {'Content-Type': 'application/json'} : {}, body: data ? JSON.stringify(data) : undefined});
  let b;
  try { b = await r.json(); } catch { throw Error('The server returned an unexpected response. Refresh and try again.'); }
  if (!r.ok) { const err = new Error(b.message || 'Request failed'); err.status = r.status; err.code = b.error; throw err; }
  return b;
}
const api = (path, method, data) => request('/api/owner' + path, method, data);

// Selected room is a per-browser convenience only; the server decides what each owner may see.
const ROOM_KEY = 'commonroom.room';
let currentRoom = (() => { try { return localStorage.getItem(ROOM_KEY); } catch { return null; } })();
function selectRoom(id) { currentRoom = id; try { id ? localStorage.setItem(ROOM_KEY, id) : localStorage.removeItem(ROOM_KEY); } catch {} }
async function loadState() {
  try { return await api('/state' + (currentRoom ? '?room=' + encodeURIComponent(currentRoom) : '')); }
  catch (err) { if (err.code !== 'room_not_found') throw err; selectRoom(null); return api('/state'); }
}

function showError(err) { $('error').hidden = false; $('error').textContent = err.message; }
function clearError() { $('error').hidden = true; }
async function copy(button, text) {
  const label = button.textContent;
  try { await navigator.clipboard.writeText(text); button.textContent = 'Copied'; setTimeout(() => button.textContent = label, 1500); }
  catch { showError(new Error('Clipboard unavailable. Select and copy manually.')); }
}

// Header: signed-in name and sign-out (password mode only; Sites mode signs out through the platform).
async function initHeader() {
  let session = null;
  try { session = await request('/api/auth/session'); } catch { session = {mode: 'chatgpt', owner: null}; }
  if (session.owner) $('ownerName').textContent = session.owner.name;
  $('signOut').hidden = !(session.mode === 'password' && session.owner);
  $('signOut').onclick = async () => {
    await request('/api/auth/logout', 'POST', {}).catch(() => {});
    location.href = '/connect.html';
  };
  return session;
}
