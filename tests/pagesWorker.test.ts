import { describe, it, expect } from 'vitest';
import pagesWorker from '../mobile-web/_worker.js';

describe('Cloudflare Pages _worker.js Handler', () => {
  const mockKvStore = new Map<string, string>();
  const mockEnv = {
    SKIP_FIREBASE: true,
    TASKS_KV: {
      get: async (key: string) => mockKvStore.get(key) || null,
      put: async (key: string, value: string) => { mockKvStore.set(key, value); }
    },
    ASSETS: {
      fetch: async (_request: Request) => {
        return new Response('Mock Static Asset Content', {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        });
      }
    }
  };

  it('GET /api/status returns Cloudflare Pages status', async () => {
    const req = new Request('https://blackboarder.pages.dev/api/status', { method: 'GET' });
    const res = await pagesWorker.fetch(req, mockEnv, {} as any);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.platform).toContain('Cloudflare Pages');
    expect(data.feedUrl).toBe('https://blackboarder.pages.dev/feed.ics');
  });

  it('POST /api/sync saves tasks to Cloudflare Pages', async () => {
    const testTasks = [
      {
        id: 'pages-task-1',
        courseCode: '1440131',
        courseName: 'Calculus I for Engineering',
        title: 'Calculus Quiz 1',
        dueDate: '2026-10-10T12:30:00.000Z',
        hasSpecificTime: true,
        type: 'quiz',
        priority: 'high',
        status: 'pending'
      }
    ];

    const req = new Request('https://blackboarder.pages.dev/api/sync?key=BBS-TESTKEY1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: testTasks })
    });

    const res = await pagesWorker.fetch(req, mockEnv, {} as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.count).toBe(1);
  });

  it('GET /api/tasks retrieves saved tasks', async () => {
    const req = new Request('https://blackboarder.pages.dev/api/tasks?key=BBS-TESTKEY1', { method: 'GET' });
    const res = await pagesWorker.fetch(req, mockEnv, {} as any);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.tasks.length).toBe(1);
    expect(data.tasks[0].title).toBe('Calculus Quiz 1');
  });

  it('GET /feed.ics serves RFC 5545 feed from Cloudflare Pages', async () => {
    const req = new Request('https://blackboarder.pages.dev/feed.ics?key=BBS-TESTKEY1', { method: 'GET' });
    const res = await pagesWorker.fetch(req, mockEnv, {} as any);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    const text = await res.text();
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain('SUMMARY:[1440131] Calculus Quiz 1');
    expect(text).toContain('STATUS:CONFIRMED');
    expect(text).toContain('BEGIN:VALARM');
  });

  it('GET /feed.ics reflects completed task with checkmark, Done suffix, and alarm suppression', async () => {
    // Update task to completed
    const statusReq = new Request('https://blackboarder.pages.dev/api/task-status?key=BBS-TESTKEY1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'pages-task-1', status: 'completed' })
    });
    const statusRes = await pagesWorker.fetch(statusReq, mockEnv, {} as any);
    expect(statusRes.status).toBe(200);

    const req = new Request('https://blackboarder.pages.dev/feed.ics?key=BBS-TESTKEY1', { method: 'GET' });
    const res = await pagesWorker.fetch(req, mockEnv, {} as any);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('SUMMARY:✓ [1440131] Calculus Quiz 1 (Done)');
    expect(text).toContain('STATUS:CONFIRMED');
    expect(text).not.toContain('STATUS:COMPLETED');
    expect(text).toContain('Status: Completed (Done)');
    expect(text).not.toContain('BEGIN:VALARM');
  });

  it('passes static assets to env.ASSETS.fetch', async () => {
    const req = new Request('https://blackboarder.pages.dev/index.html', { method: 'GET' });
    const res = await pagesWorker.fetch(req, mockEnv, {} as any);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('Mock Static Asset Content');
  });

  it('serves robots.txt with sitemap reference', async () => {
    const req = new Request('https://blackboarder.pages.dev/robots.txt', { method: 'GET' });
    const res = await pagesWorker.fetch(req, mockEnv, {} as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('User-agent: *');
    expect(text).toContain('Sitemap: https://blackboarder.pages.dev/sitemap.xml');
  });

  it('serves sitemap.xml with landing and companion URLs', async () => {
    const req = new Request('https://blackboarder.pages.dev/sitemap.xml', { method: 'GET' });
    const res = await pagesWorker.fetch(req, mockEnv, {} as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const text = await res.text();
    expect(text).toContain('<urlset');
    expect(text).toContain('https://blackboarder.pages.dev/');
    expect(text).toContain('https://blackboarder.pages.dev/companion/');
  });
});
