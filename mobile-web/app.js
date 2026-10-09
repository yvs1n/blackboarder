/**
 * Blackboarder Mobile - Client Application
 * Touch-optimized companion with offline caching, live WebCal feed, and push notifications.
 */

const FIREBASE_DB_URL = 'https://blackboard-sidekick-default-rtdb.asia-southeast1.firebasedatabase.app';

/**
 * Retrieves the active Sync Pairing Key:
 * 1. Checks URL parameter ?key=... (and saves to localStorage if present)
 * 2. Checks localStorage('bbs_sync_key')
 */
function getSyncKey() {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlKey = params.get('key');
    if (urlKey && urlKey.trim()) {
      const clean = urlKey.trim().toUpperCase().replace(/[^a-zA-Z0-9_-]/g, '');
      localStorage.setItem('bbs_sync_key', clean);
      return clean;
    }
    const saved = localStorage.getItem('bbs_sync_key');
    if (saved && saved.trim()) {
      return saved.trim().toUpperCase().replace(/[^a-zA-Z0-9_-]/g, '');
    }
  } catch (e) {}
  return '';
}

function getFirebaseDataUrl() {
  const key = getSyncKey();
  return key ? `${FIREBASE_DB_URL}/users/${key}/data.json` : `${FIREBASE_DB_URL}/data.json`;
}

// Permanent Subject Colors (matching University of Sharjah curriculum)
const PERMANENT_COURSE_LEGEND = [
  { code: '1502101', name: 'Intro to Comp Eng.', color: '#7c7c7c', pattern: /(?:intro.*comp|comp(?:uter)?\s*eng|هندسة.*حاسوب|حاسوب|1502101|0402101|0402102|0401102)/i },
  { code: '1440133', name: 'Calculus I for Engineering', color: '#dc2626', pattern: /(?:calculus|calc\b|حسبان|1440133|1440131|0401101|0401201)/i },
  { code: '1430115', name: 'Physics 1', color: '#4b99d2', pattern: /(?:physics\s*1(?!\s*lab)|general\s*physics\s*1|فيزياء\s*1(?!\s*عملي)|فيزياء\s*عامة\s*1|1430115|1430111|0401115)/i },
  { code: '1430116', name: 'Physics 1 Lab', color: '#4b99d2', pattern: /(?:phys(?:ics)?.*lab|lab.*phys(?:ics)?|مختبر.*فيزياء|فيزياء.*عملي|1430116|1430117|0401116)/i },
  { code: '0202112', name: 'English for Academic Purposes', color: '#525252', pattern: /(?:english|eap\b|academic\s*purposes|academic\s*english|إنجليزي|انجليزي|0202112|0202111)/i },
  { code: '0104100', name: 'Islamic Culture', color: '#489160', pattern: /(?:islamic|إسلام|اسلام|ثقافة|0104100|0104101)/i }
];

// Fallback palette for any unexpected courses
const FALLBACK_PALETTE = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#db2777', '#0891b2'];

// Student Class Schedule (from schedule.pdf with student room assignments)
const STUDENT_CLASS_SCHEDULE = [
  { courseCode: '1502 101 01', courseName: 'Introduction to Computer Engineering', days: 'Tue / Thu', time: '11:00 AM - 12:15 PM', room: 'A8-103', matcher: /(?:intro.*comp|comp(?:uter)?\s*eng|هندسة.*حاسوب|حاسوب|1502101|0402101|0402102|0401102)/i },
  { courseCode: '1440 133 02', courseName: 'Calculus I for Engineering', days: 'Tue / Thu', time: '12:30 PM - 01:45 PM', room: 'A12-110', matcher: /(?:calculus|calc\b|حسبان|1440133|1440131|0401101|0401201)/i },
  { courseCode: '0202 112 09', courseName: 'English for Academic Purposes', days: 'Tue / Thu', time: '02:00 PM - 03:15 PM', room: 'A3-184', matcher: /(?:english|eap\b|academic\s*purposes|academic\s*english|إنجليزي|انجليزي|0202112|0202111)/i },
  { courseCode: '1430 115 02', courseName: 'Physics 1', days: 'Mon / Wed', time: '11:00 AM - 12:15 PM', room: 'A8-110', matcher: /(?:physics\s*1(?!\s*lab)|general\s*physics\s*1|فيزياء\s*1(?!\s*عملي)|فيزياء\s*عامة\s*1|1430115|1430111|0401115)/i },
  { courseCode: '1430 116 04', courseName: 'Physics 1 Lab', days: 'Wed', time: '02:00 PM - 04:45 PM', room: 'Central Lab Men - 105', matcher: /(?:phys(?:ics)?.*lab|lab.*phys(?:ics)?|مختبر.*فيزياء|فيزياء.*عملي|1430116|1430117|0401116|measuring\s*density|free\s*fall|student'?s\s*lab)/i },
  { courseCode: '0104 100', courseName: 'Islamic Culture', days: 'Mon / Wed', time: '05:00 PM - 06:15 PM', room: 'A8-TH005', matcher: /(?:islamic|إسلام|اسلام|ثقافة|0104100|0104101)/i }
];

/**
 * Extracts explicit room/hall/lab numbers mentioned by professors in announcement text.
 */
function extractRoomFromText(text) {
  if (!text) return null;

  // 0. Positive relocation / explicit room indicator (e.g. "moved to room A8-204", "held in A8-103", "in room A8-204", "قاعة A8-204")
  const targetRoomRegex = /(?:moved\s*to(?:\s*room)?|transferred\s*to|held\s*in|location:?|venue:?|in\s*room|في\s*قاعة|قاعة)\s*[:\-–]?\s*([A-Za-z]\d{1,2}\s*[-–—/]\s*(?:TH\d{2,4}|Lab\s*\d+|\d{2,4}[A-Za-z]?))\b/i;
  const targetMatch = text.match(targetRoomRegex);
  if (targetMatch) {
    return targetMatch[1].replace(/\s*[-–—/]\s*/, '-').toUpperCase();
  }

  // 1. Explicit Building + Room or Lab patterns (e.g. "A8-103", "A12 - 110", "A3-184", "A8-TH005", "W8-Lab 3", "M9-102")
  // Exclude rooms explicitly negated (e.g. "NOT in A12-110", "not take place in A12-110")
  const allBldMatches = Array.from(text.matchAll(/\b([A-Za-z]\d{1,2}\s*[-–—/]\s*(?:TH\d{2,4}|Lab\s*\d+|\d{2,4}[A-Za-z]?))\b/gi));
  for (const m of allBldMatches) {
    const matchIndex = m.index ?? 0;
    const precedingSnippet = text.slice(Math.max(0, matchIndex - 35), matchIndex).toLowerCase();
    const isNegated = /not\s*(?:take\s*place\s*)?in\s*$|not\s*in\s*$|never\s*in\s*$|instead\s*of\s*$|ليس\s*في\s*$/i.test(precedingSnippet);
    if (!isNegated) {
      return m[1].replace(/\s*[-–—/]\s*/, '-').toUpperCase();
    }
  }

  const centralLabRegex = /\b(?:central\s*lab(?:orator(?:y|ies))?(?:\s*\(?men\)?)?)\s*[-–—:]*\s*(\d{2,4}[A-Za-z]?)\b/i;
  const centralMatch = text.match(centralLabRegex);
  if (centralMatch) {
    return `Central Lab Men - ${centralMatch[1]}`;
  }
  const enRoomRegex = /\b(?:in\s+)?(?:room|rm|classroom|hall|auditorium|lecture\s*hall|lab|laboratory)\s*(?:#|no\.?|number)?\s*[:\-–]?\s*([A-Za-z0-9]{1,6}(?:\s*[-–—/]\s*[A-Za-z0-9]+)?)\b/i;
  const enMatch = text.match(enRoomRegex);
  if (enMatch) {
    const raw = enMatch[1].trim();
    if (!/^(?:temperature|conditions|for|and|or|the|to|with|all|due|today|tomorrow|yesterday)$/i.test(raw)) {
      return raw.replace(/\s*[-–—/]\s*/, '-');
    }
  }
  const arRoomRegex = /(?:في\s+)?(?:قاعة|غرفة|مدرج|مختبر|معمل)\s*(?:رقم)?\s*[:\-–]?\s*([A-Za-z0-9\s/–-]{2,15})/i;
  const arMatch = text.match(arRoomRegex);
  if (arMatch) {
    const raw = arMatch[1].trim();
    if (raw && !/^(?:الامتحان|الدراسة|المحاضرة|اليوم|أمس|غدا|غداً)$/i.test(raw)) {
      return raw.replace(/\s*[-–—/]\s*/, '-');
    }
  }
  return null;
}

/**
 * Resolves room for a task: prioritizes professor's announced room, then schedule default.
 */
function resolveTaskRoom(task) {
  const type = (task?.type || '').toLowerCase();
  if (type === 'assignment' || type === 'hw' || type === 'project') {
    return '';
  }
  const combined = `${task?.title || ''} ${task?.sourceSnippet || ''} ${task?.description || ''}`.trim();
  const announced = extractRoomFromText(combined);
  if (announced) return announced;

  if (task.room && task.room.trim()) {
    return task.room.trim();
  }

  const courseContext = `${task.courseName || ''} ${task.courseCode || ''} ${combined}`;
  for (const s of STUDENT_CLASS_SCHEDULE) {
    if (s.matcher.test(courseContext)) {
      return s.room;
    }
  }
  return '';
}

/**
 * Strips UI artifacts, timestamps, and redundant course headers from the text
 * of an announcement, leaving only the professor's actual announcement text.
 */
function sanitizeDoctorAnnouncementText(rawText, courseName = '', courseCode = '', title = '') {
  if (!rawText || !rawText.trim()) return '';

  let text = rawText.trim();

  const timestampPrefixPatterns = [
    /^\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\b\s*/i,
    /^\s*(?:\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?)\s+ago|just now)\b\s*/i,
    /^\s*(?:Today|Yesterday)(?:\s+at)?\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)?\b\s*/i,
    /^\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?,?\s*(?:\d{1,2}\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*(?:\d{1,2})?(?:,?\s*\d{4})?(?:,?\s*at\s*|,?\s+)?(?:\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)?\s*[-–—:]*\s*/i,
    /^\s*(?:منذ\s+\d+\s+(?:دقائق|دقيقة|ساعات|ساعة|أيام|يوم)|اليوم|أمس)(?:\s+الساعة)?\s*(?:\d{1,2}:\d{2}\s*(?:صباحاً|صباحا|مساءً|مساء)?)?\s*/
  ];

  const knownCoursePatterns = [
    /^\s*(?:Introduction\s+to\s+Computer\s+Eng(?:\.|ineering)?|مقدمة\s+في\s+هندسة\s+الحاسوب)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*(?:مقدمة\s+في\s+هندسة\s+الحاسوب|Introduction\s+to\s+Computer\s+Eng(?:\.|ineering)?)?\s*[-–—:]*\s*/i,
    /^\s*(?:Calculus\s+I\s+(?:for\s+Engineering)?|حسبان\s*1(?:\s*للمهندسين)?)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*(?:حسبان\s*1(?:\s*للمهندسين)?|Calculus\s+I\s+(?:for\s+Engineering)?)?\s*[-–—:]*\s*/i,
    /^\s*(?:Physics\s*1\s*Lab|مختبر\s*فيزياء\s*1|فيزياء\s*1\s*عملي)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*/i,
    /^\s*(?:Physics\s*1|General\s*Physics\s*1|فيزياء\s*1|فيزياء\s*عامة\s*1)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*/i,
    /^\s*(?:English\s+for\s+Academic\s+Purposes|EAP|إنجليزي|انجليزي)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*/i,
    /^\s*(?:Islamic\s+Culture|ثقافة\s*إسلامية|ثقافة\s*اسلامية)\s*[-–—:]*\s*(?:\b\d{1,2}[A-Z]?\b)?\s*[-–—:]*\s*/i
  ];

  const dynamicCoursePatterns = [];
  if (courseName && courseName !== 'General Course') {
    const escaped = courseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    dynamicCoursePatterns.push(new RegExp(`^\\s*${escaped}\\s*[-–—:]*\\s*(?:\\b\\d{1,2}[A-Z]?\\b)?\\s*[-–—:]*`, 'i'));
  }
  if (courseCode && courseCode !== 'UOS') {
    const escapedCode = courseCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    dynamicCoursePatterns.push(new RegExp(`^\\s*${escapedCode}\\s*[-–—:]*`, 'i'));
  }

  let changed = true;
  let passes = 0;
  while (changed && passes < 5) {
    changed = false;
    passes++;

    for (const pat of timestampPrefixPatterns) {
      if (pat.test(text)) {
        const next = text.replace(pat, '').trim();
        if (next.length >= 5) {
          text = next;
          changed = true;
        }
      }
    }

    for (const pat of dynamicCoursePatterns) {
      if (pat.test(text)) {
        const next = text.replace(pat, '').trim();
        if (next.length >= 5) {
          text = next;
          changed = true;
        }
      }
    }

    for (const pat of knownCoursePatterns) {
      if (pat.test(text)) {
        const next = text.replace(pat, '').trim();
        if (next.length >= 5) {
          text = next;
          changed = true;
        }
      }
    }

    const sectionMatch = text.match(/^[-–—:]*\s*\b(?:\d{1,2}[A-Z]?|ALL)\b\s*[-–—:]*\s*/i);
    if (sectionMatch && sectionMatch[0]) {
      const next = text.slice(sectionMatch[0].length).trim();
      if (next.length >= 5) {
        text = next;
        changed = true;
      }
    }
  }

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

  return text.trim();
}

// Syllabus Database
const SYLLABUS_INFO = [
  { courseCode: '1440 133 02', courseName: 'Calculus I for Engineering', breakdown: 'Midterm 30% (Paper), Quizzes 20% (Best 2 of 3), HWs 10% (Best 3 of 4 Online), Final 40% (Paper)' },
  { courseCode: '1430 115 02', courseName: 'Physics 1 & Lab', breakdown: 'Final Exam 45%, Quizzes 20% (Average), Assignments 10%, Lab Practical 25%' },
  { courseCode: '1502 101 01', courseName: 'Introduction to Computer Engineering', breakdown: 'Quizzes (Best 3 of 4 Average), Midterm Exam, Projects & Final Exam. No home homeworks' },
  { courseCode: '0202 112 09', courseName: 'English for Academic Purposes', breakdown: 'Writing Portfolios, Reading Comprehension Quizzes, Speaking Presentations, Final Exam' },
  { courseCode: '0104 100', courseName: 'Islamic Culture', breakdown: 'Midterm Exam 30%, Quizzes & Activities 20%, Final Exam 50%' }
];

// Exact syllabus grade distributions extracted from course PDFs in syllabus/
const DEFAULT_SYLLABUS_DATABASE = [
  {
    courseId: 'calc1',
    courseName: 'Calculus 1 for Engineering',
    courseCodePattern: /(?:calculus|calc\b|حسبان|1440133|1440131|0401101|0401201)/i,
    sourcePdf: 'calc_1.pdf',
    totalWeight: 100,
    components: [
      { id: 'calc1_final', name: 'Final Exam', type: 'exam', totalWeight: 40, unitWeight: 40, note: 'On paper (40%)', matcher: /(?:final\s*exam|final|امتحان\s*نهائي|نهائي)/i },
      { id: 'calc1_midterm', name: 'Midterm Exam', type: 'exam', totalWeight: 30, unitWeight: 30, note: 'On paper (30%)', matcher: /(?:midterm\s*exam|midterm|امتحان\s*نصفي|نصفي|منتصف)/i },
      { id: 'calc1_quizzes', name: 'Quizzes', type: 'quiz', totalWeight: 20, count: 2, unitWeight: 10, note: 'Best 2 of 3 quizzes (10% each, 20% total)', matcher: /(?:quiz|كويز|امتحان\s*قصير)/i },
      { id: 'calc1_assignments', name: 'Homeworks', type: 'assignment', totalWeight: 10, count: 3, unitWeight: 3.33, note: 'Online, best 3 of 4 homeworks (~3.33% each, 10% total)', matcher: /(?:assignment|hw|homework|واجب|connect)/i }
    ]
  },
  {
    courseId: 'eap',
    courseName: 'English for Academic Purposes',
    courseCodePattern: /(?:english|eap\b|academic\s*english|إنجليز|انجليز|0202112|0202111)/i,
    sourcePdf: 'eap.pdf',
    totalWeight: 100,
    components: [
      { id: 'eap_final', name: 'Final Exam', type: 'exam', totalWeight: 40, unitWeight: 40, note: 'Week 16 (40%)', matcher: /(?:final\s*exam|final|نهائي)/i },
      { id: 'eap_midterm', name: 'Midterm Exam', type: 'exam', totalWeight: 20, unitWeight: 20, note: 'Week 8 (20%)', matcher: /(?:midterm\s*exam|midterm|نصفي|منتصف)/i },
      { id: 'eap_quizzes', name: 'Quizzes', type: 'quiz', totalWeight: 20, count: 2, unitWeight: 10, note: '2 Quizzes (10% each, 20% total)', matcher: /(?:quiz|كويز)/i },
      { id: 'eap_essay', name: 'Cause-Effect Essay', type: 'assignment', totalWeight: 10, unitWeight: 10, note: 'Week 12 Writing Assignment (10%)', matcher: /(?:essay|cause.*effect|writing\s*assignment|مقال)/i },
      { id: 'eap_employability', name: 'Employability Skills', type: 'assignment', totalWeight: 10, count: 5, unitWeight: 2, note: '5 Employability Tasks (2% each, 10% total)', matcher: /(?:employability|skill|task|مهام|مهارات)/i }
    ]
  },
  {
    courseId: 'compeng',
    courseName: 'Intro to Computer Engineering',
    courseCodePattern: /(?:intro.*comp|comp(?:uter)?\s*eng|هندسة.*حاسوب|حاسوب|1502101|0402101|0402102)/i,
    sourcePdf: 'introtocompeng.pdf',
    totalWeight: 100,
    components: [
      { id: 'compeng_final', name: 'Final Exam', type: 'exam', totalWeight: 45, unitWeight: 45, note: 'TBA (45%)', matcher: /(?:final\s*exam|final|امتحان\s*نهائي|نهائي)/i },
      { id: 'compeng_midterm', name: 'Midterm Exam', type: 'exam', totalWeight: 30, unitWeight: 30, note: 'TBA (30%)', matcher: /(?:midterm\s*exam|midterm|امتحان\s*نصفي|نصفي|منتصف)/i },
      { id: 'compeng_quizzes', name: 'Quizzes', type: 'quiz', totalWeight: 25, count: 3, unitWeight: 8.33, note: 'Best 3 of 4 quizzes (~8.33% each, 25% total, no HWs)', matcher: /(?:quiz|كويز|امتحان\s*قصير)/i }
    ]
  },
  {
    courseId: 'islamic',
    courseName: 'Islamic Culture',
    courseCodePattern: /(?:islamic|إسلام|اسلام|0104100|0104101)/i,
    sourcePdf: 'islamicculture.pdf',
    totalWeight: 100,
    components: [
      { id: 'islamic_final', name: 'Final Exam', type: 'exam', totalWeight: 50, unitWeight: 50, note: 'امتحان نهائي (50%)', matcher: /(?:final\s*exam|final|امتحان\s*نهائي|نهائي)/i },
      { id: 'islamic_midterm', name: 'Midterm Exam', type: 'exam', totalWeight: 25, unitWeight: 25, note: 'امتحان المنتصف (25%)', matcher: /(?:midterm\s*exam|midterm|امتحان\s*نصفي|نصفي|منتصف)/i },
      { id: 'islamic_coursework', name: 'Coursework & Research', type: 'project', totalWeight: 25, unitWeight: 15, note: 'واجبات وتقارير وبحوث (25% total)', matcher: /(?:بحث|مشروع|تقرير|واجب|عرض|project|research|assignment|report|quiz|كويز)/i }
    ]
  },
  {
    courseId: 'phy1lab',
    courseName: 'Physics 1 Lab',
    courseCodePattern: /(?:phys(?:ics)?.*lab|lab.*phys(?:ics)?|مختبر.*فيزياء|1430116|1430117|0401116)/i,
    sourcePdf: 'phy1lab.pdf',
    totalWeight: 100,
    components: [
      { id: 'phy1lab_final', name: 'Final Examination', type: 'exam', totalWeight: 40, unitWeight: 40, note: 'Practical Final Exam (40%)', matcher: /(?:final\s*exam|final|امتحان\s*نهائي|نهائي|عملي)/i },
      { id: 'phy1lab_quizzes', name: 'Lab Quizzes', type: 'quiz', totalWeight: 30, count: 3, unitWeight: 10, note: 'Top 3 counted (10% each, 30% total)', matcher: /(?:quiz|كويز)/i },
      { id: 'phy1lab_reports', name: 'Experiments & Lab Reports', type: 'lab', totalWeight: 30, count: 9, unitWeight: 3.33, note: '9 Lab reports (~3.33% each, 30% total)', matcher: /(?:report|experiment|تقرير|تجربة|مختبر)/i }
    ]
  },
  {
    courseId: 'phy1',
    courseName: 'Physics 1',
    courseCodePattern: /(?:physics\s*1(?!\s*lab)|general\s*physics\s*1|فيزياء\s*1(?!\s*عملي)|فيزياء\s*عامة\s*1|1430115|1430\s*115)/i,
    sourcePdf: 'phy1.pdf',
    totalWeight: 100,
    components: [
      { id: 'phy1_final', name: 'Final Exam', type: 'exam', totalWeight: 45, unitWeight: 45, note: 'Final Examination (45 marks)', matcher: /(?:final\s*exam|final|امتحان\s*نهائي|نهائي)/i },
      { id: 'phy1_midterm', name: 'Midterm Exam', type: 'exam', totalWeight: 25, unitWeight: 25, note: 'Midterm Exam (25 marks)', matcher: /(?:midterm\s*exam|midterm|امتحان\s*نصفي|نصفي|منتصف)/i },
      { id: 'phy1_quizzes', name: 'Quizzes', type: 'quiz', totalWeight: 20, unitWeight: 20, note: 'Quizzes throughout semester (average = 20 marks)', matcher: /(?:quiz|كويز|امتحان\s*قصير)/i },
      { id: 'phy1_assignments', name: 'Assignments', type: 'assignment', totalWeight: 10, unitWeight: 10, note: 'Assignments / Homework (10 marks total)', matcher: /(?:assignment|hw|homework|واجب)/i }
    ]
  }
];

function extractExplicitPoints(text) {
  if (!text) return null;
  const arMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:درجة|درجات|علامة|علامات)/);
  if (arMatch) {
    const val = parseFloat(arMatch[1]);
    if (val > 0 && val <= 100) return val;
  }
  const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)\b/i);
  if (pctMatch) {
    const val = parseFloat(pctMatch[1]);
    if (val > 0 && val <= 100) return val;
  }
  const marksMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:marks?|points?|pts?)\b/i);
  if (marksMatch) {
    const val = parseFloat(marksMatch[1]);
    if (val > 0 && val <= 100) return val;
  }
  return null;
}

function resolveTaskWeight(courseNameOrCode = '', title = '', type = 'assignment', notes = '') {
  const combinedContext = `${title} ${notes}`.trim();
  const explicitPts = extractExplicitPoints(combinedContext);
  if (explicitPts !== null) {
    return {
      weight: explicitPts,
      weightDisplay: `${explicitPts}% of Grade`,
      syllabusNote: `Explicitly stated in announcement (${explicitPts} marks)`
    };
  }

  const courseStr = `${courseNameOrCode} ${combinedContext}`;
  for (const s of DEFAULT_SYLLABUS_DATABASE) {
    if (s.courseCodePattern.test(courseStr)) {
      for (const comp of s.components) {
        if (comp.matcher.test(combinedContext) || (comp.type === type && comp.matcher.test(title))) {
          const w = comp.unitWeight || comp.totalWeight;
          return {
            weight: w,
            weightDisplay: `${w}% of Grade`,
            syllabusNote: comp.note || `${comp.name} from ${s.courseName} syllabus`,
            componentName: comp.name
          };
        }
      }
    }
  }

  return {
    weight: undefined,
    weightDisplay: undefined,
    syllabusNote: undefined
  };
}

