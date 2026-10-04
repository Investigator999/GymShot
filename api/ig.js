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

module.exports = async (req, res) => {
  const code = shortcode(String((req.query && req.query.url) || ''));
  if (!code) {
    res.status(400).json({ error: 'Send an Instagram post or reel link as ?url=' });
    return;
  }
  try {
    const r = await fetch(`https://www.instagram.com/p/${code}/embed/captioned/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GymShot/1.0; +https://gymshot.fit)', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      res.status(r.status === 404 ? 404 : 502).json({ error: `Instagram answered ${r.status}` });
      return;
    }
    const data = parse(await r.text());
    if (!data.thumbnail_url) {
      // Private, removed or age-restricted posts have no public preview.
      res.status(404).json({ error: 'No public preview for this post' });
      return;
    }
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json({ provider_name: 'Instagram', ...data });
  } catch {
    res.status(502).json({ error: 'Could not reach Instagram' });
  }
};

module.exports.parse = parse;
module.exports.shortcode = shortcode;
