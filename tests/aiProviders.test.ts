import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  resolveAiEndpoint, normalizeAiBaseUrl, isAllowedAiChatUrl, parseAiJson, aiRequestHeaders,
  OPENROUTER_CHAT_URL, IFM_MODEL
} from '../src/engine/aiProviders';
import { extractDeadlinesWithAi } from '../src/engine/aiExtractor';
import { extractDeadlinesHybridDetailed, guessAssessmentType, wordingHint } from '../src/engine/hybridExtractor';
import * as aiExtractor from '../src/engine/aiExtractor';
import { Announcement } from '../src/types';

const ann: Announcement = {
  id: 'ann_provider_test',
  courseCode: '1440 133',
  courseName: 'Calculus I',
  title: 'Quiz 2',
  postedAt: '2026-10-01T08:00:00.000Z',
  contentText: 'Quiz 2 will be held on October 15 at 12:30 PM',
  sourceUrl: 'https://elearning.sharjah.ac.ae',
  scannedAt: '2026-10-01T09:00:00.000Z'
};

const reply = (content: string) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }), text: async () => '' });
const QUIZ_JSON = JSON.stringify({ deadlines: [{ title: 'Quiz 2', dueDate: '2026-10-15T12:30:00', hasSpecificTime: true, type: 'quiz', priority: 'medium', room: null, sourceSnippet: 'Quiz 2' }] });

afterEach(() => vi.unstubAllGlobals());

