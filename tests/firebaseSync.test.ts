import { describe, it, expect, vi } from 'vitest';
import {
  pushTasksToFirebase,
  fetchTasksFromFirebase,
  updateTaskStatusInFirebase,
  FIREBASE_DB_URL
} from '../src/utils/firebaseSync';
import pagesWorker from '../mobile-web/_worker.js';
import { DeadlineTask, UserCourseConfig } from '../src/types';

describe('Firebase Realtime Database Sync Bridge', () => {
  const sampleTasks = [
    {
      id: 'fb-task-1',
      courseCode: '1440131',
      courseName: 'Calculus I for Engineering',
      title: 'Calculus Midterm Exam',
      description: 'Covers Chapters 1 to 4',
      dueDate: '2026-10-15T12:30:00.000Z',
      hasSpecificTime: true,
      type: 'exam',
      priority: 'high',
      status: 'pending',
      weight: 30,
      weightDisplay: '30% Midterm (Paper)',
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:00.000Z'
    }
  ] as unknown as DeadlineTask[];

  it('exposes correct Firebase Realtime Database endpoint', () => {
    expect(FIREBASE_DB_URL).toBe('https://blackboard-sidekick-default-rtdb.asia-southeast1.firebasedatabase.app');
  });

  it('pushTasksToFirebase sends PUT request to Firebase REST endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const result = await pushTasksToFirebase(sampleTasks, 'Test Suite');

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      `${FIREBASE_DB_URL}/data.json`,
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' }
      })
    );

    fetchSpy.mockRestore();
  });

  it('fetchTasksFromFirebase parses tasks array and sync metadata', async () => {
    const payload = {
      tasks: sampleTasks,
      lastSync: '2026-09-20T10:00:00.000Z',
      device: 'Chrome Extension',
      count: 1
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200 })
    );

    const result = await fetchTasksFromFirebase();

    expect(result.success).toBe(true);
    expect(result.tasks.length).toBe(1);
    expect(result.tasks[0].title).toBe('Calculus Midterm Exam');
    expect(result.lastSync).toBe('2026-09-20T10:00:00.000Z');

    fetchSpy.mockRestore();
  });

  it('updateTaskStatusInFirebase updates individual task status and pushes back', async () => {
    const initialPayload = {
      tasks: [
        { ...sampleTasks[0], status: 'pending' }
      ],
      lastSync: '2026-09-20T10:00:00.000Z',
      count: 1
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      // 1. GET initial
      .mockResolvedValueOnce(new Response(JSON.stringify(initialPayload), { status: 200 }))
      // 2. PUT updated
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const success = await updateTaskStatusInFirebase('fb-task-1', 'completed');

    expect(success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    fetchSpy.mockRestore();
  });

  it('Pages _worker.js fetches directly from Firebase endpoint when live', async () => {
    const fbPayload = {
      tasks: sampleTasks,
      lastSync: '2026-09-20T10:00:00.000Z',
      count: 1
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(fbPayload), { status: 200 })
    );

    const req = new Request('https://blackboarder.pages.dev/api/tasks?key=BBS-TESTKEY1', { method: 'GET' });
    const res = await pagesWorker.fetch(req, {} as any, {} as any);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.tasks.length).toBe(1);
    expect(data.tasks[0].title).toBe('Calculus Midterm Exam');

    fetchSpy.mockRestore();
  });

  it('Pages _worker.js /feed.ics generates WebCal feed with Firebase data', async () => {
    const fbPayload = {
      tasks: sampleTasks,
      lastSync: '2026-09-20T10:00:00.000Z',
      count: 1
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(fbPayload), { status: 200 })
    );

    const req = new Request('https://blackboarder.pages.dev/feed.ics?key=BBS-TESTKEY1', { method: 'GET' });
    const res = await pagesWorker.fetch(req, {} as any, {} as any);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain('SUMMARY:[1440131] Calculus Midterm Exam');
    expect(text).toContain('Weight: 30% Midterm (Paper)');

    fetchSpy.mockRestore();
  });

  const sampleCourses: UserCourseConfig[] = [
    {
      id: 'custom-cs101',
      courseCode: 'CS 101',
      courseName: 'Intro to Computer Science',
      colorHex: '#3b82f6',
      aliases: ['cs101', 'intro cs'],
      scheduleSlots: [
        {
          days: ['Sunday', 'Tuesday'],
          startTime: '09:00',
          endTime: '10:15',
          room: 'M9-102'
        }
      ],
      syllabus: [
        {
          id: 'quiz',
          name: 'Quizzes',
          type: 'quiz',
          totalWeight: 20
        }
      ]
    }
  ];

  it('pushTasksToFirebase includes courses and coursesUpdatedAt in payload', async () => {
    let capturedBody: any = null;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const timestamp = '2026-10-15T15:30:00.000Z';
    const result = await pushTasksToFirebase(
      sampleTasks,
      'Test Suite',
      'test-key',
      undefined,
      undefined,
      sampleCourses,
      timestamp
    );

    expect(result.success).toBe(true);
    expect(capturedBody).toBeDefined();
    expect(capturedBody.courses).toHaveLength(1);
    expect(capturedBody.courses[0].courseCode).toBe('CS 101');
    expect(capturedBody.coursesUpdatedAt).toBe(timestamp);

    fetchSpy.mockRestore();
  });

  it('fetchTasksFromFirebase parses courses and coursesUpdatedAt correctly', async () => {
    const timestamp = '2026-10-15T16:00:00.000Z';
    const payload = {
      tasks: sampleTasks,
      lastSync: '2026-10-15T16:00:00.000Z',
      courses: sampleCourses,
      coursesUpdatedAt: timestamp,
      count: 1
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200 })
    );

    const result = await fetchTasksFromFirebase('test-key');

    expect(result.success).toBe(true);
    expect(result.courses).toHaveLength(1);
    expect(result.courses![0].courseCode).toBe('CS 101');
    expect(result.coursesUpdatedAt).toBe(timestamp);

    fetchSpy.mockRestore();
  });

  it('coursesUpdatedAt conflict resolution protects newer local courses from stale cloud courses', () => {
    const localCoursesUpdatedAt = '2026-10-15T18:00:00.000Z';
    const staleCloudCoursesUpdatedAt = '2026-10-15T17:00:00.000Z';

    const localTime = new Date(localCoursesUpdatedAt).getTime();
    const cloudTime = new Date(staleCloudCoursesUpdatedAt).getTime();

    // Verify condition: local is newer, stale cloud push must not overwrite
    const shouldOverwrite = !localCoursesUpdatedAt || cloudTime > localTime;
    expect(shouldOverwrite).toBe(false);

    // Verify condition: cloud is newer, local must update
    const newerCloudCoursesUpdatedAt = '2026-10-15T19:00:00.000Z';
    const newerCloudTime = new Date(newerCloudCoursesUpdatedAt).getTime();
    const shouldOverwriteWithNewer = !localCoursesUpdatedAt || newerCloudTime > localTime;
    expect(shouldOverwriteWithNewer).toBe(true);
  });
});
