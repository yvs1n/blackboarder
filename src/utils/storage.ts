import { DeadlineTask, Announcement, UserSettings, DEFAULT_SETTINGS, QuickLink, DEFAULT_QUICK_LINKS } from '../types';
import { isValidTask } from './courseHelper';

const STORAGE_KEYS = {
  TASKS: 'bbs_tasks',
  ANNOUNCEMENTS: 'bbs_announcements',
  SETTINGS: 'bbs_settings',
  LAST_SCANNED: 'bbs_last_scanned',
  QUICK_LINKS: 'bbs_quick_links'
};

/**
 * Dynamic check to verify if the Chrome Extension runtime context is still active and valid.
 * In Manifest V3, when an extension is updated, reloaded, or rebuilt, content scripts injected
 * into existing tabs become orphaned. In that state, calling chrome APIs throws:
 * "Error: Extension context invalidated."
 */
export function isExtensionContextValid(): boolean {
  try {
    return (
      typeof chrome !== 'undefined' &&
      Boolean(chrome.runtime?.id) &&
      Boolean(chrome.storage?.local)
    );
  } catch {
    return false;
  }
}

const memoryStorage = new Map<string, string>();

function canUseLocalStorage(): boolean {
  try {
    const hasLocalStorage = typeof localStorage !== 'undefined';
    if (!hasLocalStorage) return false;

    // If running in browser window
    if (typeof window !== 'undefined') {
      // If running inside a content script on an external web page (e.g. Blackboard),
      // do not read/write host webpage localStorage
      if (typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)) {
        if (window.location?.protocol === 'http:' || window.location?.protocol === 'https:') {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

function safeGetLocalStorage(key: string): string | null {
  try {
    if (canUseLocalStorage()) {
      return localStorage.getItem(key);
    }
  } catch {
    // Ignore storage access errors (e.g. iframe sandbox)
  }
  return memoryStorage.get(key) || null;
}

function safeSetLocalStorage(key: string, value: string): void {
  try {
    if (canUseLocalStorage()) {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    // Ignore storage quota or access errors
  }
  memoryStorage.set(key, value);
}

export function getCachedTasksSync(): DeadlineTask[] {
  const raw = safeGetLocalStorage(STORAGE_KEYS.TASKS);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(isValidTask);
      }
    } catch {}
  }
  return [];
}

export function getCachedQuickLinksSync(): QuickLink[] {
  const raw = safeGetLocalStorage(STORAGE_KEYS.QUICK_LINKS);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }
  return DEFAULT_QUICK_LINKS;
}

export function getCachedSettingsSync(): UserSettings {
  const raw = safeGetLocalStorage(STORAGE_KEYS.SETTINGS);
  if (raw) {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {}
  }
  return DEFAULT_SETTINGS;
}

export async function getSettings(): Promise<UserSettings> {
  if (isExtensionContextValid()) {
    try {
      return await new Promise<UserSettings>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.SETTINGS], (result: { [key: string]: any }) => {
            try {
              if (chrome.runtime?.lastError) {
                const raw = safeGetLocalStorage(STORAGE_KEYS.SETTINGS);
                resolve(raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS);
                return;
              }
              const stored = result?.[STORAGE_KEYS.SETTINGS];
              const resolved = stored && typeof stored === 'object' ? { ...DEFAULT_SETTINGS, ...stored } : DEFAULT_SETTINGS;
              safeSetLocalStorage(STORAGE_KEYS.SETTINGS, JSON.stringify(resolved));
              resolve(resolved);
            } catch {
              const raw = safeGetLocalStorage(STORAGE_KEYS.SETTINGS);
              resolve(raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS);
            }
          });
        } catch {
          const raw = safeGetLocalStorage(STORAGE_KEYS.SETTINGS);
          resolve(raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS);
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }

  const raw = safeGetLocalStorage(STORAGE_KEYS.SETTINGS);
  if (raw) {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }
  return DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  safeSetLocalStorage(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));

  if (isExtensionContextValid()) {
    try {
      await new Promise<void>(resolve => {
        try {
          chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: updated }, () => resolve());
        } catch {
          resolve();
        }
      });
      return updated;
    } catch {
      // Fall through to localStorage
    }
  }

  return updated;
}

