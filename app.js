'use strict';

const STORE_KEY = 'gymshot.items.v1';
const COLS_KEY = 'gymshot.collections.v1';
const VIEW_COL_KEY = 'gymshot.view.col';
const GYM_TAGS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Glutes', 'Core', 'Full body', 'Cardio', 'Mobility'];
// Groups ("collections") let one app hold gym moves, recipes, funny videos and anything else.
const DEFAULT_COLS = [
  { id: 'gym', name: 'Gym', emoji: '💪', tags: GYM_TAGS },
  { id: 'cooking', name: 'Cooking', emoji: '🍳', tags: ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Healthy', 'Quick'] },
  { id: 'funny', name: 'Funny', emoji: '😂', tags: ['Pets', 'Kids', 'Pranks', 'Memes'] },
];
const COL_TEMPLATES = [
  ...DEFAULT_COLS,
  { id: 'restaurants', name: 'Restaurants', emoji: '🍽️', tags: ['Date night', 'Brunch', 'Cheap eats', 'Family', 'Must try'] },
  { id: 'travel', name: 'Travel', emoji: '✈️', tags: ['Places', 'Hotels', 'Food spots', 'Tips'] },
  { id: 'beauty', name: 'Beauty', emoji: '💄', tags: ['Makeup', 'Skincare', 'Hair', 'Nails'] },
  { id: 'home', name: 'Home & DIY', emoji: '🏠', tags: ['Decor', 'Cleaning', 'Organizing', 'Repairs'] },
  { id: 'learning', name: 'Learning', emoji: '📚', tags: ['Language', 'Tech', 'Money', 'Life hacks'] },
  { id: 'kids', name: 'Kids', emoji: '🧸', tags: ['Activities', 'Crafts', 'Parenting', 'Food'] },
];

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
let collections = loadCols();
const view = { status: 'todo', tag: null, q: '', col: loadViewCol() };
let editingId = null;
let draftShot; // undefined = unchanged, null = remove, Blob = new screenshot
const shots = new Map(); // item id -> { blob, url }

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function cloneCol(c) {
  return { id: c.id, name: c.name, emoji: c.emoji, tags: [...c.tags] };
}
function loadCols() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLS_KEY) || 'null');
    const ok = Array.isArray(raw) ? raw.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string') : [];
    if (ok.length) {
      return ok.map((c) => ({ id: c.id, name: c.name, emoji: typeof c.emoji === 'string' ? c.emoji : '📁',
        tags: Array.isArray(c.tags) ? c.tags.filter((t) => typeof t === 'string' && t.trim()) : [] }));
    }
  } catch { /* fall through to defaults */ }
  return DEFAULT_COLS.map(cloneCol);
}
function persistCols() {
  try { localStorage.setItem(COLS_KEY, JSON.stringify(collections)); } catch { /* ignore */ }
}
function loadViewCol() {
  try { return localStorage.getItem(VIEW_COL_KEY) || 'gym'; } catch { return 'gym'; }
}
function setViewCol(id) {
  view.col = id;
  view.tag = null;
  try { localStorage.setItem(VIEW_COL_KEY, id); } catch { /* ignore */ }
}
function colById(id) {
  return collections.find((c) => c.id === id) || collections[0];
}
// Items saved before groups existed (or whose group was removed) belong to the first group.
function itemCol(it) {
  return it.col && collections.some((c) => c.id === it.col) ? it.col : collections[0].id;
}
function newColId(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group';
  let id = base, n = 2;
  while (collections.some((c) => c.id === id)) id = `${base}-${n++}`;
  return id;
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(items));
  } catch {
    toast('Could not save — storage is full or blocked');
  }
}

