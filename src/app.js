// ============ POLYFILLS (Chrome 44) ============
if (!NodeList.prototype.forEach) { NodeList.prototype.forEach = Array.prototype.forEach; }

// ============ CONFIG ============
const PROXY = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? location.protocol + '//' + location.hostname + ':8080'
  : location.origin + '/api';
const SITE = 'https://forums.jtechforums.org';

// ============ STATE ============
const S = {
  token: localStorage.getItem('jt_session_token') || '',
  csrf: localStorage.getItem('jt_csrf') || '',
  cookies: localStorage.getItem('jt_cookies') || '',
  username: localStorage.getItem('jt_username') || '',
  userId: localStorage.getItem('jt_user_id') || '',
  categories: {},
  drafts: JSON.parse(localStorage.getItem('jt_drafts') || '{}'),
  history: [],
};

function isLoggedIn() { return !!(S.token || S.cookies); }

function saveDraft(key, val) { S.drafts[key] = val; localStorage.setItem('jt_drafts', JSON.stringify(S.drafts)); }
function getDraft(key) { return S.drafts[key] || ''; }
function clearDraft(key) { delete S.drafts[key]; localStorage.setItem('jt_drafts', JSON.stringify(S.drafts)); }

// ============ API ============
async function api(path, opts = {}) {
  const url = PROXY + path;
  const headers = { 'Accept': 'application/json' };
  if (S.token) headers['X-Session-Token'] = S.token;
  if (S.csrf) headers['X-CSRF-Token'] = S.csrf;
  if (S.cookies) headers['X-Cookies'] = S.cookies;
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  // For FormData, don't set Content-Type (browser sets boundary), but keep auth headers
  const mergedHeaders = opts.body instanceof FormData
    ? { ...headers } // no Content-Type override
    : { ...headers, ...(opts.headers || {}) };
  delete opts.headers; // consumed
  const resp = await fetch(url, { ...opts, headers: mergedHeaders });
  // Capture session token and CSRF from response
  const newToken = resp.headers.get('X-Session-Token');
  if (newToken) { S.token = newToken; localStorage.setItem('jt_session_token', newToken); }
  const newCsrf = resp.headers.get('X-CSRF-Token');
  if (newCsrf) { S.csrf = newCsrf; localStorage.setItem('jt_csrf', newCsrf); }
  const newCookies = resp.headers.get('X-Cookies');
  if (newCookies) { S.cookies = newCookies; localStorage.setItem('jt_cookies', newCookies); }
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      S.token = ''; S.csrf = ''; S.cookies = '';
      localStorage.removeItem('jt_session_token'); localStorage.removeItem('jt_csrf'); localStorage.removeItem('jt_cookies');
      location.hash = '#/'; route();
      throw new Error('Session expired. Please log in again.');
    }
    const text = await resp.text();
    let msg;
    try { const j = JSON.parse(text); msg = (j.errors && j.errors.join(', ')) || j.error || text; } catch (e) { msg = text; }
    throw new Error(`${resp.status}: ${msg}`);
  }
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('json')) return resp.json();
  return resp.text();
}

function uploadFile(file, btn) {
  return new Promise((resolve, reject) => {
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = '0%';
    const fd = new FormData(); fd.append('file', file); fd.append('type', 'composer');
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) btn.textContent = Math.round(e.loaded / e.total * 100) + '%';
    });
    xhr.addEventListener('load', () => {
      btn.innerHTML = orig; btn.disabled = false;
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(new Error('Bad response')); }
      } else { reject(new Error('Upload failed (' + xhr.status + ')')); }
    });
    xhr.addEventListener('error', () => { btn.innerHTML = orig; btn.disabled = false; reject(new Error('Upload failed')); });
    xhr.open('POST', PROXY + '/uploads.json');
    xhr.setRequestHeader('Accept', 'application/json');
    if (S.token) xhr.setRequestHeader('X-Session-Token', S.token);
    if (S.csrf) xhr.setRequestHeader('X-CSRF-Token', S.csrf);
    if (S.cookies) xhr.setRequestHeader('X-Cookies', S.cookies);
    xhr.send(fd);
  });
}

// ============ ROUTER ============
const $app = document.getElementById('app');
const $title = document.getElementById('topTitle');
const $back = document.getElementById('backBtn');
const $menu = document.getElementById('menuDrop');
const $menuBtn = document.getElementById('menuBtn');
const $create = document.getElementById('createBtn');
let createTarget = '';

function setTitle(t) { $title.textContent = t; document.title = t + ' - JTech Forums'; }
function showBack(show) { $back.style.display = show ? 'block' : 'none'; }
function showCreate(target) { createTarget = target; $create.style.display = target ? 'block' : 'none'; }
$create.addEventListener('click', () => { if (createTarget) location.hash = createTarget; });
document.getElementById('refreshBtn').addEventListener('click', () => route());

function goBack() {
  if (S.history.length > 1) { S.history.pop(); location.hash = S.history[S.history.length - 1]; }
  else history.back();
}
$back.addEventListener('click', goBack);

// Global keyboard navigation
document.addEventListener('keydown', e => {
  // Backspace / Escape = go back (when not in an input)
  const tag = (document.activeElement && document.activeElement.tagName);
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if ((e.key === 'Backspace' || e.key === 'Escape') && !inInput) {
    // Escape closes menu first
    if ($menu.classList.contains('open')) { toggleMenu(false); $menuBtn.focus(); e.preventDefault(); return; }
    // Escape deactivates active post
    const activePost = document.querySelector('.post.active');
    if (activePost) { deactivatePost(activePost); activePost.focus(); e.preventDefault(); return; }
    // Escape closes any overlay dialog
    const overlay = document.querySelector('.confirm-overlay');
    if (overlay) { var cb = overlay.querySelector('.cancel') || overlay.querySelector('.ok'); if (cb) cb.click(); e.preventDefault(); return; }
    if ($back.style.display !== 'none') { e.preventDefault(); goBack(); }
  }
  // Escape in input = blur it so user can navigate away
  if (e.key === 'Escape' && inInput) {
    document.activeElement.blur();
    e.preventDefault();
  }
});

async function route() {
  const hash = location.hash || '#/';
  if (S.history[S.history.length - 1] !== hash) S.history.push(hash);

  if (!isLoggedIn()) { showCreate(''); renderLogin(); return; }

  const m = hash.match(/^#(\/.*)/);
  const path = m ? m[1] : '/';
  showCreate('');

  try {
    if (path === '/') { await renderTopics(); }
    else if (path.match(/^\/t\/(\d+)/)) { await renderTopic(path.match(/^\/t\/(\d+)/)[1]); }
    else if (path === '/new-topic') { renderNewTopic(); }
    else if (path === '/messages') { await renderMessages(); }
    else if (path.match(/^\/messages\/(\d+)/)) { await renderTopic(path.match(/^\/messages\/(\d+)/)[1]); }
    else if (path === '/new-message') { renderNewMessage(); }
    else if (path === '/notifications') { await renderNotifications(); }
    else if (path.match(/^\/u\/(.+)/)) { await renderProfile(decodeURIComponent(path.match(/^\/u\/(.+)/)[1])); }
    else if (path === '/settings') { renderSettings(); }
    else if (path.match(/^\/search/)) { await renderSearch(); }
    else { await renderTopics(); }
  } catch (e) {
    $app.innerHTML = `<div class="error">Error: ${esc(e.message)}</div>`;
  }
}

window.addEventListener('hashchange', route);

// ============ HELPERS ============
const _escEl = document.createElement('div');
function esc(s) { if (!s) return ''; _escEl.textContent = String(s); return _escEl.innerHTML; }
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h'; if (s < 2592000) return Math.floor(s / 86400) + 'd';
  return Math.floor(s / 2592000) + 'mo';
}
function avatarUrl(tpl, size) {
  if (!tpl) return '';
  return ASSET_BASE + tpl.replace('{size}', size || 48);
}
// Base for proxying assets (uploads, avatars, images) — uses origin root on Worker, PROXY on local
const ASSET_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? PROXY : location.origin;
// Rewrite URLs in post HTML to go through proxy
function fixPostHtml(html) {
  if (!html) return '';
  return html
    .replace(/src="https:\/\/forums\.jtechforums\.org\/([^"]*?)"/g, `src="${ASSET_BASE}/$1"`)
    .replace(/href="https:\/\/forums\.jtechforums\.org\/([^"]*?)"/g, `href="${ASSET_BASE}/$1"`)
    .replace(/src="\/([^"]*?)"/g, `src="${ASSET_BASE}/$1"`)
    .replace(/href="\/([^"]*?)"/g, `href="${ASSET_BASE}/$1"`)
    .replace(/srcset="[^"]*"/g, '');
}
// SVG icons
const IC = {
  heart: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  bookmark: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  reply: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
  edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  upload: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  msg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  bell: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  flag: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
  lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  pin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8"/><circle cx="12" cy="14" r="4"/><path d="M12 18v4"/></svg>',
  smile: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  shield: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
};

