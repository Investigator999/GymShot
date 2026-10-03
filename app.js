'use strict';

const STORE_KEY = 'gymshot.items.v1';
const TAGS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Glutes', 'Core', 'Full body', 'Cardio', 'Mobility'];

const PLATFORMS = [
  { id: 'instagram', name: 'Instagram', icon: '📸', test: /(^|\.)instagram\.com$|(^|\.)instagr\.am$/ },
  { id: 'tiktok', name: 'TikTok', icon: '🎵', test: /(^|\.)tiktok\.com$/ },
  { id: 'youtube', name: 'YouTube', icon: '▶️', test: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/ },
  { id: 'facebook', name: 'Facebook', icon: '📘', test: /(^|\.)facebook\.com$|(^|\.)fb\.watch$/ },
  { id: 'x', name: 'X', icon: '✖️', test: /(^|\.)twitter\.com$|(^|\.)x\.com$/ },
];

const $ = (sel) => document.querySelector(sel);

// ---------- state ----------
let items = load();
const view = { status: 'todo', tag: null, q: '' };
let editingId = null;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(items));
  } catch {
    toast('Could not save — storage is full or blocked');
  }
}

// ---------- link helpers ----------
function extractUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[).,!?]+$/, '') : '';
}

function platformOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\.|^m\./, '');
    return PLATFORMS.find((p) => p.test.test(host)) || null;
  } catch {
    return null;
  }
}

// Strip tracking params so the same reel shared twice is detected as a duplicate.
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    const p = platformOf(url);
    if (p && p.id === 'youtube') {
      const v = u.searchParams.get('v');
      u.search = v ? `?v=${v}` : '';
    } else if (p) {
      u.search = '';
    }
    u.hostname = u.hostname.replace(/^(www|m)\./, '');
    return u.toString().replace(/\/$/, '');
  } catch {
    return url.trim();
  }
}

function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1).split('/')[0];
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{6,})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

function defaultTitle(url) {
  const p = platformOf(url);
  if (!p) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Saved video'; }
  }
  if (p.id === 'instagram') return url.includes('/reel') ? 'Instagram reel' : 'Instagram post';
  if (p.id === 'youtube') return url.includes('/shorts/') ? 'YouTube Short' : 'YouTube video';
  return `${p.name} video`;
}

// Shared text often looks like "Check out this reel! https://..." – keep the human part.
function titleFromShare(title, text, url) {
  const cleanText = String(text || '').replace(/https?:\/\/\S+/g, '').trim();
  const t = (title || '').trim() || cleanText;
  return t ? t.slice(0, 140) : defaultTitle(url);
}