// ---------- screenshots (IndexedDB) ----------
// Screenshots are too big for localStorage, so they live in IndexedDB keyed by item id.
let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('gymshot', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('shots');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function dbTx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('shots', mode);
    const req = fn(tx.objectStore('shots'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

async function loadShots() {
  try {
    const d = await db();
    await new Promise((resolve, reject) => {
      const req = d.transaction('shots').objectStore('shots').openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve();
        if (c.value instanceof Blob) shots.set(c.key, { blob: c.value, url: URL.createObjectURL(c.value) });
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    // IndexedDB unavailable (e.g. private mode) – app still works without screenshots.
  }
}

// Updates the in-memory map right away (so render() sees it) and persists in the background.
function setShot(id, blob) {
  const old = shots.get(id);
  if (old) URL.revokeObjectURL(old.url);
  if (blob) {
    shots.set(id, { blob, url: URL.createObjectURL(blob) });
    dbTx('readwrite', (st) => st.put(blob, id)).catch(() => toast('Could not save the screenshot'));
  } else {
    shots.delete(id);
    dbTx('readwrite', (st) => st.delete(id)).catch(() => {});
  }
}

// Shrink to a small JPEG so hundreds of screenshots stay cheap to store.
async function compressImage(file, maxSide = 720) {
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = src;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.78));
  } finally {
    URL.revokeObjectURL(src);
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
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
      if (itemCol(it) !== view.col) return false;
      if (view.status === 'todo' && it.tried) return false;
      if (view.status === 'tried' && !it.tried) return false;
      if (view.status === 'fav' && !it.fav) return false;
      if (view.tag && !(it.tags || []).includes(view.tag)) return false;
      if (q && !`${it.title} ${it.notes} ${(it.tags || []).join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function renderCols() {
  const counts = {};
  items.forEach((it) => { const c = itemCol(it); counts[c] = (counts[c] || 0) + 1; });
  $('#colBar').replaceChildren(
    ...collections.map((c) => {
      const b = el('button', { type: 'button', class: 'colpill' + (c.id === view.col ? ' on' : ''), 'aria-pressed': c.id === view.col ? 'true' : 'false' },
        el('span', { class: 'emo' }, c.emoji), ' ' + c.name, counts[c.id] ? el('span', { class: 'n' }, String(counts[c.id])) : null);
      b.onclick = () => { setViewCol(c.id); render(); };
      return b;
    }),
    el('button', { type: 'button', class: 'colpill add', onclick: () => openCols(true) }, '+ New'));
}

function renderChips() {
  const box = $('#tagChips');
  const tags = colById(view.col).tags;
  if (view.tag && !tags.includes(view.tag)) view.tag = null;
  box.hidden = tags.length === 0;
  box.replaceChildren(
    ...['All', ...tags].map((t) => {
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
  const shot = shots.get(it.id);
  const thumb = el('a', { class: `thumb ${shot ? 'has-shot' : p ? p.id : ''}`, href: it.url, target: '_blank', rel: 'noopener', 'aria-label': 'Open video' },
    shot ? el('img', { src: shot.url, alt: '' })
      : yt ? el('img', { src: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, alt: '', loading: 'lazy' })
      : (p ? p.icon : '🔗'),
    shot && p ? el('span', { class: 'badge' }, p.icon) : null);

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
        el('button', { onclick: () => shareItem(it) }, 'Share'),
        el('button', { onclick: () => openEditor(it) }, 'Edit'),
        el('button', { class: 'del', 'aria-label': 'Delete', onclick: () => remove(it.id) }, 'Delete')
      )
    )
  );
}

function render() {
  document.querySelectorAll('#statusSeg button').forEach((b) =>
    b.classList.toggle('active', b.dataset.status === view.status));
  if (!collections.some((c) => c.id === view.col)) setViewCol(collections[0].id);
  renderCols();
  renderChips();
  const list = filtered();
  $('#list').replaceChildren(...list.map(card));
  $('#empty').hidden = items.length > 0;
  const col = colById(view.col);
  const inCol = items.filter((i) => itemCol(i) === col.id);
  const todo = inCol.filter((i) => !i.tried).length;
  $('#count').textContent = !items.length ? ''
    : inCol.length ? `${list.length} shown · ${todo} to try · ${inCol.length - todo} tried`
    : `Nothing in ${col.name} yet. Paste a link above to save your first one.`;
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

// Share a saved video through the phone's share sheet; fall back to copying the link.
async function shareItem(it) {
  const text = `${it.title}${it.notes ? `\n${it.notes}` : ''}\n\nSaved with GymShot · gymshot.fit`;
  if (navigator.share) {
    try {
      await navigator.share({ title: it.title, text, url: it.url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // the person closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(it.url);
    toast('Link copied. Paste it anywhere to share');
  } catch {
    window.prompt ? window.prompt('Copy this link:', it.url) : toast(it.url);
  }
}

function remove(id) {
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return;
  const [gone] = items.splice(idx, 1);
  const goneShot = shots.get(id)?.blob;
  if (goneShot) setShot(id, null);
  persist();
  render();
  toast('Deleted', 'Undo', () => {
    items.splice(idx, 0, gone);
    if (goneShot) setShot(id, goneShot);
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
  if (itemCol(it) !== view.col) setViewCol(itemCol(it));
  if ((view.status === 'todo' && it.tried) || (view.status === 'tried' && !it.tried) || (view.status === 'fav' && !it.fav)) {
    view.status = 'all';
  }
  if (view.tag && !(it.tags || []).includes(view.tag)) view.tag = null;
  view.q = '';
  $('#search').value = '';
  render();
  highlight(it.id);
}

// ---------- automatic previews (TikTok / YouTube) ----------
// Both publish a public oEmbed endpoint (CORS-enabled) with the video's title and cover image,
// so those links get a thumbnail without a screenshot. Instagram requires a paid token, so it can't.
const OEMBED = {
  tiktok: (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`,
  // Instagram dropped thumbnails from its oEmbed API, so our own helper (api/ig.js on Vercel)
  // reads them from Instagram's public embed page and answers in the same shape.
  instagram: (u) => `api/ig?url=${encodeURIComponent(u)}`,
  youtube: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
};

function canPreview(url) {
  const p = platformOf(url);
  return !!(p && OEMBED[p.id]);
}

// Captions are often long and full of hashtags; keep a short, readable title.
function cleanCaption(text) {
  const t = String(text || '').replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim();
  return t.length > 80 ? t.slice(0, 77).trimEnd() + '…' : t;
}

function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function fetchPreview(url) {
  const p = platformOf(url);
  if (!p || !OEMBED[p.id]) return null;
  let data = {};
  try {
    const res = await fetchWithTimeout(OEMBED[p.id](url));
    if (res.ok) data = await res.json();
  } catch { /* fall through: YouTube can still get a thumbnail from its id */ }
  const yt = p.id === 'youtube' ? youtubeId(url) : null;
  const thumb = data.thumbnail_url || (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null);
  let image = null;
  if (thumb) {
    try {
      // TikTok's CDN rejects hotlinked requests that carry a Referer.
      const r = await fetchWithTimeout(thumb, { referrerPolicy: 'no-referrer' });
      if (r.ok) image = await compressImage(await r.blob());
    } catch { /* keep the title even if the image fails */ }
  }
  const title = cleanCaption(data.title) || (data.author_name ? `@${data.author_name} on ${p.name}` : '');
  return image || title ? { title, image } : null;
}

// The preview for the move currently open in the editor (it keeps going if Save is tapped early).
let pendingPreview = null;

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
  draftShot = undefined;
  showShotPreview(it ? shots.get(it.id)?.url : null);
  pendingPreview = null;
  if (!it && canPreview(data.url)) {
    const req = { url: data.url, promise: fetchPreview(data.url) };
    pendingPreview = req;
    $('#shotPreview').classList.add('loading');
    $('#shotPreview').replaceChildren(el('span', {}, '⏳'));
    req.promise.then((prev) => {
      if (pendingPreview !== req) return; // editor moved on; the save handler takes it from here
      $('#shotPreview').classList.remove('loading');
      if (draftShot === undefined && !prev?.image) showShotPreview(null);
      if (!prev) return;
      if (prev.image && draftShot === undefined) useShotFile(prev.image);
      const titleInput = f.elements.title;
      if (prev.title && titleInput.value.trim() === defaultTitle(data.url)) titleInput.value = prev.title;
    });
  }
  editorCol = it ? itemCol(it) : view.col;
  editorTags = new Set(data.tags || []);
  renderEditorGroups();
  $('#editDlg').showModal();
  if (!it) setTimeout(() => f.elements.title.select(), 50);
}

const NOTE_HINTS = {
  gym: 'Sets, reps, cues, which machine…',
  cooking: 'Ingredients, oven temperature, swaps…',
  funny: 'Who to send it to…',
  restaurants: 'Location, what to order, price…',
};
let editorCol = null;
let editorTags = new Set();

function renderEditorGroups() {
  $('#editCols').replaceChildren(...collections.map((c) => {
    const b = el('button', { type: 'button', class: 'chip' + (c.id === editorCol ? ' on' : '') }, el('span', { class: 'emo' }, c.emoji), ' ' + c.name);
    b.onclick = () => { editorCol = c.id; renderEditorGroups(); };
    return b;
  }));
  const col = colById(editorCol);
  $('#tagLegend').textContent = col.id === 'gym' ? 'Muscle group' : 'Tags';
  $('#editTitle').textContent = editingId ? 'Edit' : `Save to ${col.name}`;
  $('#editForm').elements.notes.placeholder = NOTE_HINTS[col.id] || 'Notes, tips, anything to remember…';
  $('#editTags').replaceChildren(...col.tags.map((t) => {
    const b = el('button', { type: 'button', class: 'chip' + (editorTags.has(t) ? ' on' : '') }, t);
    b.onclick = () => { editorTags.has(t) ? editorTags.delete(t) : editorTags.add(t); b.classList.toggle('on'); };
    return b;
  }));
  $('#newTag').value = '';
}

function addEditorTag() {
  const name = $('#newTag').value.trim().slice(0, 24);
  if (!name) return;
  const col = colById(editorCol);
  const existing = col.tags.find((t) => t.toLowerCase() === name.toLowerCase());
  if (!existing) { col.tags.push(name); persistCols(); }
  editorTags.add(existing || name);
  renderEditorGroups();
}
$('#newTagBtn').addEventListener('click', addEditorTag);
// Enter would otherwise submit the dialog form through its first button (Cancel).
$('#newTag').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addEditorTag(); } });

