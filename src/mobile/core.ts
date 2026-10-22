/**
 * Shared logic for the phone web app (mobile-web/).
 *
 * The web app is plain JavaScript served without a build step, so scripts/build.js bundles this
 * file into mobile-web/core.js, which exposes everything below as `window.BBCore`. The extension
 * and the web app therefore run the same course matching, weights, rooms, merging and extraction
 * code instead of keeping copies that drift apart.
 */
import type { Announcement, UserSettings } from '../types';
import { sanitizeCloudTasks, sanitizeCloudQuickLinks, sanitizeCloudCourses, safeHexColor, isSafeCloudId } from '../utils/cloudSanitize';
import {
  compileCoursePattern,
  compileSyllabusComponentMatcher,
  DEFAULT_USER_COURSES,
  setActiveUserCourses,
  getActiveUserCourses,
  getActiveScheduleEntries,
  getActiveSyllabi,
  getActiveCourseLegend
} from '../core/userCourses';
import { filterCleanUserCourses } from '../core/courseFilter';
import { extractRoomFromText, resolveTaskRoom, findCourseSchedule, resolveTaskTimeWithSchedule } from '../core/courseSchedule';
import { resolveTaskWeight, extractExplicitPoints, extractAssessmentNumber } from '../core/syllabusWeights';
import { buildMarksSummary, marksSummaryHtml, marksBadgeText, formatScore } from '../utils/marks';
import { buildSyllabusProgress, syllabusProgressHtml } from '../utils/syllabusProgress';
import {
  sanitizeDoctorAnnouncementText,
  resolveCourseInfo,
  isValidTask,
  matchesSelectedCourseFilter,
  isBlackboardSystemNoise,
  hasValidAcademicCourseCode
} from '../core/courseHelper';
import { getCourseHex, getCourseColorTheme } from '../core/courseColors';
import {
  normalizeAssessmentType,
  getTaskSeriesInfo,
  areTasksDuplicates,
  mergeDuplicatePair,
  deduplicateTaskList,
  mergeTombstones
} from '../utils/taskMerge';
import { createGoogleCalendarUrl, generateIcsContent, formatCountdown, getTaskSortTimestamp, compareTasksByTime } from '../utils/calendar';
import { extractDeadlinesHybridDetailed, HybridExtractionResult } from '../engine/hybridExtractor';

type AiSettings = Pick<UserSettings, 'useAiExtraction' | 'openRouterApiKey' | 'openRouterModel' | 'useJevClassification' | 'jevApiKey'>;

/**
 * Runs the extension's extraction pipeline on text pasted into the web app.
 * Without a course hint, the course is detected from the text the same way stored tasks are resolved.
 */
async function extractFromText(text: string, courseHint: string, settings: AiSettings): Promise<HybridExtractionResult> {
  const body = (text || '').trim();
  if (!body) return { tasks: [], tier: 'Tier 1: Local Regex' };

  let courseName = (courseHint || '').trim();
  let courseCode = '';
  if (!courseName) {
    const detected = resolveCourseInfo({ title: body.slice(0, 200), description: body });
    if (detected.courseName !== 'General Course') {
      courseName = detected.courseName;
      courseCode = detected.courseCode;
    }
  }

  const now = new Date().toISOString();
  const announcement: Announcement = {
    id: `pasted_${Date.now()}`,
    courseCode,
    courseName,
    title: '',
    contentText: body,
    postedAt: now,
    sourceUrl: '',
    scannedAt: now
  };
  return extractDeadlinesHybridDetailed(announcement, settings);
}

const BBCore = {
  // Cloud data checks
  sanitizeCloudTasks,
  sanitizeCloudQuickLinks,
  sanitizeCloudCourses,
  safeHexColor,
  isSafeCloudId,

  // Courses, schedule and syllabus
  DEFAULT_USER_COURSES,
  compileCoursePattern,
  compileSyllabusComponentMatcher,
  filterCleanUserCourses,
  setActiveUserCourses,
  getActiveUserCourses,
  getActiveScheduleEntries,
  getActiveSyllabi,
  getActiveCourseLegend,
  isBlackboardSystemNoise,
  hasValidAcademicCourseCode,
  resolveCourseInfo,
  matchesSelectedCourseFilter,
  getCourseHex,
  getCourseColorTheme,
  findCourseSchedule,
  resolveTaskTimeWithSchedule,

  // Rooms, weights and text cleanup
  extractRoomFromText,
  resolveTaskRoom,
  resolveTaskWeight,
  buildMarksSummary,
  marksSummaryHtml,
  marksBadgeText,
  formatScore,
  buildSyllabusProgress,
  syllabusProgressHtml,
  extractExplicitPoints,
  extractAssessmentNumber,
  sanitizeDoctorAnnouncementText,

  // Task lists
  isValidTask,
  normalizeAssessmentType,
  getTaskSeriesInfo,
  areTasksDuplicates,
  mergeDuplicatePair,
  deduplicateTaskList,
  mergeTombstones,

  // Calendar
  createGoogleCalendarUrl,
  generateIcsContent,
  formatCountdown,
  getTaskSortTimestamp,
  compareTasksByTime,

  // Extraction
  extractFromText
};

(globalThis as any).BBCore = BBCore;

export default BBCore;
