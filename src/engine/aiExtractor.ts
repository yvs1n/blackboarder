import { Announcement, DeadlineTask, TaskType, TaskPriority } from '../types';
import { resolveTaskTimeWithSchedule, resolveTaskRoom } from '../utils/courseSchedule';
import { sanitizeDoctorAnnouncementText } from '../utils/courseHelper';
import { isExtensionContextValid } from '../utils/storage';

interface AiExtractedItem {
  title: string;
  courseCode?: string;
  dueDate: string; // ISO 8601 string: YYYY-MM-DDTHH:mm:ss
  hasSpecificTime?: boolean;
  type: 'quiz' | 'assignment' | 'exam' | 'project' | 'lab' | 'meeting' | 'other';
  priority: 'high' | 'medium' | 'low';
  description?: string;
  sourceSnippet: string;
  room?: string;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message: string;
  };
}

/**
 * Extracts deadlines and academic tasks from an announcement using OpenRouter AI.
 */
export async function extractDeadlinesWithAi(
  announcement: Announcement,
  apiKey: string,
  model: string = 'google/gemini-3.8-flash',
  jevHint?: {
    category?: TaskType | 'not_a_task';
    priority?: TaskPriority;
    hasRoom?: boolean;
    hasTime?: boolean;
  }
): Promise<DeadlineTask[]> {
  if (!apiKey || !apiKey.trim()) {
    console.warn('OpenRouter API key not configured.');
    return [];
  }

  const baseDate = announcement.postedAt ? new Date(announcement.postedAt) : new Date();
  const baseDateStr = baseDate.toISOString().slice(0, 10);

  const systemPrompt = `You are an expert academic assistant designed to extract due dates, assignments, quizzes, midterms, labs, exams, and projects from university Blackboard course announcements (English and Arabic).
Reference Context:
- Reference Date for relative terms ("tomorrow", "next Tuesday", "this Friday"): ${baseDateStr}.
- Current Year: ${baseDate.getFullYear()}.
- Course: ${announcement.courseCode} - ${announcement.courseName}.

CRITICAL TIME & DATE RULES:
1. NEVER USE THE "Posted Date" AS THE DEADLINE OR ASSESSMENT TIME! The posted date is strictly metadata indicating when the doctor published the announcement.
2. If the instructor states an explicit time or range for the quiz/exam/class (e.g. "from 12:30 pm to 13:30 pm", "at 11:00 am", "12:30 - 1:30 pm", "من 12:30 إلى 13:30"):
   - Extract the START time of the assessment (e.g. 12:30:00).
   - Set "hasSpecificTime": true.
3. If NO specific time of day is stated by the instructor:
   - Set "hasSpecificTime": false.
   - For quizzes and exams without an explicit time, use 10:00:00 as a placeholder.
   - For homework/assignments/submissions without an explicit time, use 23:59:00 as a placeholder.
4. Calculate exact ISO 8601 timestamps (format: "YYYY-MM-DDTHH:mm:00").
5. Return a strict JSON object with key "deadlines" containing an array of objects matching this schema:
{
  "deadlines": [
    {
      "title": "Short title, e.g., Midterm Exam",
      "dueDate": "2026-10-12T12:30:00",
      "hasSpecificTime": true,
      "type": "quiz" | "assignment" | "exam" | "project" | "lab" | "meeting" | "other",
      "priority": "high" | "medium" | "low",
      "room": "A8-204 (or specific room/lab if mentioned by doctor, otherwise null)",
      "description": "Clean explanation or instructions written by the doctor",
      "sourceSnippet": "Exact text sentence mentioning the deadline"
    }
  ]
}
6. If the doctor mentions a specific classroom, hall, or lab to attend in (e.g. "room A8-204", "hall TH005", "Lab 3", "قاعة 103", "مختبر 105"), extract it into "room". Otherwise set "room" to null.
If no deadlines or tasks are found, return { "deadlines": [] }. Output valid JSON only.`;

  const cleanBody = sanitizeDoctorAnnouncementText(
    announcement.contentText,
    announcement.courseName,
    announcement.courseCode,
    announcement.title
  );

  const hintLines: string[] = [];
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

  const userContent = `Course: ${announcement.courseCode} ${announcement.courseName}
Announcement Title: ${announcement.title}
Posted Date (METADATA ONLY - DO NOT USE AS ASSESSMENT TIME): ${announcement.postedAt || 'Unknown'}
${hintBlock}Doctor's Announcement Body:
${cleanBody}`;

  const candidateModels = [
    model || 'google/gemini-3.8-flash',
    'google/gemini-3.8-flash',
    'google/gemini-3.7-flash',
    'google/gemini-flash-latest'
  ].filter((m, idx, arr) => arr.indexOf(m) === idx);

  for (const currentModel of candidateModels) {
    try {
      // Optional: Try secure edge proxy first if running in web context
      let response: Response | null = null;
      if (typeof window !== 'undefined' && window.location && window.location.origin) {
        try {
          const proxyRes = await fetch('/api/ai/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: cleanBody,
              context: `Course: ${announcement.courseCode} ${announcement.courseName}\nTitle: ${announcement.title}\nRefDate: ${baseDateStr}`,
              model: currentModel,
              apiKey: apiKey.trim()
            })
          });
          if (proxyRes.ok) {
            const proxyJson = await proxyRes.json();
            if (proxyJson && proxyJson.ok && proxyJson.data) {
              const resData: OpenRouterResponse = proxyJson.data;
              const content = resData.choices?.[0]?.message?.content;
              if (content) {
                const parsed = JSON.parse(content);
                const items: AiExtractedItem[] = Array.isArray(parsed) ? parsed : (parsed.deadlines || parsed.tasks || [parsed]);
                return items.map((item, idx) => ({
                  id: `ai_${announcement.id}_${idx}_${Date.now()}`,
                  courseCode: item.courseCode || announcement.courseCode,
                  courseName: announcement.courseName,
                  title: item.title,
                  description: item.description || '',
                  dueDate: item.dueDate,
                  hasSpecificTime: Boolean(item.hasSpecificTime),
                  type: item.type as any,
                  priority: item.priority || 'medium',
                  status: 'pending',
                  sourceSnippet: item.sourceSnippet || cleanBody.slice(0, 100),
                  confidence: 0.95,
                  extractedBy: 'ai',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
                }));
              }
            }
          }
        } catch (e) {
          // Fall back to direct OpenRouter
        }
      }

      const requestPayload = {
        model: currentModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 1000
      };

      const isContentScript =
        typeof window !== 'undefined' &&
        window.location?.protocol !== 'chrome-extension:' &&
        (window.location?.protocol === 'http:' || window.location?.protocol === 'https:') &&
        isExtensionContextValid();

      let data: OpenRouterResponse | null = null;

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
                  type: 'PROXY_OPENROUTER_CHAT',
                  body: requestPayload,
                  apiKey: apiKey.trim()
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
          if (bgResp && bgResp.ok && bgResp.data) {
            data = bgResp.data as OpenRouterResponse;
          }
        } catch (e: any) {
          if (e?.message?.includes('Extension context invalidated')) {
            console.warn('[OpenRouter AI] Extension context invalidated; falling back to direct fetch.');
          } else {
            console.warn('[OpenRouter AI] Service worker proxy failed, falling back:', e);
          }
        }
      }

      if (!data) {
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey.trim()}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://blackboarder.local',
            'X-Title': 'Blackboarder Extension'
          },
          body: JSON.stringify(requestPayload)
        });

        if (!response.ok) {
          const errText = await response.text();
          console.warn(`[OpenRouter AI] Model ${currentModel} returned status ${response.status}:`, errText);
          continue;
        }

        data = (await response.json()) as OpenRouterResponse;
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content) continue;

      // Parse JSON
      let parsed: { deadlines?: AiExtractedItem[] };
      try {
        parsed = JSON.parse(content);
      } catch {
        // Clean possible markdown code fences
        const cleaned = content.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        parsed = JSON.parse(cleaned);
      }

      if (!parsed.deadlines || !Array.isArray(parsed.deadlines)) {
        return [];
      }

      return parsed.deadlines.map(item => {
        const parsedDate = new Date(item.dueDate);
        const validDate = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
        const doctorText = sanitizeDoctorAnnouncementText(
          cleanBody || item.description || announcement.title,
          announcement.courseName,
          announcement.courseCode,
          item.title
        );

        const scheduleRes = resolveTaskTimeWithSchedule({
          dueDate: validDate,
          courseNameOrCode: announcement.courseName || item.courseCode || announcement.courseCode,
          hasSpecificTime: Boolean(item.hasSpecificTime),
          announcementText: cleanBody,
          title: item.title
        });

        const resolvedType = (item.type && item.type !== 'other')
          ? (item.type as TaskType)
          : (jevHint?.category && jevHint.category !== 'not_a_task' && jevHint.category !== 'other'
              ? (jevHint.category as TaskType)
              : (item.type as TaskType || 'other'));

        const roomInfo = resolveTaskRoom({
          courseNameOrCode: announcement.courseName || item.courseCode || announcement.courseCode,
          announcementText: cleanBody,
          title: item.title,
          existingRoom: item.room,
          type: resolvedType
        });

        const resolvedPriority = item.priority || jevHint?.priority || 'medium';

        return {
          id: `task_ai_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          announcementId: announcement.id,
          courseCode: item.courseCode || announcement.courseCode,
          courseName: announcement.courseName,
          title: item.title || 'Extracted Task',
          description: doctorText,
          dueDate: scheduleRes.dueDate.toISOString(),
          hasSpecificTime: scheduleRes.hasSpecificTime,
          type: resolvedType,
          priority: resolvedPriority,
          status: 'pending',
          sourceSnippet: doctorText,
          confidence: 0.95,
          extractedBy: 'ai',
          room: roomInfo.room || undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      });
    } catch (error) {
      console.warn(`Failed with model ${currentModel}:`, error);
    }
  }

  return [];
}
