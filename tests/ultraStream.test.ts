import { describe, it, expect } from 'vitest';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';
import { Announcement } from '../src/types';

describe('Blackboard Ultra Stream Direct & Announcement Extraction', () => {
  it('extracts "Wednesday 16th" announcement date accurately', () => {
    const ann: Announcement = {
      id: 'ann-ultra-1',
      courseCode: '0401201',
      courseName: 'Calculus I for Engineering',
      title: 'Quiz 1',
      postedAt: '2026-09-07T12:00:00.000Z',
      contentText: 'Dear students,\nQuiz 1 is going to take place next week on Wednesday 16th or Thursday 17th depending on your section schedule.',
      sourceUrl: 'https://blackboard.sharjah.ac.ae/ultra/stream',
      scannedAt: '2026-09-07T14:00:00.000Z'
    };

    const tasks = extractDeadlinesLocally(ann);
    expect(tasks.length).toBeGreaterThanOrEqual(1);

    const quizTask = tasks[0];
    expect(quizTask.type).toBe('quiz');
    expect(quizTask.title).toContain('Quiz 1');

    const dueDate = new Date(quizTask.dueDate);
    expect(dueDate.getFullYear()).toBe(2026);
    expect(dueDate.getMonth()).toBe(8); // September (0-indexed)
    expect(dueDate.getDate()).toBe(16);
  });

  it('parses all 4 direct due date cards from the user screenshot', async () => {
    const { parseDirectStreamCard } = await import('../src/utils/streamParser');

    // Item 1
    const card1 = `Calculus I for Engineering - 02 - حسبان 1 للمهندسين
Due: Assignment-1-Graded
Due Date: 9/18/26, 11:59 PM (UTC+4)`;
    const task1 = parseDirectStreamCard(card1);
    expect(task1).not.toBeNull();
    expect(task1?.title).toBe('Assignment-1-Graded');
    expect(task1?.courseName).toBe('Calculus I for Engineering');
    expect(new Date(task1!.dueDate).getDate()).toBe(18);
    expect(new Date(task1!.dueDate).getMonth()).toBe(8); // September

    // Item 2
    const card2 = `Physics 1 - ALL - 1 - الفيزياء-1
Due: HW1_Phys.1_Fall26-27 (chap. 1 & Chap. 2)
Due Date: 9/20/26, 11:59 PM (UTC+4)`;
    const task2 = parseDirectStreamCard(card2);
    expect(task2).not.toBeNull();
    expect(task2?.title).toBe('HW1_Phys.1_Fall26-27 (chap. 1 & Chap. 2)');
    expect(task2?.courseName).toBe('Physics 1');
    expect(new Date(task2!.dueDate).getDate()).toBe(20);

    // Item 3
    const card3 = `Islamic Culture - 13A - الثقافة الإسلامية
Due: البحث العلمي (واجب جماعي) 15 درجة
Due Date: 10/15/26, 11:59 PM (UTC+4)`;
    const task3 = parseDirectStreamCard(card3);
    expect(task3).not.toBeNull();
    expect(task3?.title).toBe('البحث العلمي (واجب جماعي) 15 درجة');
    expect(task3?.courseName).toBe('Islamic Culture');
    expect(new Date(task3!.dueDate).getMonth()).toBe(9); // October
    expect(new Date(task3!.dueDate).getDate()).toBe(15);

    // Item 4
    const card4 = `Islamic Culture - 13A - الثقافة الإسلامية
Due: واجب (10 درجات)
Due Date: 10/25/26, 5:59 AM (UTC+4)`;
    const task4 = parseDirectStreamCard(card4);
    expect(task4).not.toBeNull();
    expect(task4?.title).toBe('واجب (10 درجات)');
    expect(new Date(task4!.dueDate).getDate()).toBe(25);
    expect(new Date(task4!.dueDate).getHours()).toBe(5);
    expect(new Date(task4!.dueDate).getMinutes()).toBe(59);
  });
});
