// Vercel serverless function: GET /api/expand?url=<short TikTok link>
// The TikTok app often copies short links (vt.tiktok.com/…, vm.tiktok.com/…, tiktok.com/t/…)
// that TikTok's own oEmbed rejects. Browsers can't follow those redirects across sites,
// so this follows them here and returns the full video address: { url }.

const UA = 'Mozilla/5.0 (compatible; GymShot/1.0; +https://gymshot.fit)';

function isShort(u) {
  return /^(vt|vm)\.tiktok\.com$/.test(u.hostname) ||
    (/(^|\.)tiktok\.com$/.test(u.hostname) && /^\/t\/[\w-]+/.test(u.pathname));
}
const isFull = (u) => /(^|\.)tiktok\.com$/.test(u.hostname) && /^\/@[^/]+\/(video|photo)\/\d+/.test(u.pathname);

async function expand(raw) {
  let u = new URL(raw);
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(6000) });
    const loc = r.headers.get('location');
    if (!loc) return null;
    u = new URL(loc, u);
    if (isFull(u)) return `https://www.tiktok.com${u.pathname}`;
    if (!/(^|\.)tiktok\.com$/.test(u.hostname)) return null;
  }
  return null;
}

module.exports = async (req, res) => {
  let u;
  try { u = new URL(String((req.query && req.query.url) || '')); } catch { /* handled below */ }
  if (!u || !isShort(u)) {
    res.status(400).json({ error: 'Send a short TikTok link as ?url=' });
    return;
  }
  try {
    const full = await expand(u.toString());
    if (!full) {
      res.status(404).json({ error: 'Could not find the video for this link' });
      return;
    }
    res.setHeader('Cache-Control', 'public, s-maxage=86400');
    res.status(200).json({ url: full });
  } catch {
    res.status(502).json({ error: 'Could not reach TikTok' });
  }
};

module.exports.isShort = isShort;