const REACTION_EMOJI = {'+1':'\uD83D\uDC4D','folded_hands':'\uD83D\uDE4F','laughing':'\uD83D\uDE02','ok_hand':'\uD83D\uDC4C','man_shrugging':'\uD83E\uDD37\u200D\u2642\uFE0F'};
const REACTION_LIST = ['+1','folded_hands','laughing','ok_hand','man_shrugging'];

function catBadge(id) {
  const c = S.categories[id];
  if (!c) return '';
  const bg = c.color ? '#' + c.color : '#666';
  return `<span class="cat" style="background:${bg}">${esc(c.name)}</span>`;
}

async function loadCategories() {
  if (Object.keys(S.categories).length) return;
  try {
    const d = await api('/categories.json');
    ((d.category_list && d.category_list.categories) || []).forEach(c => { S.categories[c.id] = c; });
  } catch (e) {}
}

function confirm(msg) {
  return new Promise(resolve => {
    var prev = document.activeElement;
    const el = document.createElement('div');
    el.className = 'confirm-overlay';
    el.innerHTML = `<div class="confirm-box"><p>${esc(msg)}</p><div class="actions">
      <button class="cancel" style="background:var(--bg3);color:var(--fg)" tabindex="0">Cancel</button>
      <button class="ok" tabindex="0">Confirm</button></div></div>`;
    document.body.appendChild(el);
    const okBtn = el.querySelector('.ok');
    const cancelBtn = el.querySelector('.cancel');
    okBtn.focus();
    const doOk = () => { el.remove(); if (prev && prev.focus) prev.focus(); resolve(true); };
    const doCancel = () => { el.remove(); if (prev && prev.focus) prev.focus(); resolve(false); };
    okBtn.onclick = doOk;
    cancelBtn.onclick = doCancel;
    el.onclick = (e) => { if (e.target === el) doCancel(); };
    // Trap focus within dialog and support Escape
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); doCancel(); }
      if (e.key === 'Tab') {
        const els = [cancelBtn, okBtn];
        const idx = els.indexOf(document.activeElement);
        if (e.shiftKey) { els[(idx - 1 + els.length) % els.length].focus(); }
        else { els[(idx + 1) % els.length].focus(); }
        e.preventDefault();
      }
    });
  });
}

// ============ LOGIN ============
function renderLogin() {
  setTitle('Login'); showBack(false);  $app.innerHTML = `
    <div class="login-box">
      <h2>JTech Forums</h2>
      <p>Sign in with your forum account.</p>
      <div class="field"><label for="loginUser">Username or Email</label>
        <input type="text" id="loginUser" placeholder="Username or email" tabindex="0"></div>
      <div class="field"><label for="loginPass">Password</label>
        <input type="password" id="loginPass" placeholder="Password" tabindex="0"></div>
      <div id="loginError" class="error" style="display:none"></div>
      <button id="loginBtn" style="width:100%" tabindex="0">Sign In</button>
    </div>`;

  const doLogin = async () => {
    const login = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    const errEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');
    if (!login || !password) { errEl.textContent = 'Both fields are required'; errEl.style.display = 'block'; return; }
    btn.disabled = true; btn.textContent = 'Signing in...';
    errEl.style.display = 'none';
    try {
      // Get CSRF token first
      try {
        const csrfResp = await fetch(PROXY + '/session/csrf.json', { headers: { 'Accept': 'application/json' } });
        const csrfData = await csrfResp.json();
        if (csrfData.csrf) { S.csrf = csrfData.csrf; localStorage.setItem('jt_csrf', S.csrf); }
        const t = csrfResp.headers.get('X-Session-Token');
        if (t) { S.token = t; localStorage.setItem('jt_session_token', t); }
        const c = csrfResp.headers.get('X-Cookies');
        if (c) { S.cookies = c; localStorage.setItem('jt_cookies', c); }
      } catch (e) {}

      // Login
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' };
      if (S.csrf) headers['X-CSRF-Token'] = S.csrf;
      if (S.token) headers['X-Session-Token'] = S.token;
      if (S.cookies) headers['X-Cookies'] = S.cookies;
      const body = `login=${encodeURIComponent(login)}&password=${encodeURIComponent(password)}`;
      const resp = await fetch(PROXY + '/session.json', { method: 'POST', headers, body });

      const newToken = resp.headers.get('X-Session-Token');
      if (newToken) { S.token = newToken; localStorage.setItem('jt_session_token', newToken); }
      const newCsrf = resp.headers.get('X-CSRF-Token');
      if (newCsrf) { S.csrf = newCsrf; localStorage.setItem('jt_csrf', newCsrf); }
      const newCookies = resp.headers.get('X-Cookies');
      if (newCookies) { S.cookies = newCookies; localStorage.setItem('jt_cookies', newCookies); }

      const d = await resp.json();
      if (d.error) throw new Error(d.error);
      if (!resp.ok) throw new Error((d.errors && d.errors.join(', ')) || 'Login failed');

      const user = d.user || {};
      S.username = user.username || login;
      S.userId = user.id || '';
      localStorage.setItem('jt_username', S.username);
      localStorage.setItem('jt_user_id', S.userId);

      location.hash = '#/';
      route();
    } catch (err) {
      errEl.textContent = err.message; errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  };

  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('loginUser').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginPass').focus(); });
  // Don't auto-focus input — brings up keyboard on mobile
}

async function logout() {
  if (!await confirm('Log out of JTech Forums?')) return;
  try { api('/session/' + encodeURIComponent(S.username) + '.json', { method: 'DELETE' }).catch(() => {}); } catch (e) {}
  S.token = ''; S.csrf = ''; S.cookies = ''; S.username = ''; S.userId = '';
  localStorage.removeItem('jt_session_token'); localStorage.removeItem('jt_csrf'); localStorage.removeItem('jt_cookies');
  localStorage.removeItem('jt_username'); localStorage.removeItem('jt_user_id');
  location.hash = '#/';
  route();
}

// ============ TOPICS ============
let topicPage = 0, topicLoading = false, topicMore = true, topicScrollCleanup = null;

function topicItemHtml(t) {
  var unread = (t.unread_posts || 0) + (t.new_posts || 0);
  var statusIcons = (t.pinned ? '<span class="topic-status-icon">' + IC.pin + '</span>' : '') + (t.closed || t.archived ? '<span class="topic-status-icon">' + IC.lock + '</span>' : '');
  return `<a class="list-item" href="#/t/${t.id}" tabindex="0">
    <div style="display:flex;align-items:flex-start;gap:8px">
      <div style="flex:1;min-width:0">
        <div class="item-title">${statusIcons}${esc(t.title)}</div>
        <div class="item-meta">
          ${catBadge(t.category_id)}
          <span>${t.posts_count - 1} replies</span>
          <span>${timeAgo(t.last_posted_at)}</span>
        </div>
        ${t.excerpt ? `<div class="item-excerpt">${t.excerpt}</div>` : ''}
      </div>
      ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}
    </div>
  </a>`;
}

async function loadMoreTopics() {
  if (topicLoading || !topicMore) return;
  topicLoading = true;
  const loader = document.getElementById('topicLoader');
  if (loader) loader.style.display = 'block';
  try {
    const d = await api('/latest.json' + (topicPage > 0 ? `?page=${topicPage}` : ''));
    const topics = (d.topic_list && d.topic_list.topics) || [];
    if (!topics.length) { topicMore = false; if (loader) loader.textContent = 'No more topics'; }
    else {
      const list = document.getElementById('topicList');
      if (list) list.insertAdjacentHTML('beforeend', topics.map(topicItemHtml).join(''));
      topicPage++;
    }
  } catch (e) {}
  topicLoading = false;
  if (loader && topicMore) loader.style.display = 'none';
}

async function renderTopics() {
  setTitle('JTech Forums'); showBack(false);
  $app.innerHTML = '<div class="loading">Loading topics...</div>';
  await loadCategories();
  topicPage = 0; topicMore = true;
  const d = await api('/latest.json');
  const topics = (d.topic_list && d.topic_list.topics) || [];
  if (!topics.length) { $app.innerHTML = '<div class="empty">No topics found</div>'; return; }
  topicPage = 1;
  let html = `<div id="topicList">`;
  html += topics.map(topicItemHtml).join('');
  html += '</div>';
  html += '<div id="topicLoader" class="loading" style="display:none">Loading more...</div>';
  $app.innerHTML = html;
  showCreate('#/new-topic');

  // Infinite scroll — clean up previous listener first
  if (topicScrollCleanup) topicScrollCleanup();
  const onScroll = () => {
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 300) {
      loadMoreTopics();
    }
  };
  window.addEventListener('scroll', onScroll);
  const cleanup = () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('hashchange', cleanup);
    topicScrollCleanup = null;
  };
  topicScrollCleanup = cleanup;
  window.addEventListener('hashchange', cleanup);
  focusContent();
}

