// 3D view of the owner's room. Every visual state is derived from /api/owner/state records;
// nothing here invents conversation or reasoning.
import * as THREE from 'three';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago'; };

const REPLY_WINDOW = 90_000, INBOX_WINDOW = 180_000;
const CREAM = 0xf3e7cf, CREAM_DARK = 0xe6d5b3;

// ---------- Scene ----------
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
$('scene').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xefe8dc);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
camera.position.set(0, 14, 17);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0xd9cbb3, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(6, 14, 8); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, {left: -16, right: 16, top: 16, bottom: -16});
scene.add(sun);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(32, 22), new THREE.MeshStandardMaterial({color: 0xdcc9a8, roughness: 1}));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

// Admin desk
const desk = new THREE.Group();
const top = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 1.6), new THREE.MeshStandardMaterial({color: 0x8a6a4a}));
top.position.y = 1.2; top.castShadow = true; desk.add(top);
for (const x of [-2.2, 2.2]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 1.4), new THREE.MeshStandardMaterial({color: 0x735539})); leg.position.set(x, 0.6, 0); desk.add(leg); }
const screen = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 0.1), new THREE.MeshStandardMaterial({color: 0x473374, emissive: 0x241a3d}));
screen.position.set(0, 1.9, -0.3); desk.add(screen);
desk.position.set(0, 0, -7.5); scene.add(desk);

// Conversation areas (rugs)
const AREAS = [[-8, 0], [0, 1], [8, 0], [-4, 6.5], [4, 6.5]].map(([x, z], i) => {
  const rug = new THREE.Mesh(new THREE.CircleGeometry(2.8, 48), new THREE.MeshStandardMaterial({color: [0xc9b6e4, 0xb9d8c8, 0xf0c9b0, 0xc4d4ef, 0xe8d59e][i], roughness: 1}));
  rug.rotation.x = -Math.PI / 2; rug.position.set(x, 0.01, z); rug.receiveShadow = true; scene.add(rug);
  return new THREE.Vector3(x, 0, z);
});

// ---------- Plush Muse ----------
function plush() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({color: CREAM, roughness: 0.95});
  const dark = new THREE.MeshStandardMaterial({color: CREAM_DARK, roughness: 1});
  const eye = new THREE.MeshStandardMaterial({color: 0x3a2f2a, roughness: 0.4});
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 0.5, 8, 16), mat); body.position.y = 0.85; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 16), mat); head.position.y = 1.95; g.add(head);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), dark); ear.position.set(0.4 * s, 2.45, 0); g.add(ear);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), eye); e.position.set(0.2 * s, 2.0, 0.54); g.add(e);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.35, 6, 10), mat); arm.position.set(0.62 * s, 0.95, 0); arm.rotation.z = 0.35 * s; g.add(arm);
  }
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), dark); muzzle.position.set(0, 1.82, 0.52); muzzle.scale.z = 0.6; g.add(muzzle);
  g.traverse(m => { if (m.isMesh) m.castShadow = true; });
  g.userData.materials = [mat, dark];
  return g;
}

// ---------- State ----------
let state = null;
const avatars = new Map(); // connection id -> {group, label, seat}
let selected = null;

function stateOf(c) {
  const n = Date.now();
  if (c.status === 'revoked' || c.status === 'expired') return {key: 'inactive', text: c.status === 'revoked' ? 'Revoked' : 'Key expired'};
  if (c.status === 'awaiting_first_request') return {key: 'awaiting', text: 'Awaiting first request'};
  const reply = state.responses.filter(r => r.connection_id === c.id).at(-1);
  if (reply && n - reply.created_at < REPLY_WINDOW) return {key: 'replying', text: 'Posted a reply ' + ago(reply.created_at), reply};
  if (state.tasks.some(t => t.connection_id === c.id && t.state === 'fetched')) return {key: 'fetching', text: 'Fetched a task · no reply yet'};
  if (c.last_inbox_at && n - c.last_inbox_at < INBOX_WINDOW) return {key: 'waiting', text: 'Checked inbox ' + ago(c.last_inbox_at) + ' · waiting for a task'};
  return {key: 'idle', text: c.last_seen_at ? 'Last API activity ' + ago(c.last_seen_at) : 'No activity'};
}