// AI & Jev Configuration
const DEFAULT_AI_SETTINGS = {
  jevApiKey: '',
  useJevClassification: false,
  openRouterApiKey: '',
  openRouterModel: 'google/gemini-3.8-flash',
  useAiExtraction: false
};

function getAiSettings() {
  try {
    const raw = localStorage.getItem('bbs_ai_settings');
    if (raw) {
      return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (e) {}
  return { ...DEFAULT_AI_SETTINGS };
}

function saveAiSettings(settings) {
  try {
    const current = getAiSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem('bbs_ai_settings', JSON.stringify(updated));
    return updated;
  } catch (e) {
    return DEFAULT_AI_SETTINGS;
  }
}

// Jev Fast Classifier (~100ms Gatekeeper)
async function callJevClassifier(text, apiKey) {
  if (!apiKey || !apiKey.trim() || !text || !text.trim()) {
    return {
      isDeadline: true,
      deadlineProbability: 0.5,
      category: 'other',
      categoryConfidence: 0.5,
      priority: 'medium',
      urgencyScore: 2.0
    };
  }

  const payload = {
    model: 'jev-latest',
    state: text.length > 1200 ? text.slice(0, 1200) : text,
    questions: {
      is_deadline: {
        type: 'noul',
        instructions: 'Does this text announce or discuss a specific academic deadline, due date, quiz, exam, test, homework, lab, or academic submission?'
      },
      category: {
        type: 'choice',
        instructions: 'What type of academic task or event is described?',
        criteria: {
          quiz: 'A quiz, pop quiz, short assessment, or test',
          exam: 'A midterm exam, final exam, or major examination',
          assignment: 'A homework assignment, problem set, essay, paper, or exercise',
          lab: 'A laboratory session, lab report, lab experiment, or lab manual work',
          project: 'A semester project, group project, milestone, presentation, or term project',
          not_a_task: 'General announcement, lecture slides notice, office hours, syllabus info, or greetings with no upcoming assessment'
        }
      },
      urgency: {
        type: 'score',
        instructions: 'How urgent or high-priority is this academic event?',
        criteria: [
          'Low priority or non-mandatory notice',
          'Standard homework or recurring reading',
          'Medium priority assignment or lab report',
          'High priority quiz or milestone',
          'Critical high-stakes midterm or final exam'
        ]
      },
      has_room: {
        type: 'noul',
        instructions: 'Does this text specify a particular room number, hall, classroom, auditorium, or lab location to attend in (e.g. room A8-103, hall TH005, lab 105, Central Lab)?'
      },
      has_time: {
        type: 'noul',
        instructions: 'Does this text specify an explicit clock time or time range for the assessment (e.g. at 12:30 pm, from 11:00 to 12:15, الساعة 12:30)?'
      }
    }
  };

  try {
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Jev API error (${response.status})`);
    }

    const data = await response.json();
    const answers = data.answers || {};
    const isDeadlineProb = answers.is_deadline?.noul ?? 0.5;
    const chosenCat = answers.category?.choice ?? 'not_a_task';
    const chosenConf = answers.category?.confidence ?? 0.5;
    const urgency = answers.urgency?.score ?? 2.0;

    const hasRoomProb = answers.has_room?.noul ?? 0.5;
    const hasTimeProb = answers.has_time?.noul ?? 0.5;
    const hasRoom = hasRoomProb >= 0.5;
    const hasTime = hasTimeProb >= 0.5;

    let priority = 'medium';
    if (urgency >= 2.8) priority = 'high';
    else if (urgency < 1.3) priority = 'low';

    const isNotTask = chosenCat === 'not_a_task';
    const isDeadline = !isNotTask && isDeadlineProb >= 0.35;

    let mappedType = 'other';
    if (isNotTask) mappedType = 'not_a_task';
    else if (['quiz', 'exam', 'assignment', 'lab', 'project'].includes(chosenCat)) {
      mappedType = chosenCat;
    }

    return {
      isDeadline,
      deadlineProbability: isDeadlineProb,
      category: mappedType,
      categoryConfidence: chosenConf,
      priority,
      urgencyScore: urgency,
      hasRoom,
      hasRoomProbability: hasRoomProb,
      hasTime,
      hasTimeProbability: hasTimeProb
    };
  } catch (err) {
    console.warn('[Jev Classifier] Client-side fetch failed, using fallback:', err);
    return fallbackResult;
  }
}

// OpenRouter Generative AI Caller
async function callOpenRouterAi(text, apiKey, model = 'google/gemini-3.8-flash', jevHint, courseHint = '') {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('OpenRouter API key not configured.');
  }

  const now = new Date();
  const baseDateStr = now.toISOString().slice(0, 10);

  const systemPrompt = `You are an expert academic assistant designed to extract due dates, assignments, quizzes, midterms, labs, exams, and projects from university Blackboard course announcements (English and Arabic).
Reference Context:
- Reference Date for relative terms ("tomorrow", "next Tuesday", "this Friday"): ${baseDateStr}.
- Current Year: ${now.getFullYear()}.
${courseHint ? `- Course: ${courseHint}.` : ''}

CRITICAL TIME & DATE RULES:
1. NEVER USE TODAY'S DATE AS THE DEADLINE OR ASSESSMENT TIME unless explicitly stated!
2. If the instructor states an explicit time or range for the assessment (e.g. "from 12:30 pm to 13:30 pm", "at 11:00 am", "12:30 - 1:30 pm", "من 12:30 إلى 13:30"):
   - Extract the START time (e.g. 12:30:00).
   - Set "hasSpecificTime": true.
3. If NO specific time of day is stated:
   - Set "hasSpecificTime": false.
   - For quizzes and exams, use 10:00:00 as a placeholder.
   - For homework/assignments, use 23:59:00 as a placeholder.
4. Calculate exact ISO 8601 timestamps (format: "YYYY-MM-DDTHH:mm:00").
5. Return a strict JSON object with key "deadlines" matching this schema:
{
  "deadlines": [
    {
      "title": "Short title, e.g., Midterm Exam",
      "courseCode": "0401101 (or null if unknown)",
      "courseName": "Calculus 1 (or detected course)",
      "dueDate": "2026-10-12T12:30:00",
      "hasSpecificTime": true,
      "type": "quiz" | "assignment" | "exam" | "project" | "lab" | "other",
      "priority": "high" | "medium" | "low",
      "room": "A8-204 (or specific room/lab if mentioned by doctor, otherwise null)",
      "description": "Clean explanation written by the doctor",
      "sourceSnippet": "Exact text sentence mentioning the deadline"
    }
  ]
}
6. If the doctor mentions a specific classroom, hall, or lab to attend in (e.g. "room A8-204", "hall TH005", "Lab 3", "قاعة 103", "مختبر 105"), extract it into "room". Otherwise set "room" to null.
If no deadlines or tasks are found, return { "deadlines": [] }. Output valid JSON only.`;

  const hintLines = [];
  if (jevHint?.category && jevHint.category !== 'not_a_task') {
    hintLines.push(`Assessment Type: "${jevHint.category}" with priority: "${jevHint.priority || 'medium'}". Use this type unless clear evidence indicates otherwise.`);
  }
  if (jevHint?.hasRoom !== undefined) {
    hintLines.push(
      jevHint.hasRoom
        ? 'Doctor mentions an explicit room/location in text: YES (You MUST extract this exact room/hall/lab into "room").'
        : 'Doctor mentions an explicit room/location in text: NO (Leave "room" as null; do not guess or hallucinate a room so the schedule default room is preserved).'
    );
  }
  if (jevHint?.hasTime !== undefined) {
    hintLines.push(
      jevHint.hasTime
        ? 'Doctor states an explicit clock time: YES (Extract the start time and set "hasSpecificTime": true).'
        : 'Doctor states an explicit clock time: NO (Set "hasSpecificTime": false so the schedule class time is preserved).'
    );
  }

  const hintBlock = hintLines.length > 0 ? `PRE-CLASSIFICATION GUIDANCE (from fast classifier):\n${hintLines.map(h => `- ${h}`).join('\n')}\n` : '';

  const userContent = `${courseHint ? `Course Hint: ${courseHint}\n` : ''}${hintBlock}Doctor's Announcement Body:
${text}`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://yassinr-uossidekick.pages.dev',
      'X-Title': 'Blackboarder Web App'
    },
    body: JSON.stringify({
      model: model || 'google/gemini-3.8-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 1000
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '{}';
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed.deadlines) ? parsed.deadlines : (Array.isArray(parsed) ? parsed : []);
  } catch (parseErr) {
    console.warn('[OpenRouter AI] Failed to parse JSON response:', parseErr);
    return [];
  }
}

// Local Regex Extractor Engine (instant, client-side)
function extractDeadlinesLocallyClient(text, courseHint = '') {
  if (!text || !text.trim()) return [];

  const MONTHS = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
    'يناير': 0, 'فبراير': 1, 'مارس': 2, 'أبريل': 3, 'ابريل': 3,
    'مايو': 4, 'يونيو': 5, 'يوليو': 6, 'أغسطس': 7, 'اغسطس': 7,
    'سبتمبر': 8, 'أكتوبر': 9, 'اكتوبر': 9, 'نوفمبر': 10, 'ديسمبر': 11
  };

  const DAYS = {
    sunday: 0, sun: 0, 'الأحد': 0, 'الاحد': 0,
    monday: 1, mon: 1, 'الاثنين': 1, 'الإثنين': 1,
    tuesday: 2, tue: 2, tues: 2, 'الثلاثاء': 2,
    wednesday: 3, wed: 3, 'الأربعاء': 3, 'الاربعاء': 3,
    thursday: 4, thu: 4, thur: 4, thurs: 4, 'الخميس': 4,
    friday: 5, fri: 5, 'الجمعة': 5,
    saturday: 6, sat: 6, 'السبت': 6
  };

  const tasks = [];
  const now = new Date();
  const currentYear = now.getFullYear();

  // Task type detection
  let taskType = 'assignment';
  let priority = 'medium';
  if (/(?:quiz|كويز|اختبار\s*قصير)/i.test(text)) {
    taskType = 'quiz';
    priority = 'high';
  } else if (/(?:midterm|final|exam|امتحان|اختبار)/i.test(text)) {
    taskType = 'exam';
    priority = 'high';
  } else if (/(?:lab\b|مختبر|تقرير\s*مختبر)/i.test(text)) {
    taskType = 'lab';
    priority = 'medium';
  } else if (/(?:project|مشروع)/i.test(text)) {
    taskType = 'project';
    priority = 'high';
  }

  // Time detection
  let startHour = 23;
  let startMinute = 59;
  let hasSpecificTime = false;

  const timeMatch = text.match(/(?:at|from|من|الساعة)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|صباحاً|صباحا|مساءً|مساء)?\b/i);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const tag = (timeMatch[3] || '').toLowerCase();
    const isPm = tag === 'pm' || /مساء/.test(tag);
    const isAm = tag === 'am' || /صباح/.test(tag);

    if (h >= 1 && h <= 12 && (isPm || isAm)) {
      if (isPm && h < 12) h += 12;
      if (isAm && h === 12) h = 0;
      startHour = h;
      startMinute = m;
      hasSpecificTime = true;
    } else if (h >= 8 && h <= 21 && timeMatch[2]) {
      startHour = h;
      startMinute = m;
      hasSpecificTime = true;
    }
  }

  // Date detection
  let targetDate = null;

  // 1. "Oct 14", "14 Oct", "October 14th", "14 أكتوبر"
  const monthNameRegex = /(?:(\d{1,2})(?:st|nd|rd|th)?\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)(?:\s+(\d{1,2})(?:st|nd|rd|th)?)?(?:,?\s*(\d{4}))?/i;
  const monthMatch = text.match(monthNameRegex);
  if (monthMatch) {
    const day = parseInt(monthMatch[1] || monthMatch[3], 10);
    const monthKey = monthMatch[2].toLowerCase();
    const month = MONTHS[monthKey];
    const year = monthMatch[4] ? parseInt(monthMatch[4], 10) : currentYear;

    if (!isNaN(day) && day >= 1 && day <= 31 && month !== undefined) {
      targetDate = new Date(year, month, day, startHour, startMinute, 0);
      if (targetDate < now && !monthMatch[4]) {
        targetDate.setFullYear(currentYear + 1);
      }
    }
  }

  // 2. Numeric date: "DD/MM/YYYY" or "YYYY-MM-DD"
  if (!targetDate) {
    const numDateMatch = text.match(/\b(?:(\d{4})[-/](\d{1,2})[-/](\d{1,2})|(\d{1,2})[-/](\d{1,2})[-/](\d{4}))\b/);
    if (numDateMatch) {
      if (numDateMatch[1]) {
        targetDate = new Date(parseInt(numDateMatch[1], 10), parseInt(numDateMatch[2], 10) - 1, parseInt(numDateMatch[3], 10), startHour, startMinute, 0);
      } else {
        targetDate = new Date(parseInt(numDateMatch[6], 10), parseInt(numDateMatch[5], 10) - 1, parseInt(numDateMatch[4], 10), startHour, startMinute, 0);
      }
    }
  }

  // 3. Relative weekday: "Monday", "next Tuesday", "on Wednesday", "يوم الأحد"
  if (!targetDate) {
    const dayRegex = /\b(?:on\s+|next\s+|يوم\s+)?(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|السبت)\b/i;
    const dayMatch = text.match(dayRegex);
    if (dayMatch) {
      const targetDayOfWeek = DAYS[dayMatch[1].toLowerCase()];
      if (targetDayOfWeek !== undefined) {
        const curDay = now.getDay();
        let daysAhead = targetDayOfWeek - curDay;
        if (daysAhead <= 0) daysAhead += 7;
        targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead, startHour, startMinute, 0);
      }
    }
  }

  // 4. "Tomorrow", "غدا", "غداً"
  if (!targetDate && /\b(tomorrow|غداً|غدا)\b/i.test(text)) {
    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, startHour, startMinute, 0);
  }

  if (targetDate && !isNaN(targetDate.getTime())) {
    // Course resolution
    let detectedCourse = courseHint || '';
    if (!detectedCourse) {
      for (const item of PERMANENT_COURSE_LEGEND) {
        if (item.pattern.test(text)) {
          detectedCourse = item.name;
          break;
        }
      }
    }

    // Default class meeting time if no explicit time was stated
    if (!hasSpecificTime && detectedCourse) {
      for (const s of STUDENT_CLASS_SCHEDULE) {
        if (s.matcher.test(detectedCourse)) {
          const parts = s.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
          if (parts) {
            let h = parseInt(parts[1], 10);
            const m = parseInt(parts[2], 10);
            const isPm = parts[3].toUpperCase() === 'PM';
            if (isPm && h < 12) h += 12;
            if (!isPm && h === 12) h = 0;
            targetDate.setHours(h, m, 0, 0);
            hasSpecificTime = true;
          }
          break;
        }
      }
    }

    const room = resolveTaskRoom({
      courseName: detectedCourse,
      title: text.slice(0, 50),
      description: text,
      sourceSnippet: text
    });

    const weightInfo = resolveTaskWeight(detectedCourse, text.slice(0, 50), taskType, text);

    const titleWords = text.trim().split(/\s+/).slice(0, 6).join(' ');
    const fallbackTitle = `${taskType.charAt(0).toUpperCase() + taskType.slice(1)}: ${titleWords}`;

    tasks.push({
      id: `task_local_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: fallbackTitle,
      courseName: detectedCourse || 'General Course',
      courseCode: '',
      dueDate: targetDate.toISOString(),
      hasSpecificTime,
      type: taskType,
      priority,
      status: 'pending',
      room: room || undefined,
      weight: weightInfo.weight,
      weightDisplay: weightInfo.weightDisplay,
      syllabusNote: weightInfo.syllabusNote,
      description: text.trim(),
      sourceSnippet: text.trim(),
      extractedBy: 'local',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  return tasks;
}

// 3-Tier Hybrid Extractor for Web Client
async function extractAnnouncementHybrid(text, courseHint = '') {
  const settings = getAiSettings();

  // Tier 1: Local Regex Engine
  const localTasks = extractDeadlinesLocallyClient(text, courseHint);

  // If local found deadlines and has generic 'other' category, refine with Jev
  if (localTasks.length > 0) {
    if (settings.useJevClassification && settings.jevApiKey && localTasks.some(t => t.type === 'other')) {
      try {
        const jevRes = await callJevClassifier(text, settings.jevApiKey);
        if (jevRes.isDeadline && jevRes.category !== 'not_a_task' && jevRes.category !== 'other') {
          for (const t of localTasks) {
            if (t.type === 'other') {
              t.type = jevRes.category;
              if (jevRes.priority) t.priority = jevRes.priority;
            }
          }
        }
      } catch (err) {
        console.warn('[Hybrid] Jev category refinement error:', err);
      }
    }
    return { tasks: localTasks, tier: 'Tier 1: Local Regex' };
  }

  // If AI is disabled or no OpenRouter key, return local tasks
  if (!settings.useAiExtraction || !settings.openRouterApiKey) {
    return { tasks: localTasks, tier: 'Tier 1: Local Regex' };
  }

  // Check if text contains assessment triggers
  const hasAcademicKeywords = /\b(quiz|exam|midterm|final|assignment|homework|hw|project|lab|due|deadline|postponed|rescheduled|واجب|كويز|امتحان|تسليم|تأجيل)\b/i.test(text);
  if (!hasAcademicKeywords) {
    return { tasks: [], tier: 'No academic keywords detected' };
  }

  // Tier 2: Jev Decision Classifier (~100ms)
  let jevHint = null;
  if (settings.useJevClassification && settings.jevApiKey) {
    try {
      const jevResult = await callJevClassifier(text, settings.jevApiKey);
      if (!jevResult.isDeadline || jevResult.category === 'not_a_task') {
        return {
          tasks: [],
          tier: 'Tier 2: Jev Fast Gatekeeper',
          rejected: true,
          reason: `Filtered out as non-deadline (${jevResult.category}, prob=${jevResult.deadlineProbability}) without calling Generative AI!`
        };
      }
      jevHint = {
        category: jevResult.category,
        priority: jevResult.priority,
        urgencyScore: jevResult.urgencyScore,
        hasRoom: jevResult.hasRoom,
        hasTime: jevResult.hasTime
      };
    } catch (jevErr) {
      console.warn('[Hybrid] Jev classifier error, falling back to Generative AI:', jevErr);
    }
  }

  // Tier 3: Generative AI (Gemini via OpenRouter)
  try {
    const rawAiTasks = await callOpenRouterAi(
      text,
      settings.openRouterApiKey,
      settings.openRouterModel,
      jevHint,
      courseHint
    );

    const formattedTasks = rawAiTasks.map(item => {
      const d = new Date(item.dueDate);
      const validDate = isNaN(d.getTime()) ? new Date() : d;
      const detectedCourse = item.courseName || courseHint || 'General Course';

      const room = resolveTaskRoom({
        courseName: detectedCourse,
        title: item.title,
        description: text,
        sourceSnippet: text,
        room: item.room
      });

      const weightInfo = resolveTaskWeight(detectedCourse, item.title, item.type, text);

      return {
        id: `task_ai_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        title: item.title || 'Extracted Assessment',
        courseName: detectedCourse,
        courseCode: item.courseCode || '',
        dueDate: validDate.toISOString(),
        hasSpecificTime: Boolean(item.hasSpecificTime),
        type: (item.type && item.type !== 'other') ? item.type : (jevHint?.category || item.type || 'other'),
        priority: item.priority || jevHint?.priority || 'medium',
        status: 'pending',
        room: room || undefined,
        weight: weightInfo.weight,
        weightDisplay: weightInfo.weightDisplay,
        syllabusNote: weightInfo.syllabusNote,
        description: item.description || text.trim(),
        sourceSnippet: item.sourceSnippet || text.trim(),
        extractedBy: 'ai',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });

    return {
      tasks: formattedTasks,
      tier: jevHint ? 'Tier 3: Generative AI (with Jev Gatekeeper Hint)' : 'Tier 3: Generative AI'
    };
  } catch (aiErr) {
    console.warn('[Hybrid] Generative AI error:', aiErr);
    return { tasks: localTasks, tier: 'Tier 1 Fallback (AI error)' };
  }
}

// Backup & Data Export Utilities
function exportJsonBackup() {
  const settings = getAiSettings();
  const backupData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    tasks: state.tasks,
    settings
  };

  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `blackboarder_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Downloaded full JSON backup of your deadlines!');
}

async function handleRestoreJson(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.tasks || !Array.isArray(data.tasks)) {
      showToast('Invalid backup JSON file.');
      return;
    }

    const taskMap = new Map();
    state.tasks.forEach(t => taskMap.set(t.id, t));
    data.tasks.forEach(t => {
      if (t.id && t.title && t.dueDate) {
        taskMap.set(t.id, t);
      }
    });

    const merged = Array.from(taskMap.values()).sort(compareTasksByTime);

    state.tasks = merged;
    saveCachedTasks(merged);
    updateAllViews();

    if (data.settings) {
      saveAiSettings(data.settings);
    }

    await syncToCloudAndLocal();
    showToast(`Successfully restored ${data.tasks.length} deadlines!`);
  } catch (err) {
    console.error('Restore error:', err);
    showToast('Failed to parse backup file.');
  }
}

function exportAllIcs() {
  const activeTasks = state.tasks.filter(t => t.status !== 'completed');
  if (activeTasks.length === 0) {
    showToast('No active deadlines to export.');
    return;
  }

  function escapeIcs(str) {
    return (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function formatUtc(d) {
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  }
  function formatDateOnly(d) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }

  const now = new Date();
  const nowUtc = formatUtc(now);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Blackboarder//UOS Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Blackboard Deadlines (UOS)',
    'X-WR-CALDESC:Live academic deadlines feed from Blackboarder Cloud',
    'X-WR-TIMEZONE:Asia/Dubai'
  ];

  for (const t of activeTasks) {
    const due = new Date(t.dueDate);
    if (isNaN(due.getTime())) continue;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${t.id}@blackboarder`);
    lines.push(`DTSTAMP:${nowUtc}`);

    if (t.hasSpecificTime) {
      const end = new Date(due.getTime() + 60 * 60 * 1000);
      lines.push(`DTSTART:${formatUtc(due)}`);
      lines.push(`DTEND:${formatUtc(end)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(due)}`);
    }

    const { courseName, courseCode } = resolveCourseInfo(t);
    const courseTag = courseCode ? `${courseName} (${courseCode})` : courseName;
    lines.push(`SUMMARY:${escapeIcs(`[${courseTag}] ${t.title}`)}`);

    const descParts = [
      `Course: ${courseTag}`,
      `Type: ${(t.type || 'assignment').toUpperCase()}`,
      t.room ? `Location: ${t.room}` : '',
      t.weightDisplay ? `Grade Weight: ${t.weightDisplay}` : '',
      t.description ? `Notes:\n${t.description}` : ''
    ].filter(Boolean);

    lines.push(`DESCRIPTION:${escapeIcs(descParts.join('\n\n'))}`);
    if (t.room) lines.push(`LOCATION:${escapeIcs(t.room)}`);
    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  const icsContent = lines.join('\r\n');

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'blackboard_deadlines.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Downloaded blackboard_deadlines.ics file!');
}

function getCourseColor(courseCode = '', courseName = '', extraContext = '') {
  const combined = `${courseName} ${courseCode} ${extraContext}`.trim();
  for (const item of PERMANENT_COURSE_LEGEND) {
    if (item.pattern.test(combined)) {
      return item.color;
    }
  }
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash << 5) - hash + combined.charCodeAt(i);
    hash |= 0;
  }
  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length];
}

function getCourseColorTheme(courseName = '', courseCode = '', extraContext = '') {
  const hex = getCourseColor(courseCode, courseName, extraContext);
  return {
    hex,
    bgLight: `${hex}18`,
    border: `${hex}45`,
    textDark: hex
  };
}

/**
 * Resolves full course name and code even if Blackboard provided empty, generic "UOS", or numeric-only strings.
 */
function resolveCourseInfo(task) {
  let courseName = (task.courseName || '').trim();
  let courseCode = (task.courseCode || '').trim();
  const title = (task.title || '').trim();

  // Fix messy Ultra stream direct assignments (e.g. "Measuring Density, Student's Lab. ReportDue date: ...")
  if (/measuring\s*density/i.test(courseName) || /measuring\s*density/i.test(title)) {
    courseName = 'Physics 1 Lab';
    courseCode = '1430 116';
    if (!task.title || task.title === 'Assignment') {
      task.title = 'Measuring Density - Lab Report';
    }
  } else if (/free\s*fall/i.test(courseName) || /free\s*fall/i.test(title)) {
    courseName = 'Physics 1 Lab';
    courseCode = '1430 116';
    if (!task.title || task.title === 'Assignment') {
      task.title = 'Free Fall Exp. - Lab Report';
    }
  } else if (/lab\.?\s*report/i.test(courseName) || /student's\s*lab/i.test(courseName)) {
    courseName = 'Physics 1 Lab';
    courseCode = '1430 116';
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
    for (const item of PERMANENT_COURSE_LEGEND) {
      if (item.pattern.test(combined)) {
        courseName = item.name;
        if (!courseCode || courseCode.toLowerCase() === 'uos') {
          courseCode = item.code;
        }
        break;
      }
    }
    if (!courseName || courseName.toLowerCase() === 'uos') {
      for (const sched of STUDENT_CLASS_SCHEDULE) {
        if (sched.matcher && sched.matcher.test(combined)) {
          courseName = sched.courseName;
          if (!courseCode) courseCode = sched.courseCode;
          break;
        }
      }
    }
  }

  const finalName = (!courseName || courseName.toLowerCase() === 'uos') ? 'General Course' : courseName;
  const finalCode = (courseCode && courseCode.toLowerCase() !== 'uos' && courseCode !== finalName) ? courseCode : '';

  return {
    courseName: finalName,
    courseCode: finalCode
  };
}

function getSvgIcon(name, extraClass = '') {
  return `<svg class="ui-icon ${extraClass}"><use href="#icon-${name}"></use></svg>`;
}

function getTaskTypeIcon(type = '', extraClass = '') {
  switch ((type || '').toLowerCase()) {
    case 'quiz': return getSvgIcon('timer', extraClass);
    case 'assignment': return getSvgIcon('notebook-pen', extraClass);
    case 'exam': return getSvgIcon('list-check', extraClass);
    case 'project': return getSvgIcon('presentation', extraClass);
    case 'lab': return getSvgIcon('flask-conical', extraClass);
    case 'meeting': return getSvgIcon('users', extraClass);
    default: return getSvgIcon('pin', extraClass);
  }
}

function formatCountdown(dueDateIso, hasSpecificTime = true, status = 'pending') {
  if (status === 'completed') {
    return { label: 'Marked as Done', urgency: 'completed' };
  }

  const now = new Date();
  const due = new Date(dueDateIso);

  if (isNaN(due.getTime())) {
    return { label: 'Date pending', urgency: 'future' };
  }

  const diffMs = due.getTime() - now.getTime();
  const isPast = diffMs < 0;
  const absDiffHours = Math.abs(diffMs) / (1000 * 60 * 60);
  const absDiffDays = Math.floor(absDiffHours / 24);

  const timeStr = hasSpecificTime
    ? due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  if (isPast) {
    if (absDiffHours < 24) {
      return { label: `Overdue (${Math.round(absDiffHours)}h ago)`, urgency: 'overdue' };
    }
    return { label: `Overdue by ${absDiffDays}d`, urgency: 'overdue' };
  }

  const isToday = now.toDateString() === due.toDateString();
  if (isToday) {
    return {
      label: hasSpecificTime ? `Due Today at ${timeStr}` : 'Due Today',
      urgency: 'today'
    };
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = tomorrow.toDateString() === due.toDateString();
  if (isTomorrow) {
    return {
      label: hasSpecificTime ? `Due Tomorrow at ${timeStr}` : 'Due Tomorrow',
      urgency: 'tomorrow'
    };
  }

  if (absDiffDays < 7) {
    const weekday = due.toLocaleDateString([], { weekday: 'short' });
    return {
      label: `${weekday} (in ${absDiffDays} days${hasSpecificTime ? ` at ${timeStr}` : ''})`,
      urgency: 'soon'
    };
  }

  const formattedDate = due.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return {
    label: `${formattedDate}${hasSpecificTime ? ` at ${timeStr}` : ''}`,
    urgency: 'future'
  };
}

function createGoogleCalendarUrl(task) {
  const startDate = new Date(task.dueDate);
  if (isNaN(startDate.getTime())) return '#';
  const endDate = new Date(startDate.getTime() + (task.hasSpecificTime ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000));

  function pad(n) { return String(n).padStart(2, '0'); }
  function formatGCal(d, allDay) {
    if (allDay) {
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    }
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  }

  const { courseName, courseCode } = resolveCourseInfo(task);
  const courseTag = courseCode ? `${courseName} (${courseCode})` : courseName;
  const title = `[${courseTag}] ${task.title}`;
  const dates = `${formatGCal(startDate, !task.hasSpecificTime)}/${formatGCal(endDate, !task.hasSpecificTime)}`;
  const cleanSnippet = (task.description || task.sourceSnippet || '').trim();
  const details = [
    `Course: ${courseTag}`,
    `Type: ${(task.type || 'assignment').toUpperCase()}`,
    task.room ? `Room: ${task.room}` : '',
    task.notes ? `Student Notes: ${task.notes}` : '',
    cleanSnippet ? `Extracted announcement:\n"${cleanSnippet}"` : '',
    '',
    'Added automatically via Blackboarder'
  ].filter(Boolean).join('\n');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates,
    details,
    location: task.room ? `${task.room} (${courseTag})` : courseName
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Helper to get the effective timestamp of a task for chronological sorting.
 * If task has specific time, uses its timestamp.
 * If task has no specific time:
 *   - uses resolved class start time if matching student class schedule
 *   - otherwise defaults to 23:59 of that day
 */
function getTaskSortTimestamp(task) {
  if (!task || !task.dueDate) return Infinity;
  const d = new Date(task.dueDate);
  if (isNaN(d.getTime())) return Infinity;

  if (task.hasSpecificTime === false) {
    const courseContext = `${task.courseName || ''} ${task.courseCode || ''} ${task.title || ''}`;
    let matchedSched = null;
    for (const s of STUDENT_CLASS_SCHEDULE) {
      if (s.matcher && s.matcher.test(courseContext)) {
        matchedSched = s;
        break;
      }
    }
    if (matchedSched) {
      const parts = matchedSched.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (parts) {
        let h = parseInt(parts[1], 10);
        const m = parseInt(parts[2], 10);
        const isPm = parts[3].toUpperCase() === 'PM';
        if (isPm && h < 12) h += 12;
        if (!isPm && h === 12) h = 0;
        const schedDate = new Date(d.getTime());
        schedDate.setHours(h, m, 0, 0);
        return schedDate.getTime();
      }
    }
    if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) {
      const endOfDay = new Date(d.getTime());
      endOfDay.setHours(23, 59, 0, 0);
      return endOfDay.getTime();
    }
  }

  return d.getTime();
}

/**
 * Chronological comparator for tasks:
 * 1. Earliest effective time comes first.
 * 2. If effective times match, tie-breaks alphabetically by task title.
 */
function compareTasksByTime(a, b) {
  const timeA = getTaskSortTimestamp(a);
  const timeB = getTaskSortTimestamp(b);

  if (timeA !== timeB) {
    return timeA - timeB;
  }

  return (a.title || '').localeCompare(b.title || '');
}

// Academic Quick Links Defaults
const DEFAULT_QUICK_LINKS = [
  {
    id: 'ql_attendance',
    title: 'Attendance (Banner SSB)',
    url: 'https://banner.sharjah.ac.ae',
    category: 'attendance',
    createdAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: 'ql_study_plan',
    title: 'Study Plan & Degree Audit',
    url: 'https://banner.sharjah.ac.ae/StudentRegistrationSsb/',
    category: 'study_plan',
    createdAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: 'ql_marks',
    title: 'Final Marks & Academic Transcript',
    url: 'https://banner.sharjah.ac.ae',
    category: 'marks',
    createdAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: 'ql_blackboard',
    title: 'Blackboard Ultra Portal',
    url: 'https://elearning.sharjah.ac.ae/ultra/course',
    category: 'portal',
    createdAt: '2026-09-01T00:00:00.000Z'
  }
];

// Application State
const state = {
  tasks: [],
  quickLinks: [],
  lastSync: null,
  currentDate: new Date(),
  displayedMonth: new Date(),
  selectedDay: null,
  selectedDate: null,
  selectedTaskId: null,
  filterStatus: 'pending',
  filterCourse: 'all',
  filterType: 'all',
  searchQuery: '',
  pushEnabled: false
};

// ==========================================================================
// Theme Management (Light / Dark / System)
// ==========================================================================
let currentTheme = 'light';

function applyTheme(theme = 'light') {
  currentTheme = theme;
  let isDark = false;
  if (theme === 'system') {
    isDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } else {
    isDark = theme === 'dark';
  }

  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

  // Update meta theme-color for mobile address bar
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', isDark ? '#090d16' : '#2563eb');
  }

  const btnToggle = document.getElementById('btn-web-theme-toggle');
  if (btnToggle) {
    btnToggle.innerHTML = isDark
      ? '<span class="theme-icon"><svg class="ui-icon"><use href="#icon-sun"></use></svg></span>'
      : '<span class="theme-icon"><svg class="ui-icon"><use href="#icon-moon"></use></svg></span>';
    btnToggle.title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    btnToggle.setAttribute('aria-label', btnToggle.title);
  }

  const selectEl = document.getElementById('web-setting-theme');
  if (selectEl && selectEl.value !== theme) {
    selectEl.value = theme;
  }
}

function toggleTheme() {
  const isCurrentDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const newTheme = isCurrentDark ? 'light' : 'dark';
  applyTheme(newTheme);
  try {
    localStorage.setItem('bbs_theme', newTheme);
    const syncChannel = new BroadcastChannel('bbs_sync_channel');
    syncChannel.postMessage({ type: 'THEME_CHANGED', theme: newTheme });
    syncChannel.close();
  } catch (e) {}
}

function initTheme() {
  let saved = 'light';
  try {
    saved = localStorage.getItem('bbs_theme') || 'light';
  } catch (e) {}

  applyTheme(saved);

  const btnToggle = document.getElementById('btn-web-theme-toggle');
  btnToggle?.addEventListener('click', toggleTheme);

  const selectEl = document.getElementById('web-setting-theme');
  selectEl?.addEventListener('change', () => {
    const val = selectEl.value;
    applyTheme(val);
    try {
      localStorage.setItem('bbs_theme', val);
      const syncChannel = new BroadcastChannel('bbs_sync_channel');
      syncChannel.postMessage({ type: 'THEME_CHANGED', theme: val });
      syncChannel.close();
    } catch (e) {}
  });

  // System appearance change listener
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentTheme === 'system') {
        applyTheme('system');
      }
    });
  }

  // Cross-tab and extension broadcast listener
  try {
    const syncChannel = new BroadcastChannel('bbs_sync_channel');
    syncChannel.onmessage = (event) => {
      if (event.data?.type === 'THEME_CHANGED' && event.data.theme) {
        applyTheme(event.data.theme);
      }
    };
  } catch (e) {}

  // Storage listener for cross-window sync
  window.addEventListener('storage', (e) => {
    if (e.key === 'bbs_theme' && e.newValue) {
      applyTheme(e.newValue);
    }
    if (e.key === 'bbs_quick_links' && e.newValue) {
      try {
        state.quickLinks = JSON.parse(e.newValue);
        renderQuickLinksBar();
        renderQuickLinksSchedule();
        renderQuickLinksManager();
      } catch (err) {}
    }
  });
}

// ==========================================================================
// Academic Quick Links Helpers & Controllers
// ==========================================================================
function getQuickLinkCategoryMeta(category) {
  switch (category) {
    case 'attendance':
      return { label: 'Attendance', icon: '📌', badgeClass: 'ql-cat-attendance', color: '#059669', bg: '#ecfdf5' };
    case 'study_plan':
      return { label: 'Study Plan', icon: '📋', badgeClass: 'ql-cat-study_plan', color: '#2563eb', bg: '#eff6ff' };
    case 'marks':
      return { label: 'Marks', icon: '🏆', badgeClass: 'ql-cat-marks', color: '#7c3aed', bg: '#ede9fe' };
    case 'portal':
      return { label: 'Portal', icon: '🌐', badgeClass: 'ql-cat-portal', color: '#d97706', bg: '#fef3c7' };
    case 'other':
    default:
      return { label: 'Link', icon: '🔗', badgeClass: 'ql-cat-other', color: '#475569', bg: '#f1f5f9' };
  }
}

function openQuickLinkUrl(rawUrl) {
  let url = (rawUrl || '').trim();
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function loadCachedQuickLinks() {
  try {
    const raw = localStorage.getItem('bbs_quick_links');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.quickLinks = parsed;
        renderQuickLinksBar();
        renderQuickLinksSchedule();
        return;
      }
    }
  } catch (e) {
    console.warn('Failed to parse cached quick links:', e);
  }
  state.quickLinks = JSON.parse(JSON.stringify(DEFAULT_QUICK_LINKS));
  localStorage.setItem('bbs_quick_links', JSON.stringify(state.quickLinks));
  renderQuickLinksBar();
  renderQuickLinksSchedule();
}

function saveQuickLinks(links) {
  state.quickLinks = links;
  localStorage.setItem('bbs_quick_links', JSON.stringify(state.quickLinks));
  renderQuickLinksBar();
  renderQuickLinksSchedule();
  renderQuickLinksManager();
}

function renderQuickLinksBar() {
  const container = document.getElementById('calendar-quick-links-chips');
  if (!container) return;

  const links = state.quickLinks && state.quickLinks.length > 0 ? state.quickLinks : DEFAULT_QUICK_LINKS;

  if (links.length === 0) {
    container.innerHTML = `<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">No quick links added yet. Click + Manage to add.</span>`;
    return;
  }

  container.innerHTML = links.map(link => {
    const meta = getQuickLinkCategoryMeta(link.category);
    return `
      <a class="ql-chip ${meta.badgeClass}" data-id="${link.id}" data-url="${escapeHtml(link.url)}" title="${escapeHtml(link.title)} (${escapeHtml(link.url)})">
        <span class="ql-chip-dot" style="background: ${meta.color};"></span>
        <span>${escapeHtml(link.title)}</span>
        <svg class="ql-chip-external-icon"><use href="#icon-external-link"></use></svg>
      </a>
    `;
  }).join('');

  container.querySelectorAll('.ql-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const url = chip.getAttribute('data-url');
      if (url) openQuickLinkUrl(url);
    });
  });
}

function renderQuickLinksSchedule() {
  const container = document.getElementById('schedule-quick-links-container');
  if (!container) return;

  const links = state.quickLinks && state.quickLinks.length > 0 ? state.quickLinks : DEFAULT_QUICK_LINKS;

  if (links.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 16px; color: var(--text-muted); font-size: 12px;">
        No quick links configured. Click <strong>+ Manage</strong> to add custom academic shortcuts.
      </div>
    `;
    return;
  }

  container.innerHTML = links.map(link => {
    const meta = getQuickLinkCategoryMeta(link.category);
    let hostname = '';
    try {
      const parsed = new URL(link.url.startsWith('http') ? link.url : `https://${link.url}`);
      hostname = parsed.hostname;
    } catch {
      hostname = link.url;
    }

    return `
      <div class="ql-item-card ${meta.badgeClass}" data-id="${link.id}" style="cursor: pointer;">
        <div class="ql-item-left">
          <div class="ql-item-icon-box" style="background: ${meta.bg}; color: ${meta.color};">
            ${meta.icon}
          </div>
          <div class="ql-item-info">
            <div class="ql-item-title-row">
              <span class="ql-item-title" title="${escapeHtml(link.title)}">${escapeHtml(link.title)}</span>
              <span class="ql-category-badge" style="background: ${meta.bg}; color: ${meta.color};">${meta.label}</span>
            </div>
            <span class="ql-item-url" title="${escapeHtml(link.url)}">${escapeHtml(hostname)}</span>
          </div>
        </div>
        <div class="ql-item-actions">
          <button type="button" class="btn-ql-open btn-open-link" data-url="${escapeHtml(link.url)}" title="Open in new tab">
            <span>Open</span>
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-external-link"></use></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-open-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = btn.getAttribute('data-url');
      if (url) openQuickLinkUrl(url);
    });
  });

  container.querySelectorAll('.ql-item-card').forEach(card => {
    card.addEventListener('click', () => {
      const linkId = card.getAttribute('data-id');
      const target = links.find(l => l.id === linkId);
      if (target && target.url) {
        openQuickLinkUrl(target.url);
      }
    });
  });
}

function renderQuickLinksManager() {
  const listContainer = document.getElementById('web-quick-links-manager-list');
  if (!listContainer) return;

  const links = state.quickLinks && state.quickLinks.length > 0 ? state.quickLinks : DEFAULT_QUICK_LINKS;

  if (links.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 20px 10px; color: var(--text-muted); font-size: 12px;">
        No quick links configured. Click <strong>Add Link</strong> or <strong>Reset Defaults</strong> to get started.
      </div>
    `;
    return;
  }

  listContainer.innerHTML = links.map(link => {
    const meta = getQuickLinkCategoryMeta(link.category);
    let hostname = '';
    try {
      const parsed = new URL(link.url.startsWith('http') ? link.url : `https://${link.url}`);
      hostname = parsed.hostname;
    } catch {
      hostname = link.url;
    }

    return `
      <div class="ql-item-card ${meta.badgeClass}" data-id="${link.id}">
        <div class="ql-item-left">
          <div class="ql-item-icon-box" style="background: ${meta.bg}; color: ${meta.color};">
            ${meta.icon}
          </div>
          <div class="ql-item-info">
            <div class="ql-item-title-row">
              <span class="ql-item-title" title="${escapeHtml(link.title)}">${escapeHtml(link.title)}</span>
              <span class="ql-category-badge" style="background: ${meta.bg}; color: ${meta.color};">${meta.label}</span>
            </div>
            <span class="ql-item-url" title="${escapeHtml(link.url)}">${escapeHtml(hostname)}</span>
          </div>
        </div>
        <div class="ql-item-actions">
          <button type="button" class="btn-ql-open btn-open-link" data-url="${escapeHtml(link.url)}" title="Open in new tab">
            <span>Open</span>
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-external-link"></use></svg>
          </button>
          <button type="button" class="btn-ql-action btn-edit-ql" data-id="${link.id}" title="Edit link" aria-label="Edit link">
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-pencil"></use></svg>
          </button>
          <button type="button" class="btn-ql-action delete btn-delete-ql" data-id="${link.id}" title="Delete link" aria-label="Delete link">
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-trash"></use></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Wire open
  listContainer.querySelectorAll('.btn-open-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = btn.getAttribute('data-url');
      if (url) openQuickLinkUrl(url);
    });
  });

  // Wire edit
  listContainer.querySelectorAll('.btn-edit-ql').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const target = state.quickLinks.find(l => l.id === id);
      if (!target) return;

      const form = document.getElementById('form-web-quick-link');
      const editIdInput = document.getElementById('web-ql-edit-id');
      const titleInput = document.getElementById('web-ql-title');
      const urlInput = document.getElementById('web-ql-url');
      const catSelect = document.getElementById('web-ql-category');
      const saveBtn = document.getElementById('btn-save-web-ql');

      if (form && editIdInput && titleInput && urlInput && catSelect) {
        editIdInput.value = target.id;
        titleInput.value = target.title;
        urlInput.value = target.url;
        catSelect.value = target.category || 'other';
        if (saveBtn) saveBtn.textContent = 'Update Link';
        form.style.display = 'block';
        titleInput.focus();
      }
    });
  });

  // Wire delete
  listContainer.querySelectorAll('.btn-delete-ql').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (!id) return;
      const target = state.quickLinks.find(l => l.id === id);
      const title = target ? target.title : 'link';

      state.quickLinks = state.quickLinks.filter(l => l.id !== id);
      saveQuickLinks(state.quickLinks);
      await syncToCloudAndLocal();
      showToast(`Removed "${title}" from quick links`);
    });
  });
}

function openQuickLinksModal() {
  const modal = document.getElementById('modal-quick-links');
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
    renderQuickLinksManager();
  }
}

function closeQuickLinksModal() {
  const modal = document.getElementById('modal-quick-links');
  const form = document.getElementById('form-web-quick-link');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
  if (form) {
    form.reset();
    form.style.display = 'none';
    const editId = document.getElementById('web-ql-edit-id');
    if (editId) editId.value = '';
    const saveBtn = document.getElementById('btn-save-web-ql');
    if (saveBtn) saveBtn.textContent = 'Save Link';
  }
}

function initQuickLinksModal() {
  const modal = document.getElementById('modal-quick-links');
  const btnWebHeader = document.getElementById('btn-web-quick-links');
  const btnBarManage = document.getElementById('btn-web-bar-manage-links');
  const btnScheduleManage = document.getElementById('btn-web-schedule-manage-links');
  const btnClose = document.getElementById('btn-close-web-quick-links');
  const btnToggleForm = document.getElementById('btn-web-toggle-add-link-form');
  const btnReset = document.getElementById('btn-web-reset-quick-links');
  const form = document.getElementById('form-web-quick-link');
  const btnCancelForm = document.getElementById('btn-cancel-web-ql-form');

  btnWebHeader?.addEventListener('click', openQuickLinksModal);
  btnBarManage?.addEventListener('click', openQuickLinksModal);
  btnScheduleManage?.addEventListener('click', openQuickLinksModal);
  btnClose?.addEventListener('click', closeQuickLinksModal);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeQuickLinksModal();
  });

  btnToggleForm?.addEventListener('click', () => {
    if (form) {
      const isVisible = form.style.display !== 'none';
      if (isVisible) {
        form.style.display = 'none';
      } else {
        form.reset();
        const editId = document.getElementById('web-ql-edit-id');
        if (editId) editId.value = '';
        const saveBtn = document.getElementById('btn-save-web-ql');
        if (saveBtn) saveBtn.textContent = 'Save Link';
        form.style.display = 'block';
        document.getElementById('web-ql-title')?.focus();
      }
    }
  });

  btnCancelForm?.addEventListener('click', () => {
    if (form) {
      form.reset();
      form.style.display = 'none';
      const editId = document.getElementById('web-ql-edit-id');
      if (editId) editId.value = '';
    }
  });

  // Preset chips
  modal?.querySelectorAll('.btn-preset-ql').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      const titleInput = document.getElementById('web-ql-title');
      const urlInput = document.getElementById('web-ql-url');
      const catSelect = document.getElementById('web-ql-category');

      if (form) form.style.display = 'block';

      if (preset === 'attendance') {
        if (titleInput) titleInput.value = 'Attendance (Banner)';
        if (urlInput) urlInput.value = 'https://banner.sharjah.ac.ae';
        if (catSelect) catSelect.value = 'attendance';
      } else if (preset === 'study_plan') {
        if (titleInput) titleInput.value = 'Study Plan & Degree Audit';
        if (urlInput) urlInput.value = 'https://banner.sharjah.ac.ae/StudentRegistrationSsb/';
        if (catSelect) catSelect.value = 'study_plan';
      } else if (preset === 'marks') {
        if (titleInput) titleInput.value = 'Final Marks & Transcript';
        if (urlInput) urlInput.value = 'https://banner.sharjah.ac.ae';
        if (catSelect) catSelect.value = 'marks';
      } else if (preset === 'portal') {
        if (titleInput) titleInput.value = 'Blackboard Ultra Portal';
        if (urlInput) urlInput.value = 'https://elearning.sharjah.ac.ae/ultra/course';
        if (catSelect) catSelect.value = 'portal';
      }
    });
  });

  // Reset defaults
  btnReset?.addEventListener('click', async () => {
    if (confirm('Reset quick links to standard university presets?')) {
      state.quickLinks = JSON.parse(JSON.stringify(DEFAULT_QUICK_LINKS));
      saveQuickLinks(state.quickLinks);
      await syncToCloudAndLocal();
      showToast('Quick links reset to defaults');
    }
  });

  // Form submit
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('web-ql-edit-id')?.value || '';
    const title = document.getElementById('web-ql-title')?.value.trim() || '';
    let url = document.getElementById('web-ql-url')?.value.trim() || '';
    const category = document.getElementById('web-ql-category')?.value || 'other';

    if (!title || !url) {
      showToast('Please provide both title and URL.');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    if (editId) {
      const idx = state.quickLinks.findIndex(l => l.id === editId);
      if (idx !== -1) {
        state.quickLinks[idx] = {
          ...state.quickLinks[idx],
          title,
          url,
          category,
          updatedAt: new Date().toISOString()
        };
      }
      showToast(`Updated "${title}"`);
    } else {
      const newLink = {
        id: `ql_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        title,
        url,
        category,
        createdAt: new Date().toISOString()
      };
      state.quickLinks.push(newLink);
      showToast(`Added "${title}" to quick links!`);
    }

    form.reset();
    form.style.display = 'none';
    const idInput = document.getElementById('web-ql-edit-id');
    if (idInput) idInput.value = '';

    saveQuickLinks(state.quickLinks);
    await syncToCloudAndLocal();
  });
}