function showShotPreview(url) {
  const box = $('#shotPreview');
  box.replaceChildren(url ? el('img', { src: url, alt: 'Screenshot' }) : el('span', {}, '🖼️'));
  box.classList.toggle('empty-shot', !url);
  $('#shotBtn').textContent = url ? 'Change screenshot' : 'Add screenshot';
  $('#shotRemove').hidden = !url;
}

async function useShotFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    const blob = await compressImage(file);
    if (!blob) throw new Error('encode failed');
    draftShot = blob;
    if (showShotPreview.url) URL.revokeObjectURL(showShotPreview.url);
    showShotPreview.url = URL.createObjectURL(blob);
    showShotPreview(showShotPreview.url);
  } catch {
    toast('Could not read that image');
  }
}

$('#shotBtn').addEventListener('click', () => $('#shotFile').click());
$('#shotPreview').addEventListener('click', () => $('#shotFile').click());
$('#shotFile').addEventListener('change', (e) => {
  useShotFile(e.target.files[0]);
  e.target.value = '';
});
$('#shotRemove').addEventListener('click', () => {
  draftShot = null;
  showShotPreview(null);
});
// Pasting an image anywhere in the dialog attaches it.
$('#editDlg').addEventListener('paste', (e) => {
  const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
  if (file) {
    e.preventDefault();
    useShotFile(file);
  }
});