export async function getTasks(): Promise<DeadlineTask[]> {
  if (isExtensionContextValid()) {
    try {
      return await new Promise<DeadlineTask[]>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.TASKS], (result: { [key: string]: any }) => {
            try {
              if (chrome.runtime?.lastError) {
                const raw = safeGetLocalStorage(STORAGE_KEYS.TASKS);
                resolve(raw ? JSON.parse(raw) : []);
                return;
              }
              const tasks = (result?.[STORAGE_KEYS.TASKS] as DeadlineTask[]) || [];
              if (tasks && tasks.length > 0) {
                safeSetLocalStorage(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
              }
              resolve(tasks);
            } catch {
              const raw = safeGetLocalStorage(STORAGE_KEYS.TASKS);
              resolve(raw ? JSON.parse(raw) : []);
            }
          });
        } catch {
          const raw = safeGetLocalStorage(STORAGE_KEYS.TASKS);
          resolve(raw ? JSON.parse(raw) : []);
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }

  const raw = safeGetLocalStorage(STORAGE_KEYS.TASKS);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return [];
}

export async function saveTasks(tasks: DeadlineTask[]): Promise<void> {
  safeSetLocalStorage(STORAGE_KEYS.TASKS, JSON.stringify(tasks));

  if (isExtensionContextValid()) {
    try {
      await new Promise<void>(resolve => {
        try {
          chrome.storage.local.set({ [STORAGE_KEYS.TASKS]: tasks }, () => {
            try {
              if (isExtensionContextValid()) {
                chrome.runtime?.sendMessage?.({ type: 'UPDATE_BADGE' }, () => {
                  if (chrome.runtime?.lastError) {
                    // Background worker may be inactive or sleeping; safely ignore
                  }
                });
              }
            } catch {
              // Context invalidated between set and message; ignore safely
            }
            resolve();
          });
        } catch {
          resolve();
        }
      });
      return;
    } catch {
      // Fall through to localStorage
    }
  }
}

export async function addTask(task: DeadlineTask): Promise<DeadlineTask[]> {
  const existing = await getTasks();
  const updated = [task, ...existing];
  await saveTasks(updated);
  return updated;
}

export async function updateTask(taskId: string, updates: Partial<DeadlineTask>): Promise<DeadlineTask[]> {
  const tasks = await getTasks();
  const updated = tasks.map(t => (t.id === taskId ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t));
  await saveTasks(updated);
  return updated;
}

export async function deleteTask(taskId: string): Promise<DeadlineTask[]> {
  const tasks = await getTasks();
  const updated = tasks.filter(t => t.id !== taskId);
  await saveTasks(updated);
  return updated;
}

export interface ScanCheckpoint {
  lastScannedAt: string;
  processedAnnouncementIds: string[];
  processedDirectTaskIds: string[];
  processedAnnouncementKeys?: string[];
}

