import { TypeSafeClient, noul, choice, score } from '@typesafe-ai/sdk';
import { TaskPriority, TaskType } from '../types';
import { isExtensionContextValid } from '../utils/storage';

export interface JevTriageResult {
  isDeadline: boolean;
  deadlineProbability: number;
  category: TaskType | 'not_a_task';
  categoryConfidence: number;
  priority: TaskPriority;
  urgencyScore: number;
  hasRoom?: boolean;
  hasRoomProbability?: number;
  hasTime?: boolean;
  hasTimeProbability?: number;
}

/**
 * Executes Jev System One classification directly using TypeSafeClient or edge proxy.
 * Used by the Background Service Worker and Node.js test environment.
 */
export async function classifyAnnouncementDirectly(
  text: string,
  apiKey: string,
  timeoutMs: number = 6000
): Promise<JevTriageResult> {
  const fallbackResult: JevTriageResult = {
    isDeadline: true,
    deadlineProbability: 0.5,
    category: 'other',
    categoryConfidence: 0.5,
    priority: 'medium',
    urgencyScore: 2.0
  };

  if (!apiKey || !apiKey.trim() || !text || !text.trim()) {
    return fallbackResult;
  }

  // Optional: Try secure edge proxy if available in web context (outside Blackboard content script)
  if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.protocol !== 'chrome-extension:') {
    try {
      const proxyRes = await fetch('/api/ai/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, apiKey })
      });
      if (proxyRes.ok) {
        const proxyData = await proxyRes.json();
        if (proxyData && proxyData.ok && proxyData.data) {
          const resp = proxyData.data;
          const isDead = resp.is_deadline ?? resp.isDeadline ?? false;
          const cat = resp.category || 'other';
          const urg = typeof resp.urgency === 'number' ? resp.urgency : 2.5;
          let prio: TaskPriority = 'medium';
          if (urg >= 4.0) prio = 'high';
          else if (urg < 2.0) prio = 'low';

          return {
            isDeadline: isDead,
            deadlineProbability: isDead ? 0.95 : 0.05,
            category: cat as any,
            categoryConfidence: 0.9,
            priority: prio,
            urgencyScore: urg,
            hasRoom: Boolean(resp.has_room),
            hasTime: Boolean(resp.has_time)
          };
        }
      }
    } catch (e) {
      // Non-blocking fallback to direct client
    }
  }

  try {
    const client = new TypeSafeClient({
      apiKey: apiKey.trim(),
      dangerouslyAllowBrowser: true,
      timeout: timeoutMs
    });

    // Truncate state to first 1200 characters if excessively long
    const stateSnippet = text.length > 1200 ? text.slice(0, 1200) : text;

    const response = await client.systemOne({
      state: stateSnippet,
      questions: {
        is_deadline: noul(
          'Does this text announce or discuss a specific academic deadline, due date, quiz, exam, test, homework, lab, or academic submission?'
        ),
        category: choice('What type of academic task or event is described?', {
          quiz: 'A quiz, pop quiz, short assessment, or test',
          exam: 'A midterm exam, final exam, or major examination',
          assignment: 'A homework assignment, problem set, essay, paper, or exercise',
          lab: 'A laboratory session, lab report, lab experiment, or lab manual work',
          project: 'A semester project, group project, milestone, presentation, or term project',
          not_a_task: 'General announcement, lecture slides notice, office hours, syllabus info, or greetings with no upcoming assessment'
        }),
        urgency: score('How urgent or high-priority is this academic event?', [
          'Low priority or non-mandatory notice',
          'Standard homework or recurring reading',
          'Medium priority assignment or lab report',
          'High priority quiz or milestone',
          'Critical high-stakes midterm or final exam'
        ]),
        has_room: noul(
          'Does this text specify a particular room number, hall, classroom, auditorium, or lab location to attend in (e.g. room A8-103, hall TH005, lab 105, Central Lab)?'
        ),
        has_time: noul(
          'Does this text specify an explicit clock time or time range for the assessment (e.g. at 12:30 pm, from 11:00 to 12:15, الساعة 12:30)?'
        )
      }
    });

    const answers = response.answers;
    const isDeadlineProb = answers.is_deadline?.noul ?? 0.5;
    const chosenCategory = answers.category?.choice ?? 'not_a_task';
    const categoryConf = answers.category?.confidence ?? 0.5;
    const rawUrgency = answers.urgency?.score ?? 2.0;

    const hasRoomProb = answers.has_room?.noul ?? 0.5;
    const hasTimeProb = answers.has_time?.noul ?? 0.5;
    const hasRoom = hasRoomProb >= 0.5;
    const hasTime = hasTimeProb >= 0.5;

    let priority: TaskPriority = 'medium';
    if (rawUrgency >= 2.8) {
      priority = 'high';
    } else if (rawUrgency < 1.3) {
      priority = 'low';
    }

    const isNotTask = chosenCategory === 'not_a_task';
    const isDeadline = !isNotTask && isDeadlineProb >= 0.35;

    let mappedType: TaskType | 'not_a_task' = 'other';
    if (isNotTask) {
      mappedType = 'not_a_task';
    } else if (
      chosenCategory === 'quiz' ||
      chosenCategory === 'exam' ||
      chosenCategory === 'assignment' ||
      chosenCategory === 'lab' ||
      chosenCategory === 'project'
    ) {
      mappedType = chosenCategory;
    }

    return {
      isDeadline,
      deadlineProbability: isDeadlineProb,
      category: mappedType,
      categoryConfidence: categoryConf,
      priority,
      urgencyScore: rawUrgency,
      hasRoom,
      hasRoomProbability: hasRoomProb,
      hasTime,
      hasTimeProbability: hasTimeProb
    };
  } catch (error) {
    console.warn('[Jev Classifier] Triage failed or timed out, falling back:', error);
    return fallbackResult;
  }
}

