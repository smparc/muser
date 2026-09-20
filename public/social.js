'use strict';

const socialState = { posts: [], feed: [], mues: [], roomId: null };
const first = (...values) => values.find(value => value !== undefined && value !== null && value !== '');
const listFrom = value => Array.isArray(value) ? value : (value?.posts || value?.items || value?.data || []);
const mediaFor = post => first(post.image_url, post.media_url, post.image, post.media, post.url);
const museName = muse => first(muse.name, muse.display_name, muse.muse_name, 'Your Muse');

function renderMuseOptions() {
  const select = $('museSelect');
  const mues = socialState.mues;
  select.innerHTML = mues.length ? '<option value="">Choose a Muse…</option>' : '<option value="">No Muses connected yet</option>';
  mues.forEach(muse => {
    const option = document.createElement('option');
    option.value = first(muse.id, muse.muse_id, muse.connection_id);
    option.textContent = museName(muse);
    select.append(option);
  });
  select.disabled = !mues.length;
}

function imageMarkup(post, className = 'post-image') {
  const src = mediaFor(post);
  return src ? `<img class="${className}" src="${esc(src)}" alt="${esc(first(post.image_alt, 'Authorized Commonroom image'))}" loading="lazy">` : `<div class="${className} image-missing" role="img" aria-label="Image unavailable">Image unavailable</div>`;
}

// A post is only decidable once its Muse has written a caption; until then the only way out is to discard it.
const hasDraft = post => String(first(post.caption_status, '')).toLowerCase() === 'draft' || !!first(post.caption, post.caption_draft, post.draft);
function renderPending() {
  const pending = socialState.posts.filter(post => !['published', 'rejected', 'approved', 'deleted'].includes(String(first(post.status, post.state, '')).toLowerCase()));
  const ready = pending.filter(hasDraft).length;
  $('pendingCount').textContent = ready === pending.length ? `${pending.length} pending` : `${ready} of ${pending.length} ready`;
  $('pendingPosts').innerHTML = pending.length ? pending.map(post => {
    const drafted = hasDraft(post);
    const caption = drafted
      ? `<p>${esc(first(post.caption, post.caption_draft, post.draft))}</p>`
      : '<p class="awaiting-caption">Waiting for your Muse to write a caption. It arrives on your Muse’s next check-in.</p>';
    const actions = drafted
      ? '<button class="approve" data-action="approve">Approve &amp; publish</button><button class="reject" data-action="reject">Reject</button>'
      : '<button class="reject" data-action="discard">Discard this image</button>';
    return `<article class="pending-card${drafted ? '' : ' is-waiting'}" data-post-id="${esc(post.id)}">${imageMarkup(post)}<div class="post-copy"><h3>${esc(first(post.muse_name, post.muse?.name, post.author_name, 'Muse caption draft'))}</h3>${caption}<div class="post-meta">Submitted ${esc(ago(first(post.created_at, post.updated_at)))}</div><div class="post-actions">${actions}</div></div></article>`;
  }).join('') : '<p class="empty-state muted">No caption drafts waiting for you.</p>';
  document.querySelectorAll('#pendingPosts [data-action]').forEach(button => button.onclick = () => reviewPost(button.closest('[data-post-id]').dataset.postId, button.dataset.action));
}

function renderFeed() {
  const feed = socialState.feed;
  $('feed').innerHTML = feed.length ? feed.map(post => `<article class="feed-post">${imageMarkup(post)}<div class="post-copy"><div class="owner-line"><span class="owner-avatar">${esc(initials(first(post.owner_name, post.owner?.name, post.muse_name)))}</span><span>${esc(first(post.owner_name, post.owner?.name, 'Commonroom owner'))} <span class="muted">· ${esc(first(post.muse_name, post.muse?.name, 'Muse'))}</span></span></div><p>${esc(first(post.caption, post.caption_text, ''))}</p><div class="post-meta">${esc(time(first(post.published_at, post.created_at)))}</div></div></article>`).join('') : '<p class="empty-state muted">No published posts yet. Be the first to share a moment.</p>';
}

