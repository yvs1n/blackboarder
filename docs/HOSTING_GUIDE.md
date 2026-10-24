# Hosting the Blackboarder Web Dashboard

The `mobile-web` folder is the whole website: the landing page at `/`, the phone app (a Progressive Web App with Firebase sync) at `/companion/`, and the backend with live `.ics` calendar feeds.

You can host it on any free modern edge/static platform in under 2 minutes.

---

## Option 1: Cloudflare Pages (Recommended: Fast & Free)

Cloudflare Pages natively runs the included `_worker.js`, giving you global edge caching, instant sync API endpoints, and live calendar subscription feeds.

### Method A: Direct Upload (No Git or Build Required)
1. Go to the [Cloudflare Dashboard](https://dash.cloudflare.com/) and navigate to **Workers & Pages**.
2. Click **Create Application** > **Pages** > **Upload assets**.
3. Name your project (for example `uos-deadlines` or `my-blackboarder`).
4. Drag and drop the `mobile-web` folder (or unzip `blackboarder-website.zip` and upload that folder).
5. Click **Deploy site**.
6. Cloudflare gives you a live HTTPS URL: `https://<your-project>.pages.dev`.

### Method B: Git Integration
1. Push this repository to GitHub or GitLab.
2. In Cloudflare Pages, connect your repository.
3. Configure build settings:
   - **Framework preset**: `None`
   - **Build command**: *(leave blank)*
   - **Build output directory**: `mobile-web`
4. Click **Save and Deploy**.

Every push to `main` now deploys by itself. The repository's GitHub Actions workflow (`.github/workflows/build.yml`) rebuilds the generated files and commits them, and the web app compares its build with the deployed `version.json`: open copies (including the installed PWA) load the new version the next time they are opened or brought back to the foreground, without losing any data.

---

## Option 2: Vercel

1. Install the Vercel CLI (or use the web dashboard at [vercel.com](https://vercel.com)):
   ```bash
   npx vercel
   ```
2. When prompted:
   - Deploy from the **repository root** (not `mobile-web`), so Vercel picks up `vercel.json` and the `api/` folder.
   - Accept the default deployment settings.
3. Your web dashboard is live at `https://<project-name>.vercel.app`.

On Vercel, `api/[...path].js` runs the same backend as Cloudflare (`mobile-web/_worker.js`), so sync, the calendar feed and the security checks behave the same on both hosts. Optional environment variables: `FIREBASE_DB_URL`, `SYNC_SECRET`, `AI_KEY_SECRET`, and for push reminders `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `FIREBASE_AUTH`, `PUSH_TICK_SECRET` (see step 4 below).

---

## Securing Firebase and the API (do this once)

1. **Publish the database rules.** Open the Firebase console > Realtime Database > **Rules**, paste the contents of `database.rules.json`, and click **Publish**. The file in the repository does nothing until it is published. These rules close the old shared bucket at the root and only allow each student's own `users/<sync key>` folder.
2. **Every request needs a sync key.** The API and calendar feed answer `400` when the link has no `?key=`. If you subscribed to the calendar before this change with a link that had no key, copy the link again from Settings and re-subscribe.
3. **Let the phone app use your AI model (optional).** In the Cloudflare project (Settings > Variables and Secrets) or Vercel (Environment Variables), add a secret named `AI_KEY_SECRET` with any long random text, then redeploy. The extension sends its AI key to `/api/ai/key`; the server encrypts it with this secret plus the sync key and stores only the encrypted text at `users/<sync key>/ai` (allowed by the published rules). Pasting an announcement on the phone sends the prompt to `/api/ai/extract` and the server adds the key, so the phone never holds it. Changing the secret makes stored keys unreadable; open the extension popup and they are sent again. Without the secret, the phone app uses the built-in parser. The phone must also be paired with the link from **Copy Phone Pairing Link**: it carries an AI pass (after `#`, never sent to any server), and the server refuses AI requests without it, so the sync key alone cannot use your AI model. After this update, open that link once on each phone. On an iPhone home screen app, which keeps its own storage apart from Safari, paste the whole link into the sync key box in the app's Settings and tap **Pair Key**.
4. **Push reminders while the phone app is closed (optional).** This is the only way an iPhone home screen app gets reminders while closed; Android gets them too. Without these settings the **Reminders While Closed** switch in the phone app's Settings > Alerts says the server is not set up, and everything else works as before.
   1. On your computer, in the project folder, run `node scripts/vapid-keys.js`. It prints `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and a `VAPID_SUBJECT` line. Never commit these.
   2. In the Cloudflare project (Settings > Variables and Secrets) or Vercel (Environment Variables), add as secrets: `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (the two printed values), `VAPID_SUBJECT` (`mailto:` plus your own email address), `PUSH_TICK_SECRET` (any long random text), and `FIREBASE_AUTH`: a database secret from the Firebase console > Project settings > Service accounts > **Database secrets** (Show, then copy). The server uses it only to find which sync keys have push subscriptions, because the rules never let anyone list keys. Redeploy.
   3. Publish `database.rules.json` again (step 1). It now allows `users/<sync key>/push` and adds the index the server's lookup needs.
   4. Make the scheduler that sends reminders every 5 minutes (Cloudflare Pages cannot run on a schedule itself). In the Cloudflare dashboard: **Workers & Pages** > **Create** > **Create Worker** (Start with Hello World), name it `blackboarder-push-cron`, **Deploy**, then **Edit code**, replace everything with `self-hosted/push-cron/worker.js` and **Deploy** again. In that Worker's **Settings**: under **Variables and Secrets** add the secrets `PUSH_TICK_URL` (your site address, for example `https://blackboarder.pages.dev`) and `PUSH_TICK_SECRET` (the same value as in the Pages project); under **Trigger events** add a **Cron Trigger** with `*/5 * * * *`. (Or run `npx wrangler deploy` in `self-hosted/push-cron`, which sets the trigger from `wrangler.toml`.) Open the Worker's own address to run one check: it shows `"ok": true` and how many reminders were sent, or what is missing.
   5. Optional backup: in GitHub, Settings > Secrets and variables > Actions, add the same `PUSH_TICK_URL` and `PUSH_TICK_SECRET`. The **Push reminders** workflow then runs once an hour and can be run by hand from the Actions tab. GitHub often starts scheduled runs late, so it is only a backup.
   6. On each phone: Settings > Alerts > turn on **Reminders While Closed**. On iPhone, add the app to the Home Screen first and open it from there.

   Each phone's subscription is stored at `users/<sync key>/push`, next to that key's deadlines, and only that key's deadlines are sent to it. Reminders follow the phone's Alerts timings, are sent once each, and are encrypted for the phone, so the push service never sees a deadline's title. Making a new VAPID key pair stops reminders until each phone turns the switch off and on again.
5. **Optional hard rate limits.** The built-in limit (60 requests per minute per IP and per key) lives in each worker instance, so it slows abuse rather than stopping it. For a strict limit, add a rate limiting rule for `/api/*` in the Cloudflare dashboard (Security > WAF > Rate limiting rules).

---

## Option 3: Netlify Drop

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag and drop the `mobile-web` folder into the upload area.
3. Your dashboard is instantly deployed with an HTTPS URL.

Netlify does not run `mobile-web/_worker.js`, so the app syncs through Firebase but the calendar feed (`/feed.ics`) and AI proxy are not available. Use Cloudflare Pages or Vercel if you need them.

---

## What the Site Serves

One deployment of `mobile-web/` serves everything:

| Address | File | What it is |
| :--- | :--- | :--- |
| `/` | `mobile-web/index.html` | Landing page: features, install steps, FAQ |
| `/companion/` | `mobile-web/companion/` | Phone app (PWA) that syncs with the extension |
| `/api/*`, `/feed.ics` | `mobile-web/_worker.js` | Sync API, calendar feed, AI proxy |

Pairing links made before the phone app moved (`/?key=...`) and phones that installed the app from the site root are sent to `/companion/` automatically, by the worker and by a small script on the landing page. `mobile-web/sw.js` is the root service worker: online it leaves everything to the network, so the landing page shows up as usual; offline it sends a launch at the root to the saved app at `/companion/`, so home screen apps installed from the root keep working without internet.

To use your own domain, add it under the Pages project's **Custom domains** tab.

---

## Option 4: Local LAN Server (For Dorm / Home Wi-Fi)

To run the dashboard locally and connect your phone over your home or dorm Wi-Fi:

1. Run the local server:
   ```bash
   npm run server
   ```
2. The terminal displays your local network address:
   ```text
   Local Access:         http://localhost:3456
   Mobile Phone (Wi-Fi): http://192.168.1.50:3456
   WebCal Feed:          webcal://192.168.1.50:3456/feed.ics
   ```
3. Open `http://<your-ip>:3456` in your phone's browser and add it to your Home Screen.

---

## Pairing the Extension with Your Hosted Website

1. In the Chrome Extension popup, go to **Settings**.
2. Under **Hosted Web Dashboard URL**, enter your site address (e.g. `https://my-deadlines.pages.dev`). The extension adds `/companion/` for the phone app itself.
3. Click **"Save Settings"**.
4. Click **"Show Pairing QR Code"**, open your site's phone app (`/companion/`) on your phone and tap **Scan QR**. Or click **"Copy Phone Pairing Link"**, send it to your phone and tap it.
5. Your phone pairs with your unique Sync Key and loads all your current deadlines.

---

## Subscribing to Calendar Feeds on iPhone & Android

Once your web dashboard is hosted, you can subscribe to real-time deadline updates in your phone calendar:

- **Apple Calendar (iOS / macOS)**:
  Tap **"Subscribe in Apple / Google Calendar"** on the Settings view, or paste your feed URL (`webcal://<your-domain>/feed.ics?key=YOUR_KEY`) into **Settings > Calendar > Accounts > Add Subscribed Calendar**.
- **Google Calendar (Android / Web)**:
  Open [calendar.google.com](https://calendar.google.com) on desktop, click **+ next to "Other calendars"** > **From URL**, paste `https://<your-domain>/feed.ics?key=YOUR_KEY`, and click **Add calendar**.
