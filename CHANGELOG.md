# Changelog

All notable changes to the Blackboarder project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed
- **Theme follows your system**: the extension and the phone app now match your computer's or phone's light/dark setting by default and switch along with it. You can still pick Light or Dark in Settings. Everyone is moved to the system setting once with this update.
- **Phone app on a computer**: on wide screens the app shows the calendar on the left, with Up Next and Quick Links under it, and your deadline list on the right, side by side. Clicking a day opens that day's deadlines in a pop-up. The header is slimmer, matching the extension: Quick Links, the Setup Guide and the theme are in the page and in Settings. The phone layout is unchanged.
- **Tidier header**: the top row of the extension now holds only Scan, Add deadline and Settings, on one row even in a narrow side panel. The other buttons moved into Settings: Sync Now to Mobile is on the Sync page, the calendar (.ics) export is on the Data page, Manage Quick Links is on the General page (the calendar's Quick Links bar still opens it too), and the theme is the Theme dropdown on the General page, which now changes the theme straight away.
- **Settings split into pages**: the extension's Settings screen has a tab strip (General, Courses, Scanning, Sync, Alerts, Data, Updates) and shows one group at a time instead of one long list. Every setting works and saves as before, and Save Settings still saves all pages. In a narrow side panel the tabs wrap onto two rows. Switching between short and long pages no longer shifts the layout sideways.
- **Credit**: the landing page footer, the README, the license, `package.json` and the Settings screens of the extension and companion now say who built Blackboarder: Yassin Ragab, a freshman at UOS, linking to [yassinr.me](https://yassinr.me).
- **One design system everywhere**: the extension, the companion and the landing page share the system in `docs/DESIGN_SYSTEM.md`: the two-tone colours (near-black `#18181b` and near-white `#f4f4f6`, with grey shades between), Inter Tight headings and Inter body text (bundled, no Google requests), square corners, no gradients, and one solid primary action per screen. Every other colour was removed from the interface, red included (errors and delete buttons use the two tones; overdue badges are solid inverted blocks). Course colours are the one exception and stay as they are.
- **Landing page at the root, phone app at `/companion/`**: `blackboarder.pages.dev` now shows the landing page and the phone app moved to `blackboarder.pages.dev/companion/`. Old pairing links and phones that installed the app from the root are sent to `/companion/` automatically, and their saved key and deadlines carry over. The calendar feed and API addresses did not change. The extension builds pairing links with `/companion/` and accepts the site address with or without it.

### Security
- **Sync key required everywhere**: `/api/tasks`, `/api/sync`, `/api/task-status` and `/feed.ics` now return `400` without a valid key instead of falling back to the shared default bucket. `/api/status` no longer reads data without a key or exposes the database URL.
- **Rate limits per IP and per key**: counting only per key let anyone guessing keys use a new key each time. The calendar feed is limited per key, since calendar services share IPs. The in-memory map is capped so it cannot grow without bound.
- **Server AI keys only for paired devices**: the worker's own AI keys are no longer lent to anonymous callers, and a caller's own `apiKey` now takes priority.
- **Firebase rules fixed**: the 1.1.0 rules validated `users/{key}` itself, but clients write to `users/{key}/data`, so every sync would have been rejected once published. Key names are now limited to 8-64 safe characters.
- **Longer sync keys**: new keys have 10 random characters (50 bits) instead of 6 (30 bits). Existing keys keep working.

### Added
- **Marks from the gradebook**: every scan now reads your marks straight from each course's Blackboard gradebook and shows them on the matching deadline (for example "4.5 / 5 (90%)"). Work waiting to be marked shows as submitted.

### Fixed
- **Fewer false errors**: normal situations (a course whose announcements cannot be read, a reloaded extension, the AI falling back) no longer show up on the extension's Errors page.
- **Marks for every course**: Physics 1, Physics 1 Lab and Islamic Culture were mixed up inside the extension, so their marks could not be placed. Marks also now find deadlines whose names differ slightly from Blackboard's (for example "Free Fall Exp. Student's Lab Report" and "Free Fall Exp. - Lab Report", or "2nd Quiz" and "Quiz 2"), and names with "&" match.
- **Stats row colours**: the Urgent count is red and the This Week count is amber again, in light and dark.
- **Marks**: a "Grade posted" card now attaches its mark to the matching deadline (the "Grade posted:" words in the title stopped it from matching), and a mark never lands on a same-named task in another course.
- **Same-named posts in two courses**: when two courses post an announcement with the same title (for example "Quiz 3" in Physics 1 Lab and Intro to Computer Engineering), each deadline now keeps its own course's text instead of one course's text showing on both.
- **Website on phones**: the landing page no longer scrolls sideways on small phones (the hero and footer grids were wider than the screen). The section links stay visible on phones and tablets as a swipeable row under the logo, and footer and step links are big enough to tap.
- **Update prompt**: Blackboarder now checks for a new version every 15 minutes and each time you open it (it was hourly, and the popup could reuse a result an hour old). As soon as an update is installed, the popup shows "Update ready - restart to finish" with a Restart now button, even if it was already open. A git clone that could not be updated now says why instead of showing nothing.
- **Sync between the extension, phone and cloud**: tasks with Arabic letters, brackets or apostrophes in their id (most Islamic Culture items, "Newton's 2nd Law") never reached the phone and were erased from the cloud whenever the phone saved. The phone no longer overwrites newer edits made in the extension, and no longer saves each change twice. Junk the extension removed can no longer come back from an older cloud copy, and an empty deadline list can be saved (republish `database.rules.json`).
- **Junk tasks called "Exam", "Meeting" or "Other"**: when a dated line in an announcement had no name (office hours, a start date, a presentation schedule, "Date: Thursday 22 October"), the scanner titled the task with its type and never asked the AI. It now takes the name from the announcement heading or leaves it to the AI. Existing junk tasks, and a Quiz 3 copied into the wrong course, are removed the next time the popup opens and stay removed on the phone and in the cloud. Scanned extras that are not graded work (office hours, paper review days, presentation schedules) are left out too. Tasks you created or edited are never removed.
- **Closing the popup cancelled a scan**: the scan now runs in the Blackboard tab, so it finishes and saves even if you close the popup, and reopening the popup shows its progress ("Extracting 12/40..."). Announcements are also processed four at a time, so scans with AI on are faster.
- **Course announcements never loaded**: Blackboard Ultra pages point their base address at a CloudFront file server, so every announcement request the scanner made went there and failed with 404. Requests now always go to the Blackboard site, so announcements that aren't visible in the stream (like a quiz date) are imported again.
- **Fake deadlines dated by when something was posted**: the activity stream doesn't show announcement text, so the scanner read the card's posting time ("Oct 18, 2026 2:20 PM") as the text and the due date, creating tasks like an overdue "Exam". It no longer does, it skips "Added: file" cards, and tasks made this way are removed on the next scan.
- **Course announcements missing on the stream page**: announcements fetched from each course were labelled with the page title instead of their course, and were lost if Blackboard refused the public announcements address. They now get the real course name, fall back to the address Ultra itself uses, and each scan writes a one-line summary to the page console.
- **New deadlines merged into old ones and disappeared**: when the course of an announcement could not be detected, a new "Quiz 3" was treated as the same task as any older "Quiz 3" and silently dropped, keeping the old date. Title matching now needs a known course, and a known course re-announcing a task on a new date moves it (unless you edited it). An announcement with two deadlines also kept only the first; both are kept now.
- **Arabic announcements never reached the AI**: the check that decides whether an announcement is worth an AI call wrapped Arabic words in `\b`, which never matches Arabic in JavaScript, so Arabic-only announcements without a readable date were dropped. It also missed presentations, tests, reports and essays. Both are fixed, and the local parser now recognises عروض (presentations).
- **AI Deep Extraction toggle would not stay on**: the AI settings (the toggle, OpenRouter key, model, Jev toggle and Jev key) only saved with the Save Settings button at the bottom of the page, so closing the popup threw the change away and the toggle showed off again. They now save the moment they change, with a toast (and a reminder to add a key if the toggle is on without one).
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
