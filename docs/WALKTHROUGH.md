# Blackboarder - Complete Architectural & Feature Walkthrough

> **Smart Academic Companion & Deadline Intelligence for Blackboard Learn**  
> *Seamlessly synchronizing deadlines across Chrome Extension, Mobile Web App (PWA), and iOS Home Screen Widgets.*

---

## 1. System Architecture & Components

Blackboarder consists of four tightly synchronized layers designed to operate offline-first with 24/7 real-time cloud persistence:

```
┌───────────────────────────────────────────────────────────┐
│               Blackboard Learn Ultra Stream               │
│        (https://elearning.sharjah.ac.ae/ultra/stream)     │
└─────────────────────────────┬─────────────────────────────┘
                              │
                 DOM Scraper + built-in parser
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│              Blackboarder Chrome Extension                │
│             (Manifest V3 • vite • TypeScript)             │
│  - Interactive Monthly Calendar Grid                      │
│  - Course Legend Quick Filter Pills                       │
│  - Syllabus Grade Breakdown & Course Room Tracker         │
│  - Academic Quick Links Bar (Banner SSB, Grades, etc.)    │
│  - Background Service Worker (Network-guarded extraction) │
└──────────────┬─────────────────────────────▲──────────────┘
               │                             │
    Firebase Realtime DB          Firebase Realtime DB
    Push (Personal Sync Key)     Pull (Bi-directional Merge)
               │                             │
               ▼                             │
┌────────────────────────────────────────────┴──────────────┐
│           Firebase Realtime Cloud Database                │
│       (Multi-Tenant Isolation via Personal Sync Key)      │
│          /bbs_sync/{SYNC_KEY}/tasks.json                  │
└──────────────┬─────────────────────────────▲──────────────┘
               │                             │
    Realtime Snapshot PWA         Offline Mutation Sync
               │                             │
               ▼                             │
┌────────────────────────────────────────────┴──────────────┐
│              Mobile Web App (PWA)                         │
│           (mobile-web/ • Cloudflare Pages)                │
│  - Mobile-First Layout with Fixed Bottom Tab Bar          │
│  - Interactive Slide-Up Day Sheet Drawer                  │
│  - Up Next Upcoming Deadlines Agenda Card                 │
│  - 2-Column Campus Quick Links Grid                       │
│  - Offline Service Worker Cache & Mutation Queue          │
└─────────────────────────────┬─────────────────────────────┘
                              │
                    WebCal (.ics) / JSON Feed
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│             iOS Scriptable Home Screen Widget             │
│    (Live upcoming deadlines, relative urgency badges,     │
│       one-tap deep link directly to Web App)              │
└───────────────────────────────────────────────────────────┘
```

---

## 2. Chrome Extension & Desktop Experience

### A. Monthly Calendar Grid & Filter Pills
- **Monochrome & High-Taste Aesthetic**: Adheres strictly to modern, high-contrast monochrome design tokens (`--primary: #18181b;`, `--surface: #ffffff;`, `--surface-hover: #f4f4f5;`, and obsidian dark mode `--bg: #121215;`, `--surface: #1a1a1f;`).
- **Interactive Course Legend Pills**:
  - Located directly above the month navigation controls.
  - Features an **"All"** chip alongside color-coded pills for registered courses (Calculus 1, Physics 1, Physics 1 Lab, Islamic Culture, Intro to Comp Eng, English for Academic Purposes).
  - Clicking any chip filters the calendar grid, day drawer, and deadline cards in real time. Unselected chips dim smoothly to focus on the selected subject.
- **Chronological Time Sorting**: Tasks on any date are sorted chronologically from earliest to latest (e.g. 8:00 AM class quiz before 11:59 PM homework).
- **Day Summary Cards & Slide-in Drawer**:
  - Click any day cell to open the selected day drawer.
  - Interactive status toggles, share action, Google Calendar shortcut, and inline notes reader.

