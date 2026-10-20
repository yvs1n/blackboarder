import { BUILD_INFO, BuildInfo } from '../buildInfo';

export interface RemoteUpdateInfo {
  commit: string;
  shortCommit: string;
  parentCommit?: string;
  parentShortCommit?: string;
  timestamp: string;
  message: string;
  version?: string;
  htmlUrl: string;
  downloadZipUrl: string;
  source: 'github-api' | 'github-raw' | 'cached';
}

export interface UpdateCheckResult {
  checked: boolean;
  updateAvailable: boolean;
  dismissed: boolean;
  local: BuildInfo;
  remote?: RemoteUpdateInfo;
  error?: string;
}

const GITHUB_API_URL = 'https://api.github.com/repos/yvs1n/blackboarder/commits/main';
const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/yvs1n/blackboarder/main/version.json';
const GITHUB_ZIP_URL = 'https://github.com/yvs1n/blackboarder/archive/refs/heads/main.zip';
const GITHUB_REPO_URL = 'https://github.com/yvs1n/blackboarder';

const STORAGE_KEY_CACHE = 'bbs_ext_update_cache';
const STORAGE_KEY_DISMISSED = 'bbs_dismissed_update_commit';
const STORAGE_KEY_ACKNOWLEDGED = 'bbs_acknowledged_update_commit';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const BUILD_COMMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes window for build-then-commit

/**
 * Safely access chrome.storage.local with localStorage fallback
 */
async function getStorageItem<T>(key: string): Promise<T | null> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get(key);
      return res ? (res[key] as T) : null;
    }
  } catch {}

  try {
    const val = localStorage.getItem(key);
    return val ? (JSON.parse(val) as T) : null;
  } catch {
    return null;
  }
}

async function setStorageItem<T>(key: string, value: T): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [key]: value });
      return;
    }
  } catch {}

  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/**
 * Fetch remote GitHub commit / version information with multi-tier fallback
 */
export async function fetchRemoteGitHubVersion(): Promise<RemoteUpdateInfo | null> {
  // 1. Primary: GitHub Commits API
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(GITHUB_API_URL, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Blackboarder-Extension'
      },
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.sha) {
        const fullSha = String(data.sha);
        const shortSha = fullSha.slice(0, 7);
        const parentSha = data.parents?.[0]?.sha ? String(data.parents[0].sha) : undefined;
        const parentShortSha = parentSha ? parentSha.slice(0, 7) : undefined;
        const commitMsg = String(data.commit?.message || 'New update').split('\n')[0].trim();
        const commitDate = data.commit?.committer?.date || data.commit?.author?.date || '';
        return {
          commit: fullSha,
          shortCommit: shortSha,
          parentCommit: parentSha,
          parentShortCommit: parentShortSha,
          timestamp: commitDate,
          message: commitMsg,
          htmlUrl: data.html_url || GITHUB_REPO_URL,
          downloadZipUrl: GITHUB_ZIP_URL,
          source: 'github-api'
        };
      }
    }
  } catch (err) {
    // API failed or rate-limited, fallback below
  }

  // 2. Fallback: Raw version.json from raw.githubusercontent.com (no rate limits)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(GITHUB_RAW_URL, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && (data.commit || data.shortCommit)) {
        const fullSha = String(data.commit || data.shortCommit);
        const shortSha = String(data.shortCommit || fullSha.slice(0, 7));
        return {
          commit: fullSha,
          shortCommit: shortSha,
          timestamp: data.timestamp || '',
          message: data.message || 'Latest release from GitHub',
          version: data.version,
          htmlUrl: GITHUB_REPO_URL,
          downloadZipUrl: GITHUB_ZIP_URL,
          source: 'github-raw'
        };
      }
    }
  } catch (err) {
    // Both endpoints unavailable
  }

  return null;
}

/**
 * Compare remote commit against local build info
 */
