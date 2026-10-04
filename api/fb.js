// Vercel serverless function: GET /api/fb?url=<facebook reel or video link>
// Returns { video_url, title, author_name } read from Facebook's public embedded-video page
// (the one sites use to embed a video). Facebook doesn't hand out a cover image there, but
// its video files are served with CORS, so the app grabs a frame from the video itself.

const HOSTS = /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/;
const UA = 'Mozilla/5.0 (compatible; GymShot/1.0; +https://gymshot.fit)';

function checkUrl(raw) {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol) || !HOSTS.test(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

const text = (html) => decode(html.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

function parse(html) {
  const src = html.match(/"sd_src":"([^"]+)"/) || html.match(/"hd_src":"([^"]+)"/);
  let video = null;
  if (src) {
    try { video = JSON.parse(`"${src[1]}"`); } catch { /* malformed */ }
  }
  const msg = html.match(/data-testid="post_message"[^>]*>([\s\S]*?)<\/div>/);
  const heading = html.match(/class="_8z50"><a[^>]*>([\s\S]*?)<\/a>/);
  const author = html.match(/<a title="([^"]+)"[^>]*href="[^"]*ref=embed_video/);
  return {
    video_url: video && /^https:\/\/[^/]+\.fbcdn\.net\//.test(video) ? video : null,
    title: (msg ? text(msg[1]) : '') || (heading ? text(heading[1]) : ''),
    author_name: author ? decode(author[1]).trim() : null,
  };
}

async function embed(href) {
  const r = await fetch(`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=true`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(8000),
  });
  return r.ok ? parse(await r.text()) : null;
}

// Short share links (fb.watch/…, facebook.com/share/r/…) point at the real reel; follow them
// to find its address. Gives up if Facebook asks for a login instead.
async function resolveShare(u) {
  let url = u.toString();
  for (let hop = 0; hop < 4; hop++) {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
      redirect: 'manual',
      signal: AbortSignal.timeout(6000),
    });
    const loc = r.headers.get('location');
    if (loc) {
      const next = new URL(loc, url);
      if (/\/login/.test(next.pathname)) return null;
      url = next.toString();
      if (!/^\/share\//.test(next.pathname) && !/fb\.watch$/.test(next.hostname)) return url;
      continue;
    }
    if (!r.ok) return null;
    const og = (await r.text()).match(/property="og:url" content="([^"]+)"/);
    return og ? decode(og[1]) : null;
  }
  return null;
}

module.exports = async (req, res) => {
  const u = checkUrl(String((req.query && req.query.url) || ''));
  if (!u) {
    res.status(400).json({ error: 'Send a Facebook reel or video link as ?url=' });
    return;
  }
  try {
    let data = await embed(u.toString());
    if (!data?.video_url && (/^\/share\//.test(u.pathname) || /fb\.watch$/.test(u.hostname))) {
      const real = await resolveShare(u);
      if (real && checkUrl(real)) data = await embed(real);
    }
    if (!data?.video_url) {
      // Private, removed or friends-only videos have no public embed.
      res.status(404).json({ error: 'No public preview for this video' });
      return;
    }
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=21600');
    res.status(200).json({ provider_name: 'Facebook', ...data });
  } catch {
    res.status(502).json({ error: 'Could not reach Facebook' });
  }
};

module.exports.parse = parse;
