# GymShot

Save gym reels and videos you want to try later — no more "watch later" lists or sending links to yourself on WhatsApp.

GymShot is an installable web app (PWA). On Android it shows up in the **Share** menu of Instagram, TikTok, YouTube, etc., so saving a reel takes two taps. Everything is stored on your phone (no account, no server).

## Features
- **Share straight from Instagram / TikTok / YouTube** (Android, via the Web Share Target API)
- Paste-a-link quick add (works everywhere, including iPhone)
- TikTok & YouTube links get their cover image and title automatically (public oEmbed); Instagram still uses a screenshot
- Attach a screenshot of the reel so you can spot it at a glance (stored on-device, compressed)
- Tag by muscle group (Chest, Back, Legs, …), add notes (sets, reps, cues)
- Filter: **To try / Tried / Favorites**, plus search
- Quick 4-step intro on first launch (why it helps + how to save on your phone); reopen via ⋯ → Quick intro
- 🎲 Random pick of something you haven't tried yet — handy at the gym
- Duplicate detection (the same reel shared twice is recognised; tracking params are ignored)
- Works offline; export / import a JSON backup (includes screenshots)

## Deploy (GitHub Pages)
1. Merge to `main`.
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. The workflow publishes to `https://<your-username>.github.io/gymshot/`.

## Deploy (Cloudflare Pages)
1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
2. Project name `gymshot`, framework preset **None**, build command empty, output directory `/`.
3. Live at `https://gymshot.pages.dev`; every push to `main` redeploys. `_headers` keeps the service worker uncached.
4. Optional: **Custom domains** tab to attach a domain bought through Cloudflare.

## Deploy (Vercel)
1. vercel.com → **Add New → Project → Import** this GitHub repo.
2. Framework preset **Other**, no build command, output directory left as default.
3. Live at `https://<project>.vercel.app`; every push to `main` redeploys. `vercel.json` keeps the service worker uncached.

## Install on your phone
- **Android (Chrome):** open the site → ⋮ → **Install app**. Then in Instagram tap **Share → GymShot**.
- **iPhone (Safari):** Share → **Add to Home Screen**. iOS doesn't allow web apps in the share sheet, so use **Copy link** in Instagram, then open GymShot, paste it into the link box and tap **Add**.

## Run locally
```sh
npx http-server -c-1 .
```