// ==========================================================================
// Initialization
// ==========================================================================
function initApp() {
  initTheme();
  initServiceWorker();
  initTabs();
  initCalendar();
  initLegend();
  initScheduleAndSyllabus();
  initDeadlinesControls();
  initSettings();
  initDaySheet();
  initSelectedDayContainer();
  initOnlineListeners();
  initModals();
  initGradeTracker();
  initQuickLinksModal();

  // 1. Immediately & synchronously load cached quick links & tasks (<2ms)
  loadCachedQuickLinks();
  loadCachedTasks();

  // 2. Render all views immediately so the dashboard appears instantly populated like on the extension
  updateAllViews();
  updateSyncBanner();

  // 3. Proactively refresh data in the background non-blockingly without layout jumps
  refreshDataInBackground();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

async function refreshDataInBackground() {
  await fetchTasksFromServer(false);
}

// Register Service Worker
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    let refreshing = false;

    // When the new service worker activates and claims the client
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        console.log('[SW] New service worker activated, reloading page...');
        window.location.reload();
      }
    });

    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('[SW] Registered successfully:', reg.scope);
        // Proactively check for worker updates on page load
        if (reg.update) {
          reg.update().catch(() => {});
        }

        // Detect new worker installed and prompt immediate update
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[SW] New version detected and installed.');
                if (!refreshing) {
                  showToast('Website updated to latest version! Reloading...', 2000);
                  setTimeout(() => {
                    if (!refreshing) {
                      refreshing = true;
                      window.location.reload();
                    }
                  }, 1200);
                }
              }
            });
          }
        });

        registerPeriodicSync();
        syncTasksToServiceWorker();
      })
      .catch(err => {
        console.warn('[SW] Registration failed:', err);
      });

    // Handle clicks from Service Worker notifications
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'OPEN_TASK' && event.data.taskId) {
        const target = (state.tasks || []).find(t => t.id === event.data.taskId);
        if (target) {
          openReadingSheet(target);
        }
      }
    });
  }
}