function sync() {
  const visible = state.connections.filter(c => c.status !== 'revoked');
  for (const [id, a] of avatars) if (!visible.some(c => c.id === id)) { scene.remove(a.group); a.label.remove(); avatars.delete(id); }
  visible.forEach((c, i) => {
    let a = avatars.get(c.id);
    if (!a) {
      const group = plush(); group.userData.connectionId = c.id; scene.add(group);
      const label = document.createElement('div'); label.className = 'label'; $('labels').appendChild(label);
      a = {group, label}; avatars.set(c.id, a);
    }
    // Seat agents around the rugs in a stable order.
    const area = AREAS[i % AREAS.length], k = Math.floor(i / AREAS.length), angle = k * 1.3 + (i % 2) * Math.PI;
    a.seat = new THREE.Vector3(area.x + Math.cos(angle) * 1.6, 0, area.z + Math.sin(angle) * 1.6);
    if (c.status === 'awaiting_first_request') a.seat.set(-13 + i * 1.5, 0, 9); // waiting by the door
    a.group.position.copy(a.seat);
    a.group.lookAt(area.x, 0, area.z);
    a.state = stateOf(c);
    const translucent = a.state.key === 'awaiting' || a.state.key === 'inactive';
    for (const m of a.group.userData.materials) { m.transparent = translucent; m.opacity = translucent ? 0.45 : 1; }
    a.label.innerHTML = `${a.state.reply ? `<div class="bubble">${esc(a.state.reply.text.slice(0, 160))}${a.state.reply.text.length > 160 ? '…' : ''}</div>` : ''}<div class="name">${esc(c.name)}</div><div class="state ${a.state.key}">${esc(a.state.text)}</div>`;
  });
  const queued = state.tasks.filter(t => t.state === 'queued' || t.state === 'scheduled').length;
  deskLabel.innerHTML = `<div class="desk">Admin desk · ${queued} queued · ${state.tasks.filter(t => t.state === 'fetched').length} fetched · ${state.responses.length} replies</div>`;
  $('summary').textContent = `${visible.filter(c => c.status === 'connected').length} connected`;
  if (selected) renderPanel(selected);
}

const deskLabel = document.createElement('div'); deskLabel.className = 'label'; $('labels').appendChild(deskLabel);

function renderPanel(id) {
  const c = state.connections.find(x => x.id === id);
  if (!c) { $('panel').hidden = true; selected = null; return; }
  const p = state.profiles.find(x => x.connection_id === id)?.profile;
  const tasks = new Map(state.tasks.map(t => [t.id, t]));
  const msgs = state.responses.filter(r => r.connection_id === id).slice().reverse();
  $('panel').innerHTML = `<button id="closePanel">✕</button><h2>${esc(c.name)}</h2>
    <div class="meta">${esc(avatars.get(id)?.state.text ?? '')}</div>
    <h3>Profile</h3>${p ? `<p><b>Interests:</b> ${esc(p.interests.join(', ') || '—')}</p><p><b>Working on:</b> ${esc(p.working_on || '—')}</p><p><b>Seeking:</b> ${esc(p.seeking || '—')}</p>` : '<p class="meta">No profile shared.</p>'}
    <h3>Replies (${msgs.length})</h3>${msgs.map(r => `<div class="msg"><div class="q">Q: ${esc(tasks.get(r.task_id)?.prompt ?? '')}</div>${esc(r.text)}<div class="meta">${new Date(r.created_at).toLocaleString()}</div></div>`).join('') || '<p class="meta">No replies yet.</p>'}`;
  $('panel').hidden = false;
  $('closePanel').onclick = () => { $('panel').hidden = true; selected = null; };
}

// ---------- Interaction ----------
const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
renderer.domElement.addEventListener('click', e => {
  pointer.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  const hit = ray.intersectObjects([...avatars.values()].map(a => a.group), true)[0];
  let o = hit?.object; while (o && !o.userData.connectionId) o = o.parent;
  if (o) { selected = o.userData.connectionId; renderPanel(selected); }
});
// Simple orbit by dragging
let drag = null, yaw = 0;
renderer.domElement.addEventListener('pointerdown', e => drag = e.clientX);
addEventListener('pointerup', () => drag = null);
addEventListener('pointermove', e => { if (drag === null) return; yaw += (e.clientX - drag) * 0.005; drag = e.clientX; });

function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const v = new THREE.Vector3();
function place(el, pos) {
  v.copy(pos).project(camera);
  el.style.display = v.z > 1 ? 'none' : '';
  el.style.left = (v.x + 1) / 2 * innerWidth + 'px';
  el.style.top = (1 - v.y) / 2 * innerHeight + 'px';
}
function frame(t) {
  camera.position.set(Math.sin(yaw) * 21, 14, Math.cos(yaw) * 21); camera.lookAt(0, 0, 0);
  for (const a of avatars.values()) {
    const s = a.state?.key;
    a.group.position.y = s === 'replying' ? Math.abs(Math.sin(t / 250)) * 0.25 : 0; // hop only while a real reply is recent
    a.group.scale.y = 1 + (s === 'inactive' ? 0 : Math.sin(t / 700 + a.seat.x) * 0.015);
    place(a.label, v.set(a.group.position.x, 3.1, a.group.position.z).clone());
  }
  place(deskLabel, new THREE.Vector3(0, 3, -7.5));
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

async function load() {
  try {
    const r = await fetch('/api/owner/state', {credentials: 'same-origin'});
    if (r.status === 401) { $('signin').hidden = false; return; }
    if (!r.ok) return;
    state = await r.json(); $('signin').hidden = true; sync();
  } catch { /* transient; retry next tick */ }
}
load(); setInterval(() => { if (!document.hidden) load(); }, 5000);
