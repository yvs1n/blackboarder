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
      fetch: async (request: Request) => {
        return new Response('Mock Static Asset Content', {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        });
      }
    }
  };

  it('GET /api/status returns Cloudflare Pages status', async () => {
    const req = new Request('https://yassinr-uossidekick.pages.dev/api/status', { method: 'GET' });
    const res = await pagesWorker.fetch(req, mockEnv, {} as any);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.platform).toContain('Cloudflare Pages');
    expect(data.feedUrl).toBe('https://yassinr-uossidekick.pages.dev/feed.ics');
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

    const req = new Request('https://yassinr-uossidekick.pages.dev/api/sync', {
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
    const req = new Request('https://yassinr-uossidekick.pages.dev/api/tasks', { method: 'GET' });
    const res = await pagesWorker.fetch(req, mockEnv, {} as any);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.tasks.length).toBe(1);
    expect(data.tasks[0].title).toBe('Calculus Quiz 1');
  });

  it('GET /feed.ics serves RFC 5545 feed from Cloudflare Pages', async () => {
    const req = new Request('https://yassinr-uossidekick.pages.dev/feed.ics', { method: 'GET' });
    const res = await pagesWorker.fetch(req, mockEnv, {} as any);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    const text = await res.text();
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain('SUMMARY:[1440131] Calculus Quiz 1');
  });

  it('passes static assets to env.ASSETS.fetch', async () => {
    const req = new Request('https://yassinr-uossidekick.pages.dev/index.html', { method: 'GET' });
    const res = await pagesWorker.fetch(req, mockEnv, {} as any);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('Mock Static Asset Content');
  });
});
