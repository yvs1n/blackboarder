/**
 * RFC 5545 iCalendar (.ics) Feed Generator
 * Generates standards-compliant iCalendar feeds for Apple Calendar, Google Calendar, and Outlook.
 */

/**
 * Escapes characters for iCalendar text values (RFC 5545 Section 3.3.11)
 * @param {string} text
 * @returns {string}
 */
function escapeIcsText(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

/**
 * Formats a Date object to RFC 5545 UTC timestamp format (YYYYMMDDTHHmmssZ)
 * @param {Date} date
 * @returns {string}
 */
function formatUtcTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Formats a Date object to RFC 5545 Date only format (YYYYMMDD)
 * @param {Date} date
 * @returns {string}
 */
function formatDateOnly(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return `${year}${month}${day}`;
}

/**
 * Generates an RFC 5545 .ics calendar feed string from an array of DeadlineTask objects.
 * @param {Array<Object>} tasks - List of deadline tasks
 * @param {Object} options - Additional calendar metadata options
 * @returns {string} Standards-compliant .ics string
 */
function generateIcsFeed(tasks = [], options = {}) {
  const calName = options.calendarName || 'Blackboard Deadlines (UOS)';
  const calDesc = options.description || 'Live automated deadline and exam feed from Blackboarder';
  const now = new Date();
  const nowUtc = formatUtcTimestamp(now);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Blackboarder//UOS Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
    `X-WR-CALDESC:${escapeIcsText(calDesc)}`,
    'X-WR-TIMEZONE:Asia/Dubai',
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H'
  ];

  for (const task of tasks) {
    if (!task || !task.dueDate) continue;

    // Filter out dismissed tasks if specified, keep completed or pending
    if (task.status === 'dismissed') continue;

    const dueDate = new Date(task.dueDate);
    if (isNaN(dueDate.getTime())) continue;

    const uid = `bbs-${task.id || Math.random().toString(36).substring(2)}@blackboarder`;

    // Resolve clean course label for Google/Apple Calendar summary
    let courseLabel = '';
    const rawName = (task.courseName || '').trim();
    const rawCode = (task.courseCode || '').trim();

    if (rawCode && !/^uos$/i.test(rawCode)) {
      courseLabel = rawCode;
    } else if (rawName && !/^uos$/i.test(rawName) && !/^general course$/i.test(rawName)) {
      if (/calculus|calc/i.test(rawName)) courseLabel = 'Calculus 1';
      else if (/intro.*comp|computer.*eng/i.test(rawName)) courseLabel = 'Intro to Comp Eng';
      else if (/phys(?:ics)?.*lab|lab.*phys|measuring density|free fall/i.test(rawName)) courseLabel = 'Physics 1 Lab';
      else if (/phys(?:ics)?\s*1/i.test(rawName)) courseLabel = 'Physics 1';
      else if (/english|eap/i.test(rawName)) courseLabel = 'English';
      else if (/islamic/i.test(rawName)) courseLabel = 'Islamic Culture';
      else courseLabel = rawName.split(/\s*[-–—|]\s*/)[0].trim();
    }

    // Refine title if generic 'Assignment'
    let taskTitle = task.title || 'Academic Task';
    if (taskTitle === 'Assignment') {
      if (/measuring\s*density/i.test(rawName)) taskTitle = 'Measuring Density - Lab Report';
      else if (/free\s*fall/i.test(rawName)) taskTitle = 'Free Fall Exp. - Lab Report';
    }

    const summary = courseLabel ? `[${courseLabel}] ${taskTitle}` : taskTitle;

    // Build rich description
    const descParts = [];
    if (task.courseName) {
      descParts.push(`Course: ${task.courseName} (${task.courseCode || ''})`);
    }
    if (task.weightDisplay || task.weight) {
      descParts.push(`Weight: ${task.weightDisplay || `${task.weight}% of Grade`}`);
    }
    if (task.syllabusNote) {
      descParts.push(`Syllabus Note: ${task.syllabusNote}`);
    }
    if (task.room) {
      descParts.push(`Room: ${task.room}`);
    }
    if (task.status === 'completed') {
      descParts.push('Status: Completed');
    } else {
      descParts.push('Status: Pending');
    }
    if (task.notes) {
      descParts.push(`Student Notes: ${task.notes}`);
    }
    const announcement = task.sourceSnippet || task.description;
    if (announcement) {
      descParts.push(`\nDoctor's Announcement:\n"${announcement}"`);
    }

    const description = descParts.join('\n');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${nowUtc}`);

    if (task.hasSpecificTime) {
      // Event with specific time
      const startDate = dueDate;
      // Default duration: 1 hour if not specified
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
      lines.push(`DTSTART:${formatUtcTimestamp(startDate)}`);
      lines.push(`DTEND:${formatUtcTimestamp(endDate)}`);
    } else {
      // All day event: DTSTART and DTEND using DATE format
      const startDateStr = formatDateOnly(dueDate);
      const nextDay = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() + 1);
      const endDateStr = formatDateOnly(nextDay);
      lines.push(`DTSTART;VALUE=DATE:${startDateStr}`);
      lines.push(`DTEND;VALUE=DATE:${endDateStr}`);
    }

    lines.push(`SUMMARY:${escapeIcsText(summary)}`);
    if (task.room) {
      lines.push(`LOCATION:${escapeIcsText(task.room)}`);
    }
    lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    
    // Status
    if (task.status === 'completed') {
      lines.push('STATUS:COMPLETED');
    } else {
      lines.push('STATUS:CONFIRMED');
    }

    // Categories
    const category = (task.type || 'assignment').toUpperCase();
    lines.push(`CATEGORIES:${escapeIcsText(category)}`);

    // Priority mapping (1=High, 5=Medium, 9=Low)
    if (task.priority === 'high') {
      lines.push('PRIORITY:1');
    } else if (task.priority === 'low') {
      lines.push('PRIORITY:9');
    } else {
      lines.push('PRIORITY:5');
    }

    // Alarms (VALARM): 24 hours before and 2 hours before
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:${escapeIcsText(`Upcoming: ${summary}`)}`);
    lines.push('TRIGGER:-P1D'); // 1 day before
    lines.push('END:VALARM');

    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:${escapeIcsText(`Due in 2 hours: ${summary}`)}`);
    lines.push('TRIGGER:-PT2H'); // 2 hours before
    lines.push('END:VALARM');

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export {
  generateIcsFeed,
  escapeIcsText,
  formatUtcTimestamp,
  formatDateOnly
};
