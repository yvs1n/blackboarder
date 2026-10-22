# Changelog

All notable changes to the Blackboarder project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed
- **Credit**: the landing page footer, the README, the license, `package.json` and the Settings screens of the extension and companion now say who built Blackboarder: Yassin Ragab, a freshman at UOS, linking to [yassinr.me](https://yassinr.me).
- **One design system everywhere**: the extension, the companion and the landing page share the system in `docs/DESIGN_SYSTEM.md`: the two-tone colours (near-black `#18181b` and near-white `#f4f4f6`, with grey shades between), Inter Tight headings and Inter body text (bundled, no Google requests), square corners, no gradients, and one solid primary action per screen. Every other colour was removed from the interface, red included (errors and delete buttons use the two tones; overdue badges are solid inverted blocks). Course colours are the one exception and stay as they are.
- **Landing page at the root, phone app at `/companion/`**: `blackboarder.pages.dev` now shows the landing page and the phone app moved to `blackboarder.pages.dev/companion/`. Old pairing links and phones that installed the app from the root are sent to `/companion/` automatically, and their saved key and deadlines carry over. The calendar feed and API addresses did not change. The extension builds pairing links with `/companion/` and accepts the site address with or without it.

### Security
- **Sync key required everywhere**: `/api/tasks`, `/api/sync`, `/api/task-status` and `/feed.ics` now return `400` without a valid key instead of falling back to the shared default bucket. `/api/status` no longer reads data without a key or exposes the database URL.
- **Rate limits per IP and per key**: counting only per key let anyone guessing keys use a new key each time. The calendar feed is limited per key, since calendar services share IPs. The in-memory map is capped so it cannot grow without bound.
- **Server AI keys only for paired devices**: the worker's own AI keys are no longer lent to anonymous callers, and a caller's own `apiKey` now takes priority.
- **Firebase rules fixed**: the 1.1.0 rules validated `users/{key}` itself, but clients write to `users/{key}/data`, so every sync would have been rejected once published. Key names are now limited to 8-64 safe characters.
- **Longer sync keys**: new keys have 10 random characters (50 bits) instead of 6 (30 bits). Existing keys keep working.

### Fixed
- **Landing page rewritten and ready to host**: plain-language sections with current facts (10-character `BBS-` keys, Firebase-only sync, auto-updates, side panel, Blackboard dark mode), real install steps with a ZIP download, phone pairing and keyed calendar links, and an honest privacy answer. Removed claims that were no longer true. Fixed sideways scrolling on phones, the theme now follows the system setting, and the page has a description, link preview and favicon. Hosting steps (Cloudflare Pages, output folder `landing`) are in the README and hosting guide.
- **Auto-update for git clones**: the helper skipped any extension inside a git clone, and the copy in a clone's top-level `updater/` folder treated the whole repository as the extension (and was registered under the wrong extension ID). It now finds `dist/` itself and updates a clone with `git pull --ff-only`, only on `main` with no uncommitted changes. Run `update.bat` once to re-register.
- **No more "Server Offline" in Settings**: sync runs through Firebase, but the extension still pinged a local server at `localhost:3456` on every sync and showed it as offline. The own-server field is now optional and empty by default; nothing is sent or shown unless you fill it in.
- **Month title spacing**: the month name had a 140px minimum width and was left-aligned, so the next-month arrow sat far from the text. The arrows now sit 8px from the name on both sides, as in the companion.
- **README rewritten**: install from a ZIP or git clone, the one-time `update.bat` / `update.sh` step, phone pairing and calendar links with keys, Firebase-only sync, publishing the Firebase rules, hosting on Cloudflare Pages, auto-updates for git clones, and which files to edit. Stale lines in the install and walkthrough guides fixed.
- **Cleanup**: removed unused one-off scripts (`generate_icons.js`, `generate_vector_icons.py`, `parsePhy1.py`, `package.bat`), the committed local-server data files (now ignored), and the four `src/utils` files that only re-exported `src/core`; imports point at `src/core` directly.
- **CI checks sync**: the build workflow runs `npm run lint`, so a version mismatch between the extension, companion, landing page and README fails the build.
- **Vercel backend**: removed the separate `api/*.js` handlers, which read without a key, used a broken data path, fell back to sample data and erased quick links and deleted-task records on every sync. `api/[...path].js` now runs the same worker as Cloudflare.
- **Side panel layout**: the side panel opened the popup at its fixed 480px size, cutting off course chips and the calendar. Only the toolbar popup keeps the fixed size now (Chrome is asked directly), so the side panel uses the full width even before Chrome reloads the manifest. Calendar columns can also no longer be widened by long task names.
- **Scan button after an extension update**: open Blackboard tabs get a fresh copy of the scraper after an install or update, and the old copy no longer relabels the new button as "reload tab".

---

## [1.1.0] - 2026-10-21 (Milestone Release)

### Security & Privacy
- **Multi-Tenant Sync Isolation**: Created `database.rules.json` enforcing strict Firebase Realtime Database isolation rules. Disallowed root dumps (`.read: false`, `.write: false` at `/`), restricting clients to authenticated/scoped `$syncKey` namespaces (`/users/{syncKey}/data.json`).
- **Automatic Sync Key Provisioning**: Ensured every new extension install automatically generates a unique 32-bit cryptographically random key (`BBS-XXXXXX`), preventing any student from falling back to or writing into a shared global bucket.
- **Sliding-Window Rate Limiting**: Added in-memory sliding-window rate limiters across `api/sync.js`, Cloudflare Pages worker (`mobile-web/_worker.js`), and Node server (`self-hosted/server/server.js`), rejecting abusive traffic with standard HTTP 429 Too Many Requests.
- **Minimum Privilege Extension Permissions**: Removed `file:///*` matches and unnecessary `"downloads"` permission from `public/manifest.json`. Replaced with standard in-tab browser downloads.
- **Repository Privacy & Course Anonymization**: Removed proprietary course syllabus PDFs from `docs/syllabus/`. Anonymized default course schedules to generic `Course Faculty` and campus room references.

### Design System & Two-Tone Theme
- **Swiss Grid Universal 0px Radius**: Implemented universal `*, *::before, *::after { border-radius: 0 !important; }` across `src/popup/popup.css` and `mobile-web/styles.css`, establishing a razor-sharp, geometric, flat Swiss Grid design system.
- **Monochrome Neutral Two-Tone Theme**: Replaced legacy neon green accents (`#10b981`, `#34d399`, `#059669`) across urgency badges, completion chips, syllabus progress bars, and device pairing indicators with clean, high-contrast monochrome tokens (`#18181b` light, `#f4f4f6` dark).
- **Typography Standardization**: Eliminated all em-dashes (`—`) in user-facing UI text, buttons, and documentation in favor of standard hyphens (`-`).

### Scraper & Runtime Resilience
- **Scoped Stream Queries**: Replaced expensive `querySelectorAll('*')` DOM traversals in `scrapeUltraStreamDueItems` with scoped container selectors (`[role="feed"] *`, `.stream-item-container *`), dramatically accelerating timeline parsing.
- **Extension Context Invalidation Recovery**: Hardened content script against Manifest V3 extension reloads (`Extension context invalidated`). The floating scan pill now safely transitions state, disconnects orphaned observers, and prompts users with `"Extension updated - reload tab (F5)"`.
- **Heuristic Layout Fallback**: Added Strategy 3 fallback selectors in `scrapeAnnouncements` to handle custom web-components or future Blackboard DOM structure updates.

### Code Hygiene & Testing
- **Automated Hygiene Script**: Added `scripts/lint-check.js` (`npm run lint`, `npm run check`) verifying TypeScript compilation, Swiss Grid rules, two-tone color compliance, JSON validity, typography standards, and universal 4-way version synchronization.
- **Universal Multi-Component Synchronization**: Automated build synchronization in `scripts/build.js` ensuring the Chrome Extension, Companion PWA, Landing Page, and GitHub README stay in byte-level lockstep across every release.
- **Comprehensive Test Suite**: 34 test suites and 322 tests verifying sync key isolation, course matching, syllabus weights, ICS feeds, bidirectional updates, popup accessibility, and context invalidation fallbacks.

### UI & Layout Polishing
- **Fixed Extension Popup Dimensions**: Permanently locked toolbar popup at 480px by 600px, eliminating dynamic jumping and shrink-to-fit sizing on high-DPI screens while preserving responsive full-screen behavior in standalone windows.
- **Companion Header Synchronization Banner**: Resolved text truncation on the mobile web companion header; sync status now displays `Updated [Date], [Time] · [X] deadlines` with multi-line word wrap and flexible brand header sizing.

---

## [1.0.0] - 2026-09-28 (Initial Release)

- **3-Tier Hybrid Extraction Pipeline**: Local regex parsing, Jev System One classification, and OpenRouter Generative AI deep extraction.
- **Academic Quick Links**: Quick access bar for attendance records, marks portal, and degree audit.
- **Syllabus Grade Tracker**: Weight calculation for assignments, quizzes, and exams.
- **Live RFC 5545 WebCal Feed**: Dynamic `.ics` calendar feed for iOS, macOS, Android, and Outlook.
- **Offline-First PWA**: Mobile web companion app with offline caching and background service worker.
