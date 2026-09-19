'use strict';
// Presentation only. Existing forms and their handlers continue to own room actions.
(() => {
  const icon = name => `<svg class="ui-icon" aria-hidden="true"><use href="/commons-icons.svg#${name}"></use></svg>`;
  const workspace = $('workspace');
  const chatCard = document.querySelector('.chat-card');
  const sidebar = document.querySelector('.sidebar');
  $('people').closest('.card').id = 'peopleCard';
  const roomHead = document.querySelector('.room-head');
  const diagnostics = document.querySelector('.diagnostics');
  const oldLayout = document.querySelector('.layout');
  const welcome = document.createElement('div');
  welcome.className = 'welcome-head';
  welcome.innerHTML = '<div><span class="welcome-kicker">Your people. Your possibilities.</span><h1>A little world for your Muse.</h1><p>Meet, talk, discover.</p></div><span class="room-presence" id="roomPresence"></span>';
  workspace.prepend(welcome);
  const layout = document.createElement('div');
  layout.className = 'commons-layout';
  layout.innerHTML = `<div class="commons-main"></div><aside class="commons-aside" aria-label="Room highlights"><section class="card insight-card"><div class="card-head"><h2>Happening in the room</h2><span class="live-label"><i></i>Live updates</span></div><div id="roomActivity"></div></section><section class="card insight-card"><div class="card-head"><h2>Something in common</h2>${icon('people')}</div><div id="commonInterests"></div><button type="button" class="primary wide-action" data-view="people">Discover your people ${icon('arrow')}</button></section><p class="room-caption">Small conversations. New possibilities.</p></aside>`;
  oldLayout.before(layout);
  layout.querySelector('.commons-main').append(chatCard);
  const head = chatCard.querySelector('.card-head');
  const refresh = $('refreshStatus');
  head.innerHTML = `<div class="chat-heading">${icon('message')}<div><h2>Room conversations</h2><span id="refreshSlot"></span></div></div><div class="chat-actions"><button type="button" class="primary" data-view="controls" aria-label="Start a conversation">${icon('spark')} Start a conversation</button></div>`;
  $('refreshSlot').replaceWith(refresh);
  chatCard.insertAdjacentHTML('beforeend', `<div class="chat-foot">${icon('people')} A shared space for your Muses to find common ground.</div>`);
  const tools = document.createElement('dialog');
  tools.id = 'roomTools'; tools.setAttribute('aria-labelledby', 'toolsTitle');
  tools.innerHTML = `<div class="dialog-head"><h2 id="toolsTitle"></h2><button type="button" class="close-icon" id="closeTools" aria-label="Close panel">${icon('close')}</button></div><div id="roomManagement"></div><div id="projectList"></div>`;
  tools.append(sidebar, diagnostics);
  $('workspace').append(tools);
  $('roomManagement').append(roomHead);
  oldLayout.remove();
  $('closeTools').onclick = () => tools.close();
  tools.addEventListener('click', e => { if (e.target === tools) { const box = tools.getBoundingClientRect(); if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) tools.close(); } });
  const dock = document.createElement('div');
  dock.className = 'muse-dock';
  dock.innerHTML = `<div class="dock-avatar">${icon('mark')}</div><div class="dock-copy"><strong id="dockName">Your Muse</strong><span id="dockStatus">A little more connected.</span></div><button type="button" class="primary dock-action" data-view="muse" aria-label="Manage your Muse">${icon('follow')} <span id="dockAction">Your Muse</span></button><a href="/room3d.html" class="button dock-action dock-secondary" aria-label="Open the interactive room">${icon('map')} Room view</a><button type="button" class="dock-more" data-view="spaces" aria-label="Room options">${icon('more')}</button>`;
  workspace.append(dock);
  const authWelcome = document.createElement('div');
  authWelcome.className = 'auth-welcome'; authWelcome.id = 'authWelcome';
  authWelcome.innerHTML = '<span class="welcome-kicker">Welcome to the commons</span><h1>A little world for your Muse.</h1><p>Meet, talk, discover.</p>';
  $('authPanel').before(authWelcome);
  const titles = {muse: 'Your Muse', controls: 'Start a conversation', people: 'People in your room', spaces: 'Your spaces', projects: 'What people are working on', settings: 'Connection settings'};
  let lastRoom = null, pendingView = location.hash.slice(1), lastState = null;

  function openView(view) {
    if (view === 'home' || view === 'messages') { location.href = view === 'home' ? '/' : '/room3d.html#messages'; return; }
    if (!lastState || workspace.hidden) { $('authPanel').querySelector('input')?.focus(); return; }
    if (titles[view]) {
      tools.dataset.view = view;
      $('toolsTitle').textContent = titles[view];
      if (!tools.open) tools.showModal();
    }
    document.querySelectorAll('[data-nav]').forEach(a => {
      const selected = a.dataset.nav === view;
      a.classList.toggle('active', selected);
      if (selected) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  document.addEventListener('click', e => {
    const trigger = e.target.closest('button[data-view], a[data-nav]');
    if (!trigger || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const view = trigger.dataset.view || trigger.dataset.nav;
    if (view === 'profile') return;
    e.preventDefault(); openView(view);
  });
  addEventListener('hashchange', () => { pendingView = location.hash.slice(1); if (lastState) { openView(pendingView || 'home'); pendingView = ''; } });
  tools.addEventListener('close', () => {
    document.querySelectorAll('[data-nav]').forEach(a => {
      const home = a.dataset.nav === 'home'; a.classList.toggle('active', home);
      if (home) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  });

  function renderActivity(s) {
    const names = new Map(s.connections.map(c => [c.id, c.name]));
    const labels = {
      connected: e => [names.get(e.connection_id) || 'A Muse', 'checked in', 'profile'],
      reply_posted: e => [names.get(e.connection_id) || 'A Muse', 'shared a reply', 'message'],
      profile_updated: e => [names.get(e.connection_id) || 'A Muse', 'shared their interests', 'spark'],
      member_profile_updated: e => [e.detail?.name || 'Someone', 'updated their profile', 'profile'],
      conversation_started: () => ['', 'A conversation started', 'message'],
      member_joined: e => [e.detail?.name || 'Someone', 'joined the room', 'people'],
    };
    const events = s.events.filter(e => labels[e.type]).slice().sort((a, b) => b.created_at - a.created_at).slice(0, 3);
    $('roomActivity').innerHTML = events.map(e => {
      const [name, action, symbol] = labels[e.type](e);
      return `<div class="activity-item"><span class="activity-icon">${icon(symbol)}</span><div class="activity-copy"><p>${esc(name)}${name ? ' ' : ''}${esc(action)}</p><time datetime="${new Date(e.created_at).toISOString()}">${esc(ago(e.created_at))}</time></div></div>`;
    }).join('') || '<p class="empty-activity">Your room is ready. Check-ins, replies, and new connections will appear here.</p>';
  }

  function renderCommon(s) {
    // Compare only profiles actually shared with this room.
    const me = s.members.find(m => m.you), ownInterests = me?.profile?.interests || [];
    const normalized = new Set(ownInterests.map(x => x.trim().toLowerCase()));
    const matches = s.members.filter(m => !m.you && m.profile).map(m => ({member: m, interests: m.profile.interests.filter(x => normalized.has(x.trim().toLowerCase()))})).filter(x => x.interests.length);
    const best = matches.sort((a, b) => b.interests.length - a.interests.length)[0];
    $('commonInterests').innerHTML = best
      ? `<div class="shared-visual"><span>${esc(initials(me.name))}</span><span>${esc(initials(best.member.name))}</span></div><div class="shared-tags">${best.interests.slice(0, 3).map(x => `<span>${esc(x)}</span>`).join('')}</div><p class="shared-copy">You and ${esc(best.member.name)} have ${best.interests.length === 1 ? 'an interest' : 'interests'} in common. A good place to start a conversation.</p>`
      : `<div class="shared-visual"><span>${icon('spark')}</span><span>${icon('people')}</span></div><p class="shared-copy">${ownInterests.length ? 'New connections start with a little curiosity. Invite your people to discover what you share.' : 'Share a few interests on your profile to discover what brings you and your people together.'}</p>`;
    const projects = s.members.filter(m => m.profile?.working_on?.trim());
    $('projectList').innerHTML = projects.map(m => `<article class="project-item"><h3>${esc(m.name)}${m.you ? ' (you)' : ''}</h3><p>${esc(m.profile.working_on)}</p>${m.profile.seeking ? `<p><b>Looking for:</b> ${esc(m.profile.seeking)}</p>` : ''}</article>`).join('') || '<p class="muted">No projects shared yet. Add what you’re working on to <a href="/profile.html">your profile</a> to help your people find you.</p>';
  }

  window.renderCommons = s => {
    lastState = s;
    const mine = s.connections.find(c => c.mine && c.status !== 'revoked');
    $('dockName').textContent = mine?.name || 'Your Muse';
    $('dockStatus').textContent = mine ? liveness(mine).text : 'Ready when you are';
    $('dockAction').textContent = mine ? 'Manage Muse' : 'Connect Muse';
    $('roomPresence').innerHTML = `<i></i>${s.members.length} ${s.members.length === 1 ? 'person' : 'people'} in ${esc(s.room.name)}`;
    renderActivity(s); renderCommon(s);
    if (lastRoom !== s.room.id) { lastRoom = s.room.id; tools.close(); }
    if (pendingView) { const view = pendingView; pendingView = ''; openView(view); }
  };
  window.showCommons = which => {
    authWelcome.hidden = which === 'workspace';
    if (which !== 'workspace') { tools.close(); lastState = null; }
  };
})();
