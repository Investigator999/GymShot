# Later, Babe

*Saw it. Loved it. Later, babe.* Save the workouts, beauty tips, recipes and date spots you find on Instagram, TikTok, YouTube and Facebook in one list, so you can try them later. No more "watch later" lists or sending links to yourself on WhatsApp.

The app comes in two looks people pick on first launch (and can switch in ⋯ → Change style): **GymShot** (dark + lime, gym groups) and **Later, Babe** (pink + cream, fitness/beauty/recipes/date-spot groups). On a `laterbabe` domain it opens as Later, Babe without asking. It is an installable web app (PWA). On Android it shows up in the **Share** menu of Instagram, TikTok, YouTube, etc., so saving a reel takes two taps. Everything is stored on your phone (no account, no server). Storage keys still use the old `gymshot.` prefix so existing saves carry over.

## Features
- **Share straight from Instagram / TikTok / YouTube** (Android, via the Web Share Target API)
- Paste-a-link quick add (works everywhere, including iPhone)
- TikTok, YouTube, Instagram and Facebook links get their cover image and title automatically (TikTok/YouTube oEmbed; Instagram via the `api/ig` Vercel function reading Instagram's public embed page; Facebook via `api/fb`, which finds the video in Facebook's public embed player so the app can capture a frame from it)
- Attach a screenshot of the reel so you can spot it at a glance (stored on-device, compressed)
- **Groups** for any topic: Fitness, Beauty, Recipes, Date spots, or your own (each with its own tags); manage them in ⋯ → Manage groups
- **Smart group pick:** after you paste a link, the caption (words, hashtags, emojis, some Arabic) picks the matching group and ticks matching tags; if a starter group you don't have fits better (e.g. Beauty for nails), it offers to add it
- Tag each save (Abs, Glutes, Pilates, Skincare, Brunch, …) and add notes
- Filter: **To try / Tried / Favorites**, plus search
- Quick 4-step intro on first launch (why it helps + how to save on your phone); reopen via ⋯ → Quick intro
- **Share** any saved video (phone share sheet, or copies the link)
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
- **Android (Chrome):** open the site → ⋮ → **Install app**. Then in Instagram tap **Share → Later, Babe**.
- **iPhone (Safari):** Share → **Add to Home Screen**. iOS doesn't allow web apps in the share sheet, so use **Copy link** in Instagram, then open Later, Babe and tap **Paste** (iOS shows a small Paste bubble to confirm).

## Run locally
```sh
npx http-server -c-1 .
```

## Credits
Logo font: [Shrikhand](https://fonts.google.com/specimen/Shrikhand) by Jonny Pinhorn, SIL Open Font License 1.1 (self-hosted in `fonts/`).

## Android app (Trusted Web Activity)
The Play Store / APK version wraps gymshot.fit in a Trusted Web Activity built with
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) (package `fit.gymshot.app`). It opens full screen
and appears in Android's Share menu. `.well-known/assetlinks.json` proves the app and site belong together;
when publishing on Google Play, add the **App signing key** SHA-256 from Play Console → App integrity to that file.
Keep the signing keystore safe; it is needed for every update.