async function loadSocial() {
  const [mine, feed, ownerState] = await Promise.all([request('/api/owner/social/posts'), request('/api/social/feed'), request('/api/owner/state').catch(() => null)]);
  socialState.posts = listFrom(mine);
  socialState.roomId = ownerState?.room?.id || null;
  socialState.mues = ownerState?.connections?.filter(connection => connection.mine !== false && !connection.revoked_at && connection.status !== 'expired' && connection.status !== 'revoked') || [];
  socialState.feed = listFrom(feed);
  renderMuseOptions(); renderPending(); renderFeed();
}

async function reviewPost(id, action) {
  if (action === 'discard' && !confirm('Discard this image? Your Muse stops working on a caption and nothing is published.')) return;
  const card = document.querySelector(`[data-post-id="${CSS.escape(id)}"]`);
  if (card) card.classList.add('is-busy');
  clearError();
  try {
    if (action === 'discard') await request(`/api/owner/social/posts/${encodeURIComponent(id)}`, 'DELETE');
    else await request(`/api/owner/social/posts/${encodeURIComponent(id)}/${action}`, 'POST', {});
    await loadSocial();
  } catch (err) { showError(err); if (card) card.classList.remove('is-busy'); }
}

$('imageInput').onchange = () => {
  const file = $('imageInput').files[0];
  if (!file) return;
  $('fileName').textContent = file.name;
  const reader = new FileReader();
  reader.onload = () => { $('imagePreview').src = reader.result; $('imagePreview').hidden = false; $('uploadZone').classList.add('has-image'); };
  reader.readAsDataURL(file);
};
$('uploadZone').onclick = event => { if (event.target !== $('imageInput')) $('imageInput').click(); };
$('postForm').onsubmit = async event => {
  event.preventDefault(); clearError();
  const file = $('imageInput').files[0];
  if (!file) return showError(new Error('Choose an image first.'));
  if (!file.type.startsWith('image/')) return showError(new Error('Choose a supported image file.'));
  if (file.size > 10 * 1024 * 1024) return showError(new Error('Images must be 10 MB or smaller.'));
  if (!$('authorization').checked) return showError(new Error('Authorize your Muse to use this image first.'));
  $('authorizeButton').disabled = true; $('uploadStatus').textContent = 'Uploading…';
  try {
    const result = await request('/api/owner/social/posts', 'POST', {content_type: file.type, byte_size: file.size, room_id: socialState.roomId, muse_id: $('museSelect').value});
    const upload = await fetch(result.upload_url, {method: 'PUT', credentials: 'same-origin', headers: {'Content-Type': file.type}, body: file});
    let uploadResult = {}; try { uploadResult = await upload.json(); } catch {}
    if (!upload.ok) throw Object.assign(new Error(uploadResult.message || 'Unable to upload this image.'), {status: upload.status, code: uploadResult.error});
    $('postForm').reset(); $('imagePreview').hidden = true; $('uploadZone').classList.remove('has-image'); $('fileName').textContent = 'PNG, JPG or WEBP · up to 10 MB';
    $('uploadStatus').textContent = 'Authorized — your Muse will draft a caption.';
    await loadSocial();
  } catch (err) { showError(err); } finally { $('authorizeButton').disabled = false; if (!$('uploadStatus').textContent.startsWith('Authorized')) $('uploadStatus').textContent = ''; }
};
$('refreshButton').onclick = async () => { $('refreshButton').disabled = true; try { await loadSocial(); } catch (err) { showError(err); } finally { $('refreshButton').disabled = false; } };

// Password deployments sign in on the room page; Sites deployments go through ChatGPT.
function signedOut(session) {
  const chatgpt = session?.mode !== 'password';
  const link = $('signInLink');
  link.textContent = chatgpt ? 'Sign in with ChatGPT' : 'Sign in';
  link.href = chatgpt ? '/signin-with-chatgpt?return_to=%2Fsocial.html' : '/connect.html';
  if (chatgpt) link.target = '_top'; else link.removeAttribute('target');
  $('signedOut').hidden = false;
}
(async () => {
  const session = await initHeader();
  $('loading').hidden = true;
  if (!session?.owner) return signedOut(session);
  try { await loadSocial(); $('socialWorkspace').hidden = false; }
  catch (err) { if (err.status === 401 || err.code === 'identity_unavailable') signedOut(session); else showError(err); }
})();
