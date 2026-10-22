import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import { encodeCloudKey, decodeCloudKey, encodeCloudKeys, decodeCloudKeys } from '../src/utils/cloudSanitize';
import { pushTasksToFirebase, fetchTasksFromFirebase } from '../src/utils/firebaseSync';

// Firebase rejects keys containing . $ # [ ] / (error 400 "Invalid data; couldn't parse key")
const BAD = /[.$#\[\]/]/;

// Ids as built from real titles
const IDS = [
  'ann_ultra_HW1_Phys.1_Fall26-27 (chap. 1 & Chap. 2)',
  "ann_api_Newton's 2nd Law/Lab",
  'task_[draft]#1$',
  '100%_done',
  'واجب (10 درجات).pdf'
];

function allKeys(v: any, out: string[] = []): string[] {
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) { out.push(k); allKeys(x, out); }
  }
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe('Firebase object keys', () => {
  it('encoded keys have no forbidden characters and decode back', () => {
    for (const id of IDS) {
      const enc = encodeCloudKey(id);
      expect(enc).not.toMatch(BAD);
      expect(decodeCloudKey(enc)).toBe(id);
    }
    expect(encodeCloudKey('')).not.toBe('');
    expect(decodeCloudKey(encodeCloudKey(''))).toBe('');
    const map = Object.fromEntries(IDS.map((id, i) => [id, `2026-10-2${i}T00:00:00Z`]));
    expect(decodeCloudKeys(encodeCloudKeys(map))).toEqual(map);
  });

  it('a push with awkward deleted-task ids sends only keys Firebase accepts', async () => {
    let sent = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => { sent = init.body; return { ok: true, text: async () => '' }; }));
    const tombstones = Object.fromEntries(IDS.map(id => [id, '2026-10-22T00:00:00Z']));
    const res = await pushTasksToFirebase([], 'test', 'BBS-ABCDEFGHJK', undefined, tombstones);
    expect(res.success).toBe(true);
    const keys = allKeys(JSON.parse(sent).tombstones);
    expect(keys.length).toBe(IDS.length);
    expect(keys.some(k => BAD.test(k))).toBe(false);
  });

  it('reading brings the original ids back', async () => {
    const stored = { lastSync: 'x', tasks: [], tombstones: Object.fromEntries(IDS.map(id => [encodeCloudKey(id), '2026-10-22T00:00:00Z'])) };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => stored })));
    const res = await fetchTasksFromFirebase('BBS-ABCDEFGHJK');
    expect(Object.keys(res.tombstones!).sort()).toEqual([...IDS].sort());
  });

  it('the phone app and the worker encode too', () => {
    const app = fs.readFileSync('mobile-web/companion/app.js', 'utf8');
    expect(app).toContain('BB.encodeCloudKeys(tombstones)');
    expect(app.match(/BB\.decodeCloudKeys\(/g)!.length).toBeGreaterThanOrEqual(2);
    const worker = fs.readFileSync('mobile-web/_worker.js', 'utf8');
    expect(worker).toContain('mapKeys(payload.tombstones, encodeKey)');
    expect(worker).toContain('mapKeys(fbData.tombstones, decodeKey)');
  });
});
