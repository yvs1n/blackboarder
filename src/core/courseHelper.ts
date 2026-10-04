/**
 * Utility to extract clean course names and course codes from Blackboard text.
 */
export interface CourseInfo {
  code: string;
  name: string;
}

export function parseCourseDetails(rawText: string): CourseInfo {
  if (!rawText || !rawText.trim()) {
    return { code: 'UOS', name: 'General Course' };
  }

  // Remove common Blackboard UI noise and direct stream due-date metadata
  let clean = rawText
    .replace(/blackboard\s*(?:learn|ultra)?/gi, '')
    .replace(/announcements?/gi, '')
    .replace(/courses?/gi, '')
    .replace(/stream/gi, '')
    .replace(/university of sharjah/gi, '')
    .replace(/^(?:Due\s*(?:in|date)?|تسليم|تاريخ\s*الاستحقاق)[:\s-]*/gi, '')
    .replace(/(?:Report)?Due\s*date:.*$/gi, '') // Strip trailing stream card metadata
    .replace(/New\s*Group\s*\d+/gi, '')
    .replace(/\(UTC[+-]?\d+\)/gi, '')
    .trim();

  // Recognize known Physics 1 Lab assignments/reports
  if (/measuring\s*density|free\s*fall|lab\.?\s*report|student's\s*lab/i.test(clean)) {
    return { code: '1430116', name: 'Physics 1 Lab' };
  }

  // Remove semester/term tags like "(Spring 2026)", "Fall 2025", "- Fall 2025/2026"
  clean = clean
    .replace(/\((?:Spring|Fall|Summer|Winter|Term|Semester)[^)]*\)/gi, '')
    .replace(/(?:[-–—|]\s*)?(?:Spring|Fall|Summer|Winter|Term|Semester)\s*\d{2,4}(?:\/\d{2,4})?\b/gi, '')
    .trim();

  // Match Course Code: 7-digit UOS code (e.g. 0401201) or Letter+Digits (e.g. CS101, MATH201)
  let code = 'UOS';
  const codeMatch = clean.match(/\b([0-9]{7}|[A-Z]{2,4}\s*[0-9]{3,4})\b/i);
  if (codeMatch) {
    code = codeMatch[1].replace(/\s+/g, '');
  }

  // If string contains multiple segments like "Calculus I for Engineering - 02 - حسبان 1 للمهندسين"
  // or "0401201 - Computer Programming"
  const parts = clean.split(/\s*[-–—|]\s*/).map(p => p.trim()).filter(Boolean);
  let name = '';

  for (const part of parts) {
    // Check if this part is just a section number (e.g. "02", "13A", "ALL", "1") or just the code
    const isSectionOrCode = /^(?:\d{1,7}[A-Z]?|ALL|SEC\b.*)$/i.test(part) || part === code;
    if (!isSectionOrCode && part.length >= 3) {
      name = part;
      break;
    }
  }

  // Fallback to general cleaning if no clear part was found
  if (!name) {
    name = clean;
  }

  // Thorough cleaning of the selected name
  name = name
    .replace(new RegExp(`\\b${code}\\b`, 'i'), '')
    .replace(/^[-_.]?\d{1,3}[A-Z]?\s+/g, '') // leading section numbers like "01 " or "-01 "
    .replace(/[-_.]\d{1,3}[A-Z]?\b/g, '')
    .replace(/[\[\]]/g, ' ')
    .replace(/^[:\-–—|\s]+|[:\-–—|\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // If clean name became empty (e.g. input was just "0401201-01"), provide a readable fallback
  if (!name || name.length < 2) {
    name = code !== 'UOS' ? `Course ${code}` : 'General Course';
  }

  return { code, name };
}

/**
 * Strips Blackboard system noise (posted timestamps like "1:21 PM" or "14 minutes ago",
 * course labels, course codes, section numbers, bilingual headers) from the beginning
 * of an announcement, leaving only the professor's actual announcement text.
 */
export function sanitizeDoctorAnnouncementText(
  rawText: string,
  courseName?: string,
  courseCode?: string,
  title?: string
): string {
  if (!rawText || !rawText.trim()) return '';

  let text = rawText.trim();

  // Blackboard Ultra Stream timestamps pattern (e.g. "1:21 PM", "14 minutes ago", "Today at 1:21 PM", "Yesterday at 10:00 AM")
  const timestampPrefixPatterns = [
    // "1:21 PM", "11:59 AM", "13:21", "01:21 PM"
    /^\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\b\s*/i,
    // "14 minutes ago", "2 hours ago", "yesterday", "just now"
    /^\s*(?:\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?)\s+ago|just now)\b\s*/i,
    // "Today at 1:21 PM", "Yesterday at 10:00 AM"
    /^\s*(?:Today|Yesterday)(?:\s+at)?\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)?\b\s*/i,
    // "Monday, 12 October 2026, 1:21 PM" (if followed by course or text)
    /^\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?,?\s*(?:\d{1,2}\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*(?:\d{1,2})?(?:,?\s*\d{4})?(?:,?\s*at\s*|,?\s+)?(?:\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)?\s*[-–—:]*\s*/i,
    // Arabic relative/posted timestamps: "منذ 14 دقيقة", "اليوم الساعة 1:21 مساءً", "أمس"
    /^\s*(?:منذ\s+\d+\s+(?:دقائق|دقيقة|ساعات|ساعة|أيام|يوم)|اليوم|أمس)(?:\s+الساعة)?\s*(?:\d{1,2}:\d{2}\s*(?:صباحاً|صباحا|مساءً|مساء)?)?\s*/
  ];

  // Course prefix patterns:
  // e.g. "Introduction to Computer Eng. - 01 - مقدمة في هندسة الحاسوب"
  // "Calculus I for Engineering - 02 - حسبان 1 للمهندسين"
  // "Physics 1 - 02", "Physics 1 Lab - 11L"
  // "English for Academic Purposes - 09"
  // "Islamic Culture - 13A - ثقافة إسلامية"
  const knownCoursePatterns = [
    /^\s*(?:Introduction\s+to\s+Computer\s+Eng(?:\.|ineering)?|مقدمة\s+في\s+هندسة\s+الحاسوب)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*(?:مقدمة\s+في\s+هندسة\s+الحاسوب|Introduction\s+to\s+Computer\s+Eng(?:\.|ineering)?)?\s*[-–—:]*\s*/i,
    /^\s*(?:Calculus\s+I\s+(?:for\s+Engineering)?|حسبان\s*1(?:\s*للمهندسين)?)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*(?:حسبان\s*1(?:\s*للمهندسين)?|Calculus\s+I\s+(?:for\s+Engineering)?)?\s*[-–—:]*\s*/i,
    /^\s*(?:Physics\s*1\s*Lab|مختبر\s*فيزياء\s*1|فيزياء\s*1\s*عملي)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*/i,
    /^\s*(?:Physics\s*1|General\s*Physics\s*1|فيزياء\s*1|فيزياء\s*عامة\s*1)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*/i,
    /^\s*(?:English\s+for\s+Academic\s+Purposes|EAP|إنجليزي|انجليزي)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*/i,
    /^\s*(?:Islamic\s+Culture|ثقافة\s*إسلامية|ثقافة\s*اسلامية)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*/i
  ];

  // Specific course name passed from context
  const dynamicCoursePatterns: RegExp[] = [];
  if (courseName && courseName !== 'General Course') {
    const escaped = courseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    dynamicCoursePatterns.push(new RegExp(`^\\s*${escaped}\\s*[-–—:]*\\s*(?:\\b\\d{1,2}[A-Z]?\\b)?\\s*[-–—:]*`, 'i'));
  }
  if (courseCode && courseCode !== 'UOS') {
    const escapedCode = courseCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    dynamicCoursePatterns.push(new RegExp(`^\\s*${escapedCode}\\s*[-–—:]*`, 'i'));
  }

  // Iterate up to 5 passes to clean layered prefixes (e.g. [timestamp] [course name] [section] [arabic name])
  let changed = true;
  let passes = 0;
  while (changed && passes < 5) {
    changed = false;
    passes++;

    // 1. Strip leading timestamps
    for (const pat of timestampPrefixPatterns) {
      if (pat.test(text)) {
        const next = text.replace(pat, '').trim();
        if (next.length >= 5) {
          text = next;
          changed = true;
        }
      }
    }

    // 2. Strip dynamic course name/code
    for (const pat of dynamicCoursePatterns) {
      if (pat.test(text)) {
        const next = text.replace(pat, '').trim();
        if (next.length >= 5) {
          text = next;
          changed = true;
        }
      }
    }

    // 3. Strip known course headers
    for (const pat of knownCoursePatterns) {
      if (pat.test(text)) {
        const next = text.replace(pat, '').trim();
        if (next.length >= 5) {
          text = next;
          changed = true;
        }
      }
    }

    // 4. Strip stray section number leftovers like "- 01 - " or "01 - "
    const sectionMatch = text.match(/^[-–—:]*\s*\b(?:\d{1,2}[A-Z]?|ALL)\b\s*[-–—:]*\s*/i);
    if (sectionMatch && sectionMatch[0]) {
      const next = text.slice(sectionMatch[0].length).trim();
      if (next.length >= 5) {
        text = next;
        changed = true;
      }
    }
  }

  // If there's an exact duplicate of title at the beginning, strip it cleanly
  // If there's an exact duplicate of title at the beginning on its own line or followed by separator, strip it cleanly
  if (title && title.length > 5) {
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const titlePat = new RegExp(`^\\s*${escapedTitle}(?:\\s*[-–—:]+\\s*|\\s*\\r?\\n|\\s*$)`, 'i');
    if (titlePat.test(text)) {
      const remainder = text.replace(titlePat, '').trim();
      if (remainder.length >= 5) {
        text = remainder;
      }
    }
  }

  // Clean remaining punctuation at the beginning
  text = text.replace(/^[:\-–—|,\s]+/, '').trim();

  return text || rawText.trim();
}

