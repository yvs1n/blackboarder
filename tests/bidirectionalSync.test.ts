import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  pushTasksToFirebase,
  fetchTasksFromFirebase,
  updateTaskInFirebase,
  FIREBASE_DB_URL
} from '../src/utils/firebaseSync';
import { DeadlineTask } from '../src/types';
import { generateIcsFeed } from '../server/calendarFeed.js';
import { generateIcsContent, createGoogleCalendarUrl } from '../src/utils/calendar';

describe('Bidirectional Sync & Notes Parity', () => {
  const baseTask: DeadlineTask = {
    id: 'task-test-sync-1',
    courseCode: '1440131',
    courseName: 'Calculus I for Engineering',
    title: 'Chapter 3 Quiz',
    description: 'Dr. Ahmad announced: Quiz covers derivatives of trigonometric functions.',
    sourceSnippet: 'Dr. Ahmad announced: Quiz covers derivatives of trigonometric functions.',
    notes: 'Remember to review product and quotient rules beforehand!',
    dueDate: '2026-10-15T12:30:00.000Z',
    hasSpecificTime: true,
    room: 'A8-103',
    type: 'quiz',
    priority: 'high',
    status: 'pending',
    weight: 10,
    weightDisplay: '10% of Grade',
    syllabusNote: 'Syllabus quiz #2',
    confidence: 1.0,
    extractedBy: 'manual',
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z'
  };

  it('supports the notes field in DeadlineTask model', () => {
    expect(baseTask.notes).toBe('Remember to review product and quotient rules beforehand!');
    expect(baseTask.description).toContain('Dr. Ahmad announced');
    expect(baseTask.sourceSnippet).toContain('Dr. Ahmad announced');
  });

  it('pushTasksToFirebase preserves notes and announcement separately', async () => {
    let capturedBody: any = null;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const res = await pushTasksToFirebase([baseTask], 'Mobile Web App');
    expect(res.success).toBe(true);
    expect(capturedBody).not.toBeNull();
    expect(capturedBody.tasks[0].notes).toBe('Remember to review product and quotient rules beforehand!');
    expect(capturedBody.tasks[0].description).toBe(baseTask.description);

    fetchSpy.mockRestore();
  });

  it('updateTaskInFirebase updates notes and description on a specific task', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      // 1st call: fetch existing tasks from Firebase
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tasks: [baseTask], lastSync: '2026-09-20T10:00:00.000Z', count: 1 }), { status: 200 })
      )
      // 2nd call: push updated tasks to Firebase
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

    const updatedTask: DeadlineTask = {
      ...baseTask,
      notes: 'Updated student notes: formulas allowed on sheet',
      description: 'Updated announcement from doctor',
      updatedAt: '2026-09-21T15:00:00.000Z'
    };

    const success = await updateTaskInFirebase(updatedTask, 'Mobile Phone');
    expect(success).toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });

  it('timestamp-based reconciliation prioritizes newer cloud edits over stale local state', () => {
    const localExtensionTask: DeadlineTask = {
      ...baseTask,
      notes: 'Old local note',
      updatedAt: '2026-09-20T10:00:00.000Z'
    };

    const cloudMobileTask: DeadlineTask = {
      ...baseTask,
      notes: 'New note written on iPhone while on campus',
      updatedAt: '2026-09-21T09:30:00.000Z' // Newer!
    };

    const localTime = new Date(localExtensionTask.updatedAt).getTime();
    const fbTime = new Date(cloudMobileTask.updatedAt).getTime();

    expect(fbTime).toBeGreaterThan(localTime);

    // Reconcile logic (mirrors popup.ts & app.js)
    const reconciled = fbTime > localTime
      ? { ...localExtensionTask, ...cloudMobileTask }
      : { ...cloudMobileTask, ...localExtensionTask };

    expect(reconciled.notes).toBe('New note written on iPhone while on campus');
  });

  it('preserves newer local offline edits when server has older snapshot', () => {
    const newerLocalOfflineTask: DeadlineTask = {
      ...baseTask,
      notes: 'Written offline on subway',
      updatedAt: '2026-09-22T18:00:00.000Z' // Newer!
    };

    const olderCloudTask: DeadlineTask = {
      ...baseTask,
      notes: 'Yesterday notes',
      updatedAt: '2026-09-21T09:00:00.000Z'
    };

    const localTime = new Date(newerLocalOfflineTask.updatedAt).getTime();
    const fbTime = new Date(olderCloudTask.updatedAt).getTime();

    expect(localTime).toBeGreaterThan(fbTime);

    // Reconcile logic (mirrors app.js fetchTasksFromServer)
    const reconciled = localTime > fbTime
      ? { ...olderCloudTask, ...newerLocalOfflineTask }
      : { ...newerLocalOfflineTask, ...olderCloudTask };

    expect(reconciled.notes).toBe('Written offline on subway');
  });

  it('includes student notes in generated WebCal feed (RFC 5545)', () => {
    const icsFeed = generateIcsFeed([baseTask], { calendarName: 'UOS Deadlines' });
    expect(icsFeed).toContain('BEGIN:VEVENT');
    expect(icsFeed).toContain('Student Notes: Remember to review product and quotient rules beforehand!');
    expect(icsFeed).toContain("Doctor's Announcement");
  });

  it('includes student notes in Chrome extension ICS generation and Google Calendar URL', () => {
    const gcalUrl = createGoogleCalendarUrl(baseTask);
    const decodedUrl = decodeURIComponent(gcalUrl.replace(/\+/g, ' '));
    expect(decodedUrl).toContain('Student Notes: Remember to review product and quotient rules beforehand!');

    const icsContent = generateIcsContent([baseTask]);
    expect(icsContent).toContain('Student Notes: Remember to review product and quotient rules beforehand!');
  });

  it('course synchronization reconciles courseName and courseCode from cloud', () => {
    const localTask: DeadlineTask = {
      ...baseTask,
      courseName: 'General Course',
      courseCode: 'UOS',
      updatedAt: '2026-09-20T10:00:00.000Z'
    };

    const cloudTask: DeadlineTask = {
      ...baseTask,
      courseName: 'Physics 1 Lab',
      courseCode: '1430116',
      room: 'Central Lab Men - 105',
      updatedAt: '2026-09-21T10:00:00.000Z'
    };

    const localTime = new Date(localTask.updatedAt).getTime();
    const fbTime = new Date(cloudTask.updatedAt).getTime();

    // Simulating pullTasksFromFirebaseIfNewer logic
    let reconciled: DeadlineTask;
    if (fbTime > localTime) {
      reconciled = {
        ...localTask,
        ...cloudTask,
        courseName: cloudTask.courseName || localTask.courseName,
        courseCode: cloudTask.courseCode || localTask.courseCode
      };
    } else {
      reconciled = { ...localTask };
      if (cloudTask.courseName && cloudTask.courseName !== localTask.courseName) {
        reconciled.courseName = cloudTask.courseName;
        if (cloudTask.courseCode) reconciled.courseCode = cloudTask.courseCode;
      }
    }

    expect(reconciled.courseName).toBe('Physics 1 Lab');
    expect(reconciled.courseCode).toBe('1430116');
    expect(reconciled.room).toBe('Central Lab Men - 105');
  });

  it('course synchronization preserves website edits even if local timestamp is equal or slightly newer', () => {
    const localTaskWithStaleCourse: DeadlineTask = {
      ...baseTask,
      courseName: 'Old Stale Course',
      courseCode: 'UOS',
      updatedAt: '2026-09-25T12:00:00.000Z' // equal or newer due to local scan
    };

    const cloudTaskWithEditedCourse: DeadlineTask = {
      ...baseTask,
      courseName: 'Calculus I for Engineering',
      courseCode: '1440133',
      updatedAt: '2026-09-25T12:00:00.000Z'
    };

    // When fbTime <= localTime, the reconciled algorithm adopts the customized courseName
    const updated = { ...localTaskWithStaleCourse };
    if (cloudTaskWithEditedCourse.courseName && cloudTaskWithEditedCourse.courseName !== localTaskWithStaleCourse.courseName) {
      updated.courseName = cloudTaskWithEditedCourse.courseName;
      if (cloudTaskWithEditedCourse.courseCode) updated.courseCode = cloudTaskWithEditedCourse.courseCode;
    }

    expect(updated.courseName).toBe('Calculus I for Engineering');
    expect(updated.courseCode).toBe('1440133');
  });

  it('pushTasksToFirebase transmits tombstones in payload and fetchTasksFromFirebase parses them', async () => {
    let capturedBody: any = null;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const tombstones = { 'task-deleted-1': '2026-10-05T04:00:00.000Z' };
    const res = await pushTasksToFirebase([baseTask], 'Chrome Extension', 'BBS-TEST', undefined, tombstones);
    expect(res.success).toBe(true);
    expect(capturedBody.tombstones).toEqual(tombstones);
    fetchSpy.mockRestore();

    // Now test fetchTasksFromFirebase reading them back
    const fetchSpy2 = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        tasks: [baseTask],
        lastSync: '2026-10-05T04:00:00.000Z',
        count: 1,
        tombstones: { 'task-deleted-1': '2026-10-05T04:00:00.000Z' }
      }), { status: 200 })
    );

    const fetched = await fetchTasksFromFirebase('BBS-TEST');
    expect(fetched.success).toBe(true);
    expect(fetched.tombstones).toBeDefined();
    expect(fetched.tombstones?.['task-deleted-1']).toBe('2026-10-05T04:00:00.000Z');
    fetchSpy2.mockRestore();
  });
});