### B. Streamlined Extension Settings
- **Personal Sync Pairing Key**:
  - Displayed prominently at the top of the Mobile Phone Sync card (e.g., `BBS-7K2QX9M4PA`).
  - Includes one-click **Copy Key**, **New Key** generator, and **Copy Phone Pairing Link** (`https://blackboarder.pages.dev/companion/?key=...`).
- **24/7 Firebase Cloud Status**:
  - Live status indicator confirming real-time cloud connectivity without requiring any local server.
- **Scanner Maintenance & Cache**:
  - **Full Re-scan Blackboard**: Performs a non-destructive re-scan of the page, upgrading announcement text, meeting times, and room numbers without resetting completed status or notes.
  - **Clear Scan Cache**: Clears the internal cache of processed announcement IDs so subsequent scans re-evaluate all historical announcements from scratch.
- **Advanced Endpoints (Collapsible)**:
  - Technical settings (an optional own sync server, empty by default because sync runs through Firebase, the `Hosted Web Dashboard URL: https://blackboarder.pages.dev`, and midnight auto-sync) are neatly organized inside an expandable details panel, keeping the primary interface clutter-free for students while preserving full developer configurability.

---

## 3. Mobile Web App (PWA) & Mobile-First UX

The mobile web application (`mobile-web/`) is tailored for viewports `<= 640px` and installs natively as an iOS/Android PWA:

### A. Mobile Header & Bottom Navigation
- **Header**:
  - Integrated sync status line directly beneath the title showing last sync time and deadline count (e.g., `Updated Oct 15 at 06:11 PM (29 deadlines)`).
  - Compact WiFi connectivity dot indicating online/offline state.
  - Minimal action buttons: Add Deadline Manually (`+`) and Refresh.
- **Fixed Bottom Tab Bar**:
  - Fixed at `bottom: 0` with iOS safe-area padding (`env(safe-area-inset-bottom)`).
  - 4 tabs: **Calendar**, **Deadlines** (with live count badge), **Schedule**, and **Settings**.

### B. Mobile Calendar & Up Next Agenda
- **Course Filter Row**: Full horizontal width filter pills directly at the top with smooth horizontal scrolling and hidden scrollbars.
- **Slide-Up Day Sheet Drawer (`#day-sheet-drawer`)**:
  - On mobile, tapping any day opens a native-feeling slide-up bottom drawer rather than cluttering the screen with stacked cards.
- **"Up Next" Agenda Card**:
  - Positioned directly below the calendar grid on mobile.
  - Renders the next 3 upcoming uncompleted deadlines sorted chronologically from today onward.
  - Features relative urgency badges (`TODAY`, `TOMORROW`, `IN 2D`), exact scheduled time, classroom/hall tags (e.g., `A8-110`), and course color indicator.
  - **Touch-Safe Animated Checkboxes**:
    - The checkbox displays an empty circular ring when uncompleted (`opacity: 0` on the SVG icon).
    - Tapping immediately applies the `.is-checked` class (turning the circle green with a crisp white checkmark) and adds a smooth fade/scale transition.
    - 160ms later, the task is marked completed and synced. The list re-renders, and the next deadline moves into position with a clean, empty ring - completely preventing mobile touchscreen sticky hover checkmarks.

### C. 2-Column Campus Quick Links Grid
- Quick links (Banner SSB Attendance, Study Plan & Degree Audit, Final Marks & Transcript, Blackboard Ultra Portal) display in a clean 2-column mobile grid.
- Labels truncate cleanly without clipping or icon-only squishing.
- Modal manager allows students to add, reorder, or customize portal links.

---

## 4. Multi-Tenant Cloud Synchronization & Privacy

- **Zero-Login Personal Sync Keys**: Students pair their phone and extension using an isolated pairing key (e.g., `BBS-ABCD`).
- **URL Parameter Pairing & Automatic Privacy Scrub**:
  - Opening `https://blackboarder.pages.dev/companion/?key=BBS-ABCD` automatically pairs the web app and stores the key in `localStorage`.
  - The URL query string is immediately scrubbed from the address bar using `window.history.replaceState()`, preventing the student's key from being exposed in screenshots or shared links.
