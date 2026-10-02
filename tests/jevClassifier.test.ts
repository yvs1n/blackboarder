import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { classifyAnnouncementWithJev } from '../src/engine/jevClassifier';
import { extractDeadlinesHybrid } from '../src/engine/hybridExtractor';
import { Announcement, DEFAULT_SETTINGS, UserSettings } from '../src/types';
import * as aiExtractor from '../src/engine/aiExtractor';
import * as localExtractor from '../src/engine/localExtractor';

const TEST_JEV_KEY = 'test_jev_mock_key';

describe('Jev System One Classifier Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(TypeSafeClient.prototype, 'systemOne').mockImplementation(async ({ state }: any) => {
      const text = String(state || '');
      if (text.includes('invalid_key')) {
        throw new Error('401 AuthenticationError');
      }
      if (text.includes('Quiz 1')) {
        return {
          answers: {
            is_deadline: { noul: 0.95 },
            category: { choice: 'quiz', confidence: 0.95 },
            urgency: { score: 4.2 },
            has_room: { noul: 0.9 },
            has_time: { noul: 0.9 }
          },
          confidence: 0.95
        } as any;
      }
      if (text.includes('welcome to the semester') || text.includes('Office hours')) {
        return {
          answers: {
            is_deadline: { noul: 0.1 },
            category: { choice: 'not_a_task', confidence: 0.9 },
            urgency: { score: 1.0 },
            has_room: { noul: 0.1 },
            has_time: { noul: 0.1 }
          },
          confidence: 0.9
        } as any;
      }
      if (text.includes('Midterm Exam') || text.includes('midterm exam')) {
        return {
          answers: {
            is_deadline: { noul: 0.98 },
            category: { choice: 'exam', confidence: 0.98 },
            urgency: { score: 4.8 },
            has_room: { noul: 0.95 },
            has_time: { noul: 0.95 }
          },
          confidence: 0.98
        } as any;
      }
      if (text.includes('Quiz 2')) {
        return {
          answers: {
            is_deadline: { noul: 0.92 },
            category: { choice: 'quiz', confidence: 0.92 },
            urgency: { score: 4.0 },
            has_room: { noul: 0.1 },
            has_time: { noul: 0.9 }
          },
          confidence: 0.92
        } as any;
      }
      return {
        answers: {
          is_deadline: { noul: 0.5 },
          category: { choice: 'other', confidence: 0.5 },
          urgency: { score: 2.5 },
          has_room: { noul: 0.5 },
          has_time: { noul: 0.5 }
        },
        confidence: 0.5
      } as any;
    });
  });

  it('gracefully handles missing API key or empty text', async () => {
    const resNoKey = await classifyAnnouncementWithJev('Quiz tomorrow', '');
    expect(resNoKey.isDeadline).toBe(true);
    expect(resNoKey.category).toBe('other');

    const resNoText = await classifyAnnouncementWithJev('', 'some-key');
    expect(resNoText.isDeadline).toBe(true);
    expect(resNoText.category).toBe('other');
  });

  it('handles API errors gracefully without throwing', async () => {
    const res = await classifyAnnouncementWithJev('Quiz 1 next Monday (invalid_key)', 'invalid_key', 2000);
    expect(res).toBeDefined();
    expect(res.category).toBe('other');
  });

  it('correctly classifies a real quiz announcement using live Jev API', async () => {
    const text = 'Dear students, Quiz 1 will take place on Monday Oct 14 at 12:30 in room A8-103. It will cover chapters 1 and 2.';
    const result = await classifyAnnouncementWithJev(text, TEST_JEV_KEY, 8000);

    expect(result.isDeadline).toBe(true);
    expect(result.category).toBe('quiz');
    expect(result.deadlineProbability).toBeGreaterThan(0.8);
    expect(result.categoryConfidence).toBeGreaterThan(0.8);
    expect(result.priority).toMatch(/high|medium/);
    expect(result.hasRoom).toBe(true);
    expect(result.hasTime).toBe(true);
  });

  it('correctly rejects a non-deadline general announcement using live Jev API', async () => {
    const text = 'Dear students, welcome to the semester. Office hours are Sunday and Tuesday 10am-12pm in building W9. Slides for Lecture 1 have been uploaded to Blackboard.';
    const result = await classifyAnnouncementWithJev(text, TEST_JEV_KEY, 8000);

    expect(result.isDeadline).toBe(false);
    expect(result.category).toBe('not_a_task');
    expect(result.deadlineProbability).toBeLessThan(0.35);
  });

  it('correctly classifies a midterm exam announcement using live Jev API', async () => {
    const text = 'Notice: The Midterm Exam is scheduled on November 15, 2026 from 10:00 to 12:00 in the Central Auditorium. All chapters are included.';
    const result = await classifyAnnouncementWithJev(text, TEST_JEV_KEY, 8000);

    expect(result.isDeadline).toBe(true);
    expect(result.category).toBe('exam');
    expect(result.priority).toBe('high');
  });
});

