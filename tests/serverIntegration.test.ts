import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import server from '../server/server.js';

const TEST_PORT = 3457;

describe('Live HTTP Server & Sync Bridge Integration', () => {
  let testServer: http.Server;
  const baseUrl = `http://localhost:${TEST_PORT}`;

  beforeAll(async () => {
    testServer = http.createServer(server.listeners('request')[0] as any);
    await new Promise<void>((resolve) => {
      testServer.listen(TEST_PORT, '127.0.0.1', () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      testServer.close(() => resolve());
    });
  });

  it('GET /api/status returns server status, network URLs and task count', async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.version).toBe('1.0.0');
    expect(data.feedUrl).toContain('/feed.ics');
    expect(data.webcalUrl).toContain('webcal://');
    expect(data.mobileUrl).toContain('http://');
  });

  it('POST /api/sync saves tasks array and returns success metadata', async () => {
    const testTasks = [
      {
        id: 'int-task-1',
        courseCode: '1440131',
        courseName: 'Calculus I for Engineering',
        title: 'Calculus Midterm Exam',
        description: 'Covers Chapters 1 to 4',
        dueDate: '2026-10-20T12:30:00.000Z',
        hasSpecificTime: true,
        type: 'exam',
        priority: 'high',
        status: 'pending',
        weight: 30,
        weightDisplay: '30% Midterm (Paper)',
        sourceSnippet: 'Midterm exam is on October 20 at 12:30 PM.',
        confidence: 1.0,
        extractedBy: 'ai',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'int-task-2',
        courseCode: '0401102',
        courseName: 'Introduction to Computer Engineering',
        title: 'Computer Eng Quiz 3',
        description: 'Logic Gates and Boolean Algebra',
        dueDate: '2026-10-22T11:00:00.000Z',
        hasSpecificTime: true,
        type: 'quiz',
        priority: 'medium',
        status: 'pending',
        weight: 6.67,
        weightDisplay: '6.7% per Quiz',
        sourceSnippet: 'Quiz 3 will be held on Oct 22 during class.',
        confidence: 0.95,
        extractedBy: 'local',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    const res = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: testTasks, device: 'Vitest Runner' })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.count).toBe(2);
    expect(data.lastSync).toBeDefined();
  });

  it('GET /api/tasks returns the synchronized deadlines', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.count).toBe(2);
    expect(data.tasks[0].title).toBe('Calculus Midterm Exam');
  });

  it('POST /api/task-status toggles task completion from mobile', async () => {
    const res = await fetch(`${baseUrl}/api/task-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'int-task-1', status: 'completed' })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.task.status).toBe('completed');

    // Verify task is now marked completed in GET /api/tasks
    const getRes = await fetch(`${baseUrl}/api/tasks`);
    const getData = await getRes.json();
    const updated = getData.tasks.find((t: any) => t.id === 'int-task-1');
    expect(updated.status).toBe('completed');
  });

  it('GET /feed.ics serves valid text/calendar RFC 5545 feed reflecting completed and pending tasks', async () => {
    const res = await fetch(`${baseUrl}/feed.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    const text = await res.text();
    expect(text).toContain('BEGIN:VCALENDAR');
    // Completed task int-task-1 reflects completion with checkmark and Done suffix
    expect(text).toContain('SUMMARY:✓ [1440131] Calculus Midterm Exam (Done)');
    expect(text).toContain('STATUS:COMPLETED');
    // Pending task int-task-2 retains alarms and standard title
    expect(text).toContain('SUMMARY:[0401102] Computer Eng Quiz 3');
    expect(text).toContain('TRIGGER:-P1D');
    expect(text).toContain('TRIGGER:-PT2H');
    expect(text).toContain('END:VCALENDAR');
  });

  it('serves static PWA files correctly (index.html, styles.css, app.js, manifest.json)', async () => {
    // HTML
    const htmlRes = await fetch(`${baseUrl}/`);
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get('content-type')).toContain('text/html');
    const html = await htmlRes.text();
    expect(html).toContain('Blackboarder');
    expect(html).toContain('id="calendar-grid"');

    // CSS
    const cssRes = await fetch(`${baseUrl}/styles.css`);
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get('content-type')).toContain('text/css');

    // JS
    const jsRes = await fetch(`${baseUrl}/app.js`);
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get('content-type')).toContain('application/javascript');

    // Manifest
    const manifestRes = await fetch(`${baseUrl}/manifest.json`);
    expect(manifestRes.status).toBe(200);
    const manifest = await manifestRes.json();
    expect(manifest.short_name).toBe('Blackboarder');
  });
});
