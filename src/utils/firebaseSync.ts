import { DeadlineTask, TaskStatus, QuickLink } from '../types';

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD2cEybk7VtkON7-Q5p7YM5q5Dr9Znri9E',
  authDomain: 'blackboard-sidekick.firebaseapp.com',
  databaseURL: 'https://blackboard-sidekick-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'blackboard-sidekick',
  storageBucket: 'blackboard-sidekick.firebasestorage.app',
  messagingSenderId: '799390689505',
  appId: '1:799390689505:web:c24bb79d67b5413029afa0'
};

export const FIREBASE_DB_URL = FIREBASE_CONFIG.databaseURL;

/**
 * Returns the scoped Firebase data URL based on user syncKey.
 * If syncKey is provided, namespaces under /users/{cleanKey}/data.json.
 * If syncKey is omitted or empty, falls back to legacy root /data.json.
 */
export function getFirebaseDataUrl(syncKey?: string): string {
  const cleanKey = (syncKey || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return cleanKey ? `${FIREBASE_DB_URL}/users/${cleanKey}/data.json` : `${FIREBASE_DB_URL}/data.json`;
}

export interface FirebaseSyncPayload {
  tasks: DeadlineTask[];
  lastSync: string;
  device?: string;
  count: number;
  syncKey?: string;
  quickLinks?: QuickLink[];
}

export interface DeletionTombstone {
  id: string;
  deletedAt: string;
  device?: string;
}

/**
 * Pushes deadlines to Firebase Realtime Database.
 * Supports user-isolated namespaces via syncKey.
 */
export async function pushTasksToFirebase(
  tasks: DeadlineTask[],
  device: string = 'Chrome Extension',
  syncKey?: string,
  quickLinks?: QuickLink[]
): Promise<{ success: boolean; message: string; lastSync?: string; count?: number }> {
  try {
    const lastSync = new Date().toISOString();
    const payload: FirebaseSyncPayload = {
      tasks,
      lastSync,
      device,
      count: tasks.length,
      syncKey: syncKey || undefined,
      quickLinks: quickLinks || undefined
    };

    const targetUrl = getFirebaseDataUrl(syncKey);
    const res = await fetch(targetUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return { success: false, message: `Firebase error (${res.status}): ${err}` };
    }

    // Mirror to root /data.json when syncKey is provided so unkeyed website access stays in sync
    if (syncKey && targetUrl !== `${FIREBASE_DB_URL}/data.json`) {
      try {
        await fetch(`${FIREBASE_DB_URL}/data.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (mirrorErr) {
        console.warn('Firebase root mirror error:', mirrorErr);
      }
    }

    return {
      success: true,
      message: `Synchronized ${tasks.length} deadlines with Firebase Cloud`,
      lastSync,
      count: tasks.length
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Could not connect to Firebase: ${err.message || err}`
    };
  }
}

/**
 * Fetches the latest deadlines stored in Firebase Realtime Database.
 * If syncKey is provided, retrieves the isolated user bucket.
 */
export async function fetchTasksFromFirebase(syncKey?: string): Promise<{
  success: boolean;
  tasks: DeadlineTask[];
  lastSync?: string;
  device?: string;
  error?: string;
  quickLinks?: QuickLink[];
}> {
  try {
    const targetUrl = getFirebaseDataUrl(syncKey);
    const res = await fetch(targetUrl, {
      cache: 'no-store'
    });

    if (!res.ok) {
      return { success: false, tasks: [], error: `HTTP ${res.status}` };
    }

    const data: FirebaseSyncPayload = await res.json();
    if (!data || !Array.isArray(data.tasks)) {
      return { success: true, tasks: [], lastSync: undefined, quickLinks: data?.quickLinks };
    }

    return {
      success: true,
      tasks: data.tasks,
      lastSync: data.lastSync,
      device: data.device,
      quickLinks: data.quickLinks
    };
  } catch (err: any) {
    return {
      success: false,
      tasks: [],
      error: err.message || 'Network error'
    };
  }
}

/**
 * Updates a single task status in Firebase Realtime Database without clobbering other fields.
 */
export async function updateTaskStatusInFirebase(
  taskId: string,
  status: TaskStatus,
  syncKey?: string
): Promise<boolean> {
  try {
    const fetchRes = await fetchTasksFromFirebase(syncKey);
    if (!fetchRes.success || !fetchRes.tasks) return false;

    const tasks = fetchRes.tasks;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return false;

    task.status = status;
    task.updatedAt = new Date().toISOString();

    const pushRes = await pushTasksToFirebase(tasks, 'Status Update', syncKey);
    return pushRes.success;
  } catch (err) {
    console.error('Error updating task status in Firebase:', err);
    return false;
  }
}

/**
 * Updates a single task (including notes and announcement) in Firebase Realtime Database.
 */
export async function updateTaskInFirebase(
  updatedTask: DeadlineTask,
  device: string = 'Chrome Extension',
  syncKey?: string
): Promise<boolean> {
  try {
    const fetchRes = await fetchTasksFromFirebase(syncKey);
    if (!fetchRes.success || !fetchRes.tasks) return false;

    const tasks = fetchRes.tasks.map(t => (t.id === updatedTask.id ? { ...t, ...updatedTask, updatedAt: new Date().toISOString() } : t));
    const pushRes = await pushTasksToFirebase(tasks, `${device} Task Edit`, syncKey);
    return pushRes.success;
  } catch (err) {
    console.error('Error updating task in Firebase:', err);
    return false;
  }
}

/**
 * Records a deletion tombstone in Firebase to prevent deleted deadlines from resurrecting on another device.
 */
export async function recordTaskDeletionInFirebase(
  taskId: string,
  device: string = 'Chrome Extension',
  syncKey?: string
): Promise<boolean> {
  try {
    const fetchRes = await fetchTasksFromFirebase(syncKey);
    if (fetchRes.success && fetchRes.tasks) {
      const remaining = fetchRes.tasks.filter(t => t.id !== taskId);
      await pushTasksToFirebase(remaining, 'Deleted Task', syncKey);
    }
    return true;
  } catch (e) {
    console.warn('Could not record task deletion in Firebase:', e);
    return false;
  }
}