$('#editDlg').addEventListener('close', () => {
  $('#shotPreview').classList.remove('loading');
});

$('#editForm').addEventListener('submit', (e) => {
  if (!e.submitter || e.submitter.value !== 'save') return;
  const f = e.target;
  const url = extractUrl(f.elements.url.value) || f.elements.url.value.trim();
  if (!url) return;
  const fields = {
    url,
    title: f.elements.title.value.trim() || defaultTitle(url),
    notes: f.elements.notes.value.trim(),
    // Keep only tags that belong to the chosen group.
    tags: colById(editorCol).tags.filter((t) => editorTags.has(t)),
    col: colById(editorCol).id,
    tried: f.elements.tried.checked,
    fav: f.elements.fav.checked,
  };
  if (editingId) {
    if (draftShot !== undefined) setShot(editingId, draftShot);
    update(editingId, fields);
    toast('Updated');
  } else {
    const dup = findDuplicate(url);
    if (dup) {
      if (draftShot !== undefined) setShot(dup.id, draftShot);
      update(dup.id, fields);
      revealItem(dup);
      toast('Already saved — updated it');
      return;
    }
    const it = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()), createdAt: Date.now(), ...fields };
    if (it.tried) it.triedAt = Date.now();
    if (draftShot) setShot(it.id, draftShot);
    else if (draftShot === undefined && pendingPreview && pendingPreview.url === url) {
      // Saved before the preview arrived: attach it when it lands.
      const genericTitle = it.title === defaultTitle(url);
      pendingPreview.promise.then((prev) => {
        if (!prev || !items.includes(it)) return;
        if (prev.image && !shots.has(it.id)) setShot(it.id, prev.image);
        if (genericTitle && prev.title && it.title === defaultTitle(url)) it.title = prev.title;
        it.previewTried = true;
        persist();
        render();
      });
    }
    if (pendingPreview) it.previewTried = true;
    pendingPreview = null;
    items.push(it);
    persist();
    revealItem(it);
    toast(`Saved to ${colById(it.col).name} ${colById(it.col).emoji}`);
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
// With an empty box the button reads "Paste" and pulls the copied link from the clipboard.
// On iPhone that shows Apple's own "Paste" bubble, which works even when the text-box menu doesn't.
function syncAddBtn() {
  $('#addBtn').textContent = $('#quickUrl').value.trim() ? 'Add' : 'Paste';
}

async function pasteFromClipboard() {
  if (!navigator.clipboard?.readText) {
    $('#quickUrl').focus();
    toast('Paste the link into the box, then tap Add');
    return;
  }
  // Must start inside the tap, before any await, or iOS refuses.
  const pending = navigator.clipboard.readText();
  if (IS_IOS_DEVICE) $('#pasteHint').hidden = false;
  try {
    const text = await pending;
    $('#pasteHint').hidden = true;
    if (extractUrl(text)) startAdd(text, '', text);
    else toast('No link copied yet. In Instagram or TikTok tap Share → Copy link first');
  } catch {
    $('#pasteHint').hidden = true;
    $('#quickUrl').focus();
    toast('Paste the link into the box, then tap Add');
  }
}

$('#quickForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#quickUrl').value;
  if (!v.trim()) { pasteFromClipboard(); return; }
  $('#quickUrl').value = '';
  syncAddBtn();
  startAdd(v);
});

