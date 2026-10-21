import { describe, it, expect, vi } from 'vitest';
import {
  getFirebaseDataUrl,
  pushTasksToFirebase,
  fetchTasksFromFirebase,
  updateTaskStatusInFirebase,
  FIREBASE_DB_URL
} from '../src/utils/firebaseSync';
import pagesWorker from '../mobile-web/_worker.js';
import { DeadlineTask } from '../src/types';

describe('Multi-User Sync Key Isolation Suite', () => {
  const sampleTasks = [
    {
      id: 'task-isolated-1',
      courseCode: '1440131',
      courseName: 'Calculus I',
      title: 'Chapter 2 Quiz',
      description: 'Limits and continuity',
      dueDate: '2026-10-10T10:00:00.000Z',
      hasSpecificTime: true,
      type: 'quiz',
      priority: 'medium',
      status: 'pending',
      createdAt: '2026-09-28T00:00:00.000Z',
      updatedAt: '2026-09-28T00:00:00.000Z'
    }
  ] as unknown as DeadlineTask[];

  describe('Endpoint Scoping & URL Generation', () => {
    it('generates user-scoped URL when syncKey is provided', () => {
      const url = getFirebaseDataUrl('BBS-9A2K');
      expect(url).toBe(`${FIREBASE_DB_URL}/users/BBS-9A2K/data.json`);
    });

    it('sanitizes unsafe characters in syncKey', () => {
      const url = getFirebaseDataUrl('BBS-9A2K?admin=1&bad=$#');
      expect(url).toBe(`${FIREBASE_DB_URL}/users/BBS-9A2Kadmin1bad/data.json`);
    });

    it('falls back to root /data.json when syncKey is empty, undefined, or whitespace', () => {
      expect(getFirebaseDataUrl(undefined)).toBe(`${FIREBASE_DB_URL}/data.json`);
      expect(getFirebaseDataUrl('')).toBe(`${FIREBASE_DB_URL}/data.json`);
      expect(getFirebaseDataUrl('   ')).toBe(`${FIREBASE_DB_URL}/data.json`);
    });
  });

  describe('Scoped Firebase CRUD Operations', () => {
    it('pushTasksToFirebase writes to user-scoped endpoint when syncKey is provided and does not mirror to root', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

      const result = await pushTasksToFirebase(sampleTasks, 'Chrome Extension', 'BBS-USER1');

      expect(result.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${FIREBASE_DB_URL}/users/BBS-USER1/data.json`,
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"syncKey":"BBS-USER1"')
        })
      );
      expect(fetchSpy).not.toHaveBeenCalledWith(
        `${FIREBASE_DB_URL}/data.json`,
        expect.anything()
      );

      fetchSpy.mockRestore();
    });

    it('fetchTasksFromFirebase reads from user-scoped endpoint when syncKey is provided', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tasks: sampleTasks,
            syncKey: 'BBS-USER2',
            lastSync: '2026-09-28T12:00:00.000Z',
            count: 1
          }),
          { status: 200 }
        )
      );

      const result = await fetchTasksFromFirebase('BBS-USER2');

      expect(result.success).toBe(true);
      expect(result.tasks.length).toBe(1);
      expect(result.tasks[0].id).toBe('task-isolated-1');
      expect(fetchSpy).toHaveBeenCalledWith(
        `${FIREBASE_DB_URL}/users/BBS-USER2/data.json`,
        expect.any(Object)
      );

      fetchSpy.mockRestore();
    });

    it('updateTaskStatusInFirebase updates within the user-scoped bucket', async () => {
      const initialPayload = {
        tasks: [{ ...sampleTasks[0], status: 'pending' }],
        lastSync: '2026-09-28T10:00:00.000Z',
        count: 1
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify(initialPayload), { status: 200 }))
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const success = await updateTaskStatusInFirebase('task-isolated-1', 'completed', 'BBS-USER3');

      expect(success).toBe(true);
      expect(fetchSpy).toHaveBeenNthCalledWith(
        1,
        `${FIREBASE_DB_URL}/users/BBS-USER3/data.json`,
        expect.any(Object)
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        `${FIREBASE_DB_URL}/users/BBS-USER3/data.json`,
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"status":"completed"')
        })
      );

      fetchSpy.mockRestore();
    });
  });

  describe('Cloudflare Pages Edge Worker Multi-Tenancy', () => {
    it('/api/tasks with ?key= routes to scoped Firebase URL', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tasks: sampleTasks,
            lastSync: '2026-09-28T10:00:00.000Z',
            syncKey: 'BBS-EDGE1'
          }),
          { status: 200 }
        )
      );

      const req = new Request('https://sidekick.pages.dev/api/tasks?key=BBS-EDGE1');
      const res = await pagesWorker.fetch(req, {});
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.tasks.length).toBe(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${FIREBASE_DB_URL}/users/BBS-EDGE1/data.json`,
        expect.any(Object)
      );

      fetchSpy.mockRestore();
    });

    it('/feed.ics with ?key= scopes calendar feed to user tasks', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tasks: sampleTasks,
            lastSync: '2026-09-28T10:00:00.000Z',
            syncKey: 'BBS-EDGE2'
          }),
          { status: 200 }
        )
      );

      const req = new Request('https://sidekick.pages.dev/feed.ics?key=BBS-EDGE2');
      const res = await pagesWorker.fetch(req, {});
      const ics = await res.text();

      expect(res.status).toBe(200);
      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('X-WR-CALNAME:Blackboard Deadlines (BBS-EDGE2)');
      expect(ics).toContain('SUMMARY:[1440131] Chapter 2 Quiz');
      expect(fetchSpy).toHaveBeenCalledWith(
        `${FIREBASE_DB_URL}/users/BBS-EDGE2/data.json`,
        expect.any(Object)
      );

      fetchSpy.mockRestore();
    });
  });

  describe('Pairing Query Parameter Parsing', () => {
    it('correctly extracts and formats pairing keys from URLs', () => {
      const rawUrl = 'https://blackboarder.pages.dev/?key=bbs-9a2k';
      const parsedUrl = new URL(rawUrl);
      const key = parsedUrl.searchParams.get('key')?.toUpperCase();

      expect(key).toBe('BBS-9A2K');
      expect(key).toMatch(/^BBS-[A-Z0-9]{4,8}$/);
    });
  });

  describe('Auto-Generated Sync Key & Discovered Courses Suite', () => {
    it('generates a unique BBS- prefix sync key with 6 uppercase alphanumeric characters', async () => {
      const { generateUniqueSyncKey } = await import('../src/utils/storage');
      const key1 = generateUniqueSyncKey();
      const key2 = generateUniqueSyncKey();

      expect(key1).toMatch(/^BBS-[A-Z0-9]{6}$/);
      expect(key2).toMatch(/^BBS-[A-Z0-9]{6}$/);
      expect(key1).not.toBe(key2);
    });

    it('autoRegisterDiscoveredCourses assigns vibrant palette colors to newly found courses', async () => {
      const { autoRegisterDiscoveredCourses } = await import('../src/utils/storage');
      const result = await autoRegisterDiscoveredCourses([
        { courseName: 'Signals & Systems', courseCode: '1502211' },
        { courseName: 'Probability & Statistics', courseCode: '1440211' }
      ]);

      expect(result.length).toBeGreaterThanOrEqual(2);
      const sigCourse = result.find(c => c.courseCode === '1502211');
      const probCourse = result.find(c => c.courseCode === '1440211');

      expect(sigCourse).toBeDefined();
      expect(sigCourse?.colorHex).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(probCourse).toBeDefined();
      expect(probCourse?.colorHex).toMatch(/^#[0-9a-fA-F]{6}$/);
      // Ensure palette assigns colors
      expect(sigCourse?.colorHex).not.toBe(probCourse?.colorHex);
    });
  });
});
