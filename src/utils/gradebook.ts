import { DeadlineTask, TaskSubmissionUpdate } from '../types';
import { findTaskForUpdate } from './streamParser';

/** One gradebook column as Ultra's /learn/api/v1/courses/{id}/gradebook/columns returns it. */
export interface GradebookColumn {
  id: string;
  columnName?: string;
  effectiveColumnName?: string;
  possible?: number;
  calculationType?: string;
  scoreProviderHandle?: string;
  visible?: boolean;
  gradesReleased?: boolean;
}

/** One of the student's grades from /learn/api/v1/courses/{id}/gradebook/grades?userId=... */
export interface GradebookGrade {
  columnId: string;
  status?: string;
  pointsPossible?: number;
  effectiveScore?: number;
  displayGrade?: { score?: number; text?: string } | null;
  isExempt?: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Gradebook names come HTML-escaped ("3 &amp; 4"); task titles do not. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Turns a course's gradebook into mark updates for its deadlines. Totals, attendance and
 * hidden or unreleased columns are skipped; work waiting to be marked counts as submitted.
 */
export function gradebookToUpdates(
  columns: GradebookColumn[],
  grades: GradebookGrade[],
  course: { courseName?: string; courseCode?: string }
): TaskSubmissionUpdate[] {
  const byId = new Map(columns.map(c => [c.id, c]));
  const updates: TaskSubmissionUpdate[] = [];

  for (const g of grades) {
    const col = byId.get(g.columnId);
    if (!col || col.visible === false || col.gradesReleased === false) continue;
    if (col.calculationType && col.calculationType !== 'NON_CALCULATED') continue;
    if ((col.scoreProviderHandle || '').includes('attendance')) continue;
    if (g.isExempt) continue;
    const title = decodeEntities(col.effectiveColumnName || col.columnName || '').trim();
    if (!title) continue;

    const base = {
      courseName: course.courseName || undefined,
      courseCode: course.courseCode && course.courseCode !== 'UOS' ? course.courseCode : undefined,
      title
    };

    const raw = typeof g.displayGrade?.score === 'number' ? g.displayGrade.score : g.effectiveScore;
    if (g.status === 'GRADED' && typeof raw === 'number' && !isNaN(raw)) {
      const score = round(raw);
      const max = g.pointsPossible || col.possible;
      const maxScore = typeof max === 'number' && max > 0 ? round(max) : undefined;
      updates.push({
        ...base,
        submissionStatus: 'graded',
        score,
        maxScore,
        scoreDisplay: maxScore ? `${score} / ${maxScore} (${Math.round((score / maxScore) * 100)}%)` : `${score} pts`
      });
    } else if (g.status === 'NEEDS_GRADING') {
      updates.push({ ...base, submissionStatus: 'submitted' });
    }
  }
  return updates;
}

/**
 * Puts marks and submissions on their tasks. A task is only touched (and its updatedAt
 * bumped, which triggers a sync) when something actually changed. Returns how many marks
 * were added or changed.
 */
export function applySubmissionUpdates(tasks: DeadlineTask[], updates: TaskSubmissionUpdate[]): number {
  let marksChanged = 0;
  const now = new Date().toISOString();
  for (const update of updates) {
    const match = findTaskForUpdate(tasks, update);
    if (!match) continue;
    if (update.submissionStatus === 'graded') {
      const changed = match.submissionStatus !== 'graded' ||
        (update.score !== undefined && match.score !== update.score) ||
        (update.maxScore !== undefined && match.maxScore !== update.maxScore) ||
        (!!update.scoreDisplay && match.scoreDisplay !== update.scoreDisplay);
      if (!changed) continue;
      match.submissionStatus = 'graded';
      if (update.score !== undefined) match.score = update.score;
      if (update.maxScore !== undefined) match.maxScore = update.maxScore;
      if (update.scoreDisplay) match.scoreDisplay = update.scoreDisplay;
      match.status = 'completed';
      match.updatedAt = now;
      marksChanged++;
    } else if (update.submissionStatus === 'submitted' && match.submissionStatus !== 'graded' && match.submissionStatus !== 'submitted') {
      match.submissionStatus = 'submitted';
      if (update.submittedAt) match.submittedAt = update.submittedAt;
      if (update.submissionReceipt) match.submissionReceipt = update.submissionReceipt;
      match.status = 'completed';
      match.updatedAt = now;
    }
  }
  return marksChanged;
}
