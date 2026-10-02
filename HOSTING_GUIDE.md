# Hosting the Blackboarder Web Dashboard

The `mobile-web` folder is a self-contained, standalone Progressive Web App (PWA) with built-in Firebase synchronization, responsive mobile UI, and live `.ics` WebCal calendar feeds.

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

---

## Option 2: Vercel

1. Install the Vercel CLI (or use the web dashboard at [vercel.com](https://vercel.com)):
   ```bash
   npx vercel
   ```
2. When prompted:
   - Set the root directory to `./mobile-web` (or deploy from inside `release/website`).
   - Accept the default deployment settings.
3. Your web dashboard is live at `https://<project-name>.vercel.app`.

---

## Option 3: Netlify Drop

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag and drop the `mobile-web` folder into the upload area.
3. Your dashboard is instantly deployed with an HTTPS URL.

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
2. Under **Hosted Web Dashboard URL**, enter your deployed URL (e.g. `https://my-deadlines.pages.dev`).
3. Click **"Save Settings"**.
4. Click **"Copy Phone Pairing Link"**.
5. Send that link to your phone (via WhatsApp, Telegram, or Email) and tap it.
6. Your phone opens the web dashboard, automatically pairs with your unique Sync Key, and loads all your current deadlines!

---

## Subscribing to Calendar Feeds on iPhone & Android

Once your web dashboard is hosted, you can subscribe to real-time deadline updates in your phone calendar:

- **Apple Calendar (iOS / macOS)**:
  Tap **"Subscribe in Apple / Google Calendar"** on the Settings view, or paste your feed URL (`webcal://<your-domain>/feed.ics?key=YOUR_KEY`) into **Settings > Calendar > Accounts > Add Subscribed Calendar**.
- **Google Calendar (Android / Web)**:
  Open [calendar.google.com](https://calendar.google.com) on desktop, click **+ next to "Other calendars"** > **From URL**, paste `https://<your-domain>/feed.ics?key=YOUR_KEY`, and click **Add calendar**.
