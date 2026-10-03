# GymShot

Save gym reels and videos you want to try later — no more "watch later" lists or sending links to yourself on WhatsApp.

GymShot is an installable web app (PWA). On Android it shows up in the **Share** menu of Instagram, TikTok, YouTube, etc., so saving a reel takes two taps. Everything is stored on your phone (no account, no server).

## Features
- **Share straight from Instagram / TikTok / YouTube** (Android, via the Web Share Target API)
- Paste-a-link quick add (works everywhere, including iPhone)
- Tag by muscle group (Chest, Back, Legs, …), add notes (sets, reps, cues)
- Filter: **To try / Tried / Favorites**, plus search
- 🎲 Random pick of something you haven't tried yet — handy at the gym
- Duplicate detection (the same reel shared twice is recognised; tracking params are ignored)
- Works offline; export / import a JSON backup

## Deploy (GitHub Pages)
1. Merge to `main`.
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. The workflow publishes to `https://<your-username>.github.io/gymshot/`.

## Install on your phone
- **Android (Chrome):** open the site → ⋮ → **Install app**. Then in Instagram tap **Share → GymShot**.
- **iPhone (Safari):** Share → **Add to Home Screen**. iOS doesn't allow web apps in the share sheet, so use **Copy link** in Instagram, then open GymShot and tap **Paste**.

## Run locally
```sh
npx http-server -c-1 .
```