// Pasting a link into the box opens the save screen straight away.
$('#quickUrl').addEventListener('paste', (e) => {
  const cd = e.clipboardData;
  const text = cd ? (cd.getData('text') || cd.getData('text/uri-list') || cd.getData('URL')) : '';
  if (!extractUrl(text)) return; // let the browser paste whatever it is
  e.preventDefault();
  $('#quickUrl').value = '';
  $('#quickUrl').blur();
  syncAddBtn();
  startAdd(text, '', text);
});
const IS_IOS_DEVICE = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
$('#quickUrl').addEventListener('input', syncAddBtn);

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
  if (!pool.length) pool = items.filter((i) => !i.tried && itemCol(i) === view.col && (!view.tag || (i.tags || []).includes(view.tag)));
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

// ---------- first-run intro ----------
const INTRO_KEY = 'gymshot.introSeen';
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(navigator.userAgent);
const isInstalled = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function buildIntro() {
  const steps = isIOS
    ? ['In Instagram / TikTok, open the reel you like.', 'Tap <b>Share → Copy link</b>.',
       'In GymShot tap <b>Paste</b>, then the little <b>Paste</b> bubble.', 'The cover fills in by itself. Pick a group, <b>Save</b>.']
    : isAndroid
      ? ['In Instagram / TikTok / YouTube tap <b>Share</b> on a reel.', 'Choose <b>GymShot</b> (look under “More” the first time).',
         'Pick a muscle group, add a screenshot if you like.', 'Tap <b>Save</b> — done!']
      : ['Copy the link of a reel or video.', 'Paste it into the link box and tap <b>Add</b>.',
         'Pick a muscle group, add a screenshot and notes.', 'Tap <b>Save</b> — done!'];
  // Steps are static strings written above, so innerHTML is safe here.
  $('#introSaveSteps').innerHTML = steps.map((t) => `<li><div>${t}</div></li>`).join('');

  const tip = $('#introInstallTip');
  if (!isInstalled && (isIOS || isAndroid)) {
    tip.innerHTML = isIOS
      ? '📌 Tip: in Safari tap <b>Share → Add to Home Screen</b> to open GymShot like an app.'
      : '📌 Tip: tap <b>⋮ → Install app</b> so GymShot shows up in your Share menu.';
    tip.hidden = false;
  }
  const n = document.querySelectorAll('#slides .slide').length;
  $('#introDots').replaceChildren(...Array.from({ length: n }, () => el('span')));
}