// ============ TOPIC DETAIL ============
async function renderTopic(id) {
  showBack(true);
  $app.innerHTML = '<div class="loading">Loading topic...</div>';
  // Load topic near the last post so user sees the latest
  const d = await api(`/t/${id}/last.json`);
  setTitle(d.title || 'Topic');

  // Mark topic as read so unread badge clears on next topic list load
  var lastPost = (d.post_stream && d.post_stream.posts) || [];
  var highestNum = 0;
  lastPost.forEach(function(p) { if (p.post_number > highestNum) highestNum = p.post_number; });
  if (highestNum > 0) {
    var timings = {};
    timings[highestNum] = 1;
    api('/topics/timings.json', { method: 'POST', body: { topic_id: parseInt(id), topic_time: 1, timings: timings } }).catch(function() {});
  }

  // Build a map of post_number for all posts in the stream
  const allPostIds = (d.post_stream && d.post_stream.stream) || [];
  const loadedPosts = (d.post_stream && d.post_stream.posts) || [];
  const postNumberMap = {};
  loadedPosts.forEach(p => { postNumberMap[p.id] = p.post_number; });

  // Earlier posts that aren't loaded yet (shown as "load earlier" button)
  const loadedIds = new Set(loadedPosts.map(p => p.id));
  const earlierIds = allPostIds.filter(pid => !loadedIds.has(pid));

  let html = `<h2 style="padding:12px;font-size:1.1rem">${esc(d.title)}</h2>`;

  // Show "load earlier" at the top if there are older posts
  if (earlierIds.length > 0) {
    html += `<button id="loadEarlierPosts" tabindex="0" style="width:100%;margin:8px 0;background:var(--bg3);color:var(--fg)">Load ${earlierIds.length} earlier posts</button>`;
  }

  html += '<div id="postsContainer">';
  html += loadedPosts.map(p => renderPost(p, d)).join('');
  html += '</div>';

  const remainingIds = earlierIds;
  html += `<div id="replyIndicator" class="reply-indicator" style="display:none">
    <span id="replyingToText">Replying to topic</span>
    <button class="cancel-reply" id="cancelReply" tabindex="0">${IC.x}</button>
  </div>`;
  html += `<div class="compose" id="replyArea">
    <textarea id="replyBox" placeholder="Press Enter to type a reply..." tabindex="0" readonly>${esc(getDraft('reply_' + id))}</textarea>
    <div class="actions">
      <button id="uploadBtn" tabindex="0" style="background:var(--bg3);color:var(--fg)">${IC.upload} Upload</button>
      <input type="file" id="uploadFile" style="display:none">
      <button id="emojiBtn" tabindex="0" style="background:var(--bg3);color:var(--fg)">${IC.smile}</button>
      <button id="sendReply" tabindex="0">Post Reply</button>
    </div>
  </div>`;
  $app.innerHTML = html;

  // State for reply-to
  let replyToPostNumber = null;

  // Auto-save draft
  const replyBox = document.getElementById('replyBox');
  replyBox.addEventListener('input', () => saveDraft('reply_' + id, replyBox.value));
  // Enter on readonly textarea opens it for editing (brings up keyboard)
  replyBox.addEventListener('keydown', e => {
    if (e.key === 'Enter' && replyBox.readOnly) {
      e.preventDefault();
      replyBox.readOnly = false;
      replyBox.placeholder = 'Write a reply...';
      replyBox.focus();
    }
  });
  replyBox.addEventListener('blur', () => {
    if (!replyBox.readOnly) {
      replyBox.readOnly = true;
      replyBox.placeholder = 'Press Enter to type a reply...';
    }
  });

  // @Mention autocomplete
  (function() {
    var mentionTimer = null;
    var mentionDrop = document.createElement('div');
    mentionDrop.className = 'mention-dropdown';
    mentionDrop.style.display = 'none';
    replyBox.parentNode.style.position = 'relative';
    replyBox.parentNode.insertBefore(mentionDrop, replyBox.nextSibling);
    var mentionIdx = -1;

    function closeMention() { mentionDrop.style.display = 'none'; mentionDrop.innerHTML = ''; mentionIdx = -1; }

    replyBox.addEventListener('input', function() {
      if (replyBox.readOnly) return;
      clearTimeout(mentionTimer);
      var val = replyBox.value;
      var pos = replyBox.selectionStart;
      // Find @query before cursor
      var before = val.substring(0, pos);
      var match = before.match(/@(\w{2,})$/);
      if (!match) { closeMention(); return; }
      var term = match[1];
      mentionTimer = setTimeout(async function() {
        try {
          var d = await api('/u/search/users.json?term=' + encodeURIComponent(term) + '&topic_id=' + id + '&include_groups=false');
          var users = d.users || [];
          if (!users.length) { closeMention(); return; }
          users = users.slice(0, 5);
          mentionDrop.innerHTML = users.map(function(u, i) {
            return '<div class="mention-item" data-username="' + esc(u.username) + '" tabindex="0">' +
              (u.avatar_template ? '<img src="' + avatarUrl(u.avatar_template, 20) + '" alt="" style="width:16px;height:16px;border-radius:50%;vertical-align:middle"> ' : '') +
              esc(u.username) + '</div>';
          }).join('');
          mentionDrop.style.display = 'block';
          mentionIdx = -1;
          mentionDrop.querySelectorAll('.mention-item').forEach(function(item) {
            item.addEventListener('click', function() { insertMention(item.dataset.username); });
            item.addEventListener('keydown', function(e) {
              if (e.key === 'Enter') { e.preventDefault(); insertMention(item.dataset.username); }
              if (e.key === 'Escape') { e.preventDefault(); closeMention(); replyBox.focus(); }
              if (e.key === 'ArrowDown') { e.preventDefault(); var next = item.nextElementSibling; if (next) next.focus(); }
              if (e.key === 'ArrowUp') { e.preventDefault(); var prev = item.previousElementSibling; if (prev) prev.focus(); else replyBox.focus(); }
            });
          });
        } catch (err) { closeMention(); }
      }, 300);
    });

    function insertMention(username) {
      var val = replyBox.value;
      var pos = replyBox.selectionStart;
      var before = val.substring(0, pos);
      var after = val.substring(pos);
      var newBefore = before.replace(/@\w{2,}$/, '@' + username + ' ');
      replyBox.value = newBefore + after;
      replyBox.selectionStart = replyBox.selectionEnd = newBefore.length;
      closeMention();
      replyBox.focus();
      replyBox.dispatchEvent(new Event('input'));
    }

    replyBox.addEventListener('keydown', function(e) {
      if (mentionDrop.style.display === 'none') return;
      if (e.key === 'ArrowDown') { e.preventDefault(); var first = mentionDrop.querySelector('.mention-item'); if (first) first.focus(); }
      if (e.key === 'Escape') { e.preventDefault(); closeMention(); }
    });
  })();

  // Cancel reply-to
  document.getElementById('cancelReply').addEventListener('click', () => {
    replyToPostNumber = null;
    document.getElementById('replyIndicator').style.display = 'none';
  });

  // Upload
  const uploadBtn = document.getElementById('uploadBtn');
  uploadBtn.addEventListener('click', () => document.getElementById('uploadFile').click());
  document.getElementById('uploadFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const r = await uploadFile(file, uploadBtn);
      replyBox.value += `\n![${file.name}](${r.short_url || r.url})`;
      replyBox.dispatchEvent(new Event('input'));
    } catch (err) { showAlert(err.message); }
  });

  // Emoji picker
  document.getElementById('emojiBtn').addEventListener('click', function() {
    var EMOJIS = ['\uD83D\uDC4D','\uD83D\uDC4E','\uD83D\uDE00','\uD83D\uDE02','\uD83D\uDE0A','\uD83D\uDE0D','\uD83E\uDD14','\uD83D\uDE22','\uD83D\uDE21','\uD83D\uDE31','\uD83D\uDE4F','\uD83D\uDD25','\u2764\uFE0F','\uD83D\uDCAF','\u2705','\u274C','\uD83C\uDF89','\uD83D\uDC4B','\uD83D\uDCAA','\uD83D\uDE80','\u2B50','\uD83D\uDCA1','\uD83C\uDFC6','\uD83D\uDDE3\uFE0F','\uD83D\uDCAC','\uD83D\uDC40','\uD83E\uDD1D','\uD83C\uDF1F','\uD83D\uDC9A','\uD83D\uDC99','\uD83D\uDC9C','\uD83E\uDDE1','\uD83D\uDC9B','\uD83D\uDE07','\uD83E\uDD23','\uD83D\uDE09','\uD83D\uDE0E','\uD83E\uDD29','\uD83D\uDE4C','\uD83D\uDE18','\uD83E\uDD17','\uD83E\uDD2F','\uD83E\uDD73','\uD83D\uDE1C','\uD83E\uDD7A','\uD83D\uDE33','\uD83D\uDE44','\uD83D\uDE29','\uD83E\uDD26','\uD83D\uDE4B'];
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = '<div class="emoji-picker"><div class="emoji-grid">' +
      EMOJIS.map(function(e) { return '<button class="emoji-item" tabindex="0">' + e + '</button>'; }).join('') +
      '</div></div>';
    document.body.appendChild(overlay);
    history.pushState({ emoji: true }, '');
    var closeEmoji = function() { overlay.remove(); };
    overlay.onclick = function(e) { if (e.target === overlay) closeEmoji(); };
    overlay.querySelectorAll('.emoji-item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var val = replyBox.value;
        var pos = replyBox.selectionStart || val.length;
        replyBox.value = val.substring(0, pos) + btn.textContent + val.substring(pos);
        replyBox.selectionStart = replyBox.selectionEnd = pos + btn.textContent.length;
        closeEmoji();
        replyBox.readOnly = false;
        replyBox.focus();
        replyBox.dispatchEvent(new Event('input'));
      });
    });
    overlay.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeEmoji(); }
    });
    var popHandler = function() { closeEmoji(); window.removeEventListener('popstate', popHandler); };
    window.addEventListener('popstate', popHandler);
    var firstEmoji = overlay.querySelector('.emoji-item');
    if (firstEmoji) firstEmoji.focus();
  });

  // Post reply
  document.getElementById('sendReply').addEventListener('click', async function() {
    const raw = replyBox.value.trim();
    if (!raw) return;
    this.disabled = true; this.textContent = 'Posting...';
    try {
      const postBody = { topic_id: parseInt(id), raw };
      if (replyToPostNumber) postBody.reply_to_post_number = replyToPostNumber;
      await api('/posts.json', { method: 'POST', body: postBody });
      clearDraft('reply_' + id);
      await renderTopic(id);
      // Scroll to bottom to see new reply
      window.scrollTo(0, document.body.scrollHeight);
    } catch (err) {
      showAlert('Error: ' + err.message);
      this.disabled = false; this.textContent = 'Post Reply';
    }
  });

  // Load earlier posts
  const loadEarlierBtn = document.getElementById('loadEarlierPosts');
  if (loadEarlierBtn) {
    loadEarlierBtn.addEventListener('click', async function() {
      this.disabled = true; this.textContent = 'Loading...';
      try {
        // Load last 20 from the earlier batch (closest to current view)
        const batch = remainingIds.splice(-20);
        const resp = await api(`/t/${id}/posts.json?post_ids[]=${batch.join('&post_ids[]=')}`);
        const newPosts = ((resp.post_stream && resp.post_stream.posts) || []).sort((a, b) => a.post_number - b.post_number);
        const container = document.getElementById('postsContainer');
        // Insert at the top of the container
        const beforeScrollH = document.body.scrollHeight;
        newPosts.forEach(p => {
          postNumberMap[p.id] = p.post_number;
          container.insertAdjacentHTML('afterbegin', renderPost(p, d));
        });
        // Maintain scroll position so user doesn't jump
        window.scrollBy(0, document.body.scrollHeight - beforeScrollH);
        attachPostHandlers(container, id, replyBox, postNumberMap, (n) => { replyToPostNumber = n; });
        if (remainingIds.length > 0) {
          this.disabled = false;
          this.textContent = `Load ${remainingIds.length} earlier posts`;
        } else {
          this.remove();
        }
      } catch (err) {
        showAlert(err.message);
        this.disabled = false; this.textContent = 'Load earlier posts';
      }
    });
  }

  // Attach all post interaction handlers
  attachPostHandlers($app, id, replyBox, postNumberMap, (n) => { replyToPostNumber = n; });

  // Scroll to last post and focus it
  const posts = document.querySelectorAll('.post');
  if (posts.length) {
    const last = posts[posts.length - 1];
    last.scrollIntoView({ behavior: 'instant' });
    last.focus();
  }
}

