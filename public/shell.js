'use strict';
// Shared navigation for the dashboard, profile and interactive room.
(() => {
  const icon = name => `<svg class="ui-icon" aria-hidden="true"><use href="/commons-icons.svg#${name}"></use></svg>`;
  const page = document.body.dataset.page === 'scene' ? 'home' : document.body.dataset.page;
  const roomLink = view => view === 'home' ? '/' : view === 'messages' ? '/room3d.html#messages' : `/connect.html#${view}`;
  const link = (view, label, symbol) => `<a href="${view === 'profile' ? '/profile.html' : view === 'social' ? '/social.html' : view === 'provenance' ? '/integrity.html' : roomLink(view)}" data-nav="${view}" ${view === page ? 'class="active" aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span></a>`;
  const rail = document.createElement('aside');
  rail.className = 'app-rail';
  rail.innerHTML = `<a class="brand-mark" href="/" aria-label="Muser home">${icon('mark')}</a><nav aria-label="Main navigation">${link('home', 'Home', 'home')}${link('social', 'Social', 'globe')}${link('people', 'People', 'people')}${link('spaces', 'Spaces', 'spaces')}${link('messages', 'Messages', 'message')}${link('provenance', 'Provenance', 'spark')}${link('profile', 'Profile', 'profile')}</nav><div class="rail-bottom">${link('settings', 'Settings', 'settings')}</div>`;
  document.body.prepend(rail);
  const header = document.querySelector('.topbar');
  if (header) {
    // Keep the existing account controls and room picker, including their IDs.
    const account = header.querySelector('.who');
    const picker = header.querySelector('#roomSwitch');
    header.replaceChildren();
    header.innerHTML = `<a class="brand" href="/">Muser</a><nav class="top-tabs" aria-label="Explore">${link('home', 'The commons', 'home')}${link('social', 'Social', 'globe')}${link('people', 'Discover', 'people')}${link('projects', 'Projects', 'folder')}</nav><div class="header-account"><span class="app-tag">A place to belong</span></div>`;
    const accountArea = header.querySelector('.header-account');
    if (account) accountArea.append(account);
    else accountArea.insertAdjacentHTML('beforeend', '<a class="account-avatar" href="/profile.html" aria-label="Your profile">' + icon('profile') + '</a>');
    if (picker) document.querySelector('.room-head')?.append(picker);
  }
  const owner = document.getElementById('ownerName');
  if (owner) {
    const avatar = document.createElement('a');
    avatar.className = 'account-avatar'; avatar.href = '/profile.html'; avatar.setAttribute('aria-label', 'Your profile');
    owner.closest('.who').prepend(avatar);
    const update = () => { avatar.textContent = owner.textContent.trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2) || 'M'; };
    new MutationObserver(update).observe(owner, {childList: true, characterData: true, subtree: true}); update();
  }
})();
