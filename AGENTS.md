# Blackboarder

Student companion for Blackboard at the University of Sharjah (`elearning.sharjah.ac.ae`). It reads announcements and the gradebook, turns them into deadlines and marks, and shows them in a Chrome extension and a phone web app that sync through Firebase.

This file holds what stays true. It has no change log and no bug history: git history has those. Keep it short, and update it in the same commit as any change that makes a line here wrong.

## Commands

```
npm run build     # build everything; also stamps version and test count into README, manifest, companion
npm run lint      # type-check, style, JSON and version-sync checks
npm test          # Vitest
```

Run `npm run lint` and `npm test` before every commit. Commit generated files (`dist/`, `mobile-web/companion/core.js`, stamps) from a fresh `npm run build`. CI regenerates them and pushes a commit to `main`; merge it before pushing.

## What is where

- `src/core/`: courses, schedule, room and weight rules, syllabus data. Single source of truth for course logic.
- `src/engine/`: deadline extraction. Local regex first, then Jev classifier, then OpenRouter AI.
- `src/utils/`: storage, Firebase sync, task merge, gradebook marks, marks and syllabus-progress lists, announcement merge, stream parsing.
- `src/content/scraper.ts`: runs on Blackboard pages. Scans announcements, the stream and the gradebook, then saves tasks.
- `src/background/`: service worker (alarms, badge, sync, update checks).
- `src/popup/`: extension popup and side panel (plain TypeScript, no framework).
- `src/mobile/core.ts`: bundled by the build into `mobile-web/companion/core.js` and exposed as `window.BBCore`, so the phone app runs the same logic as the extension.
- `mobile-web/`: the website. `index.html` is the landing page, `companion/` is the phone app, `_worker.js` is the sync API and calendar feed (Cloudflare Pages and Vercel).
- `self-hosted/`: optional Node server and single-file Cloudflare worker (generated from `_worker.js`).
- `database.rules.json`: Firebase rules. They only take effect once published in the Firebase console.
- `docs/DESIGN_SYSTEM.md`: the visual spec.

## Features and how they work

- **Deadlines**: extracted from announcements (Arabic, English, mixed). Tasks have an id, course, type, due date, weight, room, status, and may carry a mark.
- **Marks**: read from the Blackboard gradebook on every scan (`fetchGradebookUpdates`), plus stream grade cards. A mark goes on a task through `findTaskForUpdate`: the course must agree, practice or mock titles only match each other, numbers must agree (Quiz 1 is not Quiz 10), and a mark never lands on a task more than a day before its date. The gradebook column is remembered on the task (`gradeSourceId`, `gradeSourcesBefore`).
- **Weights**: from the course syllabus (`resolveTaskWeight`). A percentage in announcement text only counts when it is stated as that item's weight. The title is matched before the body.
- **Rooms**: announced room first, then the saved room if it looks real (`isPlausibleRoom`), then the course schedule.
- **Marks card and Syllabus Progress card**: `src/utils/marks.ts` and `src/utils/syllabusProgress.ts`, rendered by both the popup and the phone app. Marks are listed newest first.
- **Popup**: opens on the calendar. Unfinished add, edit and settings work is restored (`src/popup/popupDraft.ts`). Course fields are pickers (`src/popup/coursePicker.ts`). Settings has one page per group.
- **Sync**: tasks, quick links, courses and tombstones live at `users/{syncKey}/data` in Firebase. The newer `updatedAt` wins per task.
- **Phone app** (`mobile-web/companion/`): phones use a bottom tab bar, 900px and wider is a two-column dashboard.
- **Updates**: the extension checks GitHub every 15 minutes; a git clone updates with `git pull --ff-only` through a small helper (`updater/`).

## Rules

1. **Never `fetch('/...')` from the content script.** Blackboard sets `<base href>` to a CDN, so relative paths 404. Use `bbFetch()`.
2. **Never put `\b` around Arabic text in a regex.** JavaScript's `\b` only sees ASCII letters.
3. **Never overwrite tasks the student made or edited** (`userEdited`, `extractedBy: 'manual'`): not their dates, times, rooms, weights or course names.
4. **Save tasks with `saveTasksMergingLatest`** when a save can race a scan, the popup or the phone. A plain `saveTasks` of an older copy can erase marks.
5. **Bump `updatedAt` only when something really changed.** Every bump triggers a sync, and the newer copy wins everywhere.
6. **Real faults use `console.error`; expected situations use `console.info`.** Brave lists every `console.warn` on the extension's Errors page.
7. **Two colours only** (near-black and near-white, plus greys), no gradients, `border-radius: 0 !important`, no em-dashes anywhere. Course colours and the red/amber stats numbers are the only exceptions. Checked by `tests/theme.test.ts` and lint.
8. **Never break sync isolation**: every Firebase read and write is scoped to `users/{syncKey}`. Never write to the root. Sync keys are `BBS-` plus 10 characters.
9. **No secrets in the repo.** Never commit the owner's backups, API keys, Jev key or sync key. Tests use made-up scores.
10. **Course logic lives in `src/core`.** Do not copy it into `mobile-web/companion/app.js`; add it to `src/mobile/core.ts` and use `BBCore`.

## Verifying changes

- Unit tests cover logic. For popup or phone UI, load the built `dist/` popup or `mobile-web/companion/` in a browser with a stubbed `chrome` object and look at it.
- The content script only runs on the owner's signed-in Blackboard. Read-only checks of the gradebook endpoints are fine; never change anything on Blackboard.