/**
 * Fast System One classifier using Jev (TypeSafe AI).
 * Automatically detects Chrome Extension content script context and routes requests
 * via background service worker messaging to circumvent Blackboard page CSP restrictions.
 */
export async function classifyAnnouncementWithJev(
  text: string,
  apiKey: string,
  timeoutMs: number = 6000
): Promise<JevTriageResult> {
  const fallbackResult: JevTriageResult = {
    isDeadline: true,
    deadlineProbability: 0.5,
    category: 'other',
    categoryConfidence: 0.5,
    priority: 'medium',
    urgencyScore: 2.0
  };

  if (!apiKey || !apiKey.trim() || !text || !text.trim()) {
    return fallbackResult;
  }

  // Content Script Context: Forward request to Extension Background Service Worker
  // In Chrome MV3, content scripts execute in the context of https://elearning.sharjah.ac.ae
  // and are restricted by Blackboard's connect-src CSP. The background service worker
  // possesses host_permissions and can reach api.typesafe.ai directly without CSP blocks.
  const isContentScript =
    typeof window !== 'undefined' &&
    window.location?.protocol !== 'chrome-extension:' &&
    (window.location?.protocol === 'http:' || window.location?.protocol === 'https:') &&
    isExtensionContextValid();

  if (isContentScript) {
    try {
      const bgResp = await new Promise<any>((resolve, reject) => {
        try {
          if (!isExtensionContextValid()) {
            reject(new Error('Extension context invalidated'));
            return;
          }
          chrome.runtime.sendMessage(
            {
              type: 'PROXY_JEV_CLASSIFY',
              text,
              apiKey: apiKey.trim(),
              timeoutMs
            },
            response => {
              try {
                if (chrome.runtime?.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve(response);
                }
              } catch (cbErr) {
                reject(cbErr);
              }
            }
          );
        } catch (callErr) {
          reject(callErr);
        }
      });
      if (bgResp && bgResp.ok && (bgResp.result || bgResp.data)) {
        return bgResp.result || bgResp.data;
      }
    } catch (err: any) {
      if (err?.message?.includes('Extension context invalidated')) {
        console.warn('[Jev Classifier] Extension context invalidated; falling back to direct triage.');
      } else {
        console.warn('[Jev Classifier] Content script proxy request via service worker failed, falling back to direct:', err);
      }
    }
  }

  return classifyAnnouncementDirectly(text, apiKey, timeoutMs);
}
