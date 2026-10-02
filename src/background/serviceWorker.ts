import { DeadlineTask, UserSettings, DEFAULT_SETTINGS } from '../types';
import { pushTasksToSyncServer } from '../utils/syncClient';
import { pushTasksToFirebase, fetchTasksFromFirebase } from '../utils/firebaseSync';
import { classifyAnnouncementDirectly } from '../engine/jevClassifier';

const ALARM_NAME = 'bbs_check_deadlines';
const MIDNIGHT_ALARM_NAME = 'bbs_midnight_sync';

// Schedule daily 12:00 AM midnight alarm for automated sync
function scheduleMidnightAlarm() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5).getTime();
  chrome.alarms.create(MIDNIGHT_ALARM_NAME, {
    when: nextMidnight,
    periodInMinutes: 24 * 60
  });
  console.log(`[Auto-Sync] Scheduled daily midnight sync for ${new Date(nextMidnight).toLocaleString()}`);
}

/**
 * Periodically pulls freshest tasks and user customizations from Firebase into chrome.storage.local.
 * Reconciles tasks field-by-field, ensuring course name modifications, room updates, and student notes
 * made on the phone or web app are never lost.
 */
export async function pullTasksFromFirebaseToLocal(): Promise<boolean> {
  try {
    const res = await fetchTasksFromFirebase();
    if (!res.success || !Array.isArray(res.tasks) || res.tasks.length === 0) {
      return false;
    }

    const data = await chrome.storage.local.get(['bbs_tasks']) as { bbs_tasks?: DeadlineTask[] };
    const localTasks: DeadlineTask[] = data.bbs_tasks || [];
    const mergedMap = new Map<string, DeadlineTask>();
    for (const t of localTasks) {
      mergedMap.set(t.id, t);
    }

    let changed = false;
    for (const fbTask of res.tasks) {
      if (!mergedMap.has(fbTask.id)) {
        mergedMap.set(fbTask.id, fbTask);
        changed = true;
      } else {
        const localTask = mergedMap.get(fbTask.id)!;
        const localTime = new Date(localTask.updatedAt || localTask.createdAt || 0).getTime();
        const fbTime = new Date(fbTask.updatedAt || fbTask.createdAt || 0).getTime();

        if (fbTime > localTime) {
          // Cloud version modified more recently on phone/web
          mergedMap.set(fbTask.id, {
            ...localTask,
            ...fbTask,
            courseName: fbTask.courseName || localTask.courseName,
            courseCode: fbTask.courseCode || localTask.courseCode,
            title: fbTask.title || localTask.title,
            description: fbTask.description !== undefined ? fbTask.description : localTask.description,
            sourceSnippet: fbTask.sourceSnippet !== undefined ? fbTask.sourceSnippet : localTask.sourceSnippet,
            notes: fbTask.notes !== undefined ? fbTask.notes : localTask.notes,
            dueDate: fbTask.dueDate || localTask.dueDate,
            hasSpecificTime: fbTask.hasSpecificTime !== undefined ? fbTask.hasSpecificTime : localTask.hasSpecificTime,
            room: fbTask.room !== undefined ? fbTask.room : localTask.room,
            type: fbTask.type || localTask.type,
            priority: fbTask.priority || localTask.priority,
            status: fbTask.status || localTask.status,
            weight: fbTask.weight !== undefined ? fbTask.weight : localTask.weight,
            weightDisplay: fbTask.weightDisplay !== undefined ? fbTask.weightDisplay : localTask.weightDisplay,
            syllabusNote: fbTask.syllabusNote !== undefined ? fbTask.syllabusNote : localTask.syllabusNote,
            updatedAt: fbTask.updatedAt || new Date().toISOString()
          });
          changed = true;
        } else {
          // Cloud version has non-colliding fields or manual updates
          let subChanged = false;
          const updated = { ...localTask };

          // Adopt customized course names/codes from mobile web
          if (fbTask.courseName && fbTask.courseName !== localTask.courseName) {
            updated.courseName = fbTask.courseName;
            if (fbTask.courseCode) updated.courseCode = fbTask.courseCode;
            subChanged = true;
          }
          if (fbTask.courseCode && !localTask.courseCode) {
            updated.courseCode = fbTask.courseCode;
            subChanged = true;
          }
          // Adopt custom notes
          if (fbTask.notes && fbTask.notes !== localTask.notes) {
            updated.notes = fbTask.notes;
            subChanged = true;
          }
          // Adopt status if cloud timestamp is equal or newer
          if (fbTask.status && fbTask.status !== localTask.status && fbTime >= localTime) {
            updated.status = fbTask.status;
            subChanged = true;
          }
          // Adopt room
          if (fbTask.room && fbTask.room !== localTask.room) {
            updated.room = fbTask.room;
            subChanged = true;
          }
          // Adopt doctor description if updated on web
          if (fbTask.description && fbTask.description !== localTask.description && fbTask.description.trim()) {
            updated.description = fbTask.description;
            subChanged = true;
          }

          if (subChanged) {
            mergedMap.set(fbTask.id, updated);
            changed = true;
          }
        }
      }
    }

    if (changed) {
      const mergedList = Array.from(mergedMap.values()).sort(
        (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      );
      await chrome.storage.local.set({ bbs_tasks: mergedList });
      await updateExtensionBadge();
      console.log('[Background Sync] Pulled and merged latest deadlines & course changes from Firebase into storage');
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[Background Sync] Failed pulling tasks from Firebase:', err);
    return false;
  }
}

// Automatically sync latest tasks to mobile sync server & Firebase Cloud
async function syncDeadlinesToMobileServer() {
  try {
    // Proactively pull freshest updates from Firebase BEFORE pushing to prevent overwriting mobile edits
    await pullTasksFromFirebaseToLocal();

    const data = await chrome.storage.local.get(['bbs_tasks', 'bbs_settings']) as {
      bbs_tasks?: DeadlineTask[];
      bbs_settings?: UserSettings;
    };
    const tasks: DeadlineTask[] = data.bbs_tasks || [];
    const settings: UserSettings = data.bbs_settings || DEFAULT_SETTINGS;

    if (settings.autoSyncMidnight === false) {
      console.log('[Auto-Sync] Skipped: autoSyncMidnight is disabled in settings');
      return { ok: false, reason: 'disabled' };
    }

    const [fbResult, serverResult] = await Promise.all([
      pushTasksToFirebase(tasks, 'Midnight Extension Sync'),
      pushTasksToSyncServer(tasks, settings)
    ]);
    console.log('[Auto-Sync] Firebase Result:', fbResult, 'Server Result:', serverResult);
    return { ok: fbResult.success || serverResult.success, fbResult, serverResult };
  } catch (err) {
    console.error('[Auto-Sync] Failed syncing to mobile server:', err);
    return { ok: false, error: err };
  }
}

// Update extension icon badge
async function updateExtensionBadge() {
  try {
    const data = await chrome.storage.local.get(['bbs_tasks']) as { bbs_tasks?: DeadlineTask[] };
    const tasks: DeadlineTask[] = data.bbs_tasks || [];

    const now = Date.now();
    const urgentTasks = tasks.filter(t => {
      if (t.status !== 'pending') return false;
      const dueTime = new Date(t.dueDate).getTime();
      const hoursLeft = (dueTime - now) / (1000 * 3600);
      return hoursLeft > -12 && hoursLeft <= 48; // Overdue recently or due in next 48h
    });

    if (urgentTasks.length > 0) {
      await chrome.action.setBadgeText({ text: String(urgentTasks.length) });
      await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (err) {
    console.error('Failed to update extension badge:', err);
  }
}

// Check for approaching deadlines and send notifications
async function checkUpcomingDeadlines() {
  try {
    const data = await chrome.storage.local.get(['bbs_tasks', 'bbs_settings', 'bbs_notified']) as {
      bbs_tasks?: DeadlineTask[];
      bbs_settings?: UserSettings;
      bbs_notified?: Record<string, number>;
    };
    const tasks: DeadlineTask[] = data.bbs_tasks || [];
    const settings: UserSettings = data.bbs_settings || DEFAULT_SETTINGS;
    const notifiedMap: Record<string, number> = data.bbs_notified || {};

    if (!settings.badgeNotification) return;

    const now = Date.now();
    const alertThresholdMs = settings.reminderHoursBefore * 3600 * 1000;

    for (const task of tasks) {
      if (task.status !== 'pending') continue;
      const dueTime = new Date(task.dueDate).getTime();
      const timeRemaining = dueTime - now;

      // If within notification window and hasn't been notified in past 12 hours
      if (timeRemaining > 0 && timeRemaining <= alertThresholdMs) {
        const lastNotified = notifiedMap[task.id] || 0;
        if (now - lastNotified > 12 * 3600 * 1000) {
          notifiedMap[task.id] = now;

          const hoursLeft = Math.round(timeRemaining / (3600 * 1000));
          const timeText = hoursLeft <= 1 ? 'under 1 hour' : `about ${hoursLeft} hours`;

          chrome.notifications.create(`reminder_${task.id}`, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title: `[Urgent] Upcoming ${task.type.toUpperCase()}: ${task.title}`,
            message: `Due in ${timeText}! Course: ${task.courseCode} - ${task.courseName}`,
            priority: 2
          });
        }
      }
    }

    await chrome.storage.local.set({ bbs_notified: notifiedMap });
    await updateExtensionBadge();
  } catch (err) {
    console.error('Failed checking upcoming deadlines:', err);
  }
}

// Listeners
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 30 });
  scheduleMidnightAlarm();
  pullTasksFromFirebaseToLocal().then(() => updateExtensionBadge());
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) {
    pullTasksFromFirebaseToLocal().then(() => checkUpcomingDeadlines());
  } else if (alarm.name === MIDNIGHT_ALARM_NAME) {
    syncDeadlinesToMobileServer();
    scheduleMidnightAlarm();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // 1. Content Script Proxy: Jev Classification (bypasses Blackboard page CSP)
  if (message.type === 'PROXY_JEV_CLASSIFY' || message.type === 'CLASSIFY_JEV') {
    classifyAnnouncementDirectly(message.text, message.apiKey, message.timeoutMs)
      .then(result => sendResponse({ ok: true, result, data: result }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true; // Keep message channel open for async response
  }

  // 2. Content Script Proxy: OpenRouter AI Chat (bypasses Blackboard page CSP)
  if (message.type === 'PROXY_OPENROUTER_CHAT') {
    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${message.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://blackboarder.local',
        'X-Title': 'Blackboarder Extension'
      },
      body: JSON.stringify(message.body)
    })
      .then(async res => {
        const data = await res.json().catch(() => null);
        sendResponse({ ok: res.ok, status: res.status, data });
      })
      .catch(err => {
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  // 3. Trigger Firebase background pull
  if (message.type === 'PULL_FIREBASE') {
    pullTasksFromFirebaseToLocal()
      .then(changed => sendResponse({ ok: true, changed }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === 'UPDATE_BADGE') {
    updateExtensionBadge()
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === 'CHECK_DEADLINES') {
    checkUpcomingDeadlines()
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === 'SYNC_TO_SERVER') {
    syncDeadlinesToMobileServer()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === 'OPEN_POPUP') {
    chrome.action.openPopup?.().catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
