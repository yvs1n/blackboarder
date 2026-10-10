import { Announcement, DeadlineTask } from '../types';
import { processAnnouncementsBatch } from '../engine/hybridExtractor';
import { getSettings, getTasks, saveTasks, saveAnnouncements, getLastScanCheckpoint, saveLastScanCheckpoint, isExtensionContextValid } from '../utils/storage';
import { parseCourseDetails, sanitizeDoctorAnnouncementText } from '../utils/courseHelper';
import { parseDirectStreamCard } from '../utils/streamParser';

/**
 * Known University of Sharjah Blackboard Course IDs mapped to courses.
 * Used for instant, zero-click background API lookups when stream cards omit course parameters.
 */
export const KNOWN_UOS_COURSE_IDS = [
  { pattern: /(?:intro.*comp|comp(?:uter)?\s*eng|هندسة.*حاسوب|1502101|0402101)/i, courseId: '_87148_1', name: 'Introduction to Computer Eng.', code: '1502 101' },
  { pattern: /(?:calculus|calc\b|حسبان|1440133|1440131)/i, courseId: '_86929_1', name: 'Calculus I for Engineering', code: '1440 133' },
  { pattern: /(?:english|eap\b|academic\s*purposes|إنجليزي|0202112)/i, courseId: '_87240_1', name: 'English for Academic Purposes', code: '0202 112' },
  { pattern: /(?:physics\s*1(?!\s*lab)|general\s*physics\s*1|فيزياء\s*1(?!\s*عملي)|1430115)/i, courseId: '_85276_1', name: 'Physics 1', code: '1430 115' },
  { pattern: /(?:physics.*lab|فيزياء.*عملي|مختبر.*فيزياء|1430116)/i, courseId: '_87186_1', name: 'Physics 1 Lab', code: '1430 116' },
  { pattern: /(?:islamic|ثقافة\s*إسلامية|0104100)/i, courseId: '_84837_1', name: 'Islamic Culture', code: '0104 100' }
];

/**
 * Scrapes direct deadline cards from the Blackboard Ultra Stream timeline
 * (e.g. items with "Due Date: 9/18/26, 11:59 PM (UTC+4)").
 * Supports incremental scanning by stopping when hitting items already scanned.
 */
function scrapeUltraStreamDueItems(knownDirectTaskIds?: Set<string>): DeadlineTask[] {
  const directTasks: DeadlineTask[] = [];
  const scannedKeys = new Set<string>();
  let consecutiveKnown = 0;

  // Find all elements containing "Due Date:" or "تاريخ الاستحقاق:"
  const allElements = document.querySelectorAll('*');
  const leafDateElements: Element[] = [];

  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i];
    const text = el.textContent || '';
    if (/(?:Due Date:\s*|تاريخ الاستحقاق:\s*)\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(text)) {
      let hasChildMatch = false;
      for (let j = 0; j < el.children.length; j++) {
        if (/(?:Due Date:\s*|تاريخ الاستحقاق:\s*)\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(el.children[j].textContent || '')) {
          hasChildMatch = true;
          break;
        }
      }
      if (!hasChildMatch) {
        leafDateElements.push(el);
      }
    }
  }

  for (const dateEl of leafDateElements) {
    const card = dateEl.closest('li, [role="listitem"], .stream-item, [class*="stream-item"], [class*="stream-entry"], [class*="activity-card"], [class*="element-card"], [class*="timeline"], [class*="base-card"], div[class*="card"]') || dateEl.parentElement?.parentElement || dateEl.parentElement;
    if (!card) continue;

    const cardText = card.textContent || '';
    if (/(?:you\s+submitted|submission\s+(?:receipt|confirmed)|attempt\s+submitted|تم\s+التسليم|تم\s+إرسال|confirmation\s*number)/i.test(cardText)) {
      continue;
    }

    const parsed = parseDirectStreamCard(cardText);
    if (parsed) {
      if (knownDirectTaskIds && knownDirectTaskIds.has(parsed.id)) {
        consecutiveKnown++;
        if (consecutiveKnown >= 3) {
          // Reached checkpoint where previous scan already captured older items
          break;
        }
        continue;
      }
      consecutiveKnown = 0;
      if (!scannedKeys.has(parsed.id)) {
        scannedKeys.add(parsed.id);
        directTasks.push(parsed);
      }
    }
  }

  return directTasks;
}

/**
 * Scrapes announcements from Blackboard (Classic, Ultra Course, and Ultra Stream).
 * Supports incremental scanning by stopping when hitting announcements already processed.
 */