function attachPostHandlers(container, topicId, replyBox, postNumberMap, setReplyTo) {
  // React button - open reaction picker
  container.querySelectorAll('[data-react-open]').forEach(btn => {
    if (btn._bound) return; btn._bound = true;
    btn.addEventListener('click', () => {
      showReactionPicker(btn.dataset.reactOpen);
    });
  });

  // Reaction pill click - short press toggles, or show who reacted
  container.querySelectorAll('[data-react]').forEach(btn => {
    if (btn._bound) return; btn._bound = true;
    btn.addEventListener('click', async () => {
      var postId = btn.dataset.postId;
      var reactionId = btn.dataset.react;
      // Show who reacted dialog, with option to toggle
      btn.disabled = true;
      try {
        var d = await api('/discourse-reactions/posts/' + postId + '/reactions-users.json');
        var groups = d.reaction_users || [];
        var target = null;
        for (var gi = 0; gi < groups.length; gi++) { if (groups[gi].id === reactionId) { target = groups[gi]; break; } }
        var emoji = REACTION_EMOJI[reactionId] || reactionId;
        if (target && target.users && target.users.length) {
          var names = target.users.map(function(u) { return '@' + u.username; }).join(', ');
          showAlert(emoji + ' (' + target.count + '): ' + names);
        } else {
          showAlert(emoji + ': no reactions yet');
        }
      } catch (err) { showAlert(err.message); }
      btn.disabled = false;
    });
  });

  // Reply to post
  container.querySelectorAll('[data-reply-to]').forEach(btn => {
    if (btn._bound) return; btn._bound = true;
    btn.addEventListener('click', () => {
      const postId = parseInt(btn.dataset.replyTo);
      const user = btn.dataset.replyUser;
      const postNum = postNumberMap[postId] || postId;
      setReplyTo(postNum);
      const indicator = document.getElementById('replyIndicator');
      document.getElementById('replyingToText').textContent = `Replying to @${user} (#${postNum})`;
      indicator.style.display = 'flex';
      replyBox.readOnly = false;
      replyBox.placeholder = 'Write a reply...';
      replyBox.focus();
      replyBox.scrollIntoView({ behavior: 'smooth' });
    });
  });

  // Delete post
  container.querySelectorAll('[data-delete-post]').forEach(btn => {
    if (btn._bound) return; btn._bound = true;
    btn.addEventListener('click', async () => {
      const postId = btn.dataset.deletePost;
      if (!await confirm('Delete this post?')) return;
      btn.disabled = true;
      try {
        await api(`/posts/${postId}.json`, { method: 'DELETE' });
        await renderTopic(topicId);
      } catch (err) {
        showAlert(err.message);
        btn.disabled = false;
      }
    });
  });

  // Edit post
  container.querySelectorAll('[data-edit-post]').forEach(btn => {
    if (btn._bound) return; btn._bound = true;
    btn.addEventListener('click', async () => {
      const postId = btn.dataset.editPost;
      const postEl = document.getElementById('post-' + postId);
      const bodyEl = postEl && postEl.querySelector('.post-body');
      if (!bodyEl) return;

      // Fetch raw content
      btn.disabled = true;
      try {
        const resp = await api(`/posts/${postId}.json`);
        const raw = resp.raw || '';
        const actionsEl = postEl.querySelector('.post-actions');
        actionsEl.style.display = 'none';
        bodyEl.innerHTML = `<textarea id="editBox-${postId}" style="width:100%;min-height:120px" tabindex="0">${esc(raw)}</textarea>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="save-edit" data-post-id="${postId}" tabindex="0">Save</button>
            <button class="cancel-edit" data-post-id="${postId}" tabindex="0" style="background:var(--bg3);color:var(--fg)">Cancel</button>
          </div>`;
        bodyEl.querySelector('.save-edit').addEventListener('click', async function() {
          const newRaw = document.getElementById('editBox-' + postId).value.trim();
          if (!newRaw) return;
          this.disabled = true; this.textContent = 'Saving...';
          try {
            await api(`/posts/${postId}.json`, { method: 'PUT', body: { post: { raw: newRaw } } });
            var te = postEl.closest('[data-topic-id]'); await renderTopic((te && te.dataset.topicId) || (location.hash.match(/\d+/) || [])[0]);
          } catch (err) {
            showAlert(err.message);
            this.disabled = false; this.textContent = 'Save';
          }
        });
        bodyEl.querySelector('.cancel-edit').addEventListener('click', () => renderTopic((location.hash.match(/\d+/) || [])[0]));
      } catch (err) {
        showAlert(err.message);
        btn.disabled = false;
      }
    });
  });

  // Poll vote
  container.querySelectorAll('[data-poll-vote]').forEach(opt => {
    if (opt._bound) return; opt._bound = true;
    opt.addEventListener('click', async () => {
      const pollName = opt.dataset.pollName;
      const optVal = opt.dataset.pollVote;
      const postId = opt.dataset.postId;
      try {
        await api('/polls/vote.json', { method: 'PUT', body: { post_id: parseInt(postId), poll_name: pollName, options: [optVal] } });
        await renderTopic((location.hash.match(/\d+/) || [])[0]);
      } catch (err) { showAlert(err.message); }
    });
  });

  // Flag post
  container.querySelectorAll('[data-flag]').forEach(btn => {
    if (btn._bound) return; btn._bound = true;
    btn.addEventListener('click', () => {
      const postId = btn.dataset.flag;
      showFlagDialog(postId);
    });
  });
}