export async function getLastScanCheckpoint(): Promise<ScanCheckpoint> {
  const fallback: ScanCheckpoint = {
    lastScannedAt: '',
    processedAnnouncementIds: [],
    processedDirectTaskIds: [],
    processedAnnouncementKeys: []
  };

  const parseCheckpoint = (stored: any): ScanCheckpoint => {
    if (stored && typeof stored === 'object') {
      return {
        lastScannedAt: stored.lastScannedAt || '',
        processedAnnouncementIds: Array.isArray(stored.processedAnnouncementIds) ? stored.processedAnnouncementIds : [],
        processedDirectTaskIds: Array.isArray(stored.processedDirectTaskIds) ? stored.processedDirectTaskIds : [],
        processedAnnouncementKeys: Array.isArray(stored.processedAnnouncementKeys) ? stored.processedAnnouncementKeys : []
      };
    }
    return fallback;
  };

  if (isExtensionContextValid()) {
    try {
      return await new Promise<ScanCheckpoint>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.LAST_SCANNED], (result: { [key: string]: any }) => {
            try {
              if (chrome.runtime?.lastError) {
                resolve(readLocalCheckpoint());
                return;
              }
              resolve(parseCheckpoint(result?.[STORAGE_KEYS.LAST_SCANNED]));
            } catch {
              resolve(readLocalCheckpoint());
            }
          });
        } catch {
          resolve(readLocalCheckpoint());
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }

  return readLocalCheckpoint();

  function readLocalCheckpoint(): ScanCheckpoint {
    const raw = safeGetLocalStorage(STORAGE_KEYS.LAST_SCANNED);
    if (raw) {
      try {
        return parseCheckpoint(JSON.parse(raw));
      } catch {
        // Fallback
      }
    }
    return fallback;
  }
}

export async function saveLastScanCheckpoint(checkpoint: Partial<ScanCheckpoint>): Promise<void> {
  const current = await getLastScanCheckpoint();
  const updated: ScanCheckpoint = {
    lastScannedAt: checkpoint.lastScannedAt || new Date().toISOString(),
    processedAnnouncementIds: Array.from(new Set([...current.processedAnnouncementIds, ...(checkpoint.processedAnnouncementIds || [])])).slice(-500),
    processedDirectTaskIds: Array.from(new Set([...current.processedDirectTaskIds, ...(checkpoint.processedDirectTaskIds || [])])).slice(-500),
    processedAnnouncementKeys: Array.from(new Set([...(current.processedAnnouncementKeys || []), ...(checkpoint.processedAnnouncementKeys || [])])).slice(-500)
  };

  if (isExtensionContextValid()) {
    try {
      await new Promise<void>(resolve => {
        try {
          chrome.storage.local.set({ [STORAGE_KEYS.LAST_SCANNED]: updated }, () => resolve());
        } catch {
          resolve();
        }
      });
      return;
    } catch {
      // Fall through to localStorage
    }
  }

  safeSetLocalStorage(STORAGE_KEYS.LAST_SCANNED, JSON.stringify(updated));
}

export async function getAnnouncements(): Promise<Announcement[]> {
  if (isExtensionContextValid()) {
    try {
      return await new Promise<Announcement[]>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.ANNOUNCEMENTS], (result: { [key: string]: any }) => {
            try {
              if (chrome.runtime?.lastError) {
                const raw = safeGetLocalStorage(STORAGE_KEYS.ANNOUNCEMENTS);
                resolve(raw ? JSON.parse(raw) : []);
                return;
              }
              resolve((result?.[STORAGE_KEYS.ANNOUNCEMENTS] as Announcement[]) || []);
            } catch {
              const raw = safeGetLocalStorage(STORAGE_KEYS.ANNOUNCEMENTS);
              resolve(raw ? JSON.parse(raw) : []);
            }
          });
        } catch {
          const raw = safeGetLocalStorage(STORAGE_KEYS.ANNOUNCEMENTS);
          resolve(raw ? JSON.parse(raw) : []);
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }

  const raw = safeGetLocalStorage(STORAGE_KEYS.ANNOUNCEMENTS);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return [];
}

export async function saveAnnouncements(newAnnouncements: Announcement[]): Promise<void> {
  const existing = await getAnnouncements();
  const map = new Map<string, Announcement>();
  for (const a of existing) {
    map.set(a.id, a);
  }
  for (const a of newAnnouncements) {
    map.set(a.id, a);
  }
  const merged = Array.from(map.values()).slice(-200);

  if (isExtensionContextValid()) {
    try {
      await new Promise<void>(resolve => {
        try {
          chrome.storage.local.set({ [STORAGE_KEYS.ANNOUNCEMENTS]: merged }, () => resolve());
        } catch {
          resolve();
        }
      });
      return;
    } catch {
      // Fall through to localStorage
    }
  }

  safeSetLocalStorage(STORAGE_KEYS.ANNOUNCEMENTS, JSON.stringify(merged));
}