async function scrapeAnnouncements(knownAnnIds?: Set<string>, knownKeys?: Set<string>): Promise<Announcement[]> {
  const currentUrl = window.location.href;
  const pageTitle = document.title || '';

  // Extract page-level course info from headings or document title
  const pageHeadingEl = document.querySelector('#courseMenuPalette_paletteTitleHeading, .course-title, header h1, [aria-label*="Course Name"], #course-title-header, .bb-course-title');
  const rawPageCourseText = pageHeadingEl?.textContent?.trim() || (pageTitle !== 'Activity' ? pageTitle : '');
  const pageCourseInfo = parseCourseDetails(rawPageCourseText);

  let detectedCourseCode = pageCourseInfo.code;
  let detectedCourseName = pageCourseInfo.name;

  const results: Announcement[] = [];
  const scannedIds = new Set<string>();

  // Strategy 1: Blackboard Learn Classic Announcement List
  const classicItems = document.querySelectorAll('#announcementList > li, .announcementListItem');
  if (classicItems.length > 0) {
    classicItems.forEach((el, index) => {
      const titleEl = el.querySelector('h3, .announcementTitle, a');
      const bodyEl = el.querySelector('.vtbegenerated, .announcementBody, .details') || el;
      const dateEl = el.querySelector('.details, .date, .posted-date');

      const title = titleEl?.textContent?.trim() || `Announcement ${index + 1}`;
      let text = bodyEl?.textContent?.trim() || '';
      text = sanitizeDoctorAnnouncementText(text, detectedCourseName, detectedCourseCode, title);
      const rawDate = dateEl?.textContent?.trim() || '';

      const id = `ann_classic_${index}_${title.slice(0, 15).replace(/\s+/g, '')}`;
      if (!scannedIds.has(id) && text.length > 10) {
        scannedIds.add(id);
        results.push({
          id,
          courseCode: detectedCourseCode,
          courseName: detectedCourseName,
          title,
          postedAt: extractDateStringFromText(rawDate),
          contentText: text,
          contentHtml: bodyEl?.innerHTML || '',
          sourceUrl: currentUrl,
          scannedAt: new Date().toISOString()
        });
      }
    });
  }

  // Strategy 2: Blackboard Ultra Stream / Announcements Cards
  const ultraCards = Array.from(document.querySelectorAll<HTMLElement>(
    'li.stream-item-container, bb-announcement-card, .stream-entry, article[aria-label], div[role="article"], .element-card, [class*="stream-item"], [class*="activity-card"]'
  ));

  let consecutiveKnown = 0;

  for (let index = 0; index < ultraCards.length; index++) {
    const card = ultraCards[index];
    const cardText = card.textContent?.trim() || '';
    // Skip if it's already a direct due date card
    if (/Due Date:\s*\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(cardText)) {
      continue;
    }

    // Identify title link and extract courseId / announcementId
    const titleLink = card.querySelector<HTMLAnchorElement>(
      'a.js-title-link, [analytics-id="stream.entry.title"], a[bb-peek-sref*="announcement"], a[href*="announcementId"]'
    );
    const peekSref = titleLink?.getAttribute('bb-peek-sref') || '';
    const href = titleLink?.getAttribute('href') || '';

    let courseId = '';
    let announcementId = '';
    let courseNameFromAttr = '';

    if (peekSref) {
      const cidMatch = peekSref.match(/courseId["']?\s*:\s*["']([^"']+)["']/);
      if (cidMatch) courseId = cidMatch[1];
      const aidMatch = peekSref.match(/announcementId["']?\s*:\s*["']([^"']+)["']/);
      if (aidMatch) announcementId = aidMatch[1];
      const cnameMatch = peekSref.match(/courseName["']?\s*:\s*["']([^"']+)["']/);
      if (cnameMatch) courseNameFromAttr = cnameMatch[1];
    }

    if (!courseId && href) {
      const cidMatch = href.match(/[?&]courseId=([^&]+)/);
      if (cidMatch) courseId = cidMatch[1];
    }
    if (!announcementId && href) {
      const aidMatch = href.match(/[?&]announcementId=([^&]+)/);
      if (aidMatch) announcementId = aidMatch[1];
    }

    // Extract courseId / announcementId from analytics-context JSON on card or element-details
    const analyticsContextEl = card.querySelector('[analytics-context]') || (card.hasAttribute('analytics-context') ? card : null);
    const analyticsContextRaw = analyticsContextEl?.getAttribute('analytics-context') || '';
    if (analyticsContextRaw) {
      try {
        const parsedContext = JSON.parse(analyticsContextRaw.replace(/&quot;/g, '"'));
        if (!courseId && parsedContext.courseId) courseId = parsedContext.courseId;
        if (!announcementId && parsedContext.announcementId) announcementId = parsedContext.announcementId;
        if (!announcementId && parsedContext.id && parsedContext.id.startsWith('_')) announcementId = parsedContext.id;
      } catch {}
    }

    // Extract courseId from course outline / content links inside card
    if (!courseId) {
      const courseLink = card.querySelector<HTMLAnchorElement>('a[href*="/courses/"], a[href*="course_id="], a[analytics-id="stream.entry.course"]');
      const cHref = courseLink?.getAttribute('href') || '';
      const cMatch = cHref.match(/(?:courses\/|course_id=)(_\d+_\d+)/);
      if (cMatch) courseId = cMatch[1];
      if (!peekSref && courseLink) {
        const cPeek = courseLink.getAttribute('bb-peek-sref') || '';
        const cPeekMatch = cPeek.match(/courseId["']?\s*:\s*["']([^"']+)["']/);
        if (cPeekMatch) courseId = cPeekMatch[1];
      }
    }

    const titleEl = card.querySelector('h3, h4, .announcement-title, .stream-entry-title, [role="heading"], a.js-title-link, [analytics-id="stream.entry.title"]');
    const timeEl = card.querySelector('time, [datetime], .timestamp, .stream-entry-time, [class*="timestamp"]');
    const courseEl = card.querySelector('.course-name, .context-title, a[analytics-id="stream.entry.course"], a[href*="/courses/"], [data-course-id], .course-title, .context a');

    let title = titleEl?.textContent?.trim() || '';
    const titleLower = title.toLowerCase().trim();
    const candidateId = announcementId ? `ann_ultra_${announcementId}` : `ann_ultra_${index}_${title.slice(0, 15).replace(/\s+/g, '')}`;

    // Incremental Check: Check by ID, raw announcementId, or title key
    const isKnown = (knownAnnIds && (
      knownAnnIds.has(candidateId) ||
      (announcementId && knownAnnIds.has(announcementId)) ||
      (announcementId && knownAnnIds.has(`ann_ultra_${announcementId}`)) ||
      (announcementId && knownAnnIds.has(`ann_api_${announcementId}`))
    )) || (knownKeys && (
      (titleLower && knownKeys.has(titleLower)) ||
      (courseNameFromAttr && titleLower && knownKeys.has(`${courseNameFromAttr}_${titleLower}`))
    ));

    if (isKnown) {
      consecutiveKnown++;
      // Blackboard Ultra stream is strictly descending by date; encountering 2 consecutive known items means we caught up!
      if (consecutiveKnown >= 2) {
        break;
      }
      continue;
    }
    consecutiveKnown = 0;

    let cardCourseCode = detectedCourseCode;
    let cardCourseName = detectedCourseName;

    const rawCourseStr = courseNameFromAttr || courseEl?.textContent?.trim() || '';
    if (rawCourseStr) {
      const parsed = parseCourseDetails(rawCourseStr);
      if (parsed.name !== 'General Course') cardCourseName = parsed.name;
      if (parsed.code !== 'UOS') cardCourseCode = parsed.code;
    } else {
      const lines = cardText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        const parsedFirstLine = parseCourseDetails(lines[0]);
        if (parsedFirstLine.name !== 'General Course') {
          cardCourseName = parsedFirstLine.name;
          cardCourseCode = parsedFirstLine.code;
        }
      }
    }

    // Fallback: If courseId is still empty, map from known UOS course database
    if (!courseId) {
      const courseStr = `${cardCourseName} ${cardCourseCode} ${rawCourseStr} ${title}`;
      for (const m of KNOWN_UOS_COURSE_IDS) {
        if (m.pattern.test(courseStr)) {
          courseId = m.courseId;
          break;
        }
      }
    }

    // Clone card to prune non-announcement elements safely
    const cardClone = card.cloneNode(true) as HTMLElement;

    const noiseSelectors = [
      'time',
      '[datetime]',
      '.timestamp',
      '.stream-entry-time',
      '[class*="timestamp"]',
      '[class*="date-time"]',
      '.course-name',
      '.context-title',
      '.course-title',
      '[data-course-id]',
      'a[href*="/courses/"]',
      'a[analytics-id="stream.entry.course"]',
      'button',
      'svg',
      'nav',
      '[aria-hidden="true"]',
      '.bb-avatar',
      '.avatar',
      '[class*="author"]',
      'bb-read-more',
      '.read-more',
      '.show-more',
      '[class*="more"]',
      '[data-analytics-id*="more"]'
    ];
    noiseSelectors.forEach(sel => {
      cardClone.querySelectorAll(sel).forEach(el => el.remove());
    });

    if (title) {
      cardClone.querySelectorAll('h1, h2, h3, h4, h5, [role="heading"], .announcement-title, .stream-entry-title, a.js-title-link').forEach(h => h.remove());
    }

    const bodyEl = cardClone.querySelector('.announcement-body, .entry-content, .stream-entry-body, .stream-item-content, .stream-message, .message-body, [class*="body-content"], [bb-translate], .vtbegenerated, .summary, .content') || cardClone;

    let text = bodyEl?.textContent?.trim() || cardClone.textContent?.trim() || cardText;
    let fullHtml = bodyEl?.innerHTML || '';

    const attrFullText = card.getAttribute('data-full-text') || card.getAttribute('data-content') || '';
    if (attrFullText && attrFullText.length > text.length) {
      text = attrFullText.trim();
    }
    const titleAttr = card.getAttribute('title') || bodyEl?.getAttribute('title') || card.querySelector('[title]')?.getAttribute('title') || '';
    if (titleAttr && titleAttr.length > text.length && !titleAttr.startsWith('http')) {
      text = titleAttr.trim();
    }

    // Check if text ends in ellipsis or is truncated
    const isTruncated = /[…\.]\s*$/.test(text) || text.includes('…') || text.endsWith('...');

    // Fetch complete unabridged text directly from code (REST API / Classic Webapp) - ZERO DOM clicks
    if (isTruncated || (courseId && announcementId)) {
      const fullRes = await fetchFullAnnouncementBodyFromCode(courseId, announcementId, title);
      if (fullRes && fullRes.text.length > text.length) {
        text = fullRes.text;
        fullHtml = fullRes.html;
      }
    }

    // Smart Expansion: update summary container with fullHtml and only expand cards that were truncated or contain deadlines
    const summaryContainer = card.querySelector<HTMLElement>('.vtbegenerated, .summary, .content, .stream-entry-body, .entry-content');
    const hasAcademicKeyword = /(?:quiz|exam|midterm|final|assignment|homework|hw|project|lab|due|كويز|واجب|امتحان|تسليم)/i.test(`${title} ${text}`);
    if (summaryContainer && fullHtml && fullHtml.length > summaryContainer.innerHTML.length) {
      summaryContainer.innerHTML = fullHtml;
      card.classList.add('bbs-extracted-expanded');
    } else if (isTruncated || hasAcademicKeyword) {
      card.classList.add('bbs-extracted-expanded');
    }

    text = sanitizeDoctorAnnouncementText(text, cardCourseName, cardCourseCode, title);

    if (!title) {
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        title = lines[0];
        text = lines.slice(1).join('\n').trim();
      } else {
        title = `Announcement ${index + 1}`;
      }
    }

    const postedAt = timeEl?.getAttribute('datetime') || extractDateStringFromText(timeEl?.textContent || '');

    const id = candidateId;
    if (!scannedIds.has(id) && text.length > 5) {
      scannedIds.add(id);
      results.push({
        id,
        courseCode: cardCourseCode,
        courseName: cardCourseName,
        title,
        postedAt,
        contentText: text,
        contentHtml: fullHtml || bodyEl?.innerHTML || '',
        sourceUrl: currentUrl,
        scannedAt: new Date().toISOString()
      });
    }
  }

  // Strategy 3: Generic Announcement/Post container heuristic fallback
  if (results.length === 0) {
    const genericPosts = document.querySelectorAll('[class*="announcement"], [class*="post"], [class*="notice"]');
    genericPosts.forEach((post, index) => {
      let text = post.textContent?.trim() || '';
      if (text.length > 30 && text.length < 5000) {
        const titleEl = post.querySelector('h1, h2, h3, h4, h5, strong');
        const title = titleEl?.textContent?.trim() || `Notice ${index + 1}`;
        text = sanitizeDoctorAnnouncementText(text, detectedCourseName, detectedCourseCode, title);
        const id = `ann_gen_${index}_${title.slice(0, 15).replace(/\s+/g, '')}`;
        if (!scannedIds.has(id)) {
          scannedIds.add(id);
          results.push({
            id,
            courseCode: detectedCourseCode,
            courseName: detectedCourseName,
            title,
            contentText: text,
            sourceUrl: currentUrl,
            scannedAt: new Date().toISOString()
          });
        }
      }
    });
  }

  return results;
}

/**
 * Expansion is handled purely via CSS (.bbs-extracted-expanded) on extract to prevent clicking or shifting.
 */
async function expandAllTruncatedAnnouncements(): Promise<void> {
  // Purely CSS-based expansion on extract; no synthetic clicks on DOM buttons
}

/**
 * Extracts all Blackboard course IDs from the URL, DOM elements, and student course API.
 */
async function extractAllCourseIdsFromPage(): Promise<string[]> {
  const ids = new Set<string>();

  // 0. Seed with known registered student course IDs
  KNOWN_UOS_COURSE_IDS.forEach(k => ids.add(k.courseId));

  // 1. Current URL
  const urlMatch = window.location.href.match(/(?:courses\/|course_id=|[?&]id=)(_\d+_\d+)/);
  if (urlMatch) ids.add(urlMatch[1]);

  // 2. DOM elements with data attributes
  document.querySelectorAll('[data-course-id], [data-course]').forEach(el => {
    const cid = el.getAttribute('data-course-id') || el.getAttribute('data-course');
    if (cid && cid.startsWith('_')) ids.add(cid);
  });

  // 3. Links to courses on stream cards
  document.querySelectorAll('a[href*="/courses/"], a[href*="course_id="], a[href*="launcher?type=Course"]').forEach(a => {
    const href = (a as HTMLAnchorElement).getAttribute('href') || '';
    const m = href.match(/(?:courses\/|course_id=|[?&]id=)(_\d+_\d+)/);
    if (m) ids.add(m[1]);
  });

  // 4. Blackboard Learn user enrolled courses REST API
  try {
    const res = await fetch('/learn/api/public/v1/users/me/courses', {
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.results)) {
        for (const item of data.results) {
          if (item.courseId && typeof item.courseId === 'string' && item.courseId.startsWith('_')) {
            ids.add(item.courseId);
          }
        }
      }
    }
  } catch {
    // Ignore API discovery failure if offline or permissions restricted
  }

  return Array.from(ids);
}

/**
 * Extracts Blackboard course ID from the URL or DOM if present.
 */
function extractCourseIdFromPage(): string | null {
  const urlMatch = window.location.href.match(/courses\/(_\d+_\d+)/) ||
                   window.location.href.match(/course_id=(_\d+_\d+)/);
  if (urlMatch) return urlMatch[1];
  const el = document.querySelector('[data-course-id]');
  if (el) {
    const cid = el.getAttribute('data-course-id');
    if (cid && cid.startsWith('_')) return cid;
  }
  return null;
}

// Cache for classic Blackboard course announcements to prevent redundant fetches
const classicCourseAnnouncementsCache = new Map<string, Map<string, { html: string; text: string }>>();

/**
 * Fetches course announcements directly from Blackboard's classic webapp endpoint.
 * This endpoint is 100% cookie-authenticated for enrolled students and returns
 * the unabridged HTML without any summary clipping.
 */
async function fetchCourseAnnouncementsClassicWebapp(courseId: string): Promise<Map<string, { html: string; text: string }>> {
  if (classicCourseAnnouncementsCache.has(courseId)) {
    return classicCourseAnnouncementsCache.get(courseId)!;
  }
  const map = new Map<string, { html: string; text: string }>();
  try {
    const res = await fetch(`/webapps/blackboard/execute/announcement?method=search&course_id=${encodeURIComponent(courseId)}`, {
      credentials: 'same-origin'
    });
    if (res.ok) {
      const htmlText = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');
      const items = doc.querySelectorAll('#announcementList > li, .announcementList > li, li[id*="announcement"], .item');
      items.forEach(item => {
        const titleEl = item.querySelector('h3, .item h3, .announcement-title, [role="heading"]');
        const title = titleEl?.textContent?.trim().toLowerCase() || '';
        const bodyEl = item.querySelector('.vtbegenerated, .details, .announcement-content, .announcement-body') || item;
        const html = bodyEl.innerHTML || '';
        const text = bodyEl.textContent?.trim() || '';
        const itemId = item.getAttribute('id') || '';
        if (title && text) {
          map.set(title, { html, text });
          if (itemId) map.set(itemId, { html, text });
        }
      });
    }
  } catch {
    // webapp search unavailable
  }
  classicCourseAnnouncementsCache.set(courseId, map);
  return map;
}

/**
 * Orchestrates unabridged announcement retrieval directly via code:
 * 1. Public REST API
 * 2. Internal v1 REST API
 * 3. Classic Blackboard Course Announcement Webapp
 * ZERO DOM clicks. ZERO drawers opened. Pure background memory retrieval.
 */
async function fetchFullAnnouncementBodyFromCode(
  courseId: string | null,
  announcementId: string | null,
  title: string
): Promise<{ text: string; html: string } | null> {
  if (courseId) {
    // 1. Try public REST API endpoint
    if (announcementId) {
      try {
        const res = await fetch(`/learn/api/public/v1/courses/${encodeURIComponent(courseId)}/announcements/${encodeURIComponent(announcementId)}`, {
          headers: { 'Accept': 'application/json' },
          credentials: 'same-origin'
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.body) {
            const temp = document.createElement('div');
            temp.innerHTML = data.body;
            const clean = temp.textContent?.trim() || '';
            if (clean) return { text: clean, html: data.body };
          }
        }
      } catch {}

      // 2. Try internal v1 REST API endpoint
      try {
        const res = await fetch(`/learn/api/v1/courses/${encodeURIComponent(courseId)}/announcements/${encodeURIComponent(announcementId)}`, {
          headers: { 'Accept': 'application/json' },
          credentials: 'same-origin'
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.body) {
            const temp = document.createElement('div');
            temp.innerHTML = data.body;
            const clean = temp.textContent?.trim() || '';
            if (clean) return { text: clean, html: data.body };
          }
        }
      } catch {}
    }

    // 3. Try classic Blackboard course announcements webapp (100% cookie authenticated, returns full HTML)
    const classicMap = await fetchCourseAnnouncementsClassicWebapp(courseId);
    if (classicMap.size > 0) {
      if (announcementId && classicMap.has(announcementId)) {
        return classicMap.get(announcementId)!;
      }
      const titleLower = title.toLowerCase().trim();
      if (classicMap.has(titleLower)) {
        return classicMap.get(titleLower)!;
      }
      const cleanTokens = titleLower.replace(/[^a-z0-9\u0600-\u06FF]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
      for (const [key, val] of classicMap.entries()) {
        const keyLower = key.toLowerCase().trim();
        if (titleLower && (keyLower.includes(titleLower) || titleLower.includes(keyLower))) {
          return val;
        }
        if (cleanTokens.length > 0) {
          const matchCount = cleanTokens.filter(t => keyLower.includes(t)).length;
          if (matchCount >= Math.min(2, cleanTokens.length)) {
            return val;
          }
        }
      }
    }

    // 4. Try REST course announcements list endpoint
    try {
      const listRes = await fetch(`/learn/api/public/v1/courses/${encodeURIComponent(courseId)}/announcements`, {
        headers: { 'Accept': 'application/json' },
        credentials: 'same-origin'
      });
      if (listRes.ok) {
        const listData = await listRes.json();
        if (listData && Array.isArray(listData.results)) {
          const titleLower = title.toLowerCase().trim();
          const cleanTokens = titleLower.replace(/[^a-z0-9\u0600-\u06FF]/g, ' ').split(/\s+/).filter(w => w.length >= 3);

          for (const item of listData.results) {
            if (!item.body) continue;
            const itemTitle = (item.title || '').toLowerCase().trim();
            const matchesId = announcementId && item.id === announcementId;
            const matchesSub = titleLower && (itemTitle.includes(titleLower) || titleLower.includes(itemTitle));
            const tokenMatch = cleanTokens.length > 0 && cleanTokens.filter((t: string) => itemTitle.includes(t)).length >= Math.min(2, cleanTokens.length);

            if (matchesId || matchesSub || tokenMatch) {
              const temp = document.createElement('div');
              temp.innerHTML = item.body;
              const clean = temp.textContent?.trim() || '';
              if (clean) return { text: clean, html: item.body };
            }
          }
        }
      }
    } catch {}
  }

  return null;
}

/**
 * Attempts to fetch complete announcement bodies directly from Blackboard's authenticated REST API.
 */
async function fetchCourseAnnouncementsApi(
  courseId: string,
  fallbackCourseName?: string,
  fallbackCourseCode?: string
): Promise<Announcement[]> {
  try {
    const res = await fetch(`/learn/api/public/v1/courses/${encodeURIComponent(courseId)}/announcements`, {
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || !Array.isArray(data.results)) return [];

    let cName = fallbackCourseName || '';
    let cCode = fallbackCourseCode || '';

    if (!cName || !cCode) {
      const pageHeadingEl = document.querySelector('#courseMenuPalette_paletteTitleHeading, .course-title, header h1, [aria-label*="Course Name"], #course-title-header, .bb-course-title');
      const rawCourseText = pageHeadingEl?.textContent?.trim() || (document.title !== 'Activity' ? document.title : '');
      if (rawCourseText) {
        const parsed = parseCourseDetails(rawCourseText);
        if (!cName) cName = parsed.name;
        if (!cCode) cCode = parsed.code;
      }
    }

    return data.results.map((item: any, idx: number) => {
      const temp = document.createElement('div');
      temp.innerHTML = item.body || '';
      const text = temp.textContent?.trim() || temp.innerText?.trim() || '';
      const cleanCourseCode = (cCode && cCode !== 'UOS') ? cCode : '';
      const cleanCourseName = (cName && cName.toLowerCase() !== 'uos') ? cName : 'General Course';
      const cleanText = sanitizeDoctorAnnouncementText(text, cleanCourseName, cleanCourseCode, item.title);

      return {
        id: `ann_api_${item.id || idx}`,
        courseCode: cleanCourseCode,
        courseName: cleanCourseName,
        title: item.title || `Announcement ${idx + 1}`,
        postedAt: item.created || new Date().toISOString(),
        contentText: cleanText,
        contentHtml: item.body || '',
        sourceUrl: window.location.href,
        scannedAt: new Date().toISOString()
      };
    }).filter((a: Announcement) => a.contentText && a.contentText.length > 5);
  } catch (err) {
    console.warn('[Scraper] Blackboard REST API fetch unavailable, using DOM scraper:', err);
    return [];
  }
}

/**
 * Scrapes announcements from an open side panel / drawer / peek panel if visible.
 */
function scrapeOpenDrawerAnnouncement(): Announcement | null {
  const drawer = document.querySelector('aside.bb-slideout, div[role="dialog"], div.bb-peek-panel, bb-drawer, .panel-content');
  if (!drawer) return null;

  const titleEl = drawer.querySelector('h1, h2, h3, [role="heading"], .panel-header-title');
  const bodyEl = drawer.querySelector('.panel-content, .panel-body, .announcement-body, .vtbegenerated, [bb-translate]') || drawer;
  const courseEl = document.querySelector('#courseMenuPalette_paletteTitleHeading, .course-title, header h1, .bb-course-title');

  const title = titleEl?.textContent?.trim() || '';
  const text = bodyEl?.textContent?.trim() || '';
  if (!title && text.length < 20) return null;

  const courseInfo = parseCourseDetails(courseEl?.textContent || (document.title !== 'Activity' ? document.title : ''));
  const cleanText = sanitizeDoctorAnnouncementText(text, courseInfo.name, courseInfo.code, title);

  return {
    id: `ann_drawer_${Date.now()}`,
    courseCode: courseInfo.code,
    courseName: courseInfo.name,
    title: title || 'Course Announcement',
    contentText: cleanText,
    contentHtml: bodyEl?.innerHTML || '',
    sourceUrl: window.location.href,
    scannedAt: new Date().toISOString()
  };
}

/**
 * Orchestrates announcement scraping: auto-expands collapsed cards, checks REST API,
 * checks open drawers, and scrapes DOM cards with complete un-truncated text.
 * Supports incremental scanning by passing known checkpoint IDs.
 */
async function scrapeAnnouncementsFull(options?: { fullRescan?: boolean }): Promise<Announcement[]> {
  const checkpoint = options?.fullRescan
    ? { lastScannedAt: '', processedAnnouncementIds: [], processedDirectTaskIds: [], processedAnnouncementKeys: [] }
    : await getLastScanCheckpoint();

  const knownAnnIds = new Set(checkpoint.processedAnnouncementIds);
  const knownKeys = new Set(checkpoint.processedAnnouncementKeys || []);

  // 1. Expand any collapsed "...more" / "Show more" buttons (CSS only)
  await expandAllTruncatedAnnouncements();

  // 2. Scrape regular DOM announcements (skips already processed items and stops when reaching checkpoint)
  const domAnnouncements = await scrapeAnnouncements(
    options?.fullRescan ? undefined : knownAnnIds,
    options?.fullRescan ? undefined : knownKeys
  );

  // 3. Only fetch course REST APIs if user is on a specific course page, or if explicit full re-scan
  const isCoursePage = window.location.href.includes('/courses/');
  const apiAnnouncements: Announcement[] = [];

  if (options?.fullRescan || isCoursePage) {
    const courseIds = await extractAllCourseIdsFromPage();
    if (courseIds.length > 0) {
      const results = await Promise.all(
        courseIds.map(cid => {
          const matched = domAnnouncements.find(a => a.id.includes(cid) || a.sourceUrl.includes(cid));
          return fetchCourseAnnouncementsApi(cid, matched?.courseName, matched?.courseCode).catch(() => [] as Announcement[]);
        })
      );
      for (const arr of results) {
        apiAnnouncements.push(...arr);
      }
    }
  }

  // 4. Scrape any currently open side drawer/modal
  const drawerAnn = scrapeOpenDrawerAnnouncement();

  // 5. Merge and deduplicate, preferring API announcements or drawer because they have 100% unabridged text
  const mergedMap = new Map<string, Announcement>();

  for (const ann of domAnnouncements) {
    const key = `${ann.courseCode}_${ann.title.toLowerCase().trim()}`;
    mergedMap.set(key, ann);
  }

  for (const ann of apiAnnouncements) {
    const key = `${ann.courseCode}_${ann.title.toLowerCase().trim()}`;
    const existing = mergedMap.get(key);
    // Replace DOM announcement with complete API version (or keep if longer)
    if (!existing || ann.contentText.length >= existing.contentText.length) {
      mergedMap.set(key, ann);
    }
  }

  if (drawerAnn) {
    const key = `${drawerAnn.courseCode}_${drawerAnn.title.toLowerCase().trim()}`;
    mergedMap.set(key, drawerAnn);
  }

  return Array.from(mergedMap.values());
}

/**
 * Extracts a rough ISO date string from free text if present.
 */
function extractDateStringFromText(text: string): string | undefined {
  if (!text) return undefined;
  const dateMatch = text.match(/\b(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4})\b/) ||
                    text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?\b/i);
  if (dateMatch) {
    const d = new Date(dateMatch[0]);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}

/**
 * Displays a friendly notification prompting user to refresh tab when extension was reloaded.
 */
function showExtensionReloadToast() {
  showSidekickToast(
    'Extension Updated',
    'Blackboarder was reloaded or updated. Please refresh this page (press F5 or Reload) to reconnect.',
    0
  );
}

let activeStreamObserver: MutationObserver | null = null;

function teardownOrphanedContentScript() {
  if (activeStreamObserver) {
    try {
      activeStreamObserver.disconnect();
    } catch {}
    activeStreamObserver = null;
  }
  const floatingRoot = document.getElementById('bbs-floating-root');
  if (floatingRoot) {
    floatingRoot.style.opacity = '0.5';
    floatingRoot.style.cursor = 'not-allowed';
    floatingRoot.title = 'Extension reloaded. Please refresh the page (F5) to reconnect.';
  }
}

/**
 * Shows a toast message on top-right of the page.
 */
function showSidekickToast(title: string, message: string, taskCount: number = 0) {
  let toast = document.getElementById('bbs-toast') as HTMLDivElement | null;
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'bbs-toast';
    toast.className = 'bbs-toast';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <div class="bbs-toast-header">
      <span>⚡ ${title}</span>
      <span style="cursor:pointer;opacity:0.6;" id="bbs-toast-close">✕</span>
    </div>
    <div class="bbs-toast-body">${message}</div>
    ${taskCount > 0 ? `
      <div class="bbs-toast-actions">
        <button class="bbs-toast-btn-primary" id="bbs-toast-view">Open Blackboarder</button>
      </div>
    ` : ''}
  `;

  toast.classList.add('bbs-toast-visible');

  document.getElementById('bbs-toast-close')?.addEventListener('click', () => {
    toast?.classList.remove('bbs-toast-visible');
  });

  document.getElementById('bbs-toast-view')?.addEventListener('click', () => {
    if (!isExtensionContextValid()) {
      teardownOrphanedContentScript();
      showExtensionReloadToast();
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }, () => {
        if (chrome.runtime?.lastError) {
          // ignore if popup could not be opened
        }
      });
    } catch {
      teardownOrphanedContentScript();
      showExtensionReloadToast();
    }
    toast?.classList.remove('bbs-toast-visible');
  });

  setTimeout(() => {
    toast?.classList.remove('bbs-toast-visible');
  }, 6000);
}

/**
 * Injects the floating quick-scan pill onto Blackboard pages.
 */
function injectFloatingButton(onScanClick: () => void) {
  if (document.getElementById('bbs-floating-root')) return;

  const root = document.createElement('div');
  root.id = 'bbs-floating-root';

  const btn = document.createElement('div');
  btn.className = 'bbs-pill-btn';
  btn.innerHTML = `
    <div class="bbs-pill-icon">⚡</div>
    <span>Scan Blackboard</span>
    <span class="bbs-pill-badge" id="bbs-floating-badge" style="display:none">0</span>
  `;

  btn.addEventListener('click', () => {
    if (!isExtensionContextValid()) {
      teardownOrphanedContentScript();
      showExtensionReloadToast();
      return;
    }
    onScanClick();
  });
  root.appendChild(btn);
  document.body.appendChild(root);
}

/**
 * Main scan execution routine. Supports incremental scanning by default.
 */
async function runScan(interactive: boolean = false, fullRescan: boolean = false) {
  if (!isExtensionContextValid()) {
    teardownOrphanedContentScript();
    if (interactive) {
      showExtensionReloadToast();
    } else {
      console.warn('[Blackboarder] Extension context invalidated (extension reloaded). Tab refresh required.');
    }
    return;
  }

  try {
    const checkpoint = fullRescan
      ? { lastScannedAt: '', processedAnnouncementIds: [], processedDirectTaskIds: [] }
      : await getLastScanCheckpoint();

    const knownDirectIds = new Set(checkpoint.processedDirectTaskIds);
    const knownAnnIds = new Set(checkpoint.processedAnnouncementIds);

    // 1. Scrape direct due date cards (incremental)
    const directStreamTasks = scrapeUltraStreamDueItems(fullRescan ? undefined : knownDirectIds);

    // 2. Scrape announcement cards (incremental)
    const announcements = await scrapeAnnouncementsFull({ fullRescan });

    if (directStreamTasks.length === 0 && announcements.length === 0) {
      if (interactive) {
        showSidekickToast('Blackboarder', 'Up to date. No new deadlines found since last scan.');
      }
      return;
    }

    const settings = await getSettings();
    const existingTasks = await getTasks();

    // Save announcements to storage (merges with existing)
    if (announcements.length > 0) {
      await saveAnnouncements(announcements);
    }

    // Process announcements for deadlines (skips already processed IDs)
    const { newTasks: extractedTasks, allTasks: mergedAnnTasks } = await processAnnouncementsBatch(
      announcements,
      existingTasks,
      settings,
      fullRescan ? undefined : knownAnnIds
    );

    // Merge direct stream tasks with deduplication against existing stored tasks
    const existingIdMap = new Map<string, DeadlineTask>();
    const existingTitleCourseMap = new Map<string, DeadlineTask>();
    const existingDateKeySet = new Set<string>();

    for (const t of mergedAnnTasks) {
      existingIdMap.set(t.id, t);
      const cleanT = (t.title || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
      const cleanC = (t.courseCode || t.courseName || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
      if (cleanT) {
        existingTitleCourseMap.set(`${cleanC}_${cleanT}`, t);
      }
      try {
        existingDateKeySet.add(`${t.courseCode}_${t.title}_${new Date(t.dueDate).toISOString().slice(0, 10)}`);
      } catch {}
    }

    const newlyAddedDirect: DeadlineTask[] = [];

    for (const dt of directStreamTasks) {
      const cleanT = (dt.title || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
      const cleanC = (dt.courseCode || dt.courseName || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
      const titleCourseKey = `${cleanC}_${cleanT}`;
      let dateKey = '';
      try {
        dateKey = `${dt.courseCode}_${dt.title}_${new Date(dt.dueDate).toISOString().slice(0, 10)}`;
      } catch {}

      const matched = existingIdMap.get(dt.id)
        || (cleanT ? existingTitleCourseMap.get(titleCourseKey) : undefined)
        || (dateKey && existingDateKeySet.has(dateKey) ? true : undefined);

      if (matched && typeof matched === 'object') {
        // Matched an existing task! If user edited it, never overwrite user changes.
        if (!matched.userEdited && matched.extractedBy !== 'manual') {
          if (!matched.hasSpecificTime && dt.hasSpecificTime) {
            matched.dueDate = dt.dueDate;
            matched.hasSpecificTime = dt.hasSpecificTime;
            matched.updatedAt = new Date().toISOString();
          }
        }
      } else if (!matched) {
        newlyAddedDirect.push(dt);
        existingIdMap.set(dt.id, dt);
        if (cleanT) existingTitleCourseMap.set(titleCourseKey, dt);
        if (dateKey) existingDateKeySet.add(dateKey);
      }
    }

    const finalTasks = [...newlyAddedDirect, ...mergedAnnTasks].sort(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    );

    await saveTasks(finalTasks);

    // Update scan checkpoint with newly processed IDs
    const newAnnIds = announcements.map(a => a.id);
    const newDirectIds = directStreamTasks.map(d => d.id);
    const newKeys = announcements.flatMap(a => [
      a.title.toLowerCase().trim(),
      `${a.courseCode}_${a.title.toLowerCase().trim()}`
    ]);
    await saveLastScanCheckpoint({
      lastScannedAt: new Date().toISOString(),
      processedAnnouncementIds: newAnnIds,
      processedDirectTaskIds: newDirectIds,
      processedAnnouncementKeys: newKeys
    });

    const totalNewCount = newlyAddedDirect.length + extractedTasks.length;

    // Update floating badge
    const badge = document.getElementById('bbs-floating-badge');
    if (badge) {
      const pendingCount = finalTasks.filter(t => t.status === 'pending').length;
      if (pendingCount > 0) {
        badge.textContent = String(pendingCount);
        badge.style.display = 'inline-block';
      }
    }

    if (interactive || totalNewCount > 0) {
      const msg = totalNewCount > 0
        ? `Found <strong>${totalNewCount}</strong> new deadline${totalNewCount > 1 ? 's' : ''} (Quizzes & Assignments) from Blackboard!`
        : `All deadlines up to date. (${finalTasks.filter(t => t.status === 'pending').length} pending tasks in dashboard)`;
      showSidekickToast('Scan Complete', msg, totalNewCount);
    }
  } catch (error: any) {
    if (error?.message?.includes('Extension context invalidated')) {
      teardownOrphanedContentScript();
      console.warn('[Blackboarder] Extension context invalidated (extension reloaded). Tab refresh required.');
      if (interactive) {
        showExtensionReloadToast();
      }
      return;
    }
    console.error('Error during Blackboard scan:', error);
  }
}

function isBlackboardSite(): boolean {
  const host = window.location.hostname.toLowerCase();
  if (host.includes('blackboard.com') || host.includes('blackboard.sharjah.ac.ae') || host.includes('elearning.sharjah.ac.ae')) {
    return true;
  }
  if (host.includes('blackboard')) {
    return true;
  }
  if (host.endsWith('sharjah.ac.ae')) {
    return host.includes('bb') || host.includes('learn') || host.includes('elearning') || Boolean(document.querySelector('#courseMenuPalette, .bb-course-title, #announcementList, bb-announcement-card, .stream-item-container, #activity-stream, [data-course-id]'));
  }
  return false;
}

// Initialize on page load
function init() {
  if (!isBlackboardSite()) {
    return;
  }

  // Inject floating button (cards are only expanded when extract is explicitly triggered)
  injectFloatingButton(() => runScan(true));

  // Keyboard shortcut listener: Alt+B (or Option+Shift+B on Mac) to open popup
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'b' || e.key === 'B')) {
      if (isExtensionContextValid()) {
        try {
          chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
        } catch {
          // Extension context might be invalidated or unavailable
        }
      }
    }
  });

  // Listen for messages from popup or background
  try {
    if (isExtensionContextValid()) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'SCRAPE_PAGE') {
          (async () => {
            try {
              const fullRescan = Boolean(message.fullRescan);
              const checkpoint = fullRescan
                ? { lastScannedAt: '', processedAnnouncementIds: [], processedDirectTaskIds: [] }
                : await getLastScanCheckpoint();

              const directTasks = scrapeUltraStreamDueItems(fullRescan ? undefined : new Set(checkpoint.processedDirectTaskIds));
              const announcements = await scrapeAnnouncementsFull({ fullRescan });
              sendResponse({
                announcements,
                directTasks,
                isIncremental: !fullRescan,
                lastScannedAt: checkpoint.lastScannedAt
              });
            } catch (err) {
              console.error('[Scraper] SCRAPE_PAGE failed:', err);
              sendResponse({ announcements: [], directTasks: [] });
            }
          })();
          return true; // Keep message channel open for async response
        } else if (message.type === 'TRIGGER_SCAN') {
          runScan(true, Boolean(message.fullRescan))
            .then(() => sendResponse({ success: true }))
            .catch(() => sendResponse({ success: false }));
          return true; // async
        }
        return false;
      });
    }
  } catch {
    // Context may already be invalidated
  }

  // Auto-scan on load if enabled
  getSettings()
    .then(settings => {
      if (!isExtensionContextValid()) return;
      if (settings.autoScanOnPageLoad) {
        setTimeout(() => {
          if (isExtensionContextValid()) {
            runScan(false);
          }
        }, 2500);
      }
    })
    .catch(() => {});

  // Zero-click Ultra Stream Infinite Scroll Observer
  initUltraStreamObserver();
}

/**
 * Watches for dynamically rendered stream cards during infinite scrolling
 * and runs a quiet incremental micro-scan automatically.
 */
function initUltraStreamObserver() {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isScanning = false;

  const observer = new MutationObserver(mutations => {
    if (!isExtensionContextValid()) {
      teardownOrphanedContentScript();
      return;
    }

    let hasRelevantNodes = false;
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length > 0) {
        for (let i = 0; i < m.addedNodes.length; i++) {
          const node = m.addedNodes[i];
          if (node instanceof HTMLElement) {
            if (node.matches && (
              node.matches('[role="feed"] > *, .stream-item-container, .stream-item, [class*="activity-card"], bb-announcement-card, #announcementList > *') ||
              node.querySelector?.('.stream-item-container, .stream-item, bb-announcement-card, [class*="activity-card"], [class*="timeline"]')
            )) {
              hasRelevantNodes = true;
              break;
            }
          }
        }
      }
      if (hasRelevantNodes) break;
    }

    if (hasRelevantNodes && !isScanning) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (!isExtensionContextValid()) {
          teardownOrphanedContentScript();
          return;
        }
        isScanning = true;
        try {
          console.log('[Blackboarder] Ultra stream scroll detected: running quiet incremental scan...');
          await runScan(false, false);
        } catch (e: any) {
          if (e?.message?.includes('Extension context invalidated')) {
            teardownOrphanedContentScript();
            console.warn('[Blackboarder] Extension context invalidated during auto-scan.');
          } else {
            console.warn('[Blackboarder] Infinite scroll auto-scan error:', e);
          }
        } finally {
          isScanning = false;
        }
      }, 1500);
    }
  });

  activeStreamObserver = observer;
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Run after document is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