- **Bi-Directional Timestamp Merging**: Changes made on mobile (marking done, editing notes, adding deadlines) or in the extension merge cleanly using `updatedAt` ISO timestamps and tombstone tracking.
- **Offline Mutation Queue**: When offline, changes are enqueued in `localStorage` and automatically pushed to Firebase and local storage as soon as connectivity resumes.

---

## 5. iOS Home Screen Widget (Scriptable)

- Located in `widgets/blackboarder-widget.js`.
- Configured with the student's pairing key (`BBS_KEY`) and web dashboard URL (`https://blackboarder.pages.dev`).
- Features:
  - Fetches live deadlines directly from Firebase or WebCal feed.
  - Shows urgent deadlines with colored countdown badges.
  - **One-Tap App Launch**: Tapping the widget automatically launches Safari / PWA directly to `https://blackboarder.pages.dev/companion/`.

---

## 6. Directory Cleanliness & File Structure

```text
blackboarder/
|
|-- src/                  SOURCE: the extension, written in TypeScript
|   |-- popup/            Popup and side panel (popup.ts, popup.css, index.html)
|   |-- content/          Scraper that runs on Blackboard pages
|   |-- background/       Background worker: sync, notifications, automatic updates
|   |-- engine/           Deadline detection (regex, then an optional AI model)
|   |-- core/             Logic shared with the phone app: courses, weights, schedules
|   |-- utils/            Storage, calendar, Firebase sync, task merging
|   `-- mobile/core.ts    Entry point that is bundled into mobile-web/companion/core.js
|
|-- mobile-web/           THE WEBSITE, served as-is by Cloudflare Pages
|   |-- index.html        Landing page at /
|   |-- _worker.js        Backend (sync API and calendar feed) for Cloudflare Pages
|   `-- companion/        THE PHONE APP / PWA at /companion/
|       |-- app.js, index.html, styles.css, sw.js, manifest.json   Hand-written
|       `-- core.js, widget.js, version.json                       Generated by the build
|
|-- dist/                 THE BUILT EXTENSION: load this folder in the browser (generated)
|
|-- updater/              Update helper, copied into dist/ by the build
|-- widgets/              iOS Scriptable widget source
|-- public/               Extension manifest template and icons
|-- scripts/              Build, packaging and icon scripts
|-- tests/                Automated tests
|
|-- api/                  Vercel entry point; runs the same backend as mobile-web/_worker.js
|-- self-hosted/          Other ways to run the backend
|   |-- cloudflare-worker/   Single-file Cloudflare Worker (generated)
|   `-- server/              Node server for your own computer or Wi-Fi
|
|-- assets/               Logos
|-- docs/                 Guides: installing, hosting, how it works, course syllabi
|
|-- version.json          Build id for installs that predate dist/version.json (generated)
`-- package.json          Scripts and dependencies
```

**Which files do I edit?** Edit `src/`, the landing page (`mobile-web/index.html`), the hand-written files in `mobile-web/companion/`, `widgets/`, `updater/` and `public/`. Never edit generated files (`dist/`, `mobile-web/companion/core.js`, `mobile-web/companion/widget.js`, `version.json` files, `self-hosted/**/calendarFeed.js` and `worker.js`): `npm run build` rewrites them, and GitHub Actions rebuilds them on every push.

**Folders that cannot move:** `dist/` and `version.json` are read by installed extensions to update themselves, `mobile-web/` is the output folder set in Cloudflare Pages, and `api/` is where Vercel looks for functions.

---

## 7. Verification & Test Suite Status

- **Vitest Test Suite**: **31 test files**, **309 tests** passing with 100% green coverage.
- **Production Build**: Clean compilation via `npm run build` with Vite.
- **Lint & Safety Checks**: Zero unshielded network calls, extension context validation guards, and offline error boundaries.