// Keyboard-friendly alert replacement
function showAlert(msg) {
  return new Promise(resolve => {
    var prev = document.activeElement;
    const el = document.createElement('div');
    el.className = 'confirm-overlay';
    el.innerHTML = `<div class="confirm-box"><p>${esc(msg)}</p><div class="actions">
      <button class="ok" tabindex="0">OK</button></div></div>`;
    document.body.appendChild(el);
    const okBtn = el.querySelector('.ok');
    okBtn.focus();
    const close = () => { el.remove(); if (prev && prev.focus) prev.focus(); resolve(); };
    okBtn.onclick = close;
    el.onclick = (e) => { if (e.target === el) close(); };
    okBtn.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  });
}


function showReactionPicker(postId) {
  var prev = document.activeElement;
  var el = document.createElement('div');
  el.className = 'confirm-overlay';
  el.innerHTML = '<div class="confirm-box"><p>React:</p><div class="reaction-picker-grid">' +
    REACTION_LIST.map(function(r) { return '<button class="reaction-pick" data-rid="' + r + '" tabindex="0">' + (REACTION_EMOJI[r] || r) + '</button>'; }).join('') +
    '</div><button class="cancel" tabindex="0" style="background:var(--bg3);color:var(--fg);margin-top:8px;width:100%">Cancel</button></div>';
  document.body.appendChild(el);
  var first = el.querySelector('.reaction-pick');
  if (first) first.focus();
  var close = function() { el.remove(); if (prev && prev.focus) prev.focus(); };
  el.querySelector('.cancel').onclick = close;
  el.onclick = function(e) { if (e.target === el) close(); };
  el.querySelectorAll('.reaction-pick').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      btn.disabled = true;
      try {
        await api('/discourse-reactions/posts/' + postId + '/custom-reactions/' + encodeURIComponent(btn.dataset.rid) + '/toggle.json', { method: 'PUT' });
        close();
        await renderTopic((location.hash.match(/\d+/) || [])[0]);
      } catch (err) { close(); showAlert(err.message); }
    });
  });
  el.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'ArrowRight') { var next = document.activeElement.nextElementSibling; if (next && next.classList.contains('reaction-pick')) { next.focus(); e.preventDefault(); } }
    if (e.key === 'ArrowLeft') { var prev = document.activeElement.previousElementSibling; if (prev && prev.classList.contains('reaction-pick')) { prev.focus(); e.preventDefault(); } }
    if (e.key === 'ArrowDown') { var cancelBtn = el.querySelector('.cancel'); if (cancelBtn) { cancelBtn.focus(); e.preventDefault(); } }
    if (e.key === 'ArrowUp') { var lastPick = el.querySelectorAll('.reaction-pick'); if (lastPick.length && document.activeElement === el.querySelector('.cancel')) { lastPick[lastPick.length - 1].focus(); e.preventDefault(); } }
  });
}

function showFlagDialog(postId) {
  var prev = document.activeElement;
  var el = document.createElement('div');
  el.className = 'confirm-overlay';
  el.innerHTML = '<div class="confirm-box"><p>Flag this post as:</p><div style="display:flex;flex-direction:column;gap:6px">' +
    '<button class="flag-opt" data-type="8" tabindex="0">It\'s Spam</button>' +
    '<button class="flag-opt" data-type="4" tabindex="0">It\'s Inappropriate</button>' +
    '<button class="flag-opt" data-type="3" tabindex="0">It\'s Off-Topic</button>' +
    '<button class="flag-opt" data-type="7" tabindex="0">Something Else</button>' +
    '<button class="cancel" tabindex="0" style="background:var(--bg3);color:var(--fg);margin-top:4px">Cancel</button>' +
    '</div></div>';
  document.body.appendChild(el);
  var first = el.querySelector('.flag-opt');
  if (first) first.focus();
  var close = function() { el.remove(); if (prev && prev.focus) prev.focus(); };
  el.querySelector('.cancel').onclick = close;
  el.onclick = function(e) { if (e.target === el) close(); };
  el.querySelectorAll('.flag-opt').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var typeId = parseInt(btn.dataset.type);
      btn.disabled = true; btn.textContent = 'Flagging...';
      try {
        await api('/post_actions.json', { method: 'POST', body: { id: parseInt(postId), post_action_type_id: typeId, flag_topic: false } });
        close();
        showAlert('Post flagged');
      } catch (err) { close(); showAlert(err.message); }
    });
  });
  el.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
}