export function isRemoteNewer(
  remote: RemoteUpdateInfo,
  local: BuildInfo = BUILD_INFO,
  acknowledgedCommit?: string | null
): boolean {
  if (!remote || !remote.commit) return false;

  const remoteSha = remote.commit.toLowerCase();
  const remoteShort = remote.shortCommit.toLowerCase();
  const localSha = (local.commit || '').toLowerCase();
  const localShort = (local.shortCommit || '').toLowerCase();

  // If user already acknowledged/applied this exact remote commit
  if (acknowledgedCommit) {
    const ack = acknowledgedCommit.toLowerCase();
    if (ack === remoteSha || ack === remoteShort || remoteSha.startsWith(ack)) {
      return false;
    }
  }

  // If SHAs are identical, already on latest version
  if (
    remoteSha === localSha ||
    remoteShort === localShort ||
    (localShort && remoteSha.startsWith(localShort)) ||
    (remoteShort && localSha.startsWith(remoteShort))
  ) {
    return false;
  }

  // If remote commit's immediate parent is local.commit (because build.js ran right before git commit)
  const parentSha = (remote.parentCommit || '').toLowerCase();
  const parentShort = (remote.parentShortCommit || '').toLowerCase();
  if (
    (parentSha && (parentSha === localSha || parentSha.startsWith(localShort))) ||
    (parentShort && (parentShort === localShort || localSha.startsWith(parentShort)))
  ) {
    if (remote.timestamp && local.timestamp) {
      const remoteTime = new Date(remote.timestamp).getTime();
      const localTime = new Date(local.timestamp).getTime();
      if (!isNaN(remoteTime) && !isNaN(localTime)) {
        // If committed within the build-then-commit window (or earlier), it is the commit for this build
        if (remoteTime - localTime <= BUILD_COMMIT_WINDOW_MS) {
          return false;
        }
      } else {
        return false;
      }
    } else {
      return false;
    }
  }

  // If commit messages are identical, the build was made for this exact update
  if (remote.message && local.message && remote.message.trim() === local.message.trim()) {
    return false;
  }

  // Compare timestamps if available
  if (remote.timestamp && local.timestamp) {
    const remoteTime = new Date(remote.timestamp).getTime();
    const localTime = new Date(local.timestamp).getTime();
    if (!isNaN(remoteTime) && !isNaN(localTime)) {
      return remoteTime > localTime;
    }
  }

  // If commits differ and remote is present, treat as update
  return true;
}

/**
 * Check if an extension update is available on GitHub
 */
export async function checkExtensionUpdate(force = false): Promise<UpdateCheckResult> {
  const dismissedCommit = await getStorageItem<string>(STORAGE_KEY_DISMISSED);
  const acknowledgedCommit = await getStorageItem<string>(STORAGE_KEY_ACKNOWLEDGED);

  // Check cache first if not forced
  if (!force) {
    const cached = await getStorageItem<{ time: number; data: RemoteUpdateInfo }>(STORAGE_KEY_CACHE);
    if (cached && (Date.now() - cached.time < CACHE_TTL_MS) && cached.data) {
      const available = isRemoteNewer(cached.data, BUILD_INFO, acknowledgedCommit);
      const isDismissed = Boolean(
        dismissedCommit &&
        (dismissedCommit === cached.data.commit || dismissedCommit === cached.data.shortCommit)
      );
      return {
        checked: true,
        updateAvailable: available,
        dismissed: isDismissed,
        local: BUILD_INFO,
        remote: cached.data
      };
    }
  }

  const remote = await fetchRemoteGitHubVersion();
  if (!remote) {
    return {
      checked: true,
      updateAvailable: false,
      dismissed: false,
      local: BUILD_INFO,
      error: 'Could not connect to GitHub. Check your internet connection.'
    };
  }

  // Save successful response in cache
  await setStorageItem(STORAGE_KEY_CACHE, { time: Date.now(), data: remote });

  const updateAvailable = isRemoteNewer(remote, BUILD_INFO, acknowledgedCommit);
  const dismissed = Boolean(
    dismissedCommit &&
    (dismissedCommit === remote.commit || dismissedCommit === remote.shortCommit)
  );

  return {
    checked: true,
    updateAvailable,
    dismissed,
    local: BUILD_INFO,
    remote
  };
}

/**
 * Dismiss the current update prompt for this commit
 */
export async function dismissExtensionUpdate(commit: string): Promise<void> {
  if (!commit) return;
  await setStorageItem(STORAGE_KEY_DISMISSED, commit);
}

/**
 * Acknowledge that the extension was updated/reloaded for this commit
 */
export async function acknowledgeExtensionUpdate(commit: string): Promise<void> {
  if (!commit) return;
  await setStorageItem(STORAGE_KEY_ACKNOWLEDGED, commit);
}

/**
 * Reload the extension
 */
export function reloadExtension(): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.reload) {
      chrome.runtime.reload();
      return;
    }
  } catch {}

  window.location.reload();
}
