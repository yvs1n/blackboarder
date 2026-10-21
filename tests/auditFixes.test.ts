import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../mobile-web/_worker.js';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';
import { generateIcsContent } from '../src/utils/calendar';
import { normalizeSyncUrl, pushTasksToSyncServer } from '../src/utils/syncClient';
import { sanitizeCloudTasks, recordTaskDeletionInFirebase, updateTaskStatusInFirebase } from '../src/utils/firebaseSync';
import { generateUniqueSyncKey, canUseSameOriginProxy } from '../src/utils/storage';
import { Announcement, DeadlineTask, DEFAULT_SETTINGS } from '../src/types';

const baseTask = (over: Partial<DeadlineTask> = {}): DeadlineTask => ({
  id: 't1',
  courseCode: '0401201',
  courseName: 'Physics 1',
  title: 'Quiz 1',
  description: '',
  dueDate: '2026-11-10T10:00:00.000Z',
  hasSpecificTime: true,
  type: 'quiz',
  priority: 'medium',
  status: 'pending',
  sourceSnippet: '',
  confidence: 1,
  extractedBy: 'manual',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over
});

const ann = (text: string, postedAt: string): Announcement => ({
  id: 'a1',
  courseCode: '0401201',
  courseName: 'Physics 1',
  title: 'Quiz announcement',
  contentText: text,
  postedAt,
  sourceUrl: 'https://example.test',
  scannedAt: postedAt
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('local extractor date fixes', () => {
  it('parses ISO dates (YYYY-MM-DD)', () => {
    const tasks = extractDeadlinesLocally(
      ann('The quiz will be held on 2026-11-15 at 11:00 am in the lecture hall.', '2026-10-20T08:00:00.000Z')
    );
    expect(tasks.length).toBeGreaterThan(0);
    const due = new Date(tasks[0].dueDate);
    expect([due.getFullYear(), due.getMonth() + 1, due.getDate()]).toEqual([2026, 11, 15]);
  });

  it('rolls a year-less date over into next year when posted in late December', () => {
    const tasks = extractDeadlinesLocally(ann('Quiz 2 will be on Jan 7 at 10:00 am.', '2026-12-28T08:00:00.000Z'));
    expect(tasks.length).toBeGreaterThan(0);
    expect(new Date(tasks[0].dueDate).getFullYear()).toBe(2027);
  });

  it('recognises Arabic midnight wording', () => {
    const tasks = extractDeadlinesLocally(ann('Assignment due on Nov 20 منتصف الليل', '2026-11-01T08:00:00.000Z'));
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].hasSpecificTime).toBe(true);
  });
});

describe('ICS escaping', () => {
  it('escapes commas and semicolons instead of deleting them', () => {
    const ics = generateIcsContent([baseTask({ title: 'Lab, part 2; final', room: 'A8, 103' })]);
    expect(ics).toContain('Lab\\, part 2\\; final');
    expect(ics).toContain('LOCATION:A8\\, 103');
  });
});

describe('sync client', () => {
  it('only treats real pages.dev hosts as hosted dashboards', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ count: 1 }), { status: 200 }));
    await pushTasksToSyncServer([baseTask()], {
      ...DEFAULT_SETTINGS,
      syncServerUrl: 'https://pages.dev.example.com',
      syncKey: 'BBS-TEST'
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('sends the sync key, courses and tombstones to custom servers', async () => {
    let url = '';
    let body: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (u: any, init: any) => {
      url = String(u);
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ count: 1 }), { status: 200 });
    }) as any);
    await pushTasksToSyncServer(
      [baseTask()],
      { ...DEFAULT_SETTINGS, syncServerUrl: 'https://sync.example.com', syncKey: 'BBS-TEST' },
      undefined,
      { courses: [], coursesUpdatedAt: '2026-10-01T00:00:00.000Z', tombstones: { gone: '2026-10-02T00:00:00.000Z' } }
    );
    expect(url).toContain('/api/sync?key=BBS-TEST');
    expect(body.syncKey).toBe('BBS-TEST');
    expect(body.tombstones).toEqual({ gone: '2026-10-02T00:00:00.000Z' });
    expect(normalizeSyncUrl('sync.example.com')).toBe('https://sync.example.com');
  });
});