function renderPost(p, topicData) {
  let body = fixPostHtml(p.cooked || '');
  const isOwn = p.username === S.username;

  // Render polls
  let pollsHtml = '';
  if (p.polls && p.polls.length) {
    p.polls.forEach(poll => {
      const totalVotes = poll.voters || 0;
      pollsHtml += `<div class="poll"><h4>${esc(poll.title || poll.name)}</h4>`;
      (poll.options || []).forEach(opt => {
        const pct = totalVotes > 0 ? Math.round((opt.votes || 0) / totalVotes * 100) : 0;
        const voted = opt.voted ? 'voted' : '';
        pollsHtml += `<div class="poll-option ${voted}" tabindex="0" data-poll-vote="${esc(opt.id)}" data-poll-name="${esc(poll.name)}" data-post-id="${p.id}">
          <span>${esc(opt.html || opt.text || '')}</span>
          <span class="poll-pct">${pct}% (${opt.votes || 0})</span>
        </div>`;
      });
      pollsHtml += `<div style="font-size:.75rem;color:var(--fg2);margin-top:4px">${totalVotes} votes</div></div>`;
    });
  }

  // Reply info
  let replyInfo = '';
  if (p.reply_to_post_number) {
    var replyAvatar = (p.reply_to_user && p.reply_to_user.avatar_template)
      ? `<img src="${avatarUrl(p.reply_to_user.avatar_template, 20)}" alt="" style="width:16px;height:16px;border-radius:50%;vertical-align:middle">`
      : '';
    replyInfo = `<span style="font-size:.75rem;color:var(--fg2);margin-left:auto;display:inline-flex;align-items:center;gap:3px">${IC.reply} ${replyAvatar}#${p.reply_to_post_number}</span>`;
  }

  return `<div class="post" id="post-${p.id}" tabindex="0">
    <div class="post-header">
      <img class="post-avatar" src="${avatarUrl(p.avatar_template, 48)}" alt="" loading="lazy">
      <div>
        <a class="post-author" href="#/u/${esc(p.username)}" tabindex="-1">${esc(p.username)}</a>
        <div class="post-date">${timeAgo(p.created_at)}</div>
      </div>
      <span class="post-num">#${p.post_number}</span>
      ${replyInfo}
    </div>
    <div class="post-body">${body}${pollsHtml}</div>
    ${(function(){var rxs=p.reactions||[];return rxs.length?'<div class="post-reactions">'+rxs.map(function(r){var em=REACTION_EMOJI[r.id]||r.id;var active=p.current_user_reaction===r.id?' reacted':'';return '<button class="reaction-pill'+active+'" data-react="'+esc(r.id)+'" data-post-id="'+p.id+'" tabindex="-1">'+em+' '+r.count+'</button>'}).join('')+'</div>':''}())}
    <div class="post-actions">
      <button data-react-open="${p.id}" tabindex="-1">${IC.heart} React</button>
      <button data-reply-to="${p.id}" data-reply-user="${esc(p.username)}" tabindex="-1">${IC.reply} Reply</button>
      ${isOwn ? `<button data-edit-post="${p.id}" tabindex="-1">${IC.edit} Edit</button>
      <button data-delete-post="${p.id}" tabindex="-1" style="color:var(--danger)">${IC.trash} Delete</button>` : `<button data-flag="${p.id}" tabindex="-1">${IC.flag} Flag</button>`}
    </div>
  </div>`;
}

// ============ NEW TOPIC ============
function renderNewTopic() {
  setTitle('New Topic'); showBack(true);
  $app.innerHTML = `<div class="compose">
    <div class="field"><label for="ntTitle">Title</label>
      <input type="text" id="ntTitle" value="${esc(getDraft('new_topic_title'))}" placeholder="Topic title" tabindex="0"></div>
    <div class="field"><label for="ntCat">Category</label>
      <select id="ntCat" tabindex="0"><option value="">Select...</option>
        ${Object.keys(S.categories).map(function(k) { return S.categories[k]; }).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
      </select></div>
    <div class="field"><label for="ntBody">Body</label>
      <textarea id="ntBody" placeholder="Write your topic..." tabindex="0">${esc(getDraft('new_topic_body'))}</textarea></div>
    <div class="actions">
      <button id="uploadNt" tabindex="0" style="background:var(--bg3);color:var(--fg)">${IC.upload} Upload</button>
      <input type="file" id="uploadNtFile" style="display:none">
      <button id="postTopic" tabindex="0">Create Topic</button>
    </div>
  </div>`;
  document.getElementById('ntTitle').focus();
  document.getElementById('ntTitle').addEventListener('input', e => saveDraft('new_topic_title', e.target.value));
  document.getElementById('ntBody').addEventListener('input', e => saveDraft('new_topic_body', e.target.value));
  const uploadNtBtn = document.getElementById('uploadNt');
  uploadNtBtn.addEventListener('click', () => document.getElementById('uploadNtFile').click());
  document.getElementById('uploadNtFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const r = await uploadFile(file, uploadNtBtn);
      const b = document.getElementById('ntBody');
      b.value += `\n![${file.name}](${r.short_url || r.url})`;
      b.dispatchEvent(new Event('input'));
    } catch (err) { showAlert(err.message); }
  });
  document.getElementById('postTopic').addEventListener('click', async function() {
    const title = document.getElementById('ntTitle').value.trim();
    const raw = document.getElementById('ntBody').value.trim();
    const cat = document.getElementById('ntCat').value;
    if (!title || !raw) return showAlert('Title and body are required');
    this.disabled = true; this.textContent = 'Creating...';
    try {
      const d = await api('/posts.json', { method: 'POST', body: { title, raw, category: cat ? parseInt(cat) : undefined } });
      clearDraft('new_topic_title'); clearDraft('new_topic_body');
      location.hash = `#/t/${d.topic_id}`;
    } catch (err) {
      showAlert('Error: ' + err.message);
      this.disabled = false; this.textContent = 'Create Topic';
    }
  });
}

// ============ NEW MESSAGE ============
function renderNewMessage() {
  setTitle('New Message'); showBack(true);
  $app.innerHTML = `<div class="compose">
    <div class="field"><label for="pmTo">To (username)</label>
      <input type="text" id="pmTo" placeholder="username" tabindex="0"></div>
    <div class="field"><label for="pmTitle">Subject</label>
      <input type="text" id="pmTitle" placeholder="Subject" tabindex="0"></div>
    <div class="field"><label for="pmBody">Message</label>
      <textarea id="pmBody" placeholder="Write your message..." tabindex="0"></textarea></div>
    <button id="sendPm" tabindex="0" style="width:100%">Send Message</button>
  </div>`;
  document.getElementById('pmTo').focus();
  document.getElementById('sendPm').addEventListener('click', async function() {
    const to = document.getElementById('pmTo').value.trim();
    const title = document.getElementById('pmTitle').value.trim();
    const raw = document.getElementById('pmBody').value.trim();
    if (!to || !title || !raw) return showAlert('All fields required');
    this.disabled = true; this.textContent = 'Sending...';
    try {
      const d = await api('/posts.json', { method: 'POST', body: { title, raw, target_recipients: to, archetype: 'private_message' } });
      location.hash = `#/messages/${d.topic_id}`;
    } catch (err) {
      showAlert('Error: ' + err.message);
      this.disabled = false; this.textContent = 'Send Message';
    }
  });
}

