// Vercel serverless function: GET /api/tt?url=<any TikTok video link, short or full>
// Returns oEmbed-style JSON { thumbnail_url, title, author_name } read from TikTok's public
// embed page. TikTok's own oEmbed stopped returning the cover, caption and author (it now
// only describes the player), so the app asks this helper instead. Short app links
// (vt.tiktok.com/…, vm.tiktok.com/…, tiktok.com/t/…) are expanded first.

const UA = 'Mozilla/5.0 (compatible; GymShot/1.0; +https://gymshot.fit)';
const isTikTok = (u) => /(^|\.)tiktok\.com$/.test(u.hostname);
const videoId = (u) => (u.pathname.match(/\/(?:video|photo|v)\/(\d{8,25})/) || [])[1] || null;

async function expand(raw) {
  let u = new URL(raw);
  for (let hop = 0; hop < 5 && !videoId(u); hop++) {
    const r = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(6000) });
    const loc = r.headers.get('location');
    if (!loc) return null;
    u = new URL(loc, u);
    if (!isTikTok(u)) return null;
  }
  return videoId(u);
}

function parse(html, id) {
  const m = html.match(/<script id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let state;
  try { state = JSON.parse(m[1]); } catch { return null; }
  const pages = (state && state.source && state.source.data) || {};
  const page = Object.values(pages).find((v) => v && v.videoData && (!id || String(v.videoData.itemInfos?.id) === id))
    || Object.values(pages).find((v) => v && v.videoData);
  const vd = page && page.videoData;
  if (!vd || !vd.itemInfos) return null;
  const covers = [...(vd.itemInfos.covers || []), ...(vd.itemInfos.coversOrigin || [])];
  return {
    thumbnail_url: covers.find((c) => /^https:\/\//.test(c)) || null,
    title: String(vd.itemInfos.text || '').slice(0, 300),
    author_name: (vd.authorInfos && (vd.authorInfos.uniqueId || vd.authorInfos.nickName)) || null,
  };
}

module.exports = async (req, res) => {
  let u;
  try { u = new URL(String((req.query && req.query.url) || '')); } catch { /* handled below */ }
  if (!u || !isTikTok(u)) {
    res.status(400).json({ error: 'Send a TikTok video link as ?url=' });
    return;
  }
  try {
    const id = videoId(u) || await expand(u.toString());
    if (!id) {
      res.status(404).json({ error: 'Could not find the video for this link' });
      return;
    }
    let data = null;
    for (let attempt = 0; attempt < 2 && !data; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 600));
      const r = await fetch(`https://www.tiktok.com/embed/v2/${id}`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
        signal: AbortSignal.timeout(8000),
      });
      if (r.status === 404) break;
      if (r.ok) data = parse(await r.text(), id);
    }
    if (!data || !data.thumbnail_url) {
      // Private, removed or region-blocked videos have no public embed.
      res.status(404).json({ error: 'No public preview for this video' });
      return;
    }
    // Cover links are signed and expire, so don't keep answers long.
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    res.status(200).json({ provider_name: 'TikTok', ...data });
  } catch {
    res.status(502).json({ error: 'TikTok did not answer, try again' });
  }
};

module.exports.parse = parse;
module.exports.videoId = videoId;