// ---------- rendering ----------
function filtered() {
  const q = view.q.toLowerCase();
  return items
    .filter((it) => {
      if (view.status === 'todo' && it.tried) return false;
      if (view.status === 'tried' && !it.tried) return false;
      if (view.status === 'fav' && !it.fav) return false;
      if (view.tag && !(it.tags || []).includes(view.tag)) return false;
      if (q && !`${it.title} ${it.notes} ${(it.tags || []).join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function renderChips() {
  const box = $('#tagChips');
  box.replaceChildren(
    ...['All', ...TAGS].map((t) => {
      const b = document.createElement('button');
      b.className = 'chip' + ((t === 'All' ? !view.tag : view.tag === t) ? ' on' : '');
      b.textContent = t;
      b.onclick = () => { view.tag = t === 'All' ? null : t; render(); };
      return b;
    })
  );
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) n[k] = v;
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  n.append(...children.filter((c) => c != null && c !== false));
  return n;
}

function card(it) {
  const p = platformOf(it.url);
  const yt = p && p.id === 'youtube' ? youtubeId(it.url) : null;
  const thumb = el('a', { class: `thumb ${p ? p.id : ''}`, href: it.url, target: '_blank', rel: 'noopener', 'aria-label': 'Open video' },
    yt ? el('img', { src: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, alt: '', loading: 'lazy' }) : (p ? p.icon : '🔗'));

  const date = new Date(it.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return el('li', { class: 'card' + (it.tried ? ' tried' : ''), 'data-id': it.id },
    thumb,
    el('div', { class: 'body' },
      el('p', { class: 'title' }, it.fav ? '★ ' : '', it.title),
      el('div', { class: 'meta' }, `${p ? p.name : 'Link'} · saved ${date}`, it.tried ? ' · ✓ tried' : ''),
      it.tags && it.tags.length ? el('div', { class: 'tags' }, ...it.tags.map((t) => el('span', { class: 'tag' }, t))) : null,
      it.notes ? el('p', { class: 'notes' }, it.notes) : null,
      el('div', { class: 'actions' },
        el('a', { class: 'open', href: it.url, target: '_blank', rel: 'noopener' }, 'Watch'),
        el('button', { class: it.tried ? 'on' : '', onclick: () => update(it.id, { tried: !it.tried }) }, it.tried ? '✓ Tried' : 'Mark tried'),
        el('button', { class: it.fav ? 'on' : '', 'aria-label': 'Favorite', onclick: () => update(it.id, { fav: !it.fav }) }, it.fav ? '★' : '☆'),
        el('button', { onclick: () => openEditor(it) }, 'Edit'),
        el('button', { class: 'del', 'aria-label': 'Delete', onclick: () => remove(it.id) }, 'Delete')
      )
    )
  );
}

function render() {
  document.querySelectorAll('#statusSeg button').forEach((b) =>
    b.classList.toggle('active', b.dataset.status === view.status));
  renderChips();
  const list = filtered();
  $('#list').replaceChildren(...list.map(card));
  $('#empty').hidden = items.length > 0;
  const total = items.length;
  const todo = items.filter((i) => !i.tried).length;
  $('#count').textContent = total
    ? `${list.length} shown · ${todo} to try · ${total - todo} tried`
    : '';
}

// ---------- mutations ----------
function update(id, patch) {
  const it = items.find((i) => i.id === id);
  if (!it) return;
  Object.assign(it, patch, { updatedAt: Date.now() });
  if (patch.tried) it.triedAt = Date.now();
  persist();
  render();
}

function remove(id) {
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return;
  const [gone] = items.splice(idx, 1);
  persist();
  render();
  toast('Deleted', 'Undo', () => {
    items.splice(idx, 0, gone);
    persist();
    render();
  });
}

function findDuplicate(url) {
  const n = normalizeUrl(url);
  return items.find((i) => normalizeUrl(i.url) === n);
}

function highlight(id) {
  requestAnimationFrame(() => {
    const node = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.remove('highlight');
    void node.offsetWidth;
    node.classList.add('highlight');
  });
}

function revealItem(it) {
  // Make sure the item is visible under the current filters.
  if ((view.status === 'todo' && it.tried) || (view.status === 'tried' && !it.tried) || (view.status === 'fav' && !it.fav)) {
    view.status = 'all';
  }
  if (view.tag && !(it.tags || []).includes(view.tag)) view.tag = null;
  view.q = '';
  $('#search').value = '';
  render();
  highlight(it.id);
}

// ---------- editor ----------
function openEditor(it, prefill = {}) {
  editingId = it ? it.id : null;
  const f = $('#editForm');
  const data = it || { url: '', title: '', notes: '', tags: [], tried: false, fav: false, ...prefill };
  $('#editTitle').textContent = it ? 'Edit move' : 'Save move';
  f.elements.url.value = data.url;
  f.elements.title.value = data.title;
  f.elements.notes.value = data.notes || '';
  f.elements.tried.checked = !!data.tried;
  f.elements.fav.checked = !!data.fav;
  const selected = new Set(data.tags || []);
  $('#editTags').replaceChildren(
    ...TAGS.map((t) => {
      const b = el('button', { type: 'button', class: 'chip' + (selected.has(t) ? ' on' : '') }, t);
      b.onclick = () => b.classList.toggle('on');
      return b;
    })
  );
  $('#editDlg').showModal();
  if (!it) setTimeout(() => f.elements.title.select(), 50);
}

$('#editForm').addEventListener('submit', (e) => {
  if (!e.submitter || e.submitter.value !== 'save') return;
  const f = e.target;
  const url = extractUrl(f.elements.url.value) || f.elements.url.value.trim();
  if (!url) return;
  const fields = {
    url,
    title: f.elements.title.value.trim() || defaultTitle(url),
    notes: f.elements.notes.value.trim(),
    tags: [...document.querySelectorAll('#editTags .chip.on')].map((b) => b.textContent),
    tried: f.elements.tried.checked,
    fav: f.elements.fav.checked,
  };
  if (editingId) {
    update(editingId, fields);
    toast('Updated');
  } else {
    const dup = findDuplicate(url);
    if (dup) {
      update(dup.id, fields);
      revealItem(dup);
      toast('Already saved — updated it');
      return;
    }
    const it = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()), createdAt: Date.now(), ...fields };
    if (it.tried) it.triedAt = Date.now();
    items.push(it);
    persist();
    revealItem(it);
    toast('Saved 💪');
  }
});

function startAdd(rawUrl, title = '', text = '') {
  const url = extractUrl(rawUrl) || extractUrl(text) || extractUrl(title);
  if (!url) {
    toast('That doesn’t look like a link');
    return;
  }
  const dup = findDuplicate(url);
  if (dup) {
    revealItem(dup);
    toast('Already in your list', 'Edit', () => openEditor(dup));
    return;
  }
  openEditor(null, { url, title: titleFromShare(title, text, url) });
}

// ---------- share target / deep link ----------
function handleIncomingShare() {
  const params = new URLSearchParams(location.search);
  const url = params.get('url') || '';
  const text = params.get('text') || '';
  const title = params.get('title') || '';
  if (!url && !text && !title) return;
  history.replaceState(null, '', location.pathname);
  startAdd(url, title, text);
}

// ---------- toast ----------
let toastTimer;
function toast(msg, actionLabel, action) {
  const t = $('#toast');
  t.replaceChildren(el('span', {}, msg));
  if (actionLabel) {
    t.append(el('button', { onclick: () => { t.classList.remove('show'); action(); } }, actionLabel));
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), actionLabel ? 5000 : 2200);
}

// ---------- UI wiring ----------
$('#quickForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#quickUrl').value;
  if (!v.trim()) return;
  $('#quickUrl').value = '';
  startAdd(v);
});

$('#pasteBtn').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!extractUrl(text)) {
      toast('No link on the clipboard');
      return;
    }
    startAdd(text, '', text);
  } catch {
    $('#quickUrl').focus();
    toast('Long-press the box and choose Paste');
  }
});

$('#statusSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  view.status = b.dataset.status;
  render();
});

$('#search').addEventListener('input', (e) => {
  view.q = e.target.value;
  render();
});

$('#randomBtn').addEventListener('click', () => {
  let pool = filtered().filter((i) => !i.tried);
  if (!pool.length) pool = items.filter((i) => !i.tried && (!view.tag || (i.tags || []).includes(view.tag)));
  if (!pool.length) {
    toast(items.length ? 'Nothing left to try here — nice work!' : 'Save some moves first');
    return;
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  revealItem(pick);
  toast(`Try: ${pick.title}`, 'Watch', () => window.open(pick.url, '_blank', 'noopener'));
});

$('#menuBtn').addEventListener('click', () => $('#menuDlg').showModal());
const showHelp = () => { $('#menuDlg').close(); $('#helpDlg').showModal(); };
$('#howBtn').addEventListener('click', showHelp);
$('#howBtn2').addEventListener('click', showHelp);

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'gymshot', version: 1, exportedAt: new Date().toISOString(), items }, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `gymshot-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${items.length} moves`);
});

$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(incoming)) throw new Error('bad file');
    let added = 0;
    for (const it of incoming) {
      if (!it || typeof it.url !== 'string' || findDuplicate(it.url)) continue;
      items.push({
        id: it.id || String(Date.now() + Math.random()),
        url: it.url,
        title: String(it.title || defaultTitle(it.url)),
        notes: String(it.notes || ''),
        tags: Array.isArray(it.tags) ? it.tags.filter((t) => typeof t === 'string') : [],
        tried: !!it.tried,
        fav: !!it.fav,
        createdAt: Number(it.createdAt) || Date.now(),
        triedAt: it.triedAt,
      });
      added++;
    }
    persist();
    $('#menuDlg').close();
    view.status = 'all';
    render();
    toast(`Imported ${added} new move${added === 1 ? '' : 's'}`);
  } catch {
    toast('Could not read that backup file');
  }
});

// Install prompt (Android / desktop Chrome)
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  $('#installBtn').hidden = false;
});
$('#installBtn').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice;
  installEvt = null;
  $('#installBtn').hidden = true;
  $('#menuDlg').close();
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
handleIncomingShare();
