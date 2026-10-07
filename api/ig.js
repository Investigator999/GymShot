// Vercel serverless function: GET /api/ig?url=<instagram post or reel link>
// Returns oEmbed-style JSON { thumbnail_url, title, author_name } read from Instagram's
// public embed page. Meta removed thumbnails from its oEmbed API in Nov 2025 and points
// developers to the post's own page data instead; browsers can't read that page (no CORS),
// so this small helper does it server-side. The image itself is served with CORS, so the
// app downloads it directly.

const HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am', 'www.instagr.am']);

function shortcode(raw) {
  try {
    const u = new URL(raw);
    if (!HOSTS.has(u.hostname)) return null;
    const m = u.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

function parse(html) {
  const img = html.match(/<img[^>]*class="EmbeddedMediaImage"[^>]*src="([^"]+)"/) ||
    html.match(/<img[^>]*src="([^"]+)"[^>]*class="EmbeddedMediaImage"/);
  const user = html.match(/class="UsernameText">([^<]+)</);
  let caption = '';
  const cap = html.match(/class="Caption">([\s\S]*?)<div class="CaptionComments"/);
  if (cap) {
    caption = decode(cap[1]
      .replace(/<a class="CaptionUsername"[\s\S]*?<\/a>/, '')
      .replace(/<br\s*\/?>/g, ' ')
      .replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ').trim();
  }
  return {
    thumbnail_url: img ? decode(img[1]) : null,
    author_name: user ? decode(user[1]).trim() : null,
    title: caption.slice(0, 300),
  };
}

const UA = 'Mozilla/5.0 (compatible; GymShot/1.0; +https://gymshot.fit)';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Share links (instagram.com/share/reel/<token>) point at the real post; find its shortcode.
async function resolveShare(raw) {
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, redirect: 'manual', signal: AbortSignal.timeout(6000) });
    const loc = r.headers.get('location');
    if (loc) {
      url = new URL(loc, url).toString();
      const code = shortcode(url);
      if (code && !/\/share\//.test(new URL(url).pathname)) return code;
      continue;
    }
    if (!r.ok) return null;
    const m = (await r.text()).match(/instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/);
    return m ? m[1] : null;
  }
  return null;
}

// Instagram sometimes answers 429/5xx under load; try again once, then the plain embed page.
async function fetchEmbed(code) {
  let lastStatus = 0;
  for (const [path, pause] of [['embed/captioned/', 0], ['embed/captioned/', 700], ['embed/', 300]]) {
    if (pause) await wait(pause);
    try {
      const r = await fetch(`https://www.instagram.com/p/${code}/${path}`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
        signal: AbortSignal.timeout(7000),
      });
      lastStatus = r.status;
      if (r.status === 404) return { status: 404 };
      if (!r.ok) continue;
      const data = parse(await r.text());
      if (data.thumbnail_url) return { status: 200, data };
      lastStatus = 404;
    } catch {
      lastStatus = 502;
    }
  }
  return { status: lastStatus === 404 ? 404 : 502 };
}

module.exports = async (req, res) => {
  const raw = String((req.query && req.query.url) || '');
  let code = shortcode(raw);
  try {
    if (code && /\/share\//.test(new URL(raw).pathname)) code = await resolveShare(raw);
  } catch {
    code = null;
  }
  if (!code) {
    res.status(400).json({ error: 'Send an Instagram post or reel link as ?url=' });
    return;
  }
  const out = await fetchEmbed(code);
  if (out.status === 404) {
    // Private, removed or age-restricted posts have no public preview.
    res.status(404).json({ error: 'No public preview for this post' });
    return;
  }
  if (out.status !== 200) {
    res.status(502).json({ error: 'Instagram did not answer, try again' });
    return;
  }
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
  res.status(200).json({ provider_name: 'Instagram', ...out.data });
};

module.exports.parse = parse;
module.exports.shortcode = shortcode;