// ==========================================================================
// Notifications & Background Deadline Scheduler
// ==========================================================================

async function sendMobileNotification(title, options = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return false;
  }
  const isEnabled = localStorage.getItem('bbs_push_enabled') === 'true';
  if (!isEnabled) return false;

  const notifOptions = {
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: './index.html' },
    ...options
  };

  // 1. Mobile PWA / Service Worker (Android Chrome & iOS Safari compliant)
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, notifOptions);
        return true;
      }
    } catch (swErr) {
      console.warn('[Notif] Service Worker showNotification failed:', swErr);
    }
  }

  // 2. Fallback to standard Desktop constructor
  try {
    new Notification(title, notifOptions);
    return true;
  } catch (err) {
    console.warn('[Notif] Desktop Notification constructor failed:', err);
    return false;
  }
}

function syncTasksToServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const pushEnabled = localStorage.getItem('bbs_push_enabled') === 'true';
  const notifiedRaw = localStorage.getItem('bbs_notified_map') || '{}';
  let notifiedMap = {};
  try { notifiedMap = JSON.parse(notifiedRaw); } catch (e) {}

  const messageData = {
    type: 'SYNC_TASKS_FOR_NOTIFICATIONS',
    tasks: state.tasks || [],
    notifiedMap,
    enabled: pushEnabled
  };

  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(messageData);
  } else {
    navigator.serviceWorker.ready.then(reg => {
      reg.active?.postMessage(messageData);
    }).catch(() => {});
  }
}

async function registerPeriodicSync() {
  if ('serviceWorker' in navigator && 'periodicSync' in navigator.serviceWorker) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const tags = await reg.periodicSync.getTags();
      if (!tags.includes('check-deadlines')) {
        await reg.periodicSync.register('check-deadlines', {
          minInterval: 15 * 60 * 1000
        });
        console.log('[SW] Periodic sync registered');
      }
    } catch (err) {
      console.log('[SW] Periodic sync not available or denied:', err.message);
    }
  }
}

function isValidTask(task) {
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

function formatNotificationPayload(task, windowType, timeRemaining) {
  const resolved = resolveCourseInfo(task);
  const courseDisplay = resolved.courseCode && resolved.courseCode.toLowerCase() !== 'uos'
    ? `${resolved.courseName} (${resolved.courseCode})`
    : resolved.courseName;

  const dueDateObj = new Date(task.dueDate);
  const timeStr = !isNaN(dueDateObj) ? dueDateObj.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const dateStr = !isNaN(dueDateObj) ? dueDateObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '';

  const room = task.room || resolveTaskRoom(task);
  let locationStr = '';
  if (room) {
    locationStr = `📍 Room: ${room}`;
  } else if (task.type === 'exam' || task.type === 'quiz') {
    locationStr = '📍 In-class on paper';
  } else {
    locationStr = '💻 Online Submission on Blackboard';
  }

  const weightStr = task.weight ? ` • Worth ${task.weight}%` : '';

  let title = '';
  let timeDesc = '';
  if (windowType === '24h') {
    const hoursLeft = Math.max(1, Math.round(timeRemaining / (3600 * 1000)));
    title = `⏰ 24h Reminder: ${task.title}`;
    timeDesc = `🕒 Due: ${dateStr} at ${timeStr} (~${hoursLeft}h left)`;
  } else if (windowType === '2h') {
    const minsLeft = Math.max(1, Math.round(timeRemaining / (60 * 1000)));
    const countdownStr = minsLeft >= 60 ? `about ${Math.round(minsLeft / 60)} hour(s)` : `${minsLeft} minutes`;
    title = `🚨 Urgent (2h): ${task.title}`;
    timeDesc = `🕒 Due: ${dateStr} at ${timeStr} (in ${countdownStr})`;
  } else {
    title = `⏳ Due Now: ${task.title}`;
    timeDesc = `🕒 Due time has arrived (${dateStr} at ${timeStr})`;
  }

  const body = `${courseDisplay}${weightStr}\n${timeDesc}\n${locationStr}`;

  return { title, body };
}

async function checkUpcomingDeadlines(isInteractive = false) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }
  const isEnabled = localStorage.getItem('bbs_push_enabled') === 'true';
  if (!isEnabled) return;

  const now = Date.now();
  const notifiedRaw = localStorage.getItem('bbs_notified_map') || '{}';
  let notifiedMap = {};
  try { notifiedMap = JSON.parse(notifiedRaw); } catch (e) {}

  let changed = false;
  let notificationsTriggered = 0;

  for (const task of (state.tasks || [])) {
    if (task.status === 'completed') continue;
    if (!isValidTask(task)) continue;
    const dueTime = new Date(task.dueDate).getTime();
    if (isNaN(dueTime)) continue;

    const timeRemaining = dueTime - now;

    // 1. 24 Hour Advance Reminder (between 2h and 24h)
    if (timeRemaining > 2 * 3600 * 1000 && timeRemaining <= 24 * 3600 * 1000) {
      const key = `${task.id}_24h`;
      const last = notifiedMap[key] || 0;
      if (now - last > 18 * 3600 * 1000) {
        notifiedMap[key] = now;
        changed = true;
        notificationsTriggered++;
        const { title, body } = formatNotificationPayload(task, '24h', timeRemaining);
        await sendMobileNotification(title, {
          body,
          tag: `bbs-24h-${task.id}`,
          renotify: false,
          vibrate: [200, 100, 200],
          data: { url: './index.html', taskId: task.id }
        });
      }
    }

    // 2. 2 Hour Urgent Alert (between 0 and 2h)
    if (timeRemaining > 0 && timeRemaining <= 2 * 3600 * 1000) {
      const key = `${task.id}_2h`;
      const last = notifiedMap[key] || 0;
      if (now - last > 3 * 3600 * 1000) {
        notifiedMap[key] = now;
        changed = true;
        notificationsTriggered++;
        const { title, body } = formatNotificationPayload(task, '2h', timeRemaining);
        await sendMobileNotification(title, {
          body,
          tag: `bbs-2h-${task.id}`,
          renotify: false,
          vibrate: [300, 150, 300],
          data: { url: './index.html', taskId: task.id }
        });
      }
    }

    // 3. Due Now / Closing (0 to -30m)
    if (timeRemaining <= 0 && timeRemaining >= -30 * 60 * 1000) {
      const key = `${task.id}_due`;
      const last = notifiedMap[key] || 0;
      if (now - last > 2 * 3600 * 1000) {
        notifiedMap[key] = now;
        changed = true;
        notificationsTriggered++;
        const { title, body } = formatNotificationPayload(task, 'due', timeRemaining);
        await sendMobileNotification(title, {
          body,
          tag: `bbs-due-${task.id}`,
          renotify: false,
          vibrate: [200, 100, 200],
          data: { url: './index.html', taskId: task.id }
        });
      }
    }
  }

  if (changed) {
    localStorage.setItem('bbs_notified_map', JSON.stringify(notifiedMap));
    syncTasksToServiceWorker();
  }

  if (isInteractive && notificationsTriggered === 0) {
    console.log('[Notif] Deadline check completed: No active deadlines within notification window.');
  }
}

// Switch Active View
function switchView(targetViewId) {
  const tabButtons = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.view-section');

  tabButtons.forEach(b => {
    const isTarget = b.getAttribute('data-view') === targetViewId;
    b.classList.toggle('active', isTarget);
    b.setAttribute('aria-selected', isTarget ? 'true' : 'false');
  });

  sections.forEach(s => {
    s.classList.toggle('active', s.id === targetViewId);
  });

  // If switching to calendar, re-render to update layout
  if (targetViewId === 'view-calendar') {
    renderCalendar();
  }
}

// Navigation Tabs & Header Shortcuts
function initTabs() {
  const tabButtons = document.querySelectorAll('.nav-item');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetViewId = btn.getAttribute('data-view');
      if (targetViewId) {
        switchView(targetViewId);
      }
    });
  });

  // Desktop action button shortcuts
  document.getElementById('btn-web-schedule')?.addEventListener('click', () => {
    switchView('view-schedule');
  });

  document.getElementById('btn-web-settings')?.addEventListener('click', () => {
    switchView('view-settings');
  });

  document.getElementById('btn-web-add')?.addEventListener('click', () => {
    openAddTaskModal(state.selectedDate || new Date().toISOString().split('T')[0]);
  });
}

// ==========================================================================
// Data Fetching & Sync
// ==========================================================================
function loadCachedTasks() {
  try {
    const cachedRaw = localStorage.getItem('bbs_mobile_tasks');
    const cachedSync = localStorage.getItem('bbs_mobile_last_sync');
    if (cachedRaw) {
      state.tasks = (JSON.parse(cachedRaw) || []).filter(isValidTask);
      state.tasks.sort(compareTasksByTime);
      state.lastSync = cachedSync;

      // Auto-backfill rooms, sanitize quotes, and syllabus weights if missing
      state.tasks.forEach(t => {
        if (t.courseCode === 'UOS') t.courseCode = '';
        const resolved = resolveCourseInfo(t);
        if (resolved.courseName !== 'General Course' && (!t.courseName || t.courseName === 'General Course' || t.courseName.toLowerCase() === 'uos')) {
          t.courseName = resolved.courseName;
        }
        if (resolved.courseCode && !t.courseCode) {
          t.courseCode = resolved.courseCode;
        }
        const cleanT = (t.type || '').toLowerCase();
        const isHwOrProj = cleanT === 'assignment' || cleanT === 'hw' || cleanT === 'project';
        if (isHwOrProj) {
          t.room = undefined;
        } else if (!t.room) {
          const r = resolveTaskRoom(t);
          if (r) t.room = r;
        }
        if (t.description) {
          t.description = sanitizeDoctorAnnouncementText(t.description, t.courseName, t.courseCode, t.title);
        }
        if (t.sourceSnippet) {
          t.sourceSnippet = sanitizeDoctorAnnouncementText(t.sourceSnippet, t.courseName, t.courseCode, t.title);
        }
        if (t.weight === undefined || t.weight === null) {
          const wInfo = resolveTaskWeight(t.courseName || t.courseCode, t.title, t.type, t.sourceSnippet || t.description || t.notes || '');
          if (wInfo.weight !== undefined) {
            t.weight = wInfo.weight;
            t.weightDisplay = wInfo.weightDisplay;
            t.syllabusNote = wInfo.syllabusNote;
          }
        }
      });

      syncTasksToServiceWorker();
      checkUpcomingDeadlines(false);
    }
  } catch (err) {
    console.error('Error loading cached tasks:', err);
  }
}

function recordLocalTombstone(taskId) {
  try {
    const raw = localStorage.getItem('bbs_tombstones') || '{}';
    const tombs = JSON.parse(raw);
    tombs[taskId] = new Date().toISOString();
    localStorage.setItem('bbs_tombstones', JSON.stringify(tombs));
  } catch (e) {}
}

function removeLocalTombstone(taskId) {
  try {
    const raw = localStorage.getItem('bbs_tombstones') || '{}';
    const tombs = JSON.parse(raw);
    delete tombs[taskId];
    localStorage.setItem('bbs_tombstones', JSON.stringify(tombs));
  } catch (e) {}
}

function getLocalTombstones() {
  try {
    const raw = localStorage.getItem('bbs_tombstones') || '{}';
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

let _isFetchingFromServer = false;

async function fetchTasksFromServer(isManual = false) {
  if (_isFetchingFromServer && !isManual) return;
  _isFetchingFromServer = true;
  const refreshBtn = document.getElementById('btn-refresh');
  const syncBanner = document.getElementById('sync-banner-text');

  // Only show spinning indicator and override banner text during manual user sync
  if (isManual) {
    refreshBtn?.querySelector('.refresh-icon')?.classList.add('refresh-spinning');
    if (syncBanner) syncBanner.textContent = 'Syncing deadlines with Firebase Cloud...';
  }

  try {
    let tasksLoaded = false;
    let fetchedTasks = [];
    let fetchedSync = null;
    let fetchedQuickLinks = null;

    // 1. Fetch directly from Firebase Realtime Database (24/7 online even if laptop is off)
    try {
      const fbUrl = getFirebaseDataUrl();
      const fbRes = await fetch(fbUrl, { cache: 'no-store' });
      if (fbRes.ok) {
        const fbData = await fbRes.json();
        if (fbData && Array.isArray(fbData.tasks)) {
          fetchedTasks = fbData.tasks;
          fetchedSync = fbData.lastSync || new Date().toISOString();
          tasksLoaded = true;
          if (Array.isArray(fbData.quickLinks) && fbData.quickLinks.length > 0) {
            fetchedQuickLinks = fbData.quickLinks;
          }
          if (!localStorage.getItem('bbs_sync_key') && fbData.syncKey) {
            localStorage.setItem('bbs_sync_key', fbData.syncKey);
            const inputKey = document.getElementById('web-sync-key-input');
            if (inputKey && !inputKey.value) inputKey.value = fbData.syncKey;
            const syncKeyStatus = document.getElementById('web-sync-key-status');
            if (syncKeyStatus) {
              syncKeyStatus.textContent = `Paired with ${fbData.syncKey} (auto-discovered)`;
              syncKeyStatus.style.color = '#15803d';
            }
          }
          if (fbData.tombstones && typeof fbData.tombstones === 'object') {
            const tombs = getLocalTombstones();
            Object.assign(tombs, fbData.tombstones);
            localStorage.setItem('bbs_tombstones', JSON.stringify(tombs));
          }
        }
      }
    } catch (fbErr) {
      console.warn('Direct Firebase fetch unavailable, trying edge API:', fbErr);
    }

    // 2. Fallback to Cloudflare edge /api/tasks
    if (!tasksLoaded) {
      const activeKey = getSyncKey();
      const edgeUrl = activeKey ? `/api/tasks?key=${encodeURIComponent(activeKey)}` : '/api/tasks';
      const res = await fetch(edgeUrl, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.tasks)) {
          fetchedTasks = data.tasks;
          fetchedSync = data.lastSync || new Date().toISOString();
          tasksLoaded = true;
          if (Array.isArray(data.quickLinks) && data.quickLinks.length > 0) {
            fetchedQuickLinks = data.quickLinks;
          }
          if (!localStorage.getItem('bbs_sync_key') && data.syncKey) {
            localStorage.setItem('bbs_sync_key', data.syncKey);
          }
        }
      }
    }

    if (tasksLoaded) {
      const localMap = new Map((state.tasks || []).map(t => [t.id, t]));
      const tombstones = getLocalTombstones();
      let hasLocalModifications = false;

      const mergedTasks = [];
      const processedIds = new Set();

      for (const fbTask of fetchedTasks) {
        if (tombstones[fbTask.id]) {
          const tombTime = new Date(tombstones[fbTask.id]).getTime();
          const fbTime = new Date(fbTask.updatedAt || fbTask.createdAt || 0).getTime();
          if (tombTime >= fbTime) continue; // Deleted, skip resurrection
        }

        const localTask = localMap.get(fbTask.id);
        if (!localTask) {
          mergedTasks.push(fbTask);
          processedIds.add(fbTask.id);
        } else {
          processedIds.add(fbTask.id);
          const localTime = new Date(localTask.updatedAt || localTask.createdAt || 0).getTime();
          const fbTime = new Date(fbTask.updatedAt || fbTask.createdAt || 0).getTime();

          if (localTime > fbTime) {
            // Local edit is newer than server snapshot! Preserve local edit
            mergedTasks.push({
              ...fbTask,
              ...localTask
            });
            hasLocalModifications = true;
          } else {
            // Cloud task is newer or equal
            mergedTasks.push({
              ...localTask,
              ...fbTask,
              notes: fbTask.notes !== undefined ? fbTask.notes : localTask.notes,
              description: fbTask.description !== undefined ? fbTask.description : localTask.description,
              sourceSnippet: fbTask.sourceSnippet !== undefined ? fbTask.sourceSnippet : localTask.sourceSnippet,
              room: fbTask.room !== undefined ? fbTask.room : localTask.room,
              status: fbTask.status !== undefined ? fbTask.status : localTask.status,
              dueDate: fbTask.dueDate || localTask.dueDate,
              title: fbTask.title || localTask.title,
              courseName: fbTask.courseName || localTask.courseName,
              courseCode: fbTask.courseCode !== undefined ? fbTask.courseCode : localTask.courseCode
            });
          }
        }
      }

      // Retain any locally created tasks not yet in fetchedTasks (unless tombstoned)
      for (const [id, localTask] of localMap.entries()) {
        if (!processedIds.has(id)) {
          if (tombstones[id]) continue;
          mergedTasks.push(localTask);
          hasLocalModifications = true;
        }
      }

      const validatedTasks = mergedTasks.filter(isValidTask);
      validatedTasks.sort(compareTasksByTime);

      // Auto-backfill rooms, sanitize quotes, and syllabus weights if missing
      validatedTasks.forEach(t => {
        if (t.courseCode === 'UOS') t.courseCode = '';
        const resolved = resolveCourseInfo(t);
        if (resolved.courseName !== 'General Course' && (!t.courseName || t.courseName === 'General Course' || t.courseName.toLowerCase() === 'uos')) {
          t.courseName = resolved.courseName;
        }
        if (resolved.courseCode && !t.courseCode) {
          t.courseCode = resolved.courseCode;
        }
        const cleanT = (t.type || '').toLowerCase();
        const isHwOrProj = cleanT === 'assignment' || cleanT === 'hw' || cleanT === 'project';
        if (isHwOrProj) {
          t.room = undefined;
        } else if (!t.room) {
          const r = resolveTaskRoom(t);
          if (r) t.room = r;
        }
        if (t.description) {
          t.description = sanitizeDoctorAnnouncementText(t.description, t.courseName, t.courseCode, t.title);
        }
        if (t.sourceSnippet) {
          t.sourceSnippet = sanitizeDoctorAnnouncementText(t.sourceSnippet, t.courseName, t.courseCode, t.title);
        }
        if (t.weight === undefined || t.weight === null) {
          const wInfo = resolveTaskWeight(t.courseName || t.courseCode, t.title, t.type, t.sourceSnippet || t.description || t.notes || '');
          if (wInfo.weight !== undefined) {
            t.weight = wInfo.weight;
            t.weightDisplay = wInfo.weightDisplay;
            t.syllabusNote = wInfo.syllabusNote;
          }
        }
      });

      // Diff check: only re-render the DOM if tasks or quick links actually changed!
      const prevTasksJson = JSON.stringify(state.tasks);
      const prevLinksJson = JSON.stringify(state.quickLinks);
      const tasksChanged = JSON.stringify(validatedTasks) !== prevTasksJson;
      const linksChanged = Boolean(fetchedQuickLinks && Array.isArray(fetchedQuickLinks) && fetchedQuickLinks.length > 0 && JSON.stringify(fetchedQuickLinks) !== prevLinksJson);

      let viewsNeedUpdate = false;

      if (tasksChanged) {
        state.tasks = validatedTasks;
        localStorage.setItem('bbs_mobile_tasks', JSON.stringify(state.tasks));
        viewsNeedUpdate = true;
      }

      if (linksChanged && fetchedQuickLinks) {
        state.quickLinks = fetchedQuickLinks;
        localStorage.setItem('bbs_quick_links', JSON.stringify(state.quickLinks));
        renderQuickLinksBar();
        renderQuickLinksSchedule();
        renderQuickLinksManager();
      }

      if (fetchedSync && fetchedSync !== state.lastSync) {
        state.lastSync = fetchedSync;
        localStorage.setItem('bbs_mobile_last_sync', state.lastSync);
      }

      if (viewsNeedUpdate) {
        updateAllViews();
      }
      updateSyncBanner();

      // Check for newly announced upcoming deadlines
      const knownIdsRaw = localStorage.getItem('bbs_known_task_ids');
      if (knownIdsRaw) {
        try {
          const knownIds = new Set(JSON.parse(knownIdsRaw));
          const isPushEnabled = localStorage.getItem('bbs_push_enabled') === 'true' && Notification.permission === 'granted';
          if (isPushEnabled) {
            for (const t of state.tasks) {
              if (!knownIds.has(t.id) && t.status !== 'completed') {
                const dueMs = new Date(t.dueDate).getTime();
                if (dueMs > Date.now()) {
                  sendMobileNotification(`📢 New Deadline Added: ${t.title}`, {
                    body: `New ${t.type || 'task'} scheduled for ${t.courseCode || t.courseName}.`,
                    tag: `bbs-new-${t.id}`,
                    renotify: true,
                    data: { url: './index.html', taskId: t.id }
                  });
                }
              }
            }
          }
        } catch (e) {}
      }
      try {
        const currentIds = (state.tasks || []).map(t => t.id);
        localStorage.setItem('bbs_known_task_ids', JSON.stringify(currentIds));
      } catch (e) {}

      syncTasksToServiceWorker();
      checkUpcomingDeadlines(false);

      if (hasLocalModifications) {
        // Local additions or updates need to be saved back to Firebase Cloud
        syncToCloudAndLocal().catch(() => {});
      }

      if (isManual) {
        showToast('Synced with cloud: ' + state.tasks.length + ' deadlines up to date');
      }
    } else {
      throw new Error('No data returned from cloud endpoints');
    }
  } catch (err) {
    console.warn('Could not connect to sync cloud, using offline cache:', err);
    if (isManual) {
      showToast('Could not connect to cloud. Showing cached data.');
    } else if (!navigator.onLine && syncBanner) {
      syncBanner.textContent = state.tasks.length > 0 
        ? `Offline Mode: Showing ${state.tasks.length} cached deadlines` 
        : 'Offline: Waiting for connection...';
    }
  } finally {
    _isFetchingFromServer = false;
    if (isManual && refreshBtn) {
      setTimeout(() => {
        refreshBtn.querySelector('.refresh-icon')?.classList.remove('refresh-spinning');
      }, 400);
    }
  }
}