// ============ MESSAGES ============
async function renderMessages() {
  setTitle('Messages'); showBack(false);
  $app.innerHTML = '<div class="loading">Loading messages...</div>';
  try {
    const d = await api(`/topics/private-messages/${encodeURIComponent(S.username)}.json`);
    const topics = (d.topic_list && d.topic_list.topics) || [];
    if (!topics.length) { $app.innerHTML = '<div class="empty">No messages</div>'; }
    else {
      $app.innerHTML = topics.map(t => `
        <a class="list-item" href="#/messages/${t.id}" tabindex="0">
          <div class="item-title">${esc(t.title)}</div>
          <div class="item-meta"><span>${t.posts_count} posts</span><span>${timeAgo(t.last_posted_at)}</span></div>
        </a>`).join('');
    }
    showCreate('#/new-message');
    focusContent();
  } catch (e) { $app.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

// ============ NOTIFICATIONS ============
async function renderNotifications() {
  setTitle('Notifications'); showBack(false);
  $app.innerHTML = '<div class="loading">Loading notifications...</div>';
  try {
    const d = await api('/notifications.json');
    const notifs = d.notifications || [];
    if (!notifs.length) { $app.innerHTML = '<div class="empty">No notifications</div>'; return; }
    let html = `<button id="markAllRead" tabindex="0" style="margin:8px;background:var(--bg3);color:var(--fg)">Mark all read</button>`;
    html += notifs.map(n => {
      const types = {1:IC.msg,2:IC.msg,5:IC.heart,6:IC.msg,9:IC.msg,12:IC.bookmark,15:IC.msg};
      const icon = types[n.notification_type] || IC.bell;
      const text = (n.data && n.data.display_username) ? (esc(n.data.display_username) + ': ') : '';
      const topic = (n.data && n.data.topic_title) || (n.data && n.data.badge_name) || n.fancy_title || '';
      const href = n.topic_id ? `#/t/${n.topic_id}` : '#/notifications';
      return `<a class="notif-item ${n.read?'':'unread'}" href="${href}" tabindex="0">
        <span class="notif-icon">${icon}</span>
        <span class="notif-text">${text}${esc(topic)}</span>
        <span class="notif-time">${timeAgo(n.created_at)}</span>
      </a>`;
    }).join('');
    $app.innerHTML = html;
    document.getElementById('markAllRead').addEventListener('click', async function() {
      this.disabled = true; this.textContent = 'Marking...';
      try { await api('/notifications/mark-read.json', { method: 'PUT' }); await renderNotifications(); }
      catch (err) { showAlert(err.message); this.disabled = false; this.textContent = 'Mark all read'; }
    });
    focusContent();
  } catch (e) { $app.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

// ============ PROFILE ============
async function renderProfile(username) {
  showBack(username !== S.username && username !== 'me');
  const uname = username === 'me' ? S.username : username;
  setTitle(uname);
  $app.innerHTML = '<div class="loading">Loading profile...</div>';
  try {
    const d = await api(`/u/${encodeURIComponent(uname)}.json`);
    const u = d.user;
    let html = `<div class="profile-header">
      <img class="avatar" src="${avatarUrl(u.avatar_template, 120)}" alt="${esc(u.username)}">
      <h2>${esc(u.name || u.username)}</h2>
      <div style="color:var(--fg2);font-size:.85rem">@${esc(u.username)}</div>
      ${u.bio_cooked ? `<div class="bio">${fixPostHtml(u.bio_cooked)}</div>` : ''}
    </div>
    <div class="profile-stats">
      <div><span class="num">${u.post_count || 0}</span>Posts</div>
      <div><span class="num">${u.topic_count || 0}</span>Topics</div>
      <div><span class="num">${u.days_visited || 0}</span>Days</div>
    </div>
    <div style="padding:8px 12px;font-size:.85rem;display:flex;align-items:center;gap:6px;color:var(--fg2)">${IC.shield} Trust Level: ${u.trust_level || 0} (${['new','basic','member','regular','leader'][u.trust_level] || 'new'})</div>
    ${u.badges && u.badges.length ? '<div style="padding:4px 12px;display:flex;flex-wrap:wrap;gap:4px">' + u.badges.map(function(b) { return '<span class="user-badge">' + esc(b.name) + '</span>'; }).join('') + '</div>' : ''}`;
    if (uname === S.username) {
      html += `<div style="padding:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button tabindex="0" id="editProfileBtn">Edit Profile</button>
        <button tabindex="0" style="background:var(--danger)" id="logoutBtn">Log Out</button>
      </div>`;
    }
    html += `<h3 style="padding:12px 12px 4px;font-size:.95rem">Recent Activity</h3>`;
    $app.innerHTML = html;

    if (uname === S.username) {
      document.getElementById('editProfileBtn').addEventListener('click', () => location.hash = '#/settings');
      document.getElementById('logoutBtn').addEventListener('click', () => logout());
    }

    // Load activity
    try {
      const act = await api(`/u/${encodeURIComponent(uname)}/activity.json`);
      const posts = act.user_actions || [];
      if (posts.length) {
        const actHtml = posts.slice(0, 20).map(a => `
          <a class="list-item" href="#/t/${a.topic_id}" tabindex="0">
            <div class="item-title">${esc(a.title)}</div>
            <div class="item-meta"><span>${timeAgo(a.created_at)}</span></div>
          </a>`).join('');
        $app.insertAdjacentHTML('beforeend', actHtml);
      } else {
        $app.insertAdjacentHTML('beforeend', '<div class="empty">No recent activity</div>');
      }
    } catch (e) {}
    focusContent();
  } catch (e) { $app.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

// ============ SETTINGS ============
function renderSettings() {
  setTitle('Settings'); showBack(true);
  $app.innerHTML = `<div class="compose">
    <h3 style="margin-bottom:12px">Edit Profile</h3>
    <div class="field"><label for="setName">Display Name</label>
      <input type="text" id="setName" tabindex="0"></div>
    <div class="field"><label for="setBio">Bio</label>
      <textarea id="setBio" tabindex="0"></textarea></div>
    <div class="field"><label for="setStatus">Status</label>
      <input type="text" id="setStatus" placeholder="Status emoji + text" tabindex="0"></div>
    <button id="saveProfBtn" tabindex="0" style="width:100%;margin-bottom:8px">Save</button>
    <button tabindex="0" style="width:100%;background:var(--danger)" id="settingsLogout">Log Out</button>
  </div>`;
  api(`/u/${encodeURIComponent(S.username)}.json`).then(d => {
    const el = document.getElementById('setName');
    if (el) el.value = (d.user && d.user.name) || '';
    const bio = document.getElementById('setBio');
    if (bio) bio.value = (d.user && d.user.bio_raw) || '';
  }).catch(() => {});
  requestAnimationFrame(() => { const el = document.getElementById('setName'); if (el) el.focus(); });
  document.getElementById('saveProfBtn').addEventListener('click', async function() {
    this.disabled = true; this.textContent = 'Saving...';
    try {
      await api(`/u/${encodeURIComponent(S.username)}.json`, { method: 'PUT', body: {
        name: document.getElementById('setName').value,
        bio_raw: document.getElementById('setBio').value,
      }});
      const st = document.getElementById('setStatus').value.trim();
      if (st) {
        await api('/user-status.json', { method: 'PUT', body: { description: st } });
      }
      location.hash = '#/u/me';
    } catch (err) {
      showAlert('Error: ' + err.message);
      this.disabled = false; this.textContent = 'Save';
    }
  });
  document.getElementById('settingsLogout').addEventListener('click', () => logout());
}

// ============ MENU ============
let menuOpen = false;
function updateMenuItems() {
  const logged = isLoggedIn();
  $menu.querySelectorAll('[data-auth]').forEach(el => el.style.display = logged ? '' : 'none');
  const authBtn = document.getElementById('menuAuthBtn');
  if (logged) {
    authBtn.textContent = '';
    authBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Log Out';
    authBtn.style.color = 'var(--danger)';
  } else {
    authBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Log In';
    authBtn.style.color = 'var(--accent)';
  }
}
function toggleMenu(open) {
  const show = open !== undefined ? open : !menuOpen;
  menuOpen = show;
  $menu.classList.toggle('open', show);
  if (show) {
    updateMenuItems();
    history.pushState({ menu: true }, '');
    const first = $menu.querySelector('a:not([style*="display: none"])');
    if (first) first.focus();
  }
}
window.addEventListener('popstate', e => {
  if (menuOpen) { menuOpen = false; $menu.classList.remove('open'); $menuBtn.focus(); e.stopImmediatePropagation(); }
});
$menuBtn.addEventListener('click', () => toggleMenu());
// Close menu on item click
$menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => toggleMenu(false)));
document.getElementById('menuAuthBtn').addEventListener('click', e => {
  e.preventDefault();
  toggleMenu(false);
  if (isLoggedIn()) logout();
  else { location.hash = '#/'; route(); }
});
// Close menu on outside click
document.addEventListener('click', e => {
  if ($menu.classList.contains('open') && !$menu.contains(e.target) && e.target !== $menuBtn) toggleMenu(false);
});

// ============ SCALE ============
let scale = parseInt(localStorage.getItem('jt_scale') || '100');
function applyScale() {
  document.documentElement.style.fontSize = (15 * scale / 100) + 'px';
  document.getElementById('scaleLabel').textContent = scale + '%';
}
applyScale();
document.getElementById('scaleDown').addEventListener('click', e => {
  e.preventDefault(); scale = Math.max(50, scale - 10);
  localStorage.setItem('jt_scale', scale); applyScale();
});
document.getElementById('scaleUp').addEventListener('click', e => {
  e.preventDefault(); scale = Math.min(200, scale + 10);
  localStorage.setItem('jt_scale', scale); applyScale();
});

// ============ THEME ============
const $themeBtn = document.getElementById('themeBtn');
const sunSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const moonSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
function applyTheme(light) {
  document.documentElement.classList.toggle('light', light);
  $themeBtn.innerHTML = light ? moonSvg : sunSvg;
  localStorage.setItem('jt_theme', light ? 'light' : 'dark');
}
applyTheme(localStorage.getItem('jt_theme') === 'light');
$themeBtn.addEventListener('click', () => applyTheme(!document.documentElement.classList.contains('light')));

// ============ SEARCH ============

async function renderSearch() {
  var qs = location.hash.split('?')[1] || '';
  var q = '';
  qs.split('&').forEach(function(p) { var kv = p.split('='); if (kv[0] === 'q') q = decodeURIComponent(kv[1] || ''); });
  setTitle('Search'); showBack(true);
  let html = `<div class="search-bar">
    <input type="search" id="searchInput" value="${esc(q)}" placeholder="Search forums..." tabindex="0">
    <button id="searchGo" tabindex="0">Go</button>
  </div>`;
  html += '<div id="searchResults"></div>';
  $app.innerHTML = html;

  const doSearch = async () => {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) return;
    // Update URL without re-rendering
    history.replaceState(null, '', `#/search?q=${encodeURIComponent(query)}`);
    const results = document.getElementById('searchResults');
    results.innerHTML = '<div class="loading">Searching...</div>';
    try {
      const d = await api(`/search.json?q=${encodeURIComponent(query)}`);
      let rhtml = '';
      const topics = d.topics || [];
      const users = d.users || [];
      if (users.length) {
        rhtml += '<h3 style="padding:8px 12px;font-size:.9rem;color:var(--fg2)">Users</h3>';
        rhtml += users.map(u => `
          <a class="list-item" href="#/u/${esc(u.username)}" tabindex="0">
            <div class="item-title">@${esc(u.username)}</div>
            ${u.name ? `<div class="item-meta">${esc(u.name)}</div>` : ''}
          </a>`).join('');
      }
      if (topics.length) {
        rhtml += '<h3 style="padding:8px 12px;font-size:.9rem;color:var(--fg2)">Topics</h3>';
        rhtml += topics.map(t => `
          <a class="list-item" href="#/t/${t.id}" tabindex="0">
            <div class="item-title">${esc(t.title)}</div>
            <div class="item-meta">${catBadge(t.category_id)}<span>${timeAgo(t.created_at)}</span></div>
          </a>`).join('');
      }
      if (!rhtml) rhtml = '<div class="empty">No results found</div>';
      results.innerHTML = rhtml;
    } catch (e) { results.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };

  document.getElementById('searchGo').addEventListener('click', doSearch);
  document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  document.getElementById('searchInput').focus();

  // Auto-search if query present
  if (q) doSearch();
}

// ============ PULL TO REFRESH ============
(function() {
  let startY = 0, pulling = false, ptr = null;

  function ensurePtr() {
    ptr = document.getElementById('ptr');
    if (!ptr) {
      ptr = document.createElement('div');
      ptr.id = 'ptr';
      ptr.textContent = 'Pull to refresh';
      $app.parentNode.insertBefore(ptr, $app);
    }
    return ptr;
  }

  document.addEventListener('touchstart', e => {
    if (window.scrollY === 0 && isLoggedIn()) {
      startY = e.touches[0].clientY;
      pulling = true;
      ensurePtr();
    }
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 10 && dy < 150 && window.scrollY === 0) {
      ptr.classList.add('visible');
      ptr.textContent = dy > 70 ? 'Release to refresh' : 'Pull to refresh';
    } else if (dy <= 0) {
      ptr.classList.remove('visible');
      pulling = false;
    }
  }, { passive: true });

  document.addEventListener('touchend', async e => {
    if (!pulling || !ptr) { pulling = false; return; }
    const dy = ((e.changedTouches[0] && e.changedTouches[0].clientY) || 0) - startY;
    if (dy > 70 && ptr.classList.contains('visible')) {
      ptr.textContent = 'Refreshing...';
      ptr.classList.add('refreshing');
      try { await route(); } catch (e) {}
    }
    ptr.classList.remove('visible', 'refreshing');
    pulling = false;
  }, { passive: true });
})();

// ============ FOCUS MANAGEMENT ============
// D-pad arrow key navigation: move focus between focusable elements
function getFocusables() {
  const sel = 'a[tabindex="0"],button:not(:disabled),[tabindex="0"],input,textarea,select';
  // Check for open overlays first — if one exists, constrain focus to it
  var overlay = document.querySelector('.confirm-overlay');
  if (overlay) {
    var overlayEls = [].slice.call(overlay.querySelectorAll(sel));
    return overlayEls.filter(function(el) { return (el.offsetParent !== null || el.offsetWidth > 0) && el.getAttribute('tabindex') !== '-1'; });
  }
  const all = [].slice.call(document.getElementById('topbar').querySelectorAll(sel)).concat([].slice.call($app.querySelectorAll(sel)));
  return all.filter(el => (el.offsetParent !== null || el.offsetWidth > 0) && el.getAttribute('tabindex') !== '-1');
}
document.addEventListener('keydown', e => {
  const tag = (document.activeElement && document.activeElement.tagName);
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  // Enter/Space on div[tabindex] acts as click
  if ((e.key === 'Enter' || e.key === ' ') && tag === 'DIV' && document.activeElement.hasAttribute('tabindex')) {
    e.preventDefault();
    document.activeElement.click();
    return;
  }
  // Arrow up/down move focus
  // For inputs/textareas: allow escape at boundaries
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && inInput) {
    const el = document.activeElement;
    if (tag === 'SELECT') return;
    if (tag === 'TEXTAREA') {
      // Only escape textarea if cursor is at very end (down) or very start (up)
      if (e.key === 'ArrowDown' && el.selectionStart < el.value.length) return;
      if (e.key === 'ArrowUp' && el.selectionStart > 0) return;
    }
    // For INPUT or textarea at boundary, fall through to focus navigation
  }
  const isDown = e.key === 'ArrowDown' || e.key === 'ArrowRight';
  const isUp = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
  // Left/right in inputs control cursor, don't intercept
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && inInput) return;
  if (isDown || isUp) {
    const els = getFocusables();
    if (!els.length) return;
    const idx = els.indexOf(document.activeElement);
    let next;
    if (isDown) {
      next = idx < 0 ? 0 : Math.min(idx + 1, els.length - 1);
    } else {
      next = idx < 0 ? 0 : Math.max(idx - 1, 0);
    }
    els[next].focus();
    e.preventDefault();
  }
});

// Auto-scroll focused elements into view
document.addEventListener('focusin', () => {
  if (document.activeElement && document.activeElement !== document.body) {
    requestAnimationFrame(() => {
      const el = document.activeElement;
      const rect = el.getBoundingClientRect();
      const topH = document.getElementById('topbar').offsetHeight;
      // If element is taller than viewport or top is above topbar, scroll to start
      const vh = window.innerHeight;
      if (rect.height > (vh - topH) || rect.top < topH) {
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }
});

// Post activation: Enter on post shows actions, Escape goes back to post
function activatePost(post) {
  document.querySelectorAll('.post.active').forEach(p => deactivatePost(p));
  post.classList.add('active');
  post.querySelectorAll('.post-actions button').forEach(b => b.setAttribute('tabindex', '0'));
  post.querySelectorAll('.post-reactions button').forEach(b => b.setAttribute('tabindex', '0'));
  post.querySelectorAll('.post-body a').forEach(a => a.setAttribute('tabindex', '0'));
  post.querySelectorAll('.post-body summary').forEach(s => s.setAttribute('tabindex', '0'));
  const first = post.querySelector('.post-reactions button') || post.querySelector('.post-actions button') || post.querySelector('.post-body a') || post.querySelector('.post-body summary');
  if (first) first.focus();
}
function deactivatePost(post) {
  post.classList.remove('active');
  post.querySelectorAll('.post-actions button').forEach(b => b.setAttribute('tabindex', '-1'));
  post.querySelectorAll('.post-reactions button').forEach(b => b.setAttribute('tabindex', '-1'));
  post.querySelectorAll('.post-body a').forEach(a => a.setAttribute('tabindex', '-1'));
  post.querySelectorAll('.post-body summary').forEach(s => s.setAttribute('tabindex', '-1'));
}
document.addEventListener('click', e => {
  const post = e.target.closest('.post');
  // Don't intercept clicks on links, images, or action buttons inside posts
  if (e.target.closest('.post-actions')) return;
  if (e.target.closest('.post-body img') || e.target.tagName === 'IMG') return;
  if (e.target.closest('.post-body a') || e.target.tagName === 'A') return;
  if (post && post.classList.contains('active')) { deactivatePost(post); post.focus(); return; }
  if (post && post.hasAttribute('tabindex')) activatePost(post);
});

// Focus first interactive element in #app after route changes
function focusContent() {
  requestAnimationFrame(() => {
    const el = $app.querySelector('a[tabindex="0"],button:not(:disabled),[tabindex="0"]');
    if (el) el.focus();
  });
}

// ============ INIT ============
route();
