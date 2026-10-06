import { DeadlineTask } from '../types';

export type TombstoneMap = Record<string, string>;

function taskTime(task: DeadlineTask): number {
  return new Date(task.updatedAt || task.createdAt || 0).getTime() || 0;
}

/** Union of two tombstone maps; for the same id the later deletion time wins. */
export function mergeTombstones(a: TombstoneMap = {}, b: TombstoneMap = {}): TombstoneMap {
  const out: TombstoneMap = { ...a };
  for (const [id, time] of Object.entries(b)) {
    const existing = out[id];
    if (!existing || new Date(time).getTime() > new Date(existing).getTime()) {
      out[id] = time;
    }
  }
  return out;
}

function isDeleted(task: DeadlineTask, tombstones: TombstoneMap): boolean {
  const tomb = tombstones[task.id];
  if (!tomb) return false;
  const tombTime = new Date(tomb).getTime();
  return !isNaN(tombTime) && tombTime >= taskTime(task);
}

// Optional fields: when the cloud copy is newer and omits one of these, the
// omission is deliberate (the user cleared it) and must propagate.
const OPTIONAL_FIELDS = ['room', 'notes', 'weight', 'weightDisplay', 'syllabusNote'] as const;

// Fields that fill a gap on a locally-newer task without overriding local edits.
const GAP_FILL_FIELDS = [
  'courseName', 'courseCode', 'notes', 'room', 'description', 'sourceSnippet',
  'weight', 'weightDisplay', 'syllabusNote'
] as const;

function adoptCloud(local: DeadlineTask, cloud: DeadlineTask): DeadlineTask {
  const merged: any = {
    ...local,
    ...cloud,
    courseName: cloud.courseName || local.courseName,
    courseCode: cloud.courseCode !== undefined ? cloud.courseCode : local.courseCode,
    title: cloud.title || local.title,
    dueDate: cloud.dueDate || local.dueDate,
    type: cloud.type || local.type,
    priority: cloud.priority || local.priority,
    status: cloud.status || local.status,
    updatedAt: cloud.updatedAt || local.updatedAt
  };
  for (const field of OPTIONAL_FIELDS) {
    if ((cloud as any)[field] === undefined) merged[field] = undefined;
  }
  return merged as DeadlineTask;
}

function fillGaps(local: DeadlineTask, cloud: DeadlineTask, sameTime: boolean): DeadlineTask {
  const merged: any = { ...local };
  for (const field of GAP_FILL_FIELDS) {
    const localVal = (local as any)[field];
    const cloudVal = (cloud as any)[field];
    const localEmpty = localVal === undefined || localVal === null || localVal === '';
    const cloudHas = cloudVal !== undefined && cloudVal !== null && cloudVal !== '';
    if (localEmpty && cloudHas) merged[field] = cloudVal;
  }
  if (sameTime && cloud.status && cloud.status !== local.status) {
    merged.status = cloud.status;
  }
  return merged as DeadlineTask;
}

/**
 * Merges the cloud task list into the local list.
 * - Newer `updatedAt` wins per task; a locally-newer task is never overridden.
 * - Tombstones delete matching tasks on either side unless the task was edited after the deletion.
 * - Cloud-only tasks are added unless tombstoned.
 */
export function mergeCloudTasks(
  localTasks: DeadlineTask[],
  cloudTasks: DeadlineTask[],
  tombstones: TombstoneMap = {}
): { tasks: DeadlineTask[]; changed: boolean } {
  const merged = new Map<string, DeadlineTask>();
  let changed = false;

  for (const task of localTasks) {
    if (isDeleted(task, tombstones)) {
      changed = true;
      continue;
    }
    merged.set(task.id, task);
  }

  for (const cloud of cloudTasks) {
    if (isDeleted(cloud, tombstones)) continue;

    const local = merged.get(cloud.id);
    if (!local) {
      merged.set(cloud.id, cloud);
      changed = true;
      continue;
    }

    const localTime = taskTime(local);
    const cloudTime = taskTime(cloud);
    const next = cloudTime > localTime ? adoptCloud(local, cloud) : fillGaps(local, cloud, cloudTime === localTime);
    if (JSON.stringify(next) !== JSON.stringify(local)) {
      merged.set(cloud.id, next);
      changed = true;
    }
  }

  const tasks = Array.from(merged.values()).sort(
    (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  );
  return { tasks, changed };
}
