import { Announcement, DeadlineTask, UserSettings } from '../types';
import { extractDeadlinesLocally } from './localExtractor';
import { extractDeadlinesWithAi } from './aiExtractor';
import { classifyAnnouncementWithJev } from './jevClassifier';
import { resolveTaskWeight } from '../utils/syllabusWeights';
import { resolveTaskRoom } from '../utils/courseSchedule';

/**
 * Normalizes title for deduplication comparison.
 */
function normalizeTaskKey(task: DeadlineTask): string {
  const dateStr = new Date(task.dueDate).toISOString().slice(0, 10);
  const cleanTitle = task.title.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${task.courseCode}_${task.type}_${dateStr}_${cleanTitle}`;
}

/**
 * Hybrid extraction pipeline: runs local parser first, Jev fast triage gatekeeper,
 * and Generative AI for deep date timestamp synthesis when needed.
 */
export async function extractDeadlinesHybrid(
  announcement: Announcement,
  settings: UserSettings
): Promise<DeadlineTask[]> {
  // Step 1: Run local parser (instant, offline)
  const localTasks = extractDeadlinesLocally(announcement);

  // If local found deadlines and has generic 'other' category, refine category with Jev
  if (localTasks.length > 0) {
    if (settings.useJevClassification && settings.jevApiKey && localTasks.some(t => t.type === 'other')) {
      try {
        const jevRes = await classifyAnnouncementWithJev(
          `${announcement.title}\n${announcement.contentText}`,
          settings.jevApiKey
        );
        if (jevRes.isDeadline && jevRes.category !== 'not_a_task' && jevRes.category !== 'other') {
          for (const t of localTasks) {
            if (t.type === 'other') {
              t.type = jevRes.category;
              if (jevRes.priority) t.priority = jevRes.priority;
            }
          }
        }
      } catch (err) {
        console.warn('[HybridExtractor] Jev category refinement failed:', err);
      }
    }
    return localTasks;
  }

  // If AI is disabled or no API key, return local results
  if (!settings.useAiExtraction || !settings.openRouterApiKey) {
    return localTasks;
  }

  // Check if announcement text contains academic assessment triggers
  const hasAcademicKeywords = /\b(quiz|exam|midterm|final|assignment|homework|hw|project|lab|due|deadline|postponed|rescheduled|واجب|كويز|امتحان|تسليم|تأجيل)\b/i.test(
    `${announcement.title} ${announcement.contentText}`
  );

  if (!hasAcademicKeywords) {
    return localTasks;
  }

  // Step 2: Jev Fast Classification Gatekeeper (~100ms)
  let jevCategoryHint: { category?: any; priority?: any } | undefined;
  if (settings.useJevClassification && settings.jevApiKey) {
    try {
      const jevResult = await classifyAnnouncementWithJev(
        `${announcement.title}\n${announcement.contentText}`,
        settings.jevApiKey
      );

      // Fast rejection: If Jev determines this is NOT a deadline or is general notice,
      // skip slow generative AI completely.
      if (!jevResult.isDeadline || jevResult.category === 'not_a_task') {
        console.log(
          `[Blackboarder] Jev filtered out non-deadline announcement: "${announcement.title}" (${jevResult.category}, prob=${jevResult.deadlineProbability}). Skipping Generative AI.`
        );
        return [];
      }

      console.log(
        `[Blackboarder] Jev confirmed deadline: "${announcement.title}" (${jevResult.category}, prob=${jevResult.deadlineProbability}, urgency=${jevResult.urgencyScore}). Invoking Generative AI.`
      );
      jevCategoryHint = {
        category: jevResult.category,
        priority: jevResult.priority,
        hasRoom: jevResult.hasRoom,
        hasTime: jevResult.hasTime
      };
    } catch (jevErr) {
      console.warn('[Blackboarder] Jev classifier error, falling back to Generative AI:', jevErr);
    }
  }

  // Step 3: Generative AI (OpenRouter / Gemini) for exact ISO timestamp synthesis
  console.log(`[Blackboarder] Triggering Generative AI parser for announcement: "${announcement.title}"`);
  const aiTasks = await extractDeadlinesWithAi(
    announcement,
    settings.openRouterApiKey,
    settings.openRouterModel,
    jevCategoryHint
  );

  if (aiTasks.length > 0) {
    return aiTasks;
  }

  return localTasks;
}

/**
 * Batch processes multiple announcements and deduplicates deadlines against existing stored tasks.
 * When matching existing tasks, performs in-place updates without resetting user completion status,
 * updating truncated descriptions with unabridged text, announced custom rooms, and syllabus weights.
 * Skips announcements that have already been parsed in previous scan checkpoints unless a full re-scan is requested.
 */
export async function processAnnouncementsBatch(
  announcements: Announcement[],
  existingTasks: DeadlineTask[],
  settings: UserSettings,
  knownProcessedAnnIds?: Set<string>
): Promise<{ newTasks: DeadlineTask[]; allTasks: DeadlineTask[]; updatedTasks: DeadlineTask[] }> {
  // Index existing tasks by normalized key and by announcement ID
  const existingKeyMap = new Map<string, DeadlineTask>();
  const existingAnnIdMap = new Map<string, DeadlineTask>();

  for (const t of existingTasks) {
    existingKeyMap.set(normalizeTaskKey(t), t);
    if (t.announcementId) {
      existingAnnIdMap.set(t.announcementId, t);
    }
  }

  const newTasks: DeadlineTask[] = [];
  const updatedTasks: DeadlineTask[] = [];
  const updatedTaskIds = new Set<string>();

  for (const ann of announcements) {
    // If announcement was already parsed and recorded in a previous scan, skip re-extracting
    if (knownProcessedAnnIds && knownProcessedAnnIds.has(ann.id)) {
      continue;
    }

    const extracted = await extractDeadlinesHybrid(ann, settings);
    for (const task of extracted) {
      if (task.weight === undefined) {
        const wInfo = resolveTaskWeight(task, task.courseName);
        task.weight = wInfo.weight;
        task.weightDisplay = wInfo.weightDisplay;
        task.syllabusNote = wInfo.syllabusNote;
      }

      // Ensure room is resolved from the announcement text (bypasses hw and project)
      const resolvedRoom = resolveTaskRoom({
        courseNameOrCode: task.courseName || task.courseCode,
        announcementText: task.description || task.sourceSnippet,
        title: task.title,
        existingRoom: task.room,
        type: task.type
      });
      if (resolvedRoom.room) {
        task.room = resolvedRoom.room;
      } else {
        const cleanT = (task.type || '').toLowerCase();
        if (cleanT === 'assignment' || cleanT === 'hw' || cleanT === 'project') {
          task.room = undefined;
        }
      }

      const key = normalizeTaskKey(task);
      const existing = existingKeyMap.get(key) || (task.announcementId ? existingAnnIdMap.get(task.announcementId) : undefined);

      if (existing) {
        let changed = false;

        // 1. Description / sourceSnippet: update if incoming has longer text, or existing ends in '…' or '...'
        const incomingDesc = (task.description || task.sourceSnippet || '').trim();
        const existingDesc = (existing.description || existing.sourceSnippet || '').trim();
        const isExistingTruncated = /[…\.]\s*$/.test(existingDesc) || existingDesc.includes('…') || existingDesc.endsWith('...');

        if (incomingDesc && (incomingDesc.length > existingDesc.length || (isExistingTruncated && !incomingDesc.includes('…')))) {
          existing.description = incomingDesc;
          existing.sourceSnippet = incomingDesc;
          changed = true;
        }

        // 2. Room: re-resolve room with the latest announcement text. An announced room ALWAYS overrides the default!
        const newRoomRes = resolveTaskRoom({
          courseNameOrCode: existing.courseName || existing.courseCode,
          announcementText: existing.description || existing.sourceSnippet || incomingDesc,
          title: existing.title,
          existingRoom: existing.room,
          type: existing.type || task.type
        });
        if (newRoomRes.room && newRoomRes.room !== existing.room) {
          existing.room = newRoomRes.room;
          changed = true;
        } else {
          const cleanExT = (existing.type || task.type || '').toLowerCase();
          if ((cleanExT === 'assignment' || cleanExT === 'hw' || cleanExT === 'project') && existing.room) {
            existing.room = undefined;
            changed = true;
          }
        }

        // 3. Weight & Syllabus Note if previously missing
        if ((existing.weight === undefined || existing.weight === null) && task.weight !== undefined) {
          existing.weight = task.weight;
          existing.weightDisplay = task.weightDisplay;
          existing.syllabusNote = task.syllabusNote;
          changed = true;
        }

        // 4. Specific class time: if existing did not have specific time, but new does
        if (!existing.hasSpecificTime && task.hasSpecificTime) {
          existing.dueDate = task.dueDate;
          existing.hasSpecificTime = true;
          changed = true;
        }

        // 5. If announcementId was not linked before, link it
        if (!existing.announcementId && task.announcementId) {
          existing.announcementId = task.announcementId;
          changed = true;
        }

        if (changed && !updatedTaskIds.has(existing.id)) {
          existing.updatedAt = new Date().toISOString();
          updatedTasks.push(existing);
          updatedTaskIds.add(existing.id);
        }
      } else {
        existingKeyMap.set(key, task);
        if (task.announcementId) {
          existingAnnIdMap.set(task.announcementId, task);
        }
        newTasks.push(task);
      }
    }
  }

  // Combine and sort by due date ascending
  const allTasks = [...newTasks, ...existingTasks].sort(
    (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  );

  return { newTasks, allTasks, updatedTasks };
}