function introIndex() {
  const box = $('#slides');
  return Math.round(box.scrollLeft / box.clientWidth);
}
function updateIntroNav() {
  const i = introIndex();
  const n = document.querySelectorAll('#slides .slide').length;
  document.querySelectorAll('#introDots span').forEach((d, k) => d.classList.toggle('on', k === i));
  $('#introNext').textContent = i === n - 1 ? 'Start saving' : 'Next';
  $('#introSkip').style.visibility = i === n - 1 ? 'hidden' : 'visible';
}
function openIntro() {
  if ($('#menuDlg').open) $('#menuDlg').close();
  $('#introDlg').showModal();
  // Jump to the first slide without animating. (Avoids scrollTo's 'instant' option, which older Safari rejects.)
  const box = $('#slides');
  box.style.scrollBehavior = 'auto';
  box.scrollLeft = 0;
  box.style.scrollBehavior = '';
  updateIntroNav();
}
function closeIntro() {
  try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* ignore */ }
  $('#introDlg').close();
}
buildIntro();
$('#slides').addEventListener('scroll', () => requestAnimationFrame(updateIntroNav), { passive: true });
$('#introNext').addEventListener('click', () => {
  const box = $('#slides');
  const n = document.querySelectorAll('#slides .slide').length;
  if (introIndex() >= n - 1) {
    closeIntro();
    $('#quickUrl').focus();
  } else {
    box.scrollTo({ left: (introIndex() + 1) * box.clientWidth });
  }
});
$('#introSkip').addEventListener('click', closeIntro);
$('#introDlg').addEventListener('cancel', () => { try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* ignore */ } });
$('#introBtn').addEventListener('click', openIntro);
$('#introBtn2').addEventListener('click', openIntro);
$('#howBtn2').addEventListener('click', showHelp);