/**
 * Standardizes and normalizes course name and course code from task fields and text patterns.
 * Solves raw Ultra stream card strings (e.g. "Measuring Density...", "Topic of a paragraph...")
 * by resolving to official course titles ("Physics 1 Lab", "English for Academic Purposes")
 * while preserving custom edits made by the user.
 */
export function resolveCourseInfo(task: {
  courseName?: string;
  courseCode?: string;
  title?: string;
  description?: string;
  sourceSnippet?: string;
  notes?: string;
}): { courseName: string; courseCode: string } {
  let courseName = (task.courseName || '').trim();
  let courseCode = (task.courseCode || '').trim();
  const title = (task.title || '').trim();

  // Fix messy Ultra stream direct assignments
  if (/measuring\s*density/i.test(courseName) || /measuring\s*density/i.test(title)) {
    courseName = 'Physics 1 Lab';
    courseCode = '1430116';
  } else if (/free\s*fall/i.test(courseName) || /free\s*fall/i.test(title)) {
    courseName = 'Physics 1 Lab';
    courseCode = '1430116';
  } else if (/vectors?\s*exp/i.test(courseName) || /vectors?\s*exp/i.test(title)) {
    courseName = 'Physics 1 Lab';
    courseCode = '1430116';
  } else if (/lab\.?\s*report/i.test(courseName) || /student's\s*lab/i.test(courseName)) {
    courseName = 'Physics 1 Lab';
    courseCode = '1430116';
  } else if (/topic\s*of\s*a\s*paragraph/i.test(courseName) || /topic\s*of\s*a\s*paragraph/i.test(title)) {
    courseName = 'English for Academic Purposes';
    courseCode = '0202112';
  } else {
    // Strip trailing stream card metadata
    courseName = courseName
      .replace(/(?:Report)?Due\s*date:.*$/gi, '')
      .replace(/New\s*Group\s*\d+/gi, '')
      .replace(/\(UTC[+-]?\d+\)/gi, '')
      .replace(/^[:\-–—|\s]+|[:\-–—|\s]+$/g, '')
      .trim();
  }

  const isGeneric = !courseName || 
                    courseName.toLowerCase() === 'uos' || 
                    courseName.toLowerCase() === 'course' || 
                    courseName.toLowerCase() === 'general course' ||
                    courseName === courseCode;

  if (isGeneric) {
    const combined = `${courseCode} ${courseName} ${title} ${task.description || ''} ${task.sourceSnippet || ''} ${task.notes || ''}`;
    if (/(?:intro.*comp|comp(?:uter)?\s*eng|هندسة.*حاسوب|حاسوب|1502101|0402101)/i.test(combined)) {
      courseName = 'Introduction to Computer Eng.';
      courseCode = '1502101';
    } else if (/(?:calculus|calc\b|حسبان|1440133|1440131|0401101)/i.test(combined)) {
      courseName = 'Calculus I for Engineering';
      courseCode = '1440133';
    } else if (/(?:english|eap\b|academic\s*purposes|academic\s*english|إنجليزي|انجليزي|0202112)/i.test(combined)) {
      courseName = 'English for Academic Purposes';
      courseCode = '0202112';
    } else if (/(?:physics\s*1(?!\s*lab)|general\s*physics\s*1|فيزياء\s*1|1430115)/i.test(combined)) {
      courseName = 'Physics 1';
      courseCode = '1430115';
    } else if (/(?:phys(?:ics)?.*lab|lab.*phys(?:ics)?|مختبر.*فيزياء|1430116)/i.test(combined)) {
      courseName = 'Physics 1 Lab';
      courseCode = '1430116';
    } else if (/(?:islamic|إسلام|اسلام|ثقافة|0104100)/i.test(combined)) {
      courseName = 'Islamic Culture';
      courseCode = '0104100';
    }
  }

  // Clean UOS strings: Never return 'UOS' as a course code or course name!
  const finalName = (!courseName || courseName.toLowerCase() === 'uos') ? 'General Course' : courseName;
  const finalCode = (courseCode && courseCode.toUpperCase() !== 'UOS' && courseCode !== finalName) ? courseCode : '';

  return { courseName: finalName, courseCode: finalCode };
}

/**
 * Filters out empty or ghost tasks that lack a valid title or are meaningless artifacts
 * from stream submission receipts, notifications, or generic reminder text.
 */
export function isValidTask(task: { title?: string; courseName?: string; courseCode?: string }): boolean {
  if (!task || !task.title || !task.title.trim()) return false;
  const titleLower = task.title.trim().toLowerCase();
  const isGenericTitle = /^(?:assignment|untitled|due(?:\s+in.*)?|reminder|activity|announcement)$/i.test(titleLower);
  const isGenericCourse = !task.courseName || task.courseName === 'General Course' || task.courseName.toLowerCase() === 'uos';
  const isGenericCode = !task.courseCode || task.courseCode === 'UOS';
  if (isGenericTitle && isGenericCourse && isGenericCode) {
    return false;
  }
  return true;
}