describe('AI provider choice', () => {
  it('OpenRouter stays the default, and each provider uses its own key', () => {
    expect(resolveAiEndpoint({ openRouterApiKey: 'or-key' })).toMatchObject({ provider: 'openrouter', chatUrl: OPENROUTER_CHAT_URL, apiKey: 'or-key' });
    expect(resolveAiEndpoint({ aiProvider: 'ifm', openRouterApiKey: 'or-key' })).toBeNull();
    expect(resolveAiEndpoint({ aiProvider: 'ifm', ifmApiKey: ' ifm-key ' })).toEqual({
      provider: 'ifm', chatUrl: 'https://api.ifm.ai/v1/chat/completions', apiKey: 'ifm-key', model: IFM_MODEL
    });
    expect(resolveAiEndpoint({ aiProvider: 'custom', customAiApiKey: 'k', customAiModel: 'm' })).toBeNull();
    expect(resolveAiEndpoint({ aiProvider: 'custom', customAiApiKey: 'k', customAiModel: 'm', customAiBaseUrl: 'api.example.com/v1/' }))
      .toMatchObject({ chatUrl: 'https://api.example.com/v1/chat/completions', model: 'm' });
  });

  it('base URLs are cleaned up, and plain http is refused except on this computer', () => {
    expect(normalizeAiBaseUrl('https://api.example.com/v1/chat/completions')).toBe('https://api.example.com/v1');
    expect(normalizeAiBaseUrl('http://api.example.com/v1')).toBe('');
    expect(normalizeAiBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    expect(normalizeAiBaseUrl('javascript:alert(1)')).toBe('');
    expect(isAllowedAiChatUrl('https://api.ifm.ai/v1/chat/completions')).toBe(true);
    expect(isAllowedAiChatUrl('https://evil.example.com/steal')).toBe(false);
    expect(isAllowedAiChatUrl('http://evil.example.com/v1/chat/completions')).toBe(false);
  });

  it('OpenRouter headers are only sent to OpenRouter', () => {
    expect(aiRequestHeaders('openrouter', 'k')).toHaveProperty('X-Title');
    expect(aiRequestHeaders('ifm', 'k')).not.toHaveProperty('X-Title');
    expect(aiRequestHeaders('ifm', 'k').Authorization).toBe('Bearer k');
  });

  it('reads JSON that a reasoning model wraps in thinking or code fences', () => {
    expect(parseAiJson('<think>the quiz is on the 15th</think>\n{"deadlines":[]}')).toEqual({ deadlines: [] });
    expect(parseAiJson('Here you go:\n```json\n{"deadlines":[1]}\n```')).toEqual({ deadlines: [1] });
    expect(() => parseAiJson('no json here')).toThrow();
  });
});

describe('AI extraction with IFM', () => {
  it('posts to IFM with the K2 model and no OpenRouter fallbacks', async () => {
    const fetchMock = vi.fn(async () => reply(`<think>ok</think>${QUIZ_JSON}`));
    vi.stubGlobal('fetch', fetchMock);
    const tasks = await extractDeadlinesWithAi(ann, 'ifm-key', IFM_MODEL, undefined, { provider: 'ifm', chatUrl: 'https://api.ifm.ai/v1/chat/completions' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Quiz 2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe('https://api.ifm.ai/v1/chat/completions');
    expect(JSON.parse(init.body).model).toBe(IFM_MODEL);
    expect(init.headers['X-Title']).toBeUndefined();
  });

  it('asks again without JSON mode when the service refuses it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'response_format not supported' })
      .mockResolvedValueOnce(reply(QUIZ_JSON));
    vi.stubGlobal('fetch', fetchMock);
    const tasks = await extractDeadlinesWithAi(ann, 'k', 'some-model', undefined, { provider: 'custom', chatUrl: 'https://api.example.com/v1/chat/completions' });
    expect(tasks).toHaveLength(1);
    expect(JSON.parse((fetchMock.mock.calls[1] as any[])[1].body).response_format).toBeUndefined();
  });

  it('the pipeline runs AI with an IFM key even when no OpenRouter key is set', async () => {
    const spy = vi.spyOn(aiExtractor, 'extractDeadlinesWithAi').mockResolvedValue([]);
    const vague = { ...ann, title: 'Quiz reminder', contentText: 'Remember the quiz we discussed, it is the week after next on our usual day.' };
    await extractDeadlinesHybridDetailed(vague, { useAiExtraction: true, openRouterApiKey: '', openRouterModel: '', aiProvider: 'ifm', ifmApiKey: 'ifm-key' });
    expect(spy).toHaveBeenCalledWith(
      vague, 'ifm-key', IFM_MODEL,
      expect.objectContaining({ category: 'quiz', hasTime: false }),
      expect.objectContaining({ provider: 'ifm', chatUrl: 'https://api.ifm.ai/v1/chat/completions' })
    );
    spy.mockRestore();
  });
});

describe('without Jev', () => {
  it('the wording decides the type, time and room hints', () => {
    expect(guessAssessmentType('Midterm exam next week')).toBe('exam');
    expect(guessAssessmentType('Quiz 3 on chapter 2')).toBe('quiz');
    expect(guessAssessmentType('سيكون هناك كويز يوم الأحد')).toBe('quiz');
    expect(guessAssessmentType('Submit HW2 on Blackboard')).toBe('assignment');
    expect(guessAssessmentType('Welcome to the course')).toBeNull();
    expect(wordingHint('Quiz at 12:30 in room A8-103')).toEqual({ category: 'quiz', hasTime: true, hasRoom: true });
    expect(wordingHint('Quiz next week')).toEqual({ category: 'quiz', hasTime: false, hasRoom: false });
  });

  it('nothing in the extension still refers to Jev', () => {
    for (const f of ['src/types.ts', 'src/popup/index.html', 'src/popup/popup.ts', 'src/background/serviceWorker.ts', 'src/engine/hybridExtractor.ts', 'src/engine/aiExtractor.ts', 'public/manifest.json', 'package.json', 'mobile-web/_worker.js']) {
      expect(fs.readFileSync(f, 'utf8')).not.toMatch(/jev|typesafe/i);
    }
    expect(fs.existsSync('src/engine/jevClassifier.ts')).toBe(false);
  });
});

describe('web app', () => {
  const VAGUE = 'Remember the quiz we discussed, the week after next on our usual day.';

  it('keeps no AI keys or model settings, and says models are set in the extension', () => {
    for (const f of ['mobile-web/companion/index.html', 'mobile-web/companion/app.js']) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src).not.toMatch(/openrouter|gemini|jev/i);
      expect(src).not.toContain('saveAiSettings');
    }
    const html = fs.readFileSync('mobile-web/companion/index.html', 'utf8');
    expect(html.match(/set in the extension/g)!.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/built-in parser (?:reads it|is used) automatically/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('sends the extension prompt to its server by sync key, never a key', async () => {
    const BBCore = (await import('../src/mobile/core')).default as any;
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { choices: [{ message: { content: QUIZ_JSON } }] } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await BBCore.extractFromText(VAGUE, 'Calculus I', { url: 'https://blackboarder.pages.dev/api/ai/extract', syncKey: 'BBS-ABCDEFGHJK' });
    expect(res.tasks).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe('https://blackboarder.pages.dev/api/ai/extract');
    const body = JSON.parse(init.body);
    expect(body.syncKey).toBe('BBS-ABCDEFGHJK');
    expect(body.messages[0].role).toBe('system');
    expect(body.model).toBeUndefined();
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('falls back to the built-in parser when the server has no key', async () => {
    const BBCore = (await import('../src/mobile/core')).default as any;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ ok: false, error: 'No AI key set in the extension' }) })));
    const res = await BBCore.extractFromText('Quiz 1 will be held on October 15 at 12:30 PM in A8-103', 'Calculus I', { url: 'https://x.pages.dev/api/ai/extract', syncKey: 'BBS-ABCDEFGHJK' });
    expect(res.tasks.length).toBeGreaterThan(0);
    const none = await BBCore.extractFromText(VAGUE, '', { url: 'https://x.pages.dev/api/ai/extract', syncKey: 'BBS-ABCDEFGHJK' });
    expect(none.tasks).toHaveLength(0);
  });
});

describe('extension wiring', () => {
  it('the manifest can reach IFM and may ask for a custom host', () => {
    const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
    expect(manifest.host_permissions).toContain('https://api.ifm.ai/*');
    expect(manifest.optional_host_permissions).toContain('https://*/*');
  });

  it('settings have a provider dropdown with the three choices', () => {
    const html = fs.readFileSync('src/popup/index.html', 'utf8');
    for (const v of ['openrouter', 'ifm', 'custom']) expect(html).toContain(`<option value="${v}"`);
    expect(html).toContain('id="setting-ai-base-url"');
    expect(html).toContain('id="btn-test-ai"');
  });
});