/**
 * True bidirectional sync:
 * 1. Flushes pending offline mutations
 * 2. Fetches freshest tasks from cloud and reconciles
 * 3. Pushes reconciled state back to cloud so both sides are identical
 */
async function syncBidirectionally(isManual = false) {
  const refreshBtn = document.getElementById('btn-refresh');
  const syncBanner = document.getElementById('sync-banner-text');

  if (isManual) {
    refreshBtn?.querySelector('.refresh-icon')?.classList.add('refresh-spinning');
    if (syncBanner) syncBanner.textContent = 'Syncing deadlines with Firebase Cloud...';
  }

  try {
    // 1. Flush any pending offline mutations first
    await flushOfflineMutations();

    // 2. Fetch latest tasks from cloud & reconcile (passing isManual flag)
    await fetchTasksFromServer(isManual);

    // 3. Push full reconciled state to cloud so both laptop and phone are in lockstep
    await syncToCloudAndLocal();

    if (isManual) {
      showToast(`Synced with cloud: ${state.tasks.length} deadlines up to date`);
    }
  } catch (err) {
    console.warn('Bidirectional sync failed:', err);
    if (isManual) {
      showToast('Sync error: ' + (err.message || 'offline'));
    }
  } finally {
    if (isManual && refreshBtn) {
      refreshBtn.querySelector('.refresh-icon')?.classList.remove('refresh-spinning');
    }
    updateSyncBanner();
  }
}

function updateSyncBanner() {
  const syncBanner = document.getElementById('sync-banner-text');
  const metricLastSync = document.getElementById('metric-last-sync');
  if (!syncBanner) return;

  if (!state.lastSync) {
    syncBanner.textContent = 'No sync record yet';
    if (metricLastSync) metricLastSync.textContent = 'Never';
    return;
  }

  const syncDate = new Date(state.lastSync);
  const timeStr = syncDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = syncDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const display = `Updated ${dateStr} at ${timeStr} (${state.tasks.length} deadlines)`;

  syncBanner.textContent = display;
  if (metricLastSync) metricLastSync.textContent = `${dateStr} at ${timeStr}`;
}

function updateAllViews() {
  renderCalendar();
  renderSelectedDay(state.selectedDate);
  renderDeadlines();
  renderQuickLinksBar();
  renderQuickLinksSchedule();
  updateStats();
  updateBadgeCounts();
  populateCourseFilter();
  renderGradeTracker();

  // If day sheet drawer is currently open, refresh its items to reflect status changes immediately
  const drawer = document.getElementById('day-sheet-drawer');
  if (drawer && drawer.style.display !== 'none' && !drawer.classList.contains('hidden') && state.selectedDate) {
    const dayTasks = state.tasks.filter(t => t.dueDate && t.dueDate.startsWith(state.selectedDate));
    const itemsContainer = document.getElementById('day-sheet-items');
    if (itemsContainer) {
      const sorted = dayTasks.slice().sort(compareTasksByTime);
      itemsContainer.innerHTML = sorted.map(t => renderTaskCardHtml(t, false)).join('');
      bindTaskCardEvents(itemsContainer);
    }
  }
}

// Wi-Fi Connection State Listeners
function initOnlineListeners() {
  const wifiBadge = document.getElementById('wifi-status-badge');
  const wifiText = document.getElementById('wifi-status-text');
  const metricNet = document.getElementById('metric-network-status');

  function updateStatus(isOnline) {
    if (isOnline) {
      if (wifiBadge) {
        wifiBadge.className = 'wifi-status-badge online';
      }
      if (wifiText) wifiText.textContent = 'Online';
      if (metricNet) metricNet.textContent = 'Connected (Wi-Fi)';
      // Replay offline mutations to Firebase/server, then fetch freshest
      flushOfflineMutations().then(() => fetchTasksFromServer());
    } else {
      if (wifiBadge) {
        wifiBadge.className = 'wifi-status-badge offline';
      }
      if (wifiText) wifiText.textContent = 'Offline';
      if (metricNet) metricNet.textContent = 'Offline (Cached Mode)';
      showToast('You are offline. Showing cached deadlines.');
    }
  }

  window.addEventListener('online', () => {
    updateStatus(true);
    flushOfflineMutations();
  });
  window.addEventListener('offline', () => updateStatus(false));
  window.addEventListener('focus', () => {
    checkUpcomingDeadlines(false);
    if (navigator.onLine) {
      flushOfflineMutations().then(() => fetchTasksFromServer());
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkUpcomingDeadlines(false);
      if (navigator.onLine) {
        fetchTasksFromServer();
      }
    }
  });

  // Scheduled check every 60 seconds for imminent deadlines
  setInterval(() => {
    checkUpcomingDeadlines(false);
  }, 60000);

  // Heartbeat poll every 10 seconds while tab is active so extension changes mirror immediately
  setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      fetchTasksFromServer();
    }
  }, 10000);

  // Sync with Chrome extension or other tabs via BroadcastChannel
  try {
    const syncChannel = new BroadcastChannel('bbs_sync_channel');
    syncChannel.onmessage = (event) => {
      if (event.data?.type === 'TASKS_UPDATED') {
        fetchTasksFromServer();
      }
    };
  } catch (e) {}

  window.addEventListener('storage', (e) => {
    if (e.key === 'bbs_mobile_tasks' || e.key === 'bbs_sync_key') {
      loadCachedTasks();
      updateAllViews();
    }
  });

  document.getElementById('btn-refresh')?.addEventListener('click', () => syncBidirectionally(true));
  document.getElementById('btn-force-refresh')?.addEventListener('click', async () => {
    showToast('Checking for application updates and synchronizing cloud...', 2000);
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      } catch (e) {}
    }
    await syncBidirectionally(true);
  });
}

// ==========================================================================
// VIEW 1: Calendar Rendering
// ==========================================================================
function initCalendar() {
  document.getElementById('btn-prev-month')?.addEventListener('click', () => {
    navigateMonth(-1);
  });

  document.getElementById('btn-next-month')?.addEventListener('click', () => {
    navigateMonth(1);
  });

  document.getElementById('btn-today')?.addEventListener('click', () => {
    state.displayedMonth = new Date();
    renderCalendar();
  });

  initCalendarSwipe();
}

function navigateMonth(delta) {
  const grid = document.getElementById('calendar-grid');
  if (grid) {
    grid.style.transition = 'opacity 0.12s ease, transform 0.12s ease';
    grid.style.opacity = '0';
    grid.style.transform = delta > 0 ? 'translateX(-12px)' : 'translateX(12px)';
    setTimeout(() => {
      state.displayedMonth.setMonth(state.displayedMonth.getMonth() + delta);
      renderCalendar();
      grid.style.transform = delta > 0 ? 'translateX(12px)' : 'translateX(-12px)';
      requestAnimationFrame(() => {
        grid.style.opacity = '1';
        grid.style.transform = 'translateX(0)';
        setTimeout(() => {
          grid.style.transition = '';
          grid.style.transform = '';
        }, 130);
      });
    }, 120);
  } else {
    state.displayedMonth.setMonth(state.displayedMonth.getMonth() + delta);
    renderCalendar();
  }
}

function initCalendarSwipe() {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;

  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let isSwiping = false;

  grid.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
    isSwiping = true;
  }, { passive: true });

  grid.addEventListener('touchend', (e) => {
    if (!isSwiping || e.changedTouches.length !== 1) return;
    isSwiping = false;

    const diffX = e.changedTouches[0].clientX - startX;
    const diffY = e.changedTouches[0].clientY - startY;
    const elapsed = Date.now() - startTime;

    // Must be quick (< 600ms), horizontal (|diffX| > 45px), and primarily horizontal (|diffX| > 1.3 * |diffY|)
    if (elapsed < 600 && Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY) * 1.3) {
      if (diffX < 0) {
        // Swiped Left -> Next Month
        navigateMonth(1);
      } else {
        // Swiped Right -> Previous Month
        navigateMonth(-1);
      }
    }
  }, { passive: true });
}

function initLegend() {
  const container = document.getElementById('calendar-legend-items');
  if (!container) return;
  container.innerHTML = PERMANENT_COURSE_LEGEND.map(c => `
    <span class="legend-chip">
      <span class="legend-color-box" style="background-color: ${c.color};"></span>
      <span>${c.name}</span>
    </span>
  `).join('');
}

function renderCalendar() {
  const heading = document.getElementById('cal-month-heading');
  const grid = document.getElementById('calendar-grid');
  if (!heading || !grid) return;

  const year = state.displayedMonth.getFullYear();
  const month = state.displayedMonth.getMonth();

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  heading.textContent = `${monthNames[month]} ${year}`;

  grid.innerHTML = '';

  const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sun, 1 = Mon ...
  const offset = (firstDayIndex + 6) % 7; // Monday = 0, Sunday = 6
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const today = new Date();
  const isCurrentYearMonth = today.getFullYear() === year && today.getMonth() === month;

  function renderDayCell(dayNum, dateStr, isOtherMonth, isToday) {
    const cell = document.createElement('div');
    cell.className = `cal-day-cell ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'is-today' : ''}`.trim();

    // Find tasks for this day
    const dayTasks = state.tasks.filter(t => {
      if (!t.dueDate) return false;
      return t.dueDate.startsWith(dateStr);
    });
    dayTasks.sort(compareTasksByTime);

    let chipsHtml = '';
    if (dayTasks.length > 0) {
      chipsHtml = '<div class="cal-event-chips-container">';
      const maxChips = 2;
      const displayChips = dayTasks.slice(0, maxChips);
      const overflowCount = dayTasks.length - maxChips;

      displayChips.forEach(task => {
        const { courseName, courseCode } = resolveCourseInfo(task);
        const color = getCourseColor(courseCode, courseName, task.title);
        const isDone = task.status === 'completed';
        const safeTitle = escapeHtml(task.title);
        const tooltip = escapeHtml(`${isDone ? '[Completed] ' : ''}[${courseName}] ${task.title}`);
        const iconSvg = isDone ? getSvgIcon('check', 'chip-svg-icon') : getTaskTypeIcon(task.type, 'chip-svg-icon');
        chipsHtml += `<span class="cal-event-chip ${isDone ? 'is-completed' : ''}" style="background-color: ${color};" title="${tooltip}">` +
          `<span class="chip-icon">${iconSvg}</span>` +
          `<span class="chip-text">${safeTitle}</span>` +
        `</span>`;
      });

      if (overflowCount > 0) {
        chipsHtml += `<span class="cal-event-more">+${overflowCount}</span>`;
      }
      chipsHtml += '</div>';
    }

    cell.setAttribute('data-date', dateStr);
    cell.innerHTML = `
      <span class="day-number">${dayNum}</span>
      ${chipsHtml}
    `;

    // Click handler to select day and open Day Drawer on mobile screens
    cell.addEventListener('click', () => {
      document.querySelectorAll('.cal-day-cell').forEach(c => c.classList.remove('is-selected'));
      cell.classList.add('is-selected');
      state.selectedDate = dateStr;
      renderSelectedDay(dateStr, dayTasks);
      if (window.innerWidth <= 640) {
        openDaySheet(dateStr, dayTasks);
      }
    });

    return cell;
  }

  // 1. Previous month trailing days (now display tasks and open day sheet)
  for (let i = offset - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    const prevDate = new Date(year, month - 1, dayNum);
    const pYear = prevDate.getFullYear();
    const pMonth = String(prevDate.getMonth() + 1).padStart(2, '0');
    const pDay = String(dayNum).padStart(2, '0');
    const dateStr = `${pYear}-${pMonth}-${pDay}`;
    grid.appendChild(renderDayCell(dayNum, dateStr, true, false));
  }

  // 2. Current month days
  for (let day = 1; day <= daysInMonth; day++) {
    const isToday = isCurrentYearMonth && today.getDate() === day;
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    grid.appendChild(renderDayCell(day, dateStr, false, isToday));
  }

  // 3. Next month leading days to complete 7-column grid (now display tasks and open day sheet)
  const totalCells = offset + daysInMonth;
  const remainingCells = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= remainingCells; d++) {
    const nextDate = new Date(year, month + 1, d);
    const nYear = nextDate.getFullYear();
    const nMonth = String(nextDate.getMonth() + 1).padStart(2, '0');
    const nDay = String(d).padStart(2, '0');
    const dateStr = `${nYear}-${nMonth}-${nDay}`;
    grid.appendChild(renderDayCell(d, dateStr, true, false));
  }

  // Default selected date if unset
  if (!state.selectedDate) {
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    state.selectedDate = todayStr;
  }

  // Highlight active day in current grid
  const activeCell = grid.querySelector(`.cal-day-cell[data-date="${state.selectedDate}"]`);
  if (activeCell) {
    activeCell.classList.add('is-selected');
  }
}

// ==========================================================================
// Day Sheet Drawer
// ==========================================================================
function initDaySheet() {
  const backdrop = document.getElementById('day-sheet-backdrop');
  const closeBtn = document.getElementById('btn-close-day-sheet');
  const drawer = document.getElementById('day-sheet-drawer');

  function closeSheet() {
    if (backdrop) {
      backdrop.classList.add('hidden');
      backdrop.style.display = 'none';
    }
    if (drawer) {
      drawer.classList.add('hidden');
      drawer.style.display = 'none';
    }
  }

  if (backdrop) backdrop.addEventListener('click', closeSheet);
  if (closeBtn) closeBtn.addEventListener('click', closeSheet);
}

function openDaySheet(dateStr, dayTasks) {
  const backdrop = document.getElementById('day-sheet-backdrop');
  const drawer = document.getElementById('day-sheet-drawer');
  const title = document.getElementById('day-sheet-title');
  const count = document.getElementById('day-sheet-count');
  const itemsContainer = document.getElementById('day-sheet-items');

  if (!drawer || !backdrop || !itemsContainer) return;

  const sortedDayTasks = (dayTasks || []).slice().sort(compareTasksByTime);

  const dateObj = new Date(`${dateStr}T00:00:00`);
  const options = { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' };
  title.textContent = dateObj.toLocaleDateString([], options);
  count.textContent = sortedDayTasks.length === 1 ? '1 Deadline Scheduled' : `${sortedDayTasks.length} Deadlines Scheduled`;

  if (sortedDayTasks.length === 0) {
    itemsContainer.innerHTML = `
      <div class="state-container">
        <div class="state-icon">${getSvgIcon('coffee')}</div>
        <div class="state-title">No Deadlines for this Day</div>
        <div class="state-desc">You are completely free on this date. Take time to relax or review class material!</div>
      </div>
    `;
  } else {
    itemsContainer.innerHTML = sortedDayTasks.map(task => renderTaskCardHtml(task, false)).join('');
    bindTaskCardEvents(itemsContainer);
  }

  const dayAddBtn = document.getElementById('btn-day-add-deadline');
  if (dayAddBtn) {
    dayAddBtn.onclick = () => {
      openAddTaskModal(dateStr);
    };
  }

  backdrop.style.display = 'block';
  drawer.style.display = 'flex';
  backdrop.classList.remove('hidden');
  drawer.classList.remove('hidden');
}

// ==========================================================================
// Selected Day Container (Inline under Calendar)
// ==========================================================================
function renderSelectedDay(dateStr = null, dayTasks = null) {
  const container = document.getElementById('selected-day-container');
  const titleText = document.getElementById('selected-day-title-text');
  const list = document.getElementById('selected-day-list');
  if (!container || !list) return;

  const targetDate = dateStr || state.selectedDate || new Date().toISOString().split('T')[0];
  const [y, m, d] = targetDate.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const formattedHeader = dateObj.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

  if (titleText) {
    titleText.textContent = `Deadlines for ${formattedHeader}`;
  }

  const tasksOnDate = dayTasks || state.tasks.filter(t => t.dueDate && t.dueDate.startsWith(targetDate));
  tasksOnDate.sort(compareTasksByTime);

  list.innerHTML = '';

  if (tasksOnDate.length === 0) {
    list.innerHTML = `
      <div class="selected-day-empty">
        <span>No deadlines scheduled for this day.</span>
      </div>
    `;
    return;
  }

  tasksOnDate.forEach(task => {
    const { courseName, courseCode } = resolveCourseInfo(task);
    const color = getCourseColor(courseCode, courseName, task.title);
    const isCompleted = task.status === 'completed';

    let timeDisplay = 'Class Time';
    if (task.hasSpecificTime && task.dueDate) {
      const dt = new Date(task.dueDate);
      if (!isNaN(dt.getTime())) {
        timeDisplay = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    }

    const weightHtml = task.weightDisplay ? `
      <span class="selected-day-weight" title="${escapeHtml(task.syllabusNote || 'Syllabus weight')}">
        ${getSvgIcon('scale', 'mr-1')} ${escapeHtml(task.weightDisplay)}
      </span>
    ` : '';

    const item = document.createElement('div');
    item.className = `selected-day-item ${isCompleted ? 'status-completed' : ''}`;
    item.style.borderLeft = `4px solid ${color}`;
    item.style.setProperty('border-left-color', color, 'important');
    item.setAttribute('data-id', task.id);

    const isHwOrProj = task.type === 'assignment' || task.type === 'hw' || task.type === 'project';

    item.innerHTML = `
      <div class="selected-day-info">
        <div class="selected-day-course" style="color: ${color};">${escapeHtml(courseName)}</div>
        <div class="selected-day-item-title">${escapeHtml(task.title)}</div>
        <div class="selected-day-meta-row">
          <span class="selected-day-time">${getSvgIcon('clock', 'mr-1')} ${escapeHtml(timeDisplay)}</span>
          ${(!isHwOrProj && task.room) ? `<span class="selected-day-room">${getSvgIcon('pin', 'mr-1')} ${escapeHtml(task.room)}</span>` : ''}
          ${weightHtml}
        </div>
      </div>
      <div class="selected-day-actions">
        <button type="button" class="btn-sel-action btn-sel-toggle" title="${isCompleted ? 'Mark as Pending' : 'Mark as Done'}" data-id="${task.id}">
          ${isCompleted ? getSvgIcon('check') : getSvgIcon('circle')}
        </button>
        <button type="button" class="btn-sel-action btn-sel-edit" title="Edit Deadline" data-id="${task.id}">
          ${getSvgIcon('pencil')}
        </button>
      </div>
    `;

    // Click item body to open full reading sheet
    item.querySelector('.selected-day-info')?.addEventListener('click', () => {
      openReadingSheet(task);
    });

    // Toggle status with 5s undo toast
    item.querySelector('.btn-sel-toggle')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const prevStatus = task.status;
      const newStatus = prevStatus === 'completed' ? 'pending' : 'completed';
      task.status = newStatus;
      task.updatedAt = new Date().toISOString();

      enqueueOfflineMutation({ type: 'status', taskId: task.id, status: newStatus });
      await syncToCloudAndLocal();

      showToast(
        newStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
        'Undo',
        async () => {
          task.status = prevStatus;
          task.updatedAt = new Date().toISOString();
          enqueueOfflineMutation({ type: 'status', taskId: task.id, status: prevStatus });
          await syncToCloudAndLocal();
          showToast('Status reverted');
        }
      );
    });

    // Edit deadline
    item.querySelector('.btn-sel-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditTaskModal(task);
    });

    list.appendChild(item);
  });
}

function initSelectedDayContainer() {
  document.getElementById('btn-add-on-date')?.addEventListener('click', () => {
    openAddTaskModal(state.selectedDate || new Date().toISOString().split('T')[0]);
  });

  document.getElementById('btn-open-day-sheet')?.addEventListener('click', () => {
    const activeDate = state.selectedDate || new Date().toISOString().split('T')[0];
    const dayTasks = state.tasks.filter(t => t.dueDate && t.dueDate.startsWith(activeDate));
    openDaySheet(activeDate, dayTasks);
  });
}

// ==========================================================================
// VIEW 2: Deadlines List & Search
// ==========================================================================
function initDeadlinesControls() {
  const searchInput = document.getElementById('input-search');
  const filterChips = document.querySelectorAll('.filter-chip');
  const courseSelect = document.getElementById('select-course-filter');
  const typeSelect = document.getElementById('select-type-filter');

  searchInput?.addEventListener('input', e => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    renderDeadlines();
  });

  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.filterStatus = chip.getAttribute('data-filter');
      renderDeadlines();
    });
  });

  courseSelect?.addEventListener('change', e => {
    state.filterCourse = e.target.value;
    renderDeadlines();
  });

  typeSelect?.addEventListener('change', e => {
    state.filterType = e.target.value;
    renderDeadlines();
  });
}

