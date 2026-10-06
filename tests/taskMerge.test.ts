import { describe, it, expect } from 'vitest';
import { mergeCloudTasks, mergeTombstones } from '../src/utils/taskMerge';
import { DeadlineTask } from '../src/types';

function makeTask(overrides: Partial<DeadlineTask> = {}): DeadlineTask {
  return {
    id: 't1',
    courseCode: '1440133',
    courseName: 'Calculus I for Engineering',
    title: 'Quiz 1',
    description: 'Dr announced',
    dueDate: '2026-10-15T12:30:00.000Z',
    hasSpecificTime: true,
    type: 'quiz',
    priority: 'high',
    status: 'pending',
    sourceSnippet: 'Dr announced',
    confidence: 1,
    extractedBy: 'local',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides
  };
}

describe('mergeCloudTasks', () => {
  it('keeps a locally-newer edit instead of reverting it to stale cloud values', () => {
    const local = makeTask({ room: 'A8-200', notes: 'bring calculator', updatedAt: '2026-10-05T10:00:00.000Z' });
    const cloud = makeTask({ room: 'A8-103', notes: 'old note', updatedAt: '2026-10-02T10:00:00.000Z' });
    const { tasks, changed } = mergeCloudTasks([local], [cloud]);
    expect(changed).toBe(false);
    expect(tasks[0].room).toBe('A8-200');
    expect(tasks[0].notes).toBe('bring calculator');
  });

  it('adopts a cloud-newer edit including fields the phone cleared', () => {
    const local = makeTask({ room: 'A8-103', notes: 'old note' });
    const cloud = makeTask({ notes: '', updatedAt: '2026-10-05T10:00:00.000Z', title: 'Quiz 1 (moved)' });
    const { tasks, changed } = mergeCloudTasks([local], [cloud]);
    expect(changed).toBe(true);
    expect(tasks[0].title).toBe('Quiz 1 (moved)');
    expect(tasks[0].room).toBeUndefined();
    expect(tasks[0].notes).toBe('');
  });

  it('fills gaps on a locally-newer task without overriding existing values', () => {
    const local = makeTask({ updatedAt: '2026-10-05T10:00:00.000Z' });
    const cloud = makeTask({ room: 'A8-103', updatedAt: '2026-10-02T10:00:00.000Z' });
    const { tasks } = mergeCloudTasks([local], [cloud]);
    expect(tasks[0].room).toBe('A8-103');
  });

  it('adds cloud-only tasks', () => {
    const { tasks, changed } = mergeCloudTasks([], [makeTask({ id: 'new' })]);
    expect(changed).toBe(true);
    expect(tasks.map(t => t.id)).toEqual(['new']);
  });

  it('removes tasks deleted on the other device and does not resurrect them', () => {
    const task = makeTask();
    const tombstones = { t1: '2026-10-03T00:00:00.000Z' };
    const { tasks, changed } = mergeCloudTasks([task], [task], tombstones);
    expect(changed).toBe(true);
    expect(tasks).toHaveLength(0);
  });

  it('does not resurrect a task deleted locally when the cloud copy is still old', () => {
    const cloud = makeTask();
    const { tasks } = mergeCloudTasks([], [cloud], { t1: '2026-10-03T00:00:00.000Z' });
    expect(tasks).toHaveLength(0);
  });

  it('keeps a task that was edited after its tombstone (undo restore)', () => {
    const restored = makeTask({ updatedAt: '2026-10-04T00:00:00.000Z' });
    const { tasks } = mergeCloudTasks([restored], [], { t1: '2026-10-03T00:00:00.000Z' });
    expect(tasks).toHaveLength(1);
  });

  it('sorts merged tasks by due date', () => {
    const a = makeTask({ id: 'a', dueDate: '2026-10-20T00:00:00.000Z' });
    const b = makeTask({ id: 'b', dueDate: '2026-10-10T00:00:00.000Z' });
    const { tasks } = mergeCloudTasks([a], [b]);
    expect(tasks.map(t => t.id)).toEqual(['b', 'a']);
  });
});

describe('mergeTombstones', () => {
  it('keeps the later deletion time per id', () => {
    const merged = mergeTombstones(
      { a: '2026-10-01T00:00:00.000Z', b: '2026-10-05T00:00:00.000Z' },
      { a: '2026-10-02T00:00:00.000Z', b: '2026-10-04T00:00:00.000Z', c: '2026-10-03T00:00:00.000Z' }
    );
    expect(merged).toEqual({
      a: '2026-10-02T00:00:00.000Z',
      b: '2026-10-05T00:00:00.000Z',
      c: '2026-10-03T00:00:00.000Z'
    });
  });
});