$('#exportBtn').addEventListener('click', async () => {
  const withShots = await Promise.all(items.map(async (it) => {
    const s = shots.get(it.id);
    return s ? { ...it, shot: await blobToDataUrl(s.blob) } : it;
  }));
  const blob = new Blob([JSON.stringify({ app: 'gymshot', version: 3, exportedAt: new Date().toISOString(), collections, items: withShots }, null, 2)], { type: 'application/json' });
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
    if (Array.isArray(data.collections)) {
      for (const c of data.collections) {
        if (!c || typeof c.id !== 'string' || typeof c.name !== 'string') continue;
        const mine = collections.find((x) => x.id === c.id);
        const tags = Array.isArray(c.tags) ? c.tags.filter((t) => typeof t === 'string') : [];
        if (mine) tags.forEach((t) => { if (!mine.tags.includes(t)) mine.tags.push(t); });
        else collections.push({ id: c.id, name: c.name, emoji: typeof c.emoji === 'string' ? c.emoji : '📁', tags });
      }
      persistCols();
    }
    let added = 0;
    for (const it of incoming) {
      if (!it || typeof it.url !== 'string' || findDuplicate(it.url)) continue;
      const id = typeof it.id === 'string' && it.id ? it.id : String(Date.now() + Math.random());
      if (typeof it.shot === 'string' && it.shot.startsWith('data:image/')) {
        try { setShot(id, await (await fetch(it.shot)).blob()); } catch { /* skip bad image */ }
      }
      items.push({
        id,
        url: it.url,
        title: String(it.title || defaultTitle(it.url)),
        notes: String(it.notes || ''),
        tags: Array.isArray(it.tags) ? it.tags.filter((t) => typeof t === 'string') : [],
        col: typeof it.col === 'string' ? it.col : undefined,
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

// ---------- manage groups ----------
let pendingDelete = null;

function renderColsDlg() {
  const counts = {};
  items.forEach((it) => { const c = itemCol(it); counts[c] = (counts[c] || 0) + 1; });
  $('#colsList').replaceChildren(...collections.map((c, idx) => {
    const emoji = el('input', { class: 'emoji-in', id: 'col-emoji-' + c.id, value: c.emoji, maxlength: '4', 'aria-label': 'Icon' });
    emoji.oninput = () => { c.emoji = emoji.value.trim() || '📁'; persistCols(); render(); };
    const name = el('input', { class: 'name-in', id: 'col-name-' + c.id, value: c.name, maxlength: '24', 'aria-label': 'Group name' });
    name.oninput = () => { if (name.value.trim()) { c.name = name.value.trim(); persistCols(); render(); } };
    const tags = el('input', { class: 'tags-in', id: 'col-tags-' + c.id, value: c.tags.join(', '), placeholder: 'Tags, separated by commas', 'aria-label': 'Tags' });
    tags.onchange = () => {
      c.tags = [...new Set(tags.value.split(',').map((t) => t.trim().slice(0, 24)).filter(Boolean))];
      persistCols(); render();
    };
    const n = counts[c.id] || 0;
    const del = el('button', { type: 'button', class: 'ghost danger small-btn', disabled: collections.length === 1 },
      pendingDelete === c.id ? (n ? `Delete? ${n} move to ${collections.find((x) => x.id !== c.id)?.name}` : 'Tap again to delete') : 'Delete');
    del.onclick = () => {
      if (pendingDelete !== c.id) { pendingDelete = c.id; renderColsDlg(); return; }
      const target = collections.find((x) => x.id !== c.id);
      items.forEach((it) => { if (itemCol(it) === c.id) it.col = target.id; });
      collections.splice(idx, 1);
      pendingDelete = null;
      persist(); persistCols();
      if (view.col === c.id) setViewCol(target.id);
      renderColsDlg(); render();
      toast(`Deleted ${c.name}`);
    };
    return el('div', { class: 'colrow' },
      el('div', { class: 'colrow-top' }, emoji, name, del),
      tags,
      el('div', { class: 'muted small' }, n === 1 ? '1 saved video' : `${n} saved videos`));
  }));
  const have = new Set(collections.map((c) => c.name.toLowerCase()));
  $('#colTemplates').replaceChildren(
    ...COL_TEMPLATES.filter((t) => !have.has(t.name.toLowerCase())).map((t) => {
      const b = el('button', { type: 'button', class: 'chip' }, el('span', { class: 'emo' }, t.emoji), ' ' + t.name);
      b.onclick = () => addCol({ ...cloneCol(t), id: newColId(t.name) });
      return b;
    }),
    el('button', { type: 'button', class: 'chip', onclick: () => addCol({ id: newColId('group'), name: 'New group', emoji: '📁', tags: [] }, true) }, '+ Your own'));
}

function addCol(c, focusName) {
  collections.push(c);
  persistCols();
  setViewCol(c.id);
  renderColsDlg(); render();
  toast(`Added ${c.name} ${c.emoji}`);
  if (focusName) setTimeout(() => { const n = document.getElementById('col-name-' + c.id); if (n) { n.focus(); n.select(); } }, 50);
}

function openCols(scrollToAdd) {
  if ($('#menuDlg').open) $('#menuDlg').close();
  pendingDelete = null;
  renderColsDlg();
  $('#colsDlg').showModal();
  if (scrollToAdd) setTimeout(() => $('#colTemplates').scrollIntoView({ block: 'nearest' }), 50);
}
$('#colsBtn').addEventListener('click', () => openCols(false));
$('#colsDlg').addEventListener('close', () => { pendingDelete = null; render(); });

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
  // When a new version is deployed, the new service worker takes over; reload once so the
  // page never keeps running old code against new HTML.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Don't interrupt someone mid-save; the new code will load next time.
    if (!hadController || reloaded || document.querySelector('dialog[open]:not(#introDlg)')) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update())
    .catch(() => {});
}

render();
const sharedIn = location.search.length > 1;
handleIncomingShare();
loadShots().then(() => {
  render();
  backfillPreviews();
});

// Fetch thumbnails for TikTok / YouTube moves saved without a picture (once per move).
async function backfillPreviews() {
  const todo = items.filter((it) => canPreview(it.url) && !shots.has(it.id) && !it.previewTried).slice(0, 20);
  for (const it of todo) {
    const prev = await fetchPreview(it.url);
    it.previewTried = true;
    if (prev?.image && !shots.has(it.id)) setShot(it.id, prev.image);
    if (prev?.title && it.title === defaultTitle(it.url)) it.title = prev.title;
    persist();
    render();
  }
}

// Show the intro once on first launch (but never on top of an incoming share).
// ---------- opened inside TikTok / Instagram / Facebook ----------
// Their built-in browsers can't install web apps and keep their own storage, so anything
// saved there is lost. Point people to their real browser instead.
const IN_APP = (() => {
  const ua = navigator.userAgent;
  if (/musical_ly|Bytedance|TikTok|trill_/i.test(ua)) return 'TikTok';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return 'Facebook';
  if (/Snapchat/i.test(ua)) return 'Snapchat';
  return null;
})();
const INAPP_KEY = 'gymshot.inappDismissed';

function showInAppBanner() {
  if (!IN_APP || isInstalled) return;
  try { if (sessionStorage.getItem(INAPP_KEY)) return; } catch { /* ignore */ }
  const browser = isIOS ? 'Safari' : 'Chrome';
  $('#inappTitle').textContent = `You’re inside ${IN_APP}`;
  // Static strings only, so innerHTML is safe here.
  $('#inappText').innerHTML = isIOS
    ? `Saves made here get lost. Tap <b>⋯</b> in ${IN_APP}’s bar <b>above this page</b>, then <b>Open in ${IN_APP === 'TikTok' ? 'browser' : 'external browser'}</b>. Then in Safari tap <b>Share → Add to Home Screen</b>.`
    : `Saves made here get lost. Open GymShot in <b>${browser}</b> to install it, then it shows up in your Share menu.`;
  if (isAndroid) {
    $('#inappOpen').hidden = false;
    $('#inappArrow').hidden = true;
  }
  $('#inappBanner').hidden = false;
}
$('#inappOpen').addEventListener('click', () => {
  // Android intent link: hands the page to Chrome; falls back to the same page if Chrome is missing.
  const here = location.href;
  const path = here.replace(/^https?:\/\//, '');
  location.href = `intent://${path}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(here)};end`;
  setTimeout(() => toast(`If nothing happened, tap ⋮ at the top right → Open in browser`), 1500);
});
$('#inappCopy').addEventListener('click', async () => {
  const link = location.origin + location.pathname;
  try {
    await navigator.clipboard.writeText(link);
    toast(`Link copied. Paste it in ${isIOS ? 'Safari' : 'Chrome'}`);
  } catch {
    toast(`Open ${link} in ${isIOS ? 'Safari' : 'Chrome'}`);
  }
});
$('#inappClose').addEventListener('click', () => {
  $('#inappBanner').hidden = true;
  try { sessionStorage.setItem(INAPP_KEY, '1'); } catch { /* ignore */ }
});
showInAppBanner();

let introSeen = false;
try { introSeen = !!localStorage.getItem(INTRO_KEY); } catch { /* ignore */ }
// Inside TikTok/Instagram the banner matters more; the intro shows once they open the real browser.
if (!introSeen && !sharedIn && !IN_APP && items.length === 0) openIntro();
