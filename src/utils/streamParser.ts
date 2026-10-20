import { DeadlineTask, TaskType } from '../types';
import { parseCourseDetails } from './courseHelper';
import { resolveTaskWeight } from './syllabusWeights';

/**
 * Parses direct deadline cards from Blackboard Ultra activity stream timeline.
 * Example card text from user:
 * "Calculus I for Engineering - 02 - حسبان 1 للمهندسين
 * Due: Assignment-1-Graded
 * Due Date: 9/18/26, 11:59 PM (UTC+4)"
 */
export function parseDirectStreamCard(cardText: string): DeadlineTask | null {
  if (!cardText) return null;

  // 1. Skip submission receipts, confirmation cards, and grade posted alerts
  if (/(?:you\s+submitted|submission\s+(?:receipt|confirmed)|attempt\s+submitted|تم\s+التسليم|تم\s+إرسال|confirmation\s*number|grade\s+posted|score\s+posted|تم\s+نشر\s+الدرجة|تم\s+رصد\s+الدرجة)/i.test(cardText)) {
    return null;
  }

  // Regex for "Due Date: 9/18/26, 11:59 PM (UTC+4)" or Arabic equivalent
  const dueDateRegex = /(?:Due Date:\s*|تاريخ الاستحقاق:\s*)(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s*(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s*\((?:UTC)?([+-]?\d+)?\))?/i;
  const dateMatch = cardText.match(dueDateRegex);
  if (!dateMatch) return null;

  let month = parseInt(dateMatch[1], 10);
  let day = parseInt(dateMatch[2], 10);
  let year = parseInt(dateMatch[3], 10);
  if (year < 100) year += 2000;
  let hour = parseInt(dateMatch[4], 10);
  let minute = parseInt(dateMatch[5], 10);
  const isPm = dateMatch[6].toUpperCase() === 'PM';
  if (isPm && hour < 12) hour += 12;
  if (!isPm && hour === 12) hour = 0;

  const dueDate = new Date(year, month - 1, day, hour, minute, 0, 0);

  // Extract task title: "Due: <Title>" or "تسليم: <Title>"
  const dueRegex = /(?:Due:\s*|تسليم:\s*)([^\n\r]+)/i;
  const dueMatch = cardText.match(dueRegex);
  let title = dueMatch ? dueMatch[1].trim() : '';

  // Extract course line (usually before "Due:")
  const lines = cardText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let rawCourseText = '';
  const dueIndex = lines.findIndex(l => /(?:Due:|تسليم:)/i.test(l));
  if (dueIndex > 0) {
    const candidate = lines[dueIndex - 1];
    if (!/(?:Due\s*Date|تاريخ\s*الاستحقاق|\d{1,2}\/\d{1,2}\/\d{2,4})/i.test(candidate)) {
      rawCourseText = candidate;
    }
  } else if (lines.length > 0 && !/(?:Due:|تسليم:|Due\s*Date|تاريخ\s*الاستحقاق|\d{1,2}\/\d{1,2}\/\d{2,4})/i.test(lines[0])) {
    rawCourseText = lines[0];
  }

  // If title was not after "Due:", extract meaningful lab/assignment name from cardText
  if (!title) {
    if (/measuring\s*density/i.test(cardText)) {
      title = 'Measuring Density - Lab Report';
    } else if (/free\s*fall/i.test(cardText)) {
      title = 'Free Fall Exp. - Lab Report';
    } else if (/lab\.?\s*report/i.test(cardText)) {
      const match = cardText.match(/([^\n\r,]+(?:Lab\.?\s*Report|Exp\.?))/i);
      title = match ? match[1].trim() : 'Lab Report';
    }
  }

  // Sanitize title: strip "Due in 2 days", "Reminder:", etc.
  if (title) {
    title = title.replace(/^(?:due\s*(?:in|date)?|reminder|announcement)[:\s-]*/i, '').trim();
  }

  const courseInfo = parseCourseDetails(rawCourseText);

  // If title is missing or generic (e.g. "Assignment", "Due in...", "Untitled") AND course is generic, discard!
  const isGenericTitle = !title || /^(?:assignment|due(?:\s+in.*)?|untitled|reminder|activity|announcement)$/i.test(title);
  const isGenericCourse = !courseInfo.name || 
                          courseInfo.name === 'General Course' || 
                          courseInfo.name.toLowerCase() === 'uos' ||
                          /^due[:\s-]/i.test(courseInfo.name);
  if (isGenericTitle && isGenericCourse) {
    return null;
  }

  if (!title) {
    title = 'Assignment';
  }

  // Identify type
  let type: TaskType = 'assignment';
  if (/quiz|كويز/i.test(title)) type = 'quiz';
  else if (/exam|midterm|final|امتحان/i.test(title)) type = 'exam';
  else if (/project|مشروع|بحث/i.test(title)) type = 'project';
  else if (/hw|homework|واجب/i.test(title)) type = 'assignment';

  const cleanCourseCode = (courseInfo.code && courseInfo.code !== 'UOS') ? courseInfo.code : '';
  const taskId = `stream_${cleanCourseCode || 'task'}_${title.slice(0, 15).replace(/\s+/g, '')}_${dueDate.getTime()}`;

  const weightInfo = resolveTaskWeight({
    title,
    courseName: courseInfo.name,
    courseCode: cleanCourseCode,
    type,
    sourceSnippet: dateMatch[0]
  });

  return {
    id: taskId,
    courseCode: cleanCourseCode,
    courseName: courseInfo.name,
    title,
    description: '',
    dueDate: dueDate.toISOString(),
    hasSpecificTime: true,
    type,
    priority: 'high',
    status: 'pending',
    sourceSnippet: dateMatch[0],
    confidence: 1.0,
    extractedBy: 'local',
    weight: weightInfo.weight,
    weightDisplay: weightInfo.weightDisplay,
    syllabusNote: weightInfo.syllabusNote,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Parses submission confirmations or grade notification cards from the activity stream.
 * Converts receipts and posted scores into structured TaskSubmissionUpdate objects.
 */
export function parseSubmissionOrGradeCard(cardText: string): import('../types').TaskSubmissionUpdate | null {
  if (!cardText || cardText.length < 5) return null;

  const isSubmission = /(?:you\s+submitted|submission\s+(?:receipt|confirmed)|attempt\s+submitted|تم\s+التسليم|تم\s+إرسال|confirmation\s*number)/i.test(cardText);
  const isGraded = /(?:grade\s+posted|score\s+posted|graded|new\s+grade|grades\s+available|grades\s+released|تم\s+نشر\s+الدرجة|تم\s+رصد\s+الدرجة|درجة\s+جديدة|تم\s+تقييم)/i.test(cardText) ||
    /^\s*["']?\s*\.?\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*["']?\s*$/m.test(cardText);

  if (!isSubmission && !isGraded) return null;

  const lines = cardText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const courseLine = lines[0];
  const { name: courseName, code: courseCode } = parseCourseDetails(courseLine);

  let title = '';
  if (lines.length >= 2) {
    title = lines[1]
      .replace(/^(?:due:\s*|graded:\s*|you\s+submitted\s*|assignment:\s*)/i, '')
      .replace(/^(?:تسليم:\s*|تم\s+رصد\s*)/i, '')
      .trim();
  }

  // Look for score fraction: e.g. "9.5 / 10", ".25 / 10", "10/10"
  // Must avoid calendar date fractions like 10/12/26 or 9/18/26
  const fractionMatch = cardText.match(/(?:grade|score|mark|pts?|points?|درجة|علامة)[:\s]*(\.?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?!\s*[\/\-]\s*\d{2,4})/i) ||
    cardText.match(/^\s*["']?\s*(\.?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*["']?\s*$/m) ||
    cardText.match(/\b(\.?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(?:pts?|points?|marks?|درجة)(?!\s*[\/\-]\s*\d{2,4})/i);
  let score: number | undefined;
  let maxScore: number | undefined;
  let scoreDisplay: string | undefined;

  if (fractionMatch) {
    score = parseFloat(fractionMatch[1]);
    maxScore = parseFloat(fractionMatch[2]);
    if (!isNaN(score) && !isNaN(maxScore) && maxScore > 0) {
      const pct = Math.round((score / maxScore) * 100);
      scoreDisplay = `${score} / ${maxScore} (${pct}%)`;
    }
  }

  // Look for percentage: e.g. "95%"
  if (score === undefined) {
    const pctMatch = cardText.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pctMatch) {
      score = parseFloat(pctMatch[1]);
      maxScore = 100;
      scoreDisplay = `${score}%`;
    }
  }

  // Look for confirmation receipt
  const receiptMatch = cardText.match(/confirmation\s*(?:number|#)?[:\s]*([#\w-]+)/i);
  const receipt = receiptMatch ? receiptMatch[1] : undefined;

  // Look for submitted date
  const dateMatch = cardText.match(/(?:submitted\s+(?:on\s+)?|تم\s+التسليم\s+في\s+)(\d{1,2}\/\d{1,2}\/\d{2,4}(?:[,\s]+\d{1,2}:\d{2}(?:\s*[AP]M)?)?)/i);
  const submittedAt = dateMatch ? dateMatch[1] : undefined;

  if (score !== undefined || (isGraded && !isSubmission)) {
    return {
      courseName: courseName !== 'General Course' ? courseName : undefined,
      courseCode: (courseCode && courseCode !== 'UOS') ? courseCode : undefined,
      title: title || 'Assignment',
      submissionStatus: 'graded',
      score,
      maxScore,
      scoreDisplay: scoreDisplay || (score !== undefined ? `${score} pts` : undefined),
      submittedAt,
      submissionReceipt: receipt
    };
  }

  if (isSubmission) {
    return {
      courseName: courseName !== 'General Course' ? courseName : undefined,
      courseCode: (courseCode && courseCode !== 'UOS') ? courseCode : undefined,
      title: title || 'Assignment',
      submissionStatus: 'submitted',
      submittedAt,
      submissionReceipt: receipt
    };
  }

  return null;
}
