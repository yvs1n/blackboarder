import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  pushTasksToFirebase,
  fetchTasksFromFirebase,
  updateTaskStatusInFirebase,
  FIREBASE_DB_URL
} from '../src/utils/firebaseSync';
import pagesWorker from '../mobile-web/_worker.js';
import { DeadlineTask } from '../src/types';

describe('Firebase Realtime Database Sync Bridge', () => {
  const sampleTasks: DeadlineTask[] = [
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
  ];

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

    const req = new Request('https://yassinr-uossidekick.pages.dev/api/tasks', { method: 'GET' });
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

    const req = new Request('https://yassinr-uossidekick.pages.dev/feed.ics', { method: 'GET' });
    const res = await pagesWorker.fetch(req, {} as any, {} as any);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain('SUMMARY:[1440131] Calculus Midterm Exam');
    expect(text).toContain('Weight: 30% Midterm (Paper)');

    fetchSpy.mockRestore();
  });
});