export async function getQuickLinks(): Promise<QuickLink[]> {
  if (isExtensionContextValid()) {
    try {
      return await new Promise<QuickLink[]>(resolve => {
        try {
          chrome.storage.local.get([STORAGE_KEYS.QUICK_LINKS], (result: { [key: string]: any }) => {
            try {
              if (chrome.runtime?.lastError) {
                const raw = safeGetLocalStorage(STORAGE_KEYS.QUICK_LINKS);
                resolve(raw ? JSON.parse(raw) : DEFAULT_QUICK_LINKS);
                return;
              }
              const links = result?.[STORAGE_KEYS.QUICK_LINKS];
              const resolved = Array.isArray(links) && links.length > 0 ? links : DEFAULT_QUICK_LINKS;
              safeSetLocalStorage(STORAGE_KEYS.QUICK_LINKS, JSON.stringify(resolved));
              resolve(resolved);
            } catch {
              const raw = safeGetLocalStorage(STORAGE_KEYS.QUICK_LINKS);
              resolve(raw ? JSON.parse(raw) : DEFAULT_QUICK_LINKS);
            }
          });
        } catch {
          const raw = safeGetLocalStorage(STORAGE_KEYS.QUICK_LINKS);
          resolve(raw ? JSON.parse(raw) : DEFAULT_QUICK_LINKS);
        }
      });
    } catch {
      // Fall through to localStorage
    }
  }

  const raw = safeGetLocalStorage(STORAGE_KEYS.QUICK_LINKS);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      return DEFAULT_QUICK_LINKS;
    }
  }
  return DEFAULT_QUICK_LINKS;
}

export async function saveQuickLinks(links: QuickLink[]): Promise<void> {
  safeSetLocalStorage(STORAGE_KEYS.QUICK_LINKS, JSON.stringify(links));

  if (isExtensionContextValid()) {
    try {
      await new Promise<void>(resolve => {
        try {
          chrome.storage.local.set({ [STORAGE_KEYS.QUICK_LINKS]: links }, () => resolve());
        } catch {
          resolve();
        }
      });
      return;
    } catch {
      // Fall through to localStorage
    }
  }
}

export async function addQuickLink(newLink: Omit<QuickLink, 'id' | 'createdAt'>): Promise<QuickLink[]> {
  const existing = await getQuickLinks();
  let url = (newLink.url || '').trim();
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  const created: QuickLink = {
    ...newLink,
    url,
    id: `ql_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    createdAt: new Date().toISOString()
  };
  const updated = [...existing, created];
  await saveQuickLinks(updated);
  return updated;
}

export async function updateQuickLink(id: string, updates: Partial<QuickLink>): Promise<QuickLink[]> {
  const existing = await getQuickLinks();
  const updated = existing.map(l => {
    if (l.id !== id) return l;
    let url = updates.url !== undefined ? updates.url.trim() : l.url;
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    return {
      ...l,
      ...updates,
      url,
      updatedAt: new Date().toISOString()
    };
  });
  await saveQuickLinks(updated);
  return updated;
}

export async function deleteQuickLink(id: string): Promise<QuickLink[]> {
  const existing = await getQuickLinks();
  const updated = existing.filter(l => l.id !== id);
  await saveQuickLinks(updated);
  return updated;
}

export async function resetQuickLinksToDefault(): Promise<QuickLink[]> {
  await saveQuickLinks(DEFAULT_QUICK_LINKS);
  return DEFAULT_QUICK_LINKS;
}

