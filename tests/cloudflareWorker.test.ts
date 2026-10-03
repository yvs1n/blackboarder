import { describe, it, expect } from 'vitest';
import worker from '../cloudflare-worker/worker.js';

describe('Cloudflare Worker Serverless Edge Endpoint', () => {
  // Mock Cloudflare KV storage
  const mockKvStore = new Map<string, string>();
  const mockEnv = {
    SKIP_FIREBASE: true,
    TASKS_KV: {
      get: async (key: string) => mockKvStore.get(key) || null,
      put: async (key: string, value: string) => { mockKvStore.set(key, value); }
    }
  };

  it('GET /api/status returns edge serverless status and URLs', async () => {
    const request = new Request('https://sidekick.workers.dev/api/status', { method: 'GET' });
    const response = await worker.fetch(request, mockEnv, {} as any);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.platform).toContain('Cloudflare Workers');
    expect(data.feedUrl).toBe('https://sidekick.workers.dev/feed.ics');
    expect(data.webcalUrl).toBe('webcal://sidekick.workers.dev/feed.ics');
  });

  it('POST /api/sync saves tasks into Cloudflare KV', async () => {
    const testTasks = [
      {
        id: 'cf-task-1',
        courseCode: '1430115',
        courseName: 'Physics 1',
        title: 'Physics Quiz 1',
        description: 'Vectors and Motion',
        dueDate: '2026-10-18T09:30:00.000Z',
        hasSpecificTime: true,
        type: 'quiz',
        priority: 'high',
        status: 'pending',
        weight: 5,
        weightDisplay: '5% Quiz',
        sourceSnippet: 'Quiz 1 on Sunday at 9:30 AM.',
        confidence: 1.0,
        extractedBy: 'local',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    const request = new Request('https://sidekick.workers.dev/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: testTasks, device: 'Laptop Extension' })
    });

    const response = await worker.fetch(request, mockEnv, {} as any);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.count).toBe(1);

    // Verify stored in mock KV
    expect(mockKvStore.has('bbs_tasks')).toBe(true);
  });

  it('GET /api/tasks retrieves synchronized tasks from Cloudflare KV', async () => {
    const request = new Request('https://sidekick.workers.dev/api/tasks', { method: 'GET' });
    const response = await worker.fetch(request, mockEnv, {} as any);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.tasks.length).toBe(1);
    expect(data.tasks[0].title).toBe('Physics Quiz 1');
  });

  it('GET /feed.ics serves RFC 5545 calendar feed dynamically from Cloudflare KV', async () => {
    const request = new Request('https://sidekick.workers.dev/feed.ics', { method: 'GET' });
    const response = await worker.fetch(request, mockEnv, {} as any);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/calendar');
    const text = await response.text();
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain('SUMMARY:[1430115] Physics Quiz 1');
    expect(text).toContain('TRIGGER:-P1D');
    expect(text).toContain('TRIGGER:-PT2H');
    expect(text).toContain('END:VCALENDAR');
  });

  it('serves static PWA assets from edge with matching extension design', async () => {
    const htmlReq = new Request('https://sidekick.workers.dev/', { method: 'GET' });
    const htmlRes = await worker.fetch(htmlReq, mockEnv, {} as any);
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get('content-type')).toContain('text/html');
    const htmlText = await htmlRes.text();
    expect(htmlText).toContain('Blackboarder');

    const cssReq = new Request('https://sidekick.workers.dev/styles.css', { method: 'GET' });
    const cssRes = await worker.fetch(cssReq, mockEnv, {} as any);
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get('content-type')).toContain('text/css');
    const cssText = await cssRes.text();
    expect(cssText).toContain('--bg: #f8fafc;'); // extension light theme
    expect(cssText).toContain('--primary: #18181b;');
  });

  it('POST /api/task-status marks task as completed in Cloudflare KV', async () => {
    const req = new Request('https://sidekick.workers.dev/api/task-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'cf-task-1', status: 'completed' })
    });

    const res = await worker.fetch(req, mockEnv, {} as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.task.status).toBe('completed');
  });
});