describe('Firebase updates keep the rest of the cloud document', () => {
  const stored = {
    tasks: [baseTask({ id: 'keep' }), baseTask({ id: 'drop', title: 'Drop me' })],
    quickLinks: [{ id: 'ql_1', title: 'Grades', url: 'https://example.com', category: 'academic', createdAt: '2026-10-01T00:00:00.000Z' }],
    courses: [{ id: 'c1' }],
    coursesUpdatedAt: '2026-10-05T00:00:00.000Z',
    tombstones: { old: '2026-09-01T00:00:00.000Z' },
    lastSync: '2026-10-01T00:00:00.000Z',
    count: 2
  };

  function mockFirebase() {
    const puts: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (_u: any, init: any) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(init.body));
        return new Response('{}', { status: 200 });
      }
      return new Response(JSON.stringify(stored), { status: 200 });
    }) as any);
    return puts;
  }

  it('status updates do not wipe quick links, courses or tombstones', async () => {
    const puts = mockFirebase();
    expect(await updateTaskStatusInFirebase('keep', 'completed', 'BBS-TEST')).toBe(true);
    expect(puts[0].quickLinks).toHaveLength(1);
    expect(puts[0].courses).toHaveLength(1);
    expect(puts[0].courses[0].id).toBe("c1");
    expect(puts[0].tombstones).toEqual({ old: '2026-09-01T00:00:00.000Z' });
  });

  it('deleting records a tombstone', async () => {
    const puts = mockFirebase();
    expect(await recordTaskDeletionInFirebase('drop', 'Test', 'BBS-TEST')).toBe(true);
    expect(puts[0].tasks.map((t: DeadlineTask) => t.id)).toEqual(['keep']);
    expect(puts[0].tombstones.drop).toBeTruthy();
    expect(puts[0].tombstones.old).toBeTruthy();
    expect(puts[0].quickLinks).toHaveLength(1);
  });

  it('drops cloud tasks with ids that could carry HTML', () => {
    const result = sanitizeCloudTasks([
      baseTask({ id: 'ok_1' }),
      baseTask({ id: 'x" onmouseover="alert(1)' }),
      baseTask({ id: 'ok_2', type: '<img src=x>' as any })
    ]);
    expect(result.map(t => t.id)).toEqual(['ok_1', 'ok_2']);
    expect(result[1].type).toBe('other');
  });
});

describe('Pages worker isolation', () => {
  const env = { SKIP_FIREBASE: true };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`https://x.test${path}`, { method: 'POST', body: JSON.stringify(body), headers }), env);

  it("never serves one sync key's data to another when storage is memory-only", async () => {
    await post('/api/sync?key=BBS-AAAA', { tasks: [baseTask({ id: 'secret' })] });
    const other = await worker.fetch(new Request('https://x.test/api/tasks?key=BBS-BBBB'), env);
    const json = await other.json();
    expect(json.tasks).toEqual([]);
  });

  it('keeps stored quick links, courses and tombstones when a sync omits them', async () => {
    await post('/api/sync?key=BBS-KEEP', {
      tasks: [baseTask()],
      quickLinks: [{ id: 'ql_x', title: 'T', url: 'https://e.com' }],
      courses: [{ id: 'c' }],
      tombstones: { dead: '2026-10-01T00:00:00.000Z' }
    });
    await post('/api/sync?key=BBS-KEEP', { tasks: [baseTask()] });
    const res = await worker.fetch(new Request('https://x.test/api/tasks?key=BBS-KEEP'), env);
    const json = await res.json();
    expect(json.quickLinks).toHaveLength(1);
    expect(json.courses).toEqual([{ id: 'c' }]);
  });

  it('requires the secret for writes when SYNC_SECRET is configured', async () => {
    const guarded = { SKIP_FIREBASE: true, SYNC_SECRET: 's3cret' };
    const denied = await worker.fetch(
      new Request('https://x.test/api/sync?key=BBS-SEC', { method: 'POST', body: JSON.stringify({ tasks: [] }) }),
      guarded
    );
    expect(denied.status).toBe(401);
    const allowed = await worker.fetch(
      new Request('https://x.test/api/sync?key=BBS-SEC', {
        method: 'POST',
        body: JSON.stringify({ tasks: [] }),
        headers: { 'x-sync-secret': 's3cret' }
      }),
      guarded
    );
    expect(allowed.status).toBe(200);
  });
});

describe('misc helpers', () => {
  it('generates well-formed sync keys', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateUniqueSyncKey()).toMatch(/^BBS-[A-HJ-NP-Z2-9]{6}$/);
    }
  });

  it('never allows the same-origin AI proxy on Blackboard hosts', () => {
    const g = globalThis as any;
    g.window = { location: { protocol: 'https:', hostname: 'blackboard.sharjah.ac.ae' } };
    expect(canUseSameOriginProxy()).toBe(false);
    g.window = { location: { protocol: 'https:', hostname: 'blackboarder.pages.dev' } };
    expect(canUseSameOriginProxy()).toBe(true);
    g.window = { location: { protocol: 'chrome-extension:', hostname: 'abc' } };
    expect(canUseSameOriginProxy()).toBe(false);
    delete g.window;
  });
});