describe('3-Tier Hybrid Extractor with Jev Gatekeeper', () => {
  const baseSettings: UserSettings = {
    ...DEFAULT_SETTINGS,
    openRouterApiKey: 'mock-openrouter-key',
    useAiExtraction: true,
    jevApiKey: TEST_JEV_KEY,
    useJevClassification: true
  };

  const sampleAnnouncement: Announcement = {
    id: 'ann-welcome-1',
    courseCode: '0402101',
    courseName: 'Intro to Comp Eng',
    title: 'Welcome & Office Hours',
    contentText: 'Welcome everyone. Office hours will be held on Mondays. Course slides are posted on the portal.',
    sourceUrl: 'https://blackboard.example.com',
    scannedAt: new Date().toISOString()
  };

  it('weeds out non-deadlines in ~100ms without triggering Generative AI', async () => {
    const spyAi = vi.spyOn(aiExtractor, 'extractDeadlinesWithAi');
    const spyLocal = vi.spyOn(localExtractor, 'extractDeadlinesLocally').mockReturnValue([]);

    const tasks = await extractDeadlinesHybrid(sampleAnnouncement, baseSettings);

    expect(tasks).toEqual([]);
    // Fast rejection: Generative AI should NOT be invoked at all!
    expect(spyAi).not.toHaveBeenCalled();

    spyAi.mockRestore();
    spyLocal.mockRestore();
  });

  it('invokes Generative AI with Jev category and urgency hint when Jev confirms a deadline', async () => {
    const examAnn: Announcement = {
      id: 'ann-exam-1',
      courseCode: '0401101',
      courseName: 'Calculus 1',
      title: 'Midterm Exam Schedule',
      contentText: 'The midterm exam will take place on November 15th at 12:30 pm in Room A12-110.',
      sourceUrl: 'https://blackboard.example.com',
      scannedAt: new Date().toISOString()
    };

    const spyLocal = vi.spyOn(localExtractor, 'extractDeadlinesLocally').mockReturnValue([]);
    const spyAi = vi.spyOn(aiExtractor, 'extractDeadlinesWithAi').mockResolvedValue([
      {
        id: 'mock-task-1',
        courseCode: '0401101',
        courseName: 'Calculus 1',
        title: 'Midterm Exam',
        description: 'Midterm Exam in Room A12-110',
        dueDate: '2026-11-15T12:30:00.000Z',
        hasSpecificTime: true,
        type: 'exam',
        priority: 'high',
        status: 'pending',
        sourceSnippet: 'Midterm exam will take place on November 15th',
        confidence: 0.95,
        extractedBy: 'ai',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]);

    const tasks = await extractDeadlinesHybrid(examAnn, baseSettings);

    expect(tasks.length).toBe(1);
    expect(spyAi).toHaveBeenCalledWith(
      examAnn,
      baseSettings.openRouterApiKey,
      baseSettings.openRouterModel,
      expect.objectContaining({ category: 'exam', priority: 'high' })
    );

    spyLocal.mockRestore();
    spyAi.mockRestore();
  }, 15000);

  it('upgrades local tasks with generic "other" category using Jev', async () => {
    const quizAnn: Announcement = {
      id: 'ann-quiz-1',
      courseCode: '0401115',
      courseName: 'Physics 1',
      title: 'Quiz 2 Next Week',
      contentText: 'Quiz 2 is scheduled for Monday at 10:00 AM.',
      sourceUrl: 'https://blackboard.example.com',
      scannedAt: new Date().toISOString()
    };

    // Simulate local parser returning a generic "other" task
    const mockLocalTask = {
      id: 'local-task-1',
      courseCode: '0401115',
      courseName: 'Physics 1',
      title: 'Quiz 2 Next Week',
      description: 'Quiz 2 is scheduled for Monday at 10:00 AM.',
      dueDate: '2026-10-19T10:00:00.000Z',
      hasSpecificTime: true,
      type: 'other' as const,
      priority: 'medium' as const,
      status: 'pending' as const,
      sourceSnippet: 'Quiz 2 is scheduled for Monday',
      confidence: 0.8,
      extractedBy: 'local' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const spyLocal = vi.spyOn(localExtractor, 'extractDeadlinesLocally').mockReturnValue([mockLocalTask]);

    const tasks = await extractDeadlinesHybrid(quizAnn, baseSettings);

    expect(tasks.length).toBe(1);
    // Jev should have upgraded the category from 'other' to 'quiz'
    expect(tasks[0].type).toBe('quiz');

    spyLocal.mockRestore();
  }, 15000);
});
