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
  draftShot = undefined;
  showShotPreview(it ? shots.get(it.id)?.url : null);
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

$('#exportBtn').addEventListener('click', async () => {
  const withShots = await Promise.all(items.map(async (it) => {
    const s = shots.get(it.id);
    return s ? { ...it, shot: await blobToDataUrl(s.blob) } : it;
  }));
  const blob = new Blob([JSON.stringify({ app: 'gymshot', version: 2, exportedAt: new Date().toISOString(), items: withShots }, null, 2)], { type: 'application/json' });
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
loadShots().then(render);