function populateCourseFilter() {
  const select = document.getElementById('select-course-filter');
  if (!select) return;

  const currentVal = select.value;
  const coursesMap = new Map();

  state.tasks.forEach(t => {
    const { courseName, courseCode } = resolveCourseInfo(t);
    const key = courseCode || courseName;
    if (key && !coursesMap.has(key)) {
      const label = courseCode && courseCode !== courseName ? `${courseName} (${courseCode})` : courseName;
      coursesMap.set(key, label);
    }
  });

  let optionsHtml = '<option value="all">All Courses</option>';
  coursesMap.forEach((label, key) => {
    optionsHtml += `<option value="${escapeHtml(key)}" ${key === currentVal ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  });

  select.innerHTML = optionsHtml;
}

function renderDeadlines() {
  const container = document.getElementById('deadlines-container');
  if (!container) return;

  // Filter tasks
  const filtered = state.tasks.filter(task => {
    // 1. Status Filter
    if (state.filterStatus !== 'all' && task.status !== state.filterStatus) {
      return false;
    }

    // 2. Course Filter
    if (state.filterCourse !== 'all') {
      const { courseName, courseCode } = resolveCourseInfo(task);
      const match = (task.courseCode === state.filterCourse) || 
                    (task.courseName === state.filterCourse) ||
                    (courseCode === state.filterCourse) ||
                    (courseName === state.filterCourse);
      if (!match) return false;
    }

    // 3. Type Filter
    if (state.filterType !== 'all' && task.type !== state.filterType) {
      return false;
    }

    // 4. Search Filter
    if (state.searchQuery) {
      const matchTitle = (task.title || '').toLowerCase().includes(state.searchQuery);
      const matchCourse = (task.courseName || '').toLowerCase().includes(state.searchQuery) ||
                          (task.courseCode || '').toLowerCase().includes(state.searchQuery);
      const matchSnippet = (task.sourceSnippet || task.description || '').toLowerCase().includes(state.searchQuery);
      if (!matchTitle && !matchCourse && !matchSnippet) return false;
    }

    return true;
  });

  // Sort: pending first, sorted by due date ascending (earliest first)
  filtered.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return compareTasksByTime(a, b);
  });

  // Keep selectedTaskId synced
  if (filtered.length > 0) {
    if (!state.selectedTaskId || !filtered.some(t => t.id === state.selectedTaskId)) {
      state.selectedTaskId = filtered[0].id;
    }
  } else {
    state.selectedTaskId = null;
  }

  if (filtered.length === 0) {
    if (state.tasks.length === 0) {
      container.innerHTML = `
        <div class="state-container">
          <div class="state-icon">${getSvgIcon('bolt')}</div>
          <div class="state-title">No Deadlines Found Yet</div>
          <div class="state-desc">Open Blackboard on your laptop extension and tap "Scan Page" to synchronize your courses here.</div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="state-container">
          <div class="state-icon">${getSvgIcon('search')}</div>
          <div class="state-title">No Matching Deadlines</div>
          <div class="state-desc">Try clearing your search query or switching your filter tabs.</div>
        </div>
      `;
    }
    renderReadingPane(null);
    return;
  }

  container.innerHTML = filtered.map(task => renderTaskCardHtml(task, false)).join('');
  bindTaskCardEvents(container);

  const selectedTask = state.tasks.find(t => t.id === state.selectedTaskId) || filtered[0];
  renderReadingPane(selectedTask);
}

function renderTaskCardHtml(task, isCompact = false) {
  const { courseName, courseCode } = resolveCourseInfo(task);
  const courseTheme = getCourseColorTheme(courseName, courseCode, task.title);
  const isCompleted = task.status === 'completed';
  const countdown = formatCountdown(task.dueDate, task.hasSpecificTime, task.status);
  const typeIcon = getTaskTypeIcon(task.type);
  const typeLabel = (task.type || 'assignment').toUpperCase();

  // Room pill button (1-click room changer - only if not hw or project)
  const isHwOrProj = task.type === 'assignment' || task.type === 'hw' || task.type === 'project';
  let roomBadgeHtml = '';
  if (!isHwOrProj) {
    if (task.room) {
      roomBadgeHtml = `
        <button type="button" class="room-pill-btn" data-task-id="${task.id}" title="Click to change room">
          <span>${getSvgIcon('pin', 'mr-1')} ${escapeHtml(task.room)}</span>
          <span class="room-edit-hint">${getSvgIcon('pencil')}</span>
        </button>
      `;
    } else {
      roomBadgeHtml = `
        <button type="button" class="room-pill-btn" data-task-id="${task.id}" style="background:#f1f5f9; color:#64748b; border-color:#e2e8f0;" title="Click to assign room">
          <span>${getSvgIcon('pin', 'mr-1')} Add Room</span>
          <span class="room-edit-hint">${getSvgIcon('plus')}</span>
        </button>
      `;
    }
  }

  // Weight badge
  let weightBadgeHtml = '';
  if (task.weightDisplay || task.weight) {
    const weightVal = task.weight || 0;
    const isMajor = weightVal >= 20;
    const isMedium = weightVal >= 10 && weightVal < 20;
    const weightClass = isMajor ? 'weight-major' : (isMedium ? 'weight-medium' : '');
    const displayText = task.weightDisplay || `${task.weight}% of Grade`;
    weightBadgeHtml = `<span class="task-weight-pill ${weightClass}" title="${task.syllabusNote ? escapeHtml(task.syllabusNote) : 'Syllabus weight'}">${getSvgIcon('scale', 'mr-1')} ${escapeHtml(displayText)}</span>`;
  }

  // Class Time Indicator
  let classTimeBadgeHtml = '';
  if (!task.hasSpecificTime) {
    classTimeBadgeHtml = `<span class="meta-pill time-class">${getSvgIcon('clock', 'mr-1')} Class Time</span>`;
  }

  // Clean Doctor's announcement quote with expand/collapse toggle
  let doctorQuoteHtml = '';
  const snippet = (task.description || task.sourceSnippet || '').trim();
  if (snippet && !snippet.startsWith('Blackboard Ultra Stream item') && !isCompact) {
    const isLong = snippet.length > 120 || snippet.includes('\n');
    doctorQuoteHtml = `
      <div class="doctor-quote-box">
        <div class="quote-label-row">
          <div class="quote-label">
            <span>${getSvgIcon('message', 'mr-1')}</span>
            <span>Doctor Announcement:</span>
          </div>
          <button type="button" class="btn-inspect-quote" data-task-id="${task.id}" title="Inspect full announcement">
            <span>${getSvgIcon('search', 'mr-1')} Full View</span>
          </button>
        </div>
        <div class="quote-body ${isLong ? 'clamped' : 'expanded'}" id="quote-body-${task.id}">${escapeHtml(snippet)}</div>
        ${isLong ? `
          <button type="button" class="btn-toggle-quote" data-task-id="${task.id}" aria-expanded="false">
            <span class="quote-toggle-icon">${getSvgIcon('book', 'mr-1')}</span>
            <span class="quote-toggle-text">Read Full Announcement ▾</span>
          </button>
        ` : ''}
      </div>
    `;
  }

  // Student Personal Notes
  let studentNotesHtml = '';
  if (task.notes && task.notes.trim() && !isCompact) {
    studentNotesHtml = `
      <div class="student-notes-box">
        <div class="student-notes-header">
          ${getSvgIcon('pencil')}
          <span>Student Notes:</span>
        </div>
        <div class="student-notes-body">${escapeHtml(task.notes)}</div>
      </div>
    `;
  }

  const gcalUrl = createGoogleCalendarUrl(task);
  const isSelected = state.selectedTaskId === task.id;

  return `
    <div class="task-card ${isCompleted ? 'is-completed' : ''} ${isSelected ? 'is-active-reading' : ''}" data-task-id="${task.id}" style="border-left: 4px solid ${courseTheme.hex} !important;">
      <!-- Course Banner with Permanent Subject Color -->
      <div class="task-course-banner">
        <div class="course-badge-main" style="background: ${courseTheme.bgLight}; border: 1px solid ${courseTheme.border}; color: ${courseTheme.textDark};" title="${escapeHtml(courseName)}${courseCode && courseCode.toLowerCase() !== 'uos' ? ` (${escapeHtml(courseCode)})` : ''}">
          <span class="course-color-dot" style="background: ${courseTheme.hex};"></span>
          <span class="course-name-text">${escapeHtml(courseName)}</span>
          ${courseCode && courseCode.toLowerCase() !== 'uos' ? `<span class="course-code-tag" style="color: ${courseTheme.textDark}; border-color: ${courseTheme.border};">${escapeHtml(courseCode)}</span>` : ''}
        </div>
        <div class="task-header-right">
          <span class="type-pill type-${task.type || 'assignment'}">
            <span>${typeIcon}</span>
            <span>${typeLabel}</span>
          </span>
        </div>
      </div>

      <!-- Task Title & Done Toggle -->
      <div class="task-title-row">
        <button class="status-checkbox-btn ${isCompleted ? 'checked' : ''}" data-task-id="${task.id}" aria-label="Toggle status" title="${isCompleted ? 'Mark as Pending' : 'Mark as Done'}">
          ${isCompleted ? '✓' : ''}
        </button>
        <div class="task-title-text">${escapeHtml(task.title)}</div>
      </div>

      <!-- Urgency Countdown & Weight Pills -->
      <div class="task-due-row">
        <span class="urgency-badge ${countdown.urgency}">
          ${countdown.urgency === 'completed'
            ? `${getSvgIcon('check', 'mr-1')} ${escapeHtml(countdown.label)}`
            : (countdown.urgency === 'overdue' ? `${getSvgIcon('urgent', 'mr-1')} ${escapeHtml(countdown.label)}` : `${getSvgIcon('clock', 'mr-1')} ${escapeHtml(countdown.label)}`)}
        </span>
        ${roomBadgeHtml}
        ${weightBadgeHtml}
        ${classTimeBadgeHtml}
        ${task.priority === 'high' ? '<span class="meta-pill" style="color:#ef4444; font-weight:700;">HIGH PRIORITY</span>' : ''}
      </div>

      ${doctorQuoteHtml}
      ${studentNotesHtml}

      <!-- Quick Actions -->
      <div class="task-card-footer">
        <button type="button" class="btn-card-action btn-card-share" data-task-id="${task.id}" title="Share task details">
          ${getSvgIcon('share', 'mr-1')} <span class="btn-responsive-label">Share</span>
        </button>
        <a class="btn-card-action btn-card-edit" href="#" data-task-id="${task.id}" title="Edit deadline">
          ${getSvgIcon('pencil', 'mr-1')} <span class="btn-responsive-label">Edit</span>
        </a>
        <a class="btn-card-action btn-gcal" href="${gcalUrl}" target="_blank" rel="noopener noreferrer" title="Add to Google Calendar">
          ${getSvgIcon('calendar', 'mr-1')} <span class="btn-responsive-label">G-Calendar</span>
        </a>
        <button class="btn-card-action btn-card-toggle" data-task-id="${task.id}">
          ${isCompleted ? `${getSvgIcon('refresh', 'mr-1')} <span class="btn-responsive-label">Mark Pending</span>` : `${getSvgIcon('check', 'mr-1')} <span class="btn-responsive-label">Mark Done</span>`}
        </button>
      </div>
    </div>
  `;
}

function highlightActiveCard(taskId) {
  const container = document.getElementById('deadlines-container');
  if (!container) return;
  container.querySelectorAll('.task-card').forEach(c => {
    if (c.getAttribute('data-task-id') === taskId) {
      c.classList.add('is-active-reading');
    } else {
      c.classList.remove('is-active-reading');
    }
  });
}

function bindTaskCardEvents(parentContainer) {
  // Bind entire card click to select task
  parentContainer.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, select')) return;
      const taskId = card.getAttribute('data-task-id');
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      state.selectedTaskId = taskId;
      highlightActiveCard(taskId);
      openReadingSheet(task);
    });
  });

  // Bind Share buttons
  parentContainer.querySelectorAll('.btn-card-share').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const taskId = btn.getAttribute('data-task-id');
      const task = state.tasks.find(t => t.id === taskId);
      if (task) shareTaskDetails(task);
    });
  });

  // Bind Edit buttons
  const editButtons = parentContainer.querySelectorAll('.btn-card-edit');
  editButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const taskId = btn.getAttribute('data-task-id');
      const task = state.tasks.find(t => t.id === taskId);
      if (task) openEditTaskModal(task);
    });
  });

  // Bind Quote Toggle (expand/collapse in place)
  const quoteToggles = parentContainer.querySelectorAll('.btn-toggle-quote');
  quoteToggles.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute('data-task-id');
      const quoteBody = document.getElementById(`quote-body-${taskId}`);
      if (!quoteBody) return;
      const isClamped = quoteBody.classList.contains('clamped');
      if (isClamped) {
        quoteBody.classList.remove('clamped');
        quoteBody.classList.add('expanded');
        btn.setAttribute('aria-expanded', 'true');
        const textSpan = btn.querySelector('.quote-toggle-text');
        if (textSpan) textSpan.textContent = 'Show Less ▴';
      } else {
        quoteBody.classList.remove('expanded');
        quoteBody.classList.add('clamped');
        btn.setAttribute('aria-expanded', 'false');
        const textSpan = btn.querySelector('.quote-toggle-text');
        if (textSpan) textSpan.textContent = 'Read Full Announcement ▾';
      }
    });
  });

  // Bind Inspect Quote (open dedicated reading view)
  const inspectButtons = parentContainer.querySelectorAll('.btn-inspect-quote');
  inspectButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute('data-task-id');
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      state.selectedTaskId = taskId;
      highlightActiveCard(taskId);
      openReadingSheet(task);
    });
  });

  // Bind Room Pill Button (1-click room picker)
  const roomButtons = parentContainer.querySelectorAll('.room-pill-btn');
  roomButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute('data-task-id');
      openRoomPicker(taskId);
    });
  });

  // Bind Status Toggle with 5-Second Undo & Offline Queue
  const toggleButtons = parentContainer.querySelectorAll('.status-checkbox-btn, .btn-card-toggle');
  toggleButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute('data-task-id');
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;

      const prevStatus = task.status;
      const newStatus = prevStatus === 'completed' ? 'pending' : 'completed';
      task.status = newStatus;
      task.updatedAt = new Date().toISOString();

      enqueueOfflineMutation({ type: 'status', taskId, status: newStatus });
      await syncToCloudAndLocal();

      showToast(
        newStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
        'Undo',
        async () => {
          task.status = prevStatus;
          task.updatedAt = new Date().toISOString();
          enqueueOfflineMutation({ type: 'status', taskId, status: prevStatus });
          await syncToCloudAndLocal();
          showToast('Status reverted');
        }
      );
    });
  });
}

function renderReadingPane(task) {
  const pane = document.getElementById('deadlines-reading-pane');
  if (!pane) return;

  if (!task) {
    pane.innerHTML = `
      <div class="reading-pane-card is-empty">
        <div class="state-icon">${getSvgIcon('book')}</div>
        <div class="state-title">Select a Deadline</div>
        <div class="state-desc">Tap any deadline on the left to read its full announcement, room, and syllabus breakdown.</div>
      </div>
    `;
    return;
  }

  const { courseName, courseCode } = resolveCourseInfo(task);
  const courseTheme = getCourseColorTheme(courseName, courseCode, task.title);
  const isCompleted = task.status === 'completed';
  const countdown = formatCountdown(task.dueDate, task.hasSpecificTime, task.status);
  const typeIcon = getTaskTypeIcon(task.type);
  const typeLabel = (task.type || 'assignment').toUpperCase();
  const gcalUrl = createGoogleCalendarUrl(task);

  const fullAnnouncement = (task.description || task.sourceSnippet || '').trim();
  const hasAnnouncement = fullAnnouncement && !fullAnnouncement.startsWith('Blackboard Ultra Stream item');

  let roomDisplay = task.room || 'No room set';

  let weightHtml = '';
  if (task.weightDisplay || task.weight) {
    const displayText = task.weightDisplay || `${task.weight}% of Grade`;
    weightHtml = `<span class="task-weight-pill weight-major">${getSvgIcon('scale', 'mr-1')} ${escapeHtml(displayText)}</span>`;
  }

  pane.innerHTML = `
    <div class="reading-pane-card" style="border-top: 4px solid ${courseTheme.hex};">
      <!-- Course Banner & Type -->
      <div class="reading-pane-top-row">
        <div class="course-badge-main" style="background: ${courseTheme.bgLight}; border: 1px solid ${courseTheme.border}; color: ${courseTheme.textDark};">
          <span class="course-color-dot" style="background: ${courseTheme.hex};"></span>
          <span class="course-name-text">${escapeHtml(courseName)}</span>
          ${courseCode && courseCode.toLowerCase() !== 'uos' ? `<span class="course-code-tag" style="color: ${courseTheme.textDark}; border-color: ${courseTheme.border};">${escapeHtml(courseCode)}</span>` : ''}
        </div>
        <span class="type-pill type-${task.type || 'assignment'}">
          <span>${typeIcon}</span>
          <span>${typeLabel}</span>
        </span>
      </div>

      <!-- Task Title -->
      <h2 class="reading-pane-title">${escapeHtml(task.title)}</h2>

      <!-- Due Date & Meta Strip -->
      <div class="reading-meta-section">
        <span class="urgency-badge ${countdown.urgency}">
          ${countdown.urgency === 'completed'
            ? `${getSvgIcon('check', 'mr-1')} ${escapeHtml(countdown.label)}`
            : (countdown.urgency === 'overdue' ? `${getSvgIcon('urgent', 'mr-1')} ${escapeHtml(countdown.label)}` : `${getSvgIcon('clock', 'mr-1')} ${escapeHtml(countdown.label)}`)}
        </span>
        <button type="button" class="room-pill-btn reading-room-btn" data-task-id="${task.id}" title="Click to change room">
          <span>${getSvgIcon('pin', 'mr-1')} ${escapeHtml(roomDisplay)}</span>
          <span class="room-edit-hint">${getSvgIcon('pencil', 'mr-1')} Change</span>
        </button>
        ${weightHtml}
        ${!task.hasSpecificTime ? `<span class="meta-pill time-class">${getSvgIcon('clock', 'mr-1')} Class Time</span>` : ''}
        ${task.priority === 'high' ? '<span class="meta-pill" style="color:#ef4444; font-weight:700;">HIGH PRIORITY</span>' : ''}
      </div>

      <!-- Syllabus Context if available -->
      ${task.syllabusNote ? `
        <div style="font-size: 11.5px; color: var(--text-muted); background: #f1f5f9; padding: 7px 10px; border-radius: var(--radius-sm);">
          ${getSvgIcon('book', 'mr-1')} <strong>Syllabus Weight:</strong> ${escapeHtml(task.syllabusNote)}
        </div>
      ` : ''}

      <!-- Doctor Announcement Section -->
      <div class="reading-announcement-box">
        <div class="reading-box-header">
          <span class="reading-box-title">
            <span>${getSvgIcon('message', 'mr-1')}</span>
            <span>Doctor Announcement & Instructions</span>
          </span>
          ${hasAnnouncement ? `
            <button type="button" class="btn-copy-announcement" id="btn-copy-reading-text">
              <span>${getSvgIcon('copy', 'mr-1')}</span>
              <span id="copy-reading-label">Copy Text</span>
            </button>
          ` : ''}
        </div>
        <div class="reading-box-content">
          ${hasAnnouncement ? escapeHtml(fullAnnouncement) : '<span style="color: var(--text-muted); font-style: italic;">No detailed announcement body attached to this item.</span>'}
        </div>
      </div>

      <!-- Student Personal Notes -->
      ${task.notes && task.notes.trim() ? `
        <div class="reading-notes-box" style="margin-top: 12px; padding: 12px 14px; background: rgba(59, 130, 246, 0.08); border-left: 3px solid #3b82f6; border-radius: var(--radius-sm);">
          <div style="font-size: 12px; font-weight: 700; color: #2563eb; display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
            ${getSvgIcon('pencil')}
            <span>Student Personal Notes</span>
          </div>
          <div style="font-size: 13px; color: var(--text-main); white-space: pre-wrap; line-height: 1.5;">${escapeHtml(task.notes)}</div>
        </div>
      ` : ''}

      <!-- Actions Bar -->
      <div class="reading-actions-bar">
        <button type="button" class="btn-primary-action reading-toggle-status-btn" data-task-id="${task.id}" style="min-height: 40px; font-size: 12px; padding: 0 14px;">
          ${isCompleted ? `${getSvgIcon('refresh', 'mr-1')} Mark as Pending` : `${getSvgIcon('check', 'mr-1')} Mark as Completed`}
        </button>
        <button type="button" class="btn-outline-action reading-share-btn" data-task-id="${task.id}" style="min-height: 40px; font-size: 12px; padding: 0 12px;">
          <span>${getSvgIcon('share', 'mr-1')} Share</span>
        </button>
        <a class="btn-outline-action" href="${gcalUrl}" target="_blank" rel="noopener noreferrer" style="min-height: 40px; font-size: 12px; padding: 0 12px; text-decoration: none;">
          <span>${getSvgIcon('calendar', 'mr-1')} Google Calendar</span>
        </a>
        <button type="button" class="btn-outline-action reading-edit-btn" data-task-id="${task.id}" style="min-height: 40px; font-size: 12px; padding: 0 12px;">
          <span>${getSvgIcon('pencil', 'mr-1')} Edit</span>
        </button>
      </div>
    </div>
  `;

  // Bind Reading Pane Events
  const copyBtn = document.getElementById('btn-copy-reading-text');
  if (copyBtn && hasAnnouncement) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(fullAnnouncement);
        const label = document.getElementById('copy-reading-label');
        if (label) {
          label.textContent = 'Copied!';
          setTimeout(() => { label.textContent = 'Copy Text'; }, 2000);
        }
        showToast('Announcement text copied to clipboard!');
      } catch (e) {
        showToast('Could not copy to clipboard.');
      }
    };
  }

  pane.querySelector('.reading-share-btn')?.addEventListener('click', () => {
    shareTaskDetails(task);
  });

  pane.querySelector('.reading-room-btn')?.addEventListener('click', () => {
    openRoomPicker(task.id);
  });

  pane.querySelector('.reading-edit-btn')?.addEventListener('click', () => {
    openEditTaskModal(task);
  });

  pane.querySelector('.reading-toggle-status-btn')?.addEventListener('click', async () => {
    const prevStatus = task.status;
    const newStatus = prevStatus === 'completed' ? 'pending' : 'completed';
    task.status = newStatus;
    task.updatedAt = new Date().toISOString();

    enqueueOfflineMutation({ type: 'status', taskId: task.id, status: newStatus });
    await syncToCloudAndLocal();

    showToast(
      newStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
      'Undo',
      async () => {
        task.status = prevStatus;
        task.updatedAt = new Date().toISOString();
        enqueueOfflineMutation({ type: 'status', taskId: task.id, status: prevStatus });
        await syncToCloudAndLocal();
        showToast('Status reverted');
      }
    );
  });
}

function updateStats() {
  const now = Date.now();
  let urgentCount = 0;
  let weekCount = 0;
  let totalCount = 0;

  for (const t of state.tasks) {
    if (t.status !== 'completed') {
      totalCount++;
      const dueTime = new Date(t.dueDate).getTime();
      const hoursLeft = (dueTime - now) / (1000 * 3600);
      if (hoursLeft > -12 && hoursLeft <= 48) {
        urgentCount++;
      }
      if (hoursLeft > 0 && hoursLeft <= 7 * 24) {
        weekCount++;
      }
    }
  }

  const elUrgent = document.getElementById('stat-urgent-num');
  const elWeek = document.getElementById('stat-week-num');
  const elTotal = document.getElementById('stat-total-num');

  if (elUrgent) elUrgent.textContent = String(urgentCount);
  if (elWeek) elWeek.textContent = String(weekCount);
  if (elTotal) elTotal.textContent = String(totalCount);
}

function updateBadgeCounts() {
  const pendingCount = state.tasks.filter(t => t.status !== 'completed').length;
  const badge = document.getElementById('badge-deadlines-count');
  if (badge) badge.textContent = String(pendingCount);
}

// ==========================================================================
// Syllabus Grade Progress Tracker & Simulator
// ==========================================================================
function renderGradeTracker() {
  const badge = document.getElementById('mobile-grade-overall-badge');
  const breakdown = document.getElementById('mobile-grade-tracker-breakdown');
  if (!badge || !breakdown) return;

  const courses = DEFAULT_SYLLABUS_DATABASE;
  let totalTrackedCompleted = 0;
  let totalTrackedWeight = 0;

  const courseStats = courses.map(course => {
    const courseTasks = state.tasks.filter(t => {
      const { courseName, courseCode } = resolveCourseInfo(t);
      return course.courseCodePattern.test(courseName || '') ||
             course.courseCodePattern.test(courseCode || '') ||
             course.courseCodePattern.test(t.title || '');
    });

    let completedWeight = 0;
    let pendingWeight = 0;

    courseTasks.forEach(t => {
      const w = Number(t.weight) || 0;
      if (t.status === 'completed') {
        completedWeight += w;
      } else {
        pendingWeight += w;
      }
    });

    completedWeight = Math.round(completedWeight * 10) / 10;
    pendingWeight = Math.round(pendingWeight * 10) / 10;
    const trackedWeight = completedWeight + pendingWeight;

    totalTrackedCompleted += completedWeight;
    totalTrackedWeight += trackedWeight;

    return {
      course,
      completedWeight,
      pendingWeight,
      trackedWeight,
      taskCount: courseTasks.length
    };
  });

  const overallPct = totalTrackedWeight > 0
    ? Math.min(100, Math.round((totalTrackedCompleted / totalTrackedWeight) * 100))
    : 0;

  badge.textContent = `${overallPct}% Done (${Math.round(totalTrackedCompleted)} pts tracked)`;

  breakdown.innerHTML = courseStats.map(stat => {
    const course = stat.course;
    const hex = getCourseColor(course.courseId, course.courseName);
    const pct = Math.min(100, Math.round((stat.completedWeight / (course.totalWeight || 100)) * 100));

    return `
      <div class="grade-course-stat-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 7px;">
            <span style="display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: ${hex};"></span>
            <span style="font-size: 12.5px; font-weight: 700; color: var(--text-main);">${escapeHtml(course.courseName)}</span>
          </div>
          <span style="font-size: 11.5px; font-weight: 600; color: ${pct > 0 ? '#10b981' : 'var(--text-muted)'};">${stat.completedWeight}% / ${course.totalWeight}% (${pct}%)</span>
        </div>
        <div class="grade-progress-bar-bg">
          <div style="width: ${pct}%; height: 100%; background: #10b981; transition: width 0.3s ease;"></div>
          <div style="width: ${Math.min(100 - pct, Math.round((stat.pendingWeight / course.totalWeight) * 100))}%; height: 100%; background: #93c5fd; transition: width 0.3s ease;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 10.5px; color: var(--text-muted); margin-top: 6px;">
          <span>✓ Completed: ${stat.completedWeight}%</span>
          <span>⏳ Pending: ${stat.pendingWeight}%</span>
          <span>Upcoming: ${Math.max(0, Math.round((course.totalWeight - stat.trackedWeight) * 10) / 10)}%</span>
        </div>
      </div>
    `;
  }).join('');
}

function initGradeTracker() {
  const toggleBtn = document.getElementById('mobile-grade-tracker-toggle-btn');
  const breakdown = document.getElementById('mobile-grade-tracker-breakdown');
  const arrow = document.getElementById('mobile-grade-arrow');

  toggleBtn?.addEventListener('click', () => {
    if (!breakdown) return;
    const isHidden = breakdown.style.display === 'none' || !breakdown.style.display;
    breakdown.style.display = isHidden ? 'flex' : 'none';
    if (arrow) {
      arrow.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
    }
  });
}

// ==========================================================================
// VIEW 3: Schedule & Syllabus
// ==========================================================================
function initScheduleAndSyllabus() {
  const scheduleContainer = document.getElementById('schedule-timeline-container');
  if (scheduleContainer) {
    scheduleContainer.innerHTML = STUDENT_CLASS_SCHEDULE.map(s => {
      const color = getCourseColor(s.courseCode, s.courseName);
      return `
        <div class="schedule-row" style="border-left-color: ${color};">
          <div class="schedule-course-info">
            <div class="schedule-course-name">${s.courseCode}: ${s.courseName}</div>
            <div class="schedule-days-badge">${s.days} • ${s.room}</div>
          </div>
          <div class="schedule-time-badge">${s.time}</div>
        </div>
      `;
    }).join('');
  }

  const syllabusContainer = document.getElementById('syllabus-distribution-container');
  if (syllabusContainer) {
    syllabusContainer.innerHTML = SYLLABUS_INFO.map(item => `
      <div class="syllabus-item-card">
        <div class="syllabus-item-title">${item.courseCode} - ${item.courseName}</div>
        <div class="syllabus-item-details">${item.breakdown}</div>
      </div>
    `).join('');
  }
}

// ==========================================================================
// VIEW 4: Settings, Push Notifications & WebCal
// ==========================================================================
function initSettings() {
  const host = window.location.host || 'localhost:3456';
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';

  // WebCal and Personal Token setup
  const feedUrlText = document.getElementById('feed-url-text');
  const btnWebcal = document.getElementById('btn-webcal-subscribe');
  const btnCopy = document.getElementById('btn-copy-webcal');
  const inputToken = document.getElementById('input-webcal-token');
  const inputSyncKey = document.getElementById('web-sync-key-input');
  const btnSaveSyncKey = document.getElementById('btn-save-web-sync-key');
  const syncKeyStatus = document.getElementById('web-sync-key-status');

  const savedToken = localStorage.getItem('bbs_user_token') || '';
  if (inputToken) inputToken.value = savedToken;

  function updateFeedUrls() {
    const token = (inputToken ? inputToken.value.trim() : '') || savedToken;
    const activeSyncKey = getSyncKey();
    const queryParts = [];
    if (token) queryParts.push(`token=${encodeURIComponent(token)}`);
    if (activeSyncKey) queryParts.push(`key=${encodeURIComponent(activeSyncKey)}`);
    const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

    const currentFeedUrl = `${protocol}//${host}/feed.ics${query}`;
    const currentWebcalUrl = `webcal://${host}/feed.ics${query}`;

    if (feedUrlText) feedUrlText.textContent = currentFeedUrl;
    if (btnWebcal) btnWebcal.setAttribute('href', currentWebcalUrl);
    return currentFeedUrl;
  }

  let activeFeedUrl = updateFeedUrls();

  // Personal Sync Key Pairing Handler
  const currentSyncKey = getSyncKey();
  if (inputSyncKey) {
    inputSyncKey.value = currentSyncKey;
  }
  if (syncKeyStatus) {
    syncKeyStatus.textContent = currentSyncKey
      ? `Currently paired to key: ${currentSyncKey} (Isolated cloud bucket)`
      : 'No key set. Using default cloud bucket.';
  }

  btnSaveSyncKey?.addEventListener('click', async () => {
    const rawVal = inputSyncKey ? inputSyncKey.value.trim().toUpperCase() : '';
    if (rawVal) {
      localStorage.setItem('bbs_sync_key', rawVal);
      const url = new URL(window.location.href);
      url.searchParams.set('key', rawVal);
      window.history.replaceState({}, '', url.toString());
      if (syncKeyStatus) {
        syncKeyStatus.textContent = `Paired to key: ${rawVal}. Loading your tasks...`;
        syncKeyStatus.style.color = 'var(--color-primary, #6366f1)';
      }
      activeFeedUrl = updateFeedUrls();
      showToast(`Device paired with key ${rawVal}! Fetching your deadlines...`);
      await fetchTasksFromServer();
    } else {
      localStorage.removeItem('bbs_sync_key');
      const url = new URL(window.location.href);
      url.searchParams.delete('key');
      window.history.replaceState({}, '', url.toString());
      if (syncKeyStatus) {
        syncKeyStatus.textContent = 'Cleared sync key. Using default bucket.';
        syncKeyStatus.style.color = 'var(--text-muted)';
      }
      activeFeedUrl = updateFeedUrls();
      showToast('Sync key cleared. Using default bucket.');
      await fetchTasksFromServer();
    }
  });

  inputToken?.addEventListener('input', () => {
    const val = inputToken.value.trim();
    localStorage.setItem('bbs_user_token', val);
    activeFeedUrl = updateFeedUrls();
  });

  btnCopy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(activeFeedUrl);
      const copyIcon = document.getElementById('copy-btn-icon');
      const copyTxt = document.getElementById('copy-btn-text');
      if (copyIcon && copyTxt) {
        copyIcon.innerHTML = '<use href="#icon-check"></use>';
        copyTxt.textContent = 'Copied to Clipboard!';
        setTimeout(() => {
          copyIcon.innerHTML = '<use href="#icon-copy"></use>';
          copyTxt.textContent = 'Copy Calendar Feed URL';
        }, 2500);
      }
      showToast('Calendar feed link copied! Paste into Google Calendar or Apple Calendar.');
    } catch (e) {
      showToast('Could not copy automatically. Please copy the URL text manually.');
    }
  });

  // Push Notifications Setup
  const togglePush = document.getElementById('toggle-push-notif');
  const permStatus = document.getElementById('notif-permission-status');
  const btnTestNotif = document.getElementById('btn-test-notification');

  function updateNotificationUi() {
    if (!('Notification' in window)) {
      if (permStatus) permStatus.textContent = 'Not supported in this browser';
      if (togglePush) togglePush.disabled = true;
      return;
    }

    const perm = Notification.permission;
    const isSavedActive = localStorage.getItem('bbs_push_enabled') === 'true';

    if (perm === 'granted' && isSavedActive) {
      if (permStatus) permStatus.textContent = 'Active: Reminders 24h and 2h before deadlines';
      if (togglePush) togglePush.checked = true;
    } else if (perm === 'denied') {
      if (permStatus) permStatus.textContent = 'Blocked by browser permissions';
      if (togglePush) {
        togglePush.checked = false;
        togglePush.disabled = true;
      }
    } else {
      if (permStatus) permStatus.textContent = 'Disabled (Tap switch to enable)';
      if (togglePush) togglePush.checked = false;
    }
  }

  updateNotificationUi();

  togglePush?.addEventListener('change', async () => {
    if (togglePush.checked) {
      if ('Notification' in window) {
        const result = await Notification.requestPermission();
        if (result === 'granted') {
          localStorage.setItem('bbs_push_enabled', 'true');
          updateNotificationUi();
          registerPeriodicSync();
          syncTasksToServiceWorker();
          await checkUpcomingDeadlines(true);
          showToast('Notifications enabled! You will receive countdown alerts.');
        } else {
          togglePush.checked = false;
          localStorage.setItem('bbs_push_enabled', 'false');
          updateNotificationUi();
          showToast('Notification permission was not granted.');
        }
      }
    } else {
      localStorage.setItem('bbs_push_enabled', 'false');
      updateNotificationUi();
      syncTasksToServiceWorker();
      showToast('Mobile push notifications turned off.');
    }
  });

  btnTestNotif?.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      showToast('Notifications are not supported on this device.');
      return;
    }

    if (Notification.permission === 'granted') {
      const now = Date.now();
      const nextTask = (state.tasks || []).find(t => t.status !== 'completed' && new Date(t.dueDate).getTime() >= now) || (state.tasks || [])[0];
      let title = '🚨 Blackboarder Alert';
      let body = 'Calculus I for Engineering (1440 133)\n🕒 Due: Tomorrow at 12:30 PM (in ~24 hours)\n📍 Room: A12-110';

      if (nextTask) {
        const payload = formatNotificationPayload(nextTask, '2h', Math.max(0, new Date(nextTask.dueDate).getTime() - now));
        title = payload.title;
        body = payload.body;
      }

      const sent = await sendMobileNotification(title, {
        body,
        tag: 'bbs-test-notification',
        renotify: false,
        vibrate: [200, 100, 200],
        data: { url: './index.html', taskId: nextTask?.id }
      });

      if (sent) {
        showToast('Sent test notification to your screen!');
      } else {
        showToast('Notification triggered (check your notifications shade).');
      }
    } else {
      showToast('Please enable the Push Alerts toggle switch first.');
    }
  });

  // AI & Jev Fast Classifier Settings
  const aiSettings = getAiSettings();
  const inputJevKey = document.getElementById('web-setting-jev-key');
  const chkJev = document.getElementById('web-setting-use-jev');
  const inputOrKey = document.getElementById('web-setting-openrouter-key');
  const selOrModel = document.getElementById('web-setting-model');
  const chkOr = document.getElementById('web-setting-use-ai');

  if (inputJevKey) inputJevKey.value = aiSettings.jevApiKey || '';
  if (chkJev) chkJev.checked = Boolean(aiSettings.useJevClassification);
  if (inputOrKey) inputOrKey.value = aiSettings.openRouterApiKey || '';
  if (selOrModel) selOrModel.value = aiSettings.openRouterModel || 'google/gemini-3.8-flash';
  if (chkOr) chkOr.checked = Boolean(aiSettings.useAiExtraction);

  const formAi = document.getElementById('form-ai-settings');
  formAi?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveAiSettings({
      jevApiKey: inputJevKey?.value.trim() || '',
      useJevClassification: Boolean(chkJev?.checked),
      openRouterApiKey: inputOrKey?.value.trim() || '',
      openRouterModel: selOrModel?.value || 'google/gemini-3.8-flash',
      useAiExtraction: Boolean(chkOr?.checked)
    });
    showToast('AI & Jev settings saved successfully!');
  });

  // Backup & Data Management (JSON & ICS)
  document.getElementById('btn-web-backup-json')?.addEventListener('click', () => {
    exportJsonBackup();
  });

  const restoreInput = document.getElementById('input-web-restore-json');
  document.getElementById('btn-web-restore-trigger')?.addEventListener('click', () => {
    restoreInput?.click();
  });

  restoreInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleRestoreJson(file);
      restoreInput.value = '';
    }
  });

  document.getElementById('btn-web-export-ics')?.addEventListener('click', () => {
    exportAllIcs();
  });
}

// ==========================================================================
// Toast Notification Helper with 5-Second Undo Action
// ==========================================================================
function showToast(message, actionText = null, onAction = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';

  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  if (actionText && typeof onAction === 'function') {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'toast-btn-action';
    actionBtn.textContent = actionText;
    actionBtn.type = 'button';
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toast.remove();
      onAction();
    });
    toast.appendChild(actionBtn);
  }

  container.appendChild(toast);

  const duration = actionText ? 5000 : 3200;
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.2s ease-in';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// ==========================================================================
// Offline Mutation Queue & Cloud Sync Manager
// ==========================================================================
const MUTATION_QUEUE_KEY = 'bbs_offline_mutation_queue';

function getOfflineMutations() {
  try {
    const raw = localStorage.getItem(MUTATION_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function enqueueOfflineMutation(mutation) {
  const queue = getOfflineMutations();
  queue.push({
    ...mutation,
    id: 'mut_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    timestamp: new Date().toISOString()
  });
  localStorage.setItem(MUTATION_QUEUE_KEY, JSON.stringify(queue));
}

function clearOfflineMutations() {
  localStorage.removeItem(MUTATION_QUEUE_KEY);
}

let isFlushingMutations = false;
async function flushOfflineMutations() {
  if (isFlushingMutations || !navigator.onLine) return;
  if (getOfflineMutations().length === 0) return;

  isFlushingMutations = true;
  try {
    // Every queued mutation is already applied to state.tasks, so one full-state push replaces them.
    // Per-key writes such as /tasks/<id>.json must not be used: they turn the Firebase tasks
    // array into an object, which every client then reads as "no tasks".
    await syncToCloudAndLocal();
  } catch (err) {
    console.warn('Failed to flush offline mutations:', err);
  } finally {
    isFlushingMutations = false;
  }
}

// ==========================================================================
// Native Share / Copy Task Details
// ==========================================================================
async function shareTaskDetails(task) {
  if (!task) return;
  const { courseName, courseCode } = resolveCourseInfo(task);
  const dueFormatted = formatCountdown(task.dueDate, task.hasSpecificTime).label;
  const shareText = `📌 ${task.title}\n📚 ${courseCode || courseName}\n⏰ Due: ${dueFormatted}${task.room ? '\n📍 Room: ' + task.room : ''}${task.weightDisplay ? '\n⚖️ ' + task.weightDisplay : ''}\n\nManaged with Blackboarder`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: task.title,
        text: shareText,
        url: window.location.href
      });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(shareText);
    showToast('Task details copied to clipboard!');
  } catch (e) {
    showToast('Could not copy task details.');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================================================
// Add & Edit Modals (Bi-Directional Editing)
// ==========================================================================
function initModals() {
  // Add Deadline Button in Deadlines view
  document.getElementById('btn-add-deadline')?.addEventListener('click', () => {
    openAddTaskModal();
  });

  // Edit Modal Close & Cancel
  document.getElementById('btn-close-edit-modal')?.addEventListener('click', closeEditModal);
  document.getElementById('btn-cancel-edit')?.addEventListener('click', closeEditModal);
  document.getElementById('modal-edit-task')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-edit-task') closeEditModal();
  });

  // Add Modal Close & Cancel
  document.getElementById('btn-close-add-modal')?.addEventListener('click', closeAddModal);
  document.getElementById('btn-cancel-add')?.addEventListener('click', closeAddModal);
  document.getElementById('modal-add-task')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-add-task') closeAddModal();
  });

  // Reading Sheet Close
  document.getElementById('btn-close-reading-sheet')?.addEventListener('click', closeReadingSheet);
  document.getElementById('modal-reading-sheet')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-reading-sheet') closeReadingSheet();
  });

  // Room Picker Close
  document.getElementById('btn-close-room-picker')?.addEventListener('click', closeRoomPicker);
  document.getElementById('modal-room-picker')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-room-picker') closeRoomPicker();
  });

  // AI Extract Modal Open, Close & Backdrop
  const extractModal = document.getElementById('modal-ai-extract');
  function closeExtractModal() {
    if (extractModal) {
      extractModal.style.display = 'none';
      extractModal.classList.add('hidden');
    }
  }

  document.getElementById('btn-ai-extract-modal')?.addEventListener('click', () => {
    if (extractModal) {
      extractModal.style.display = 'flex';
      extractModal.classList.remove('hidden');
      const input = document.getElementById('input-extract-text');
      if (input) input.focus();
    }
  });
  document.getElementById('btn-close-extract-modal')?.addEventListener('click', closeExtractModal);
  document.getElementById('btn-cancel-extract')?.addEventListener('click', closeExtractModal);
  extractModal?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-ai-extract') closeExtractModal();
  });

  // Save Custom Room Button
  document.getElementById('btn-apply-custom-room')?.addEventListener('click', async () => {
    if (!activeRoomPickerTaskId) return;
    const customVal = document.getElementById('input-custom-room')?.value.trim() || '';
    await applyRoomChange(activeRoomPickerTaskId, customVal);
    closeRoomPicker();
  });

  // Escape key closes modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeEditModal();
      closeAddModal();
      closeReadingSheet();
      closeRoomPicker();
      closeExtractModal();
      closeQuickLinksModal();
    }
  });

  // Auto-weight calculation in Add and Edit modals
  document.getElementById('btn-calc-add-weight')?.addEventListener('click', () => {
    const course = document.getElementById('add-course')?.value || '';
    const title = document.getElementById('add-title')?.value || '';
    const type = document.getElementById('add-type')?.value || 'assignment';
    const notes = document.getElementById('add-notes')?.value || '';
    const weightInfo = resolveTaskWeight(course, title, type, notes);

    const weightInput = document.getElementById('add-weight');
    const hintSpan = document.getElementById('add-weight-hint');

    if (weightInfo.weight !== undefined) {
      if (weightInput) weightInput.value = weightInfo.weight;
      if (hintSpan) {
        hintSpan.innerHTML = `${getSvgIcon('scale', 'mr-1')} <strong>${escapeHtml(weightInfo.weightDisplay)}</strong>: ${escapeHtml(weightInfo.syllabusNote || '')}`;
        hintSpan.style.color = 'var(--primary)';
      }
      showToast(`Auto-detected weight: ${weightInfo.weightDisplay}`);
    } else {
      if (hintSpan) {
        hintSpan.textContent = 'No matching syllabus rule found for this item.';
        hintSpan.style.color = 'var(--text-muted)';
      }
      showToast('Could not automatically match syllabus component.');
    }
  });

  document.getElementById('btn-calc-edit-weight')?.addEventListener('click', () => {
    const course = document.getElementById('edit-course')?.value || '';
    const title = document.getElementById('edit-title')?.value || '';
    const type = document.getElementById('edit-type')?.value || 'assignment';
    const desc = document.getElementById('edit-desc')?.value || '';
    const notes = document.getElementById('edit-notes')?.value || '';
    const weightInfo = resolveTaskWeight(course, title, type, `${desc} ${notes}`);

    const weightInput = document.getElementById('edit-weight');
    const hintSpan = document.getElementById('edit-weight-hint');

    if (weightInfo.weight !== undefined) {
      if (weightInput) weightInput.value = weightInfo.weight;
      if (hintSpan) {
        hintSpan.innerHTML = `${getSvgIcon('scale', 'mr-1')} <strong>${escapeHtml(weightInfo.weightDisplay)}</strong>: ${escapeHtml(weightInfo.syllabusNote || '')}`;
        hintSpan.style.color = 'var(--primary)';
      }
      showToast(`Auto-detected weight: ${weightInfo.weightDisplay}`);
    } else {
      if (hintSpan) {
        hintSpan.textContent = 'No matching syllabus rule found for this item.';
        hintSpan.style.color = 'var(--text-muted)';
      }
      showToast('Could not automatically match syllabus component.');
    }
  });

  // Type change listeners to dynamically toggle room visibility in Add and Edit modals
  document.getElementById('edit-type')?.addEventListener('change', (e) => {
    const val = e.target.value;
    const isHw = val === 'assignment' || val === 'hw' || val === 'project';
    const roomInput = document.getElementById('edit-room');
    const group = roomInput ? roomInput.closest('.form-group') : null;
    if (group) group.style.display = isHw ? 'none' : '';
    if (isHw && roomInput) roomInput.value = '';
  });

  document.getElementById('add-type')?.addEventListener('change', (e) => {
    const val = e.target.value;
    const isHw = val === 'assignment' || val === 'hw' || val === 'project';
    const roomInput = document.getElementById('add-room');
    const group = roomInput ? roomInput.closest('.form-group') : null;
    if (group) group.style.display = isHw ? 'none' : '';
    if (isHw && roomInput) roomInput.value = '';
  });

  // Auto-suggest default room and meeting time when entering course in Add Modal
  const addCourseInput = document.getElementById('add-course');
  const addRoomInput = document.getElementById('add-room');
  const addTimeInput = document.getElementById('add-time');
  addCourseInput?.addEventListener('input', () => {
    const courseVal = addCourseInput.value;
    const addTypeVal = document.getElementById('add-type')?.value;
    const isHwOrProj = addTypeVal === 'assignment' || addTypeVal === 'hw' || addTypeVal === 'project';
    for (const s of STUDENT_CLASS_SCHEDULE) {
      if (s.matcher.test(courseVal)) {
        if (!isHwOrProj && addRoomInput && !addRoomInput.value) {
          addRoomInput.value = s.room;
        }
        if (addTimeInput && (!addTimeInput.value || addTimeInput.value === '23:59')) {
          const parts = s.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
          if (parts) {
            let h = parseInt(parts[1], 10);
            const m = parts[2];
            const isPm = parts[3].toUpperCase() === 'PM';
            if (isPm && h < 12) h += 12;
            if (!isPm && h === 12) h = 0;
            addTimeInput.value = `${String(h).padStart(2, '0')}:${m}`;
          }
        }
        break;
      }
    }
  });

  // Execute 3-Tier Hybrid Extraction in Modal
  const btnRunExtract = document.getElementById('btn-run-extract');
  btnRunExtract?.addEventListener('click', async () => {
    const textArea = document.getElementById('input-extract-text');
    const courseSelect = document.getElementById('extract-course-hint');
    const statusBox = document.getElementById('extract-status-box');
    const previewList = document.getElementById('extract-preview-list');
    const btnIcon = document.getElementById('extract-btn-icon');
    const btnText = document.getElementById('extract-btn-text');

    const text = (textArea?.value || '').trim();
    const courseHint = courseSelect?.value || '';

    if (!text) {
      showToast('Please paste an announcement text first.');
      return;
    }

    if (btnRunExtract) btnRunExtract.disabled = true;
    if (btnIcon) btnIcon.innerHTML = getSvgIcon('refresh');
    if (btnText) btnText.textContent = 'Analyzing...';
    if (statusBox) {
      statusBox.style.display = 'block';
      statusBox.innerHTML = `
        <div class="extract-status-pill loading">
          <span>${getSvgIcon('bolt', 'mr-1')} Running 3-Tier Hybrid Extraction (Regex + Jev Gatekeeper + Generative AI)...</span>
        </div>
      `;
    }
    if (previewList) previewList.innerHTML = '';

    try {
      const result = await extractAnnouncementHybrid(text, courseHint);

      if (result.rejected) {
        if (statusBox) {
          statusBox.innerHTML = `
            <div class="extract-status-pill rejected">
              <span>${getSvgIcon('urgent', 'mr-1')} ${escapeHtml(result.reason || 'Filtered out as non-assessment.')}</span>
            </div>
          `;
        }
        showToast('Filtered out: No assessment detected in this text.');
        return;
      }

      if (!result.tasks || result.tasks.length === 0) {
        if (statusBox) {
          statusBox.innerHTML = `
            <div class="extract-status-pill error">
              <span>No deadline dates detected in this announcement.</span>
            </div>
          `;
        }
        showToast('No deadlines detected in announcement.');
        return;
      }

      if (statusBox) {
        statusBox.innerHTML = `
          <div class="extract-status-pill success">
            <span>${getSvgIcon('check', 'mr-1')} Found ${result.tasks.length} deadline(s) via ${escapeHtml(result.tier)}!</span>
          </div>
        `;
      }

      if (previewList) {
        previewList.innerHTML = result.tasks.map((task, idx) => {
          const d = new Date(task.dueDate);
          const dateStr = !isNaN(d.getTime()) ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date pending';
          const timeStr = task.hasSpecificTime && !isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Class time';
          return `
            <div class="extract-result-item" id="extract-item-${idx}">
              <div class="extract-result-header">
                <div>
                  <h4 class="extract-result-title">${escapeHtml(task.title)}</h4>
                  <div class="extract-result-meta">
                    <span>${getSvgIcon('book', 'mr-1')} ${escapeHtml(task.courseName)}</span>
                    <span>${getSvgIcon('calendar', 'mr-1')} ${dateStr} at ${timeStr}</span>
                    ${task.room ? `<span class="badge-room-tag">${getSvgIcon('pin', 'mr-1')} ${escapeHtml(task.room)}</span>` : ''}
                    ${task.weightDisplay ? `<span class="badge-weight-tag">${getSvgIcon('scale', 'mr-1')} ${escapeHtml(task.weightDisplay)}</span>` : ''}
                    <span class="badge-jev-tag">${escapeHtml((task.type || 'assignment').toUpperCase())}</span>
                  </div>
                </div>
                <button type="button" class="btn-primary-action btn-add-extracted-item" data-idx="${idx}" style="font-size: 11px; padding: 6px 12px; height: 34px; white-space: nowrap;">
                  <span>${getSvgIcon('plus', 'mr-1')} Add to Deadlines</span>
                </button>
              </div>
              ${task.description ? `<p style="font-size: 11px; color: var(--text-muted); margin-top: 6px; line-height: 1.4;">${escapeHtml(task.description.slice(0, 150))}${task.description.length > 150 ? '...' : ''}</p>` : ''}
            </div>
          `;
        }).join('');

        // Bind Add buttons on preview items
        previewList.querySelectorAll('.btn-add-extracted-item').forEach(addBtn => {
          addBtn.addEventListener('click', async () => {
            const idx = parseInt(addBtn.getAttribute('data-idx'), 10);
            const taskToAdd = result.tasks[idx];
            if (!taskToAdd) return;

            state.tasks.push(taskToAdd);
            await syncToCloudAndLocal();

            addBtn.disabled = true;
            addBtn.innerHTML = `${getSvgIcon('check', 'mr-1')} <span>Added</span>`;
            addBtn.style.background = '#059669';
            addBtn.style.color = '#ffffff';

            showToast(`Added "${taskToAdd.title}" to deadlines!`);
          });
        });
      }
    } catch (err) {
      console.error('Extract announcement error:', err);
      if (statusBox) {
        statusBox.innerHTML = `
          <div class="extract-status-pill error" style="display: inline-flex; align-items: center; gap: 4px;">
            ${getSvgIcon('urgent')}
            <span>Extraction error: ${escapeHtml(err.message || 'Unknown error')}</span>
          </div>
        `;
      }
      showToast('Extraction error: ' + (err.message || 'Failed'));
    } finally {
      if (btnRunExtract) btnRunExtract.disabled = false;
      if (btnIcon) btnIcon.innerHTML = getSvgIcon('bolt');
      if (btnText) btnText.textContent = 'Extract Deadlines';
    }
  });

  // Edit Form Submit
  const editForm = document.getElementById('form-edit-task');
  editForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const taskId = document.getElementById('edit-task-id').value;
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const title = document.getElementById('edit-title').value.trim();
    const course = document.getElementById('edit-course').value.trim();
    const dateVal = document.getElementById('edit-date').value;
    const timeVal = document.getElementById('edit-time').value;
    const roomVal = document.getElementById('edit-room')?.value.trim() || '';
    const type = document.getElementById('edit-type').value;
    const priority = document.getElementById('edit-priority').value;
    const status = document.getElementById('edit-status').value;
    const weightVal = parseFloat(document.getElementById('edit-weight').value);
    const descVal = document.getElementById('edit-desc')?.value.trim() || '';
    const notesVal = document.getElementById('edit-notes')?.value.trim() || '';

    task.title = title;
    task.courseName = course;
    for (const item of PERMANENT_COURSE_LEGEND) {
      if (item.pattern.test(course) || item.name.toLowerCase() === course.toLowerCase()) {
        task.courseCode = item.code;
        break;
      }
    }
    if (timeVal) {
      task.dueDate = new Date(`${dateVal}T${timeVal}:00`).toISOString();
      task.hasSpecificTime = true;
    } else {
      const defaultDate = new Date(`${dateVal}T23:59:00`);
      let appliedSched = false;
      const courseContext = `${course} ${task.courseCode || ''} ${title}`;
      for (const s of STUDENT_CLASS_SCHEDULE) {
        if (s.matcher && s.matcher.test(courseContext)) {
          const parts = s.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
          if (parts) {
            let h = parseInt(parts[1], 10);
            const m = parseInt(parts[2], 10);
            const isPm = parts[3].toUpperCase() === 'PM';
            if (isPm && h < 12) h += 12;
            if (!isPm && h === 12) h = 0;
            defaultDate.setHours(h, m, 0, 0);
            appliedSched = true;
          }
          break;
        }
      }
      task.dueDate = defaultDate.toISOString();
      task.hasSpecificTime = appliedSched;
    }
    const isHwOrProj = type === 'assignment' || type === 'hw' || type === 'project';
    task.room = isHwOrProj ? undefined : (roomVal || undefined);
    task.type = type;
    task.priority = priority;
    task.status = status;
    if (!isNaN(weightVal) && weightVal > 0) {
      task.weight = weightVal;
      task.weightDisplay = `${weightVal}% of Grade`;
      const wRes = resolveTaskWeight(course, title, type, `${descVal} ${notesVal}`);
      task.syllabusNote = wRes.syllabusNote || `${weightVal}% of Grade`;
    } else {
      task.weight = undefined;
      task.weightDisplay = undefined;
      task.syllabusNote = undefined;
    }
    task.description = descVal;
    task.sourceSnippet = descVal;
    task.notes = notesVal;
    task.updatedAt = new Date().toISOString();

    // Re-sort state.tasks by dueDate ascending (earliest first)
    state.tasks.sort(compareTasksByTime);

    closeEditModal();
    enqueueOfflineMutation({ type: 'edit', task });
    await syncToCloudAndLocal();

    // If #day-sheet-drawer is open, refresh #day-sheet-items with the re-sorted tasks for that day
    const dayDrawer = document.getElementById('day-sheet-drawer');
    if (dayDrawer && !dayDrawer.classList.contains('hidden') && dayDrawer.style.display !== 'none') {
      const dayTasks = state.tasks.filter(t => t.dueDate && t.dueDate.startsWith(dateVal));
      dayTasks.sort(compareTasksByTime);
      openDaySheet(dateVal, dayTasks);
    }

    showToast('Deadline updated and synced with Firebase');
  });

  // Delete Task Button with 5-Second Undo
  document.getElementById('btn-delete-task')?.addEventListener('click', async () => {
    const taskId = document.getElementById('edit-task-id').value;
    const taskIndex = state.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;

    const deletedTask = state.tasks[taskIndex];
    state.tasks.splice(taskIndex, 1);
    closeEditModal();

    // Also close day sheet if open
    const dayBackdrop = document.getElementById('day-sheet-backdrop');
    const dayDrawer = document.getElementById('day-sheet-drawer');
    if (dayBackdrop) {
      dayBackdrop.classList.add('hidden');
      dayBackdrop.style.display = 'none';
    }
    if (dayDrawer) {
      dayDrawer.classList.add('hidden');
      dayDrawer.style.display = 'none';
    }

    recordLocalTombstone(taskId);
    enqueueOfflineMutation({ type: 'delete', taskId });
    await syncToCloudAndLocal();

    showToast(
      `Deleted "${deletedTask.title.slice(0, 22)}..."`,
      'Undo',
      async () => {
        removeLocalTombstone(deletedTask.id);
        state.tasks.splice(taskIndex, 0, deletedTask);
        enqueueOfflineMutation({ type: 'add', task: deletedTask });
        await syncToCloudAndLocal();
        showToast('Deadline restored');
      }
    );
  });

  // Add Form Submit
  const addForm = document.getElementById('form-add-task');
  addForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('add-title').value.trim();
    const course = document.getElementById('add-course').value.trim();
    const dateVal = document.getElementById('add-date').value;
    const timeVal = document.getElementById('add-time').value;
    const manualRoom = document.getElementById('add-room')?.value.trim() || '';
    const type = document.getElementById('add-type').value;
    const priority = document.getElementById('add-priority').value;
    const weightVal = parseFloat(document.getElementById('add-weight').value);
    const notes = document.getElementById('add-notes').value.trim();

    let dueDateIso = '';
    let hasSpecificTime = false;
    if (timeVal) {
      dueDateIso = new Date(`${dateVal}T${timeVal}:00`).toISOString();
      hasSpecificTime = true;
    } else {
      const defaultDate = new Date(`${dateVal}T23:59:00`);
      let appliedSched = false;
      const courseContext = `${course} ${title} ${notes}`;
      for (const s of STUDENT_CLASS_SCHEDULE) {
        if (s.matcher && s.matcher.test(courseContext)) {
          const parts = s.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
          if (parts) {
            let h = parseInt(parts[1], 10);
            const m = parseInt(parts[2], 10);
            const isPm = parts[3].toUpperCase() === 'PM';
            if (isPm && h < 12) h += 12;
            if (!isPm && h === 12) h = 0;
            defaultDate.setHours(h, m, 0, 0);
            appliedSched = true;
          }
          break;
        }
      }
      dueDateIso = defaultDate.toISOString();
      hasSpecificTime = appliedSched;
    }

    const isHwOrProj = type === 'assignment' || type === 'hw' || type === 'project';
    const room = isHwOrProj ? undefined : (manualRoom || resolveTaskRoom({
      title,
      courseName: course,
      courseCode: 'UOS',
      type,
      sourceSnippet: notes,
      description: notes
    }) || undefined);

    const resolvedWeight = resolveTaskWeight(course, title, type, notes);
    const finalWeight = !isNaN(weightVal) && weightVal > 0 ? weightVal : resolvedWeight.weight;
    const finalWeightDisplay = !isNaN(weightVal) && weightVal > 0 ? `${weightVal}% of Grade` : resolvedWeight.weightDisplay;
    const finalSyllabusNote = resolvedWeight.syllabusNote;

    const newTask = {
      id: `task_mobile_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title,
      courseName: course,
      courseCode: 'UOS',
      dueDate: dueDateIso,
      hasSpecificTime,
      room,
      type,
      priority,
      status: 'pending',
      weight: finalWeight,
      weightDisplay: finalWeightDisplay,
      syllabusNote: finalSyllabusNote,
      description: notes,
      sourceSnippet: notes,
      extractedBy: 'manual',
      confidence: 1.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    state.selectedDate = dueDateIso.split('T')[0];
    state.tasks.push(newTask);
    state.tasks.sort(compareTasksByTime);
    addForm.reset();
    closeAddModal();
    await syncToCloudAndLocal();
    showToast('New deadline added and synced');
  });
}

function openEditTaskModal(task) {
  const modal = document.getElementById('modal-edit-task');
  if (!modal) return;

  const { courseName, courseCode } = resolveCourseInfo(task);
  document.getElementById('edit-task-id').value = task.id;
  document.getElementById('edit-title').value = task.title || '';
  document.getElementById('edit-course').value = courseName || courseCode || '';

  const due = new Date(task.dueDate);
  if (!isNaN(due.getTime())) {
    const pad = n => String(n).padStart(2, '0');
    const yyyy = due.getFullYear();
    const mm = pad(due.getMonth() + 1);
    const dd = pad(due.getDate());
    document.getElementById('edit-date').value = `${yyyy}-${mm}-${dd}`;

    if (task.hasSpecificTime) {
      const hh = pad(due.getHours());
      const min = pad(due.getMinutes());
      document.getElementById('edit-time').value = `${hh}:${min}`;
    } else {
      document.getElementById('edit-time').value = '';
    }
  }

  const selectedType = task.type || 'assignment';
  document.getElementById('edit-type').value = selectedType;
  document.getElementById('edit-priority').value = task.priority || 'medium';
  document.getElementById('edit-status').value = task.status || 'pending';
  const isHwOrProj = selectedType === 'assignment' || selectedType === 'hw' || selectedType === 'project';
  const editRoom = document.getElementById('edit-room');
  const editRoomGroup = editRoom ? editRoom.closest('.form-group') : null;
  if (editRoomGroup) {
    editRoomGroup.style.display = isHwOrProj ? 'none' : '';
  }
  if (editRoom) editRoom.value = isHwOrProj ? '' : (task.room || '');
  document.getElementById('edit-weight').value = task.weight || '';

  const editWeightHint = document.getElementById('edit-weight-hint');
  if (editWeightHint) {
    if (task.syllabusNote) {
      editWeightHint.innerHTML = `${getSvgIcon('scale', 'mr-1')} <strong>${escapeHtml(task.weightDisplay || '')}</strong>: ${escapeHtml(task.syllabusNote)}`;
      editWeightHint.style.color = 'var(--primary)';
    } else {
      editWeightHint.textContent = '';
    }
  }
  
  const editDesc = document.getElementById('edit-desc');
  if (editDesc) editDesc.value = task.description || task.sourceSnippet || '';
  const editNotes = document.getElementById('edit-notes');
  if (editNotes) editNotes.value = task.notes || '';

  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function closeEditModal() {
  const modal = document.getElementById('modal-edit-task');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
}

function openAddTaskModal(prefilledDate = null) {
  const modal = document.getElementById('modal-add-task');
  if (!modal) return;

  const dateInput = document.getElementById('add-date');
  if (prefilledDate && dateInput) {
    dateInput.value = prefilledDate;
  } else if (dateInput && !dateInput.value) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    dateInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  const addType = document.getElementById('add-type');
  const addTypeValue = addType ? addType.value : 'assignment';
  const isHwOrProj = addTypeValue === 'assignment' || addTypeValue === 'hw' || addTypeValue === 'project';
  const addRoom = document.getElementById('add-room');
  const addRoomGroup = addRoom ? addRoom.closest('.form-group') : null;
  if (addRoomGroup) {
    addRoomGroup.style.display = isHwOrProj ? 'none' : '';
  }
  if (addRoom) addRoom.value = '';

  const addWeight = document.getElementById('add-weight');
  if (addWeight) addWeight.value = '';
  const addWeightHint = document.getElementById('add-weight-hint');
  if (addWeightHint) addWeightHint.textContent = '';

  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function closeAddModal() {
  const modal = document.getElementById('modal-add-task');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
}

let activeRoomPickerTaskId = null;

function openRoomPicker(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  activeRoomPickerTaskId = taskId;

  const modal = document.getElementById('modal-room-picker');
  const presetsContainer = document.getElementById('room-presets-container');
  const customInput = document.getElementById('input-custom-room');
  if (!modal || !presetsContainer) return;

  const currentRoom = (task.room || '').trim();
  if (customInput) customInput.value = currentRoom;

  // Render presets from STUDENT_CLASS_SCHEDULE
  presetsContainer.innerHTML = STUDENT_CLASS_SCHEDULE.map(s => {
    const isCurrent = currentRoom.toLowerCase() === s.room.toLowerCase();
    return `
      <button type="button" class="room-preset-btn ${isCurrent ? 'is-active' : ''}" data-room="${escapeHtml(s.room)}">
        <div class="room-preset-left">
          <span class="room-preset-code">${getSvgIcon('pin', 'mr-1')} ${escapeHtml(s.room)}</span>
          <span class="room-preset-course">${escapeHtml(s.courseName)}</span>
        </div>
        ${isCurrent ? '<span style="color:#4338ca; font-size:12px; font-weight:700;">✓ Current</span>' : '<span style="color:var(--text-muted); font-size:12px;">Select</span>'}
      </button>
    `;
  }).join('');

  // Bind clicks on presets
  presetsContainer.querySelectorAll('.room-preset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const selectedRoom = btn.getAttribute('data-room');
      await applyRoomChange(taskId, selectedRoom);
      closeRoomPicker();
    });
  });

  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function closeRoomPicker() {
  const modal = document.getElementById('modal-room-picker');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
  activeRoomPickerTaskId = null;
}

async function applyRoomChange(taskId, newRoom) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  const cleanedRoom = (newRoom || '').trim();
  task.room = cleanedRoom || undefined;
  task.updatedAt = new Date().toISOString();

  await syncToCloudAndLocal();
  showToast(`Room updated to "${cleanedRoom || 'None'}" and synced`);
}

function openReadingSheet(task) {
  const modal = document.getElementById('modal-reading-sheet');
  const badgeGroup = document.getElementById('reading-modal-badges');
  const content = document.getElementById('reading-modal-content');
  if (!modal || !badgeGroup || !content) return;

  const { courseName, courseCode } = resolveCourseInfo(task);
  const courseTheme = getCourseColorTheme(courseName, courseCode, task.title);
  const isCompleted = task.status === 'completed';
  const countdown = formatCountdown(task.dueDate, task.hasSpecificTime, task.status);
  const typeIcon = getTaskTypeIcon(task.type);
  const typeLabel = (task.type || 'assignment').toUpperCase();
  const gcalUrl = createGoogleCalendarUrl(task);

  const fullAnnouncement = (task.description || task.sourceSnippet || '').trim();
  const hasAnnouncement = fullAnnouncement && !fullAnnouncement.startsWith('Blackboard Ultra Stream item');

  const isHwOrProj = task.type === 'assignment' || task.type === 'hw' || task.type === 'project';

  badgeGroup.innerHTML = `
    <div class="course-badge-main" style="background: ${courseTheme.bgLight}; border: 1px solid ${courseTheme.border}; color: ${courseTheme.textDark};">
      <span class="course-color-dot" style="background: ${courseTheme.hex};"></span>
      <span class="course-name-text">${escapeHtml(courseName)}</span>
      ${courseCode && courseCode.toLowerCase() !== 'uos' ? `<span class="course-code-tag" style="color: ${courseTheme.textDark};">${escapeHtml(courseCode)}</span>` : ''}
    </div>
    <span class="type-pill type-${task.type || 'assignment'}">
      <span>${typeIcon}</span>
      <span>${typeLabel}</span>
    </span>
  `;

  content.innerHTML = `
    <h2 class="reading-pane-title">${escapeHtml(task.title)}</h2>

    <div class="reading-meta-section">
      <span class="urgency-badge ${countdown.urgency}">
        ${countdown.urgency === 'completed'
          ? `${getSvgIcon('check', 'mr-1')} ${escapeHtml(countdown.label)}`
          : (countdown.urgency === 'overdue' ? `${getSvgIcon('urgent', 'mr-1')} ${escapeHtml(countdown.label)}` : `${getSvgIcon('clock', 'mr-1')} ${escapeHtml(countdown.label)}`)}
      </span>
      ${!isHwOrProj ? `
      <button type="button" class="room-pill-btn modal-reading-room-btn" data-task-id="${task.id}">
        <span>${getSvgIcon('pin', 'mr-1')} ${escapeHtml(task.room || 'No room set')}</span>
        <span class="room-edit-hint">${getSvgIcon('pencil')}</span>
      </button>
      ` : ''}
      ${task.weightDisplay || task.weight ? `<span class="task-weight-pill weight-major">${getSvgIcon('scale', 'mr-1')} ${escapeHtml(task.weightDisplay || `${task.weight}%`)}</span>` : ''}
    </div>

    <div class="reading-announcement-box">
      <div class="reading-box-header">
        <span class="reading-box-title">
          <span>${getSvgIcon('message', 'mr-1')}</span>
          <span>Doctor Announcement</span>
        </span>
        ${hasAnnouncement ? `
          <button type="button" class="btn-copy-announcement" id="btn-copy-drawer-text">
            <span>${getSvgIcon('copy', 'mr-1')} Copy</span>
          </button>
        ` : ''}
      </div>
      <div class="reading-box-content" style="max-height: 50vh; overflow-y: auto;">
        ${hasAnnouncement ? escapeHtml(fullAnnouncement) : '<span style="color: var(--text-muted);">No detailed announcement text available.</span>'}
      </div>
    </div>

    <!-- Student Personal Notes -->
    ${task.notes && task.notes.trim() ? `
      <div class="reading-notes-box" style="margin-top: 12px; padding: 12px 14px; background: rgba(59, 130, 246, 0.08); border-left: 3px solid #3b82f6; border-radius: var(--radius-sm);">
        <div style="font-size: 12px; font-weight: 700; color: #2563eb; display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
          ${getSvgIcon('pencil')}
          <span>Student Personal Notes</span>
        </div>
        <div style="font-size: 13px; color: var(--text-main); white-space: pre-wrap; line-height: 1.5;">${escapeHtml(task.notes)}</div>
      </div>
    ` : ''}

    <div class="reading-actions-bar">
      <button type="button" class="btn-primary-action modal-reading-toggle-btn" style="flex: 1; min-height: 44px;">
        ${isCompleted ? `${getSvgIcon('refresh', 'mr-1')} Mark Pending` : `${getSvgIcon('check', 'mr-1')} Mark Done`}
      </button>
      <button type="button" class="btn-outline-action modal-reading-share-btn" style="min-height: 44px; padding: 0 12px;">
        <span>${getSvgIcon('share', 'mr-1')} Share</span>
      </button>
      <a class="btn-outline-action" href="${gcalUrl}" target="_blank" rel="noopener noreferrer" style="min-height: 44px; display: inline-flex; align-items: center; text-decoration: none; padding: 0 12px;">
        <span>${getSvgIcon('calendar', 'mr-1')} Calendar</span>
      </a>
      <button type="button" class="btn-outline-action modal-reading-edit-btn" style="min-height: 44px; padding: 0 12px;">
        <span>${getSvgIcon('pencil', 'mr-1')} Edit</span>
      </button>
    </div>
  `;

  modal.style.display = 'flex';
  modal.classList.remove('hidden');

  // Bind inside drawer
  const copyDrawer = document.getElementById('btn-copy-drawer-text');
  if (copyDrawer && hasAnnouncement) {
    copyDrawer.onclick = async () => {
      try {
        await navigator.clipboard.writeText(fullAnnouncement);
        showToast('Announcement text copied!');
      } catch (e) {
        showToast('Could not copy text.');
      }
    };
  }

  content.querySelector('.modal-reading-share-btn')?.addEventListener('click', () => {
    shareTaskDetails(task);
  });

  content.querySelector('.modal-reading-room-btn')?.addEventListener('click', () => {
    closeReadingSheet();
    openRoomPicker(task.id);
  });

  content.querySelector('.modal-reading-edit-btn')?.addEventListener('click', () => {
    closeReadingSheet();
    openEditTaskModal(task);
  });

  content.querySelector('.modal-reading-toggle-btn')?.addEventListener('click', async () => {
    const prevStatus = task.status;
    const newStatus = prevStatus === 'completed' ? 'pending' : 'completed';
    task.status = newStatus;
    task.updatedAt = new Date().toISOString();
    closeReadingSheet();

    enqueueOfflineMutation({ type: 'status', taskId: task.id, status: newStatus });
    await syncToCloudAndLocal();

    showToast(
      newStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
      'Undo',
      async () => {
        task.status = prevStatus;
        task.updatedAt = new Date().toISOString();
        enqueueOfflineMutation({ type: 'status', taskId: task.id, status: prevStatus });
        await syncToCloudAndLocal();
        showToast('Status reverted');
      }
    );
  });
}

function closeReadingSheet() {
  const modal = document.getElementById('modal-reading-sheet');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
}

async function syncToCloudAndLocal() {
  state.tasks = (state.tasks || []).filter(isValidTask);
  state.tasks.sort(compareTasksByTime);
  state.lastSync = new Date().toISOString();
  localStorage.setItem('bbs_mobile_tasks', JSON.stringify(state.tasks));
  localStorage.setItem('bbs_mobile_last_sync', state.lastSync);
  if (state.quickLinks && state.quickLinks.length > 0) {
    localStorage.setItem('bbs_quick_links', JSON.stringify(state.quickLinks));
  }

  updateAllViews();
  updateSyncBanner();
  syncTasksToServiceWorker();
  checkUpcomingDeadlines(false);

  const tombstones = getLocalTombstones();
  const payload = {
    tasks: state.tasks,
    quickLinks: state.quickLinks,
    lastSync: state.lastSync,
    device: 'Mobile Web App',
    count: state.tasks.length,
    syncKey: getSyncKey() || undefined,
    tombstones: Object.keys(tombstones).length > 0 ? tombstones : undefined
  };

  let cloudOk = false;
  try {
    const fbUrl = getFirebaseDataUrl();
    const fbRes = await fetch(fbUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    cloudOk = fbRes.ok;

    const activeKey = getSyncKey();
    if (activeKey && fbUrl !== `${FIREBASE_DB_URL}/data.json`) {
      await fetch(`${FIREBASE_DB_URL}/data.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('Firebase sync PUT error:', err);
  }

  try {
    const activeKey = getSyncKey();
    const edgeSyncUrl = activeKey ? `/api/sync?key=${encodeURIComponent(activeKey)}` : '/api/sync';
    await fetch(edgeSyncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(activeKey ? { 'x-sync-key': activeKey } : {}) },
      body: JSON.stringify(payload)
    });
  } catch (err) {}

  try {
    const syncChannel = new BroadcastChannel('bbs_sync_channel');
    syncChannel.postMessage({ type: 'TASKS_UPDATED', timestamp: Date.now() });
    syncChannel.close();
  } catch (err) {}

  if (cloudOk) clearOfflineMutations();
  return cloudOk;
}

