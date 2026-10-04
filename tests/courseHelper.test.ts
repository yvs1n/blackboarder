import { describe, it, expect } from 'vitest';
import { parseCourseDetails, resolveCourseInfo } from '../src/utils/courseHelper';

describe('Course Details Extraction', () => {
  it('extracts course name and code from UOS hyphenated format', () => {
    const raw = '0401201-01 Computer Programming (Spring 2026) - Announcements';
    const result = parseCourseDetails(raw);
    expect(result.code).toBe('0401201');
    expect(result.name).toBe('Computer Programming');
  });

  it('extracts from bracketed course code format', () => {
    const raw = '[0402202] Data Structures & Algorithms';
    const result = parseCourseDetails(raw);
    expect(result.code).toBe('0402202');
    expect(result.name).toBe('Data Structures & Algorithms');
  });

  it('extracts from standard letter-code format', () => {
    const raw = 'CS101: Introduction to Computer Science - Fall 2025';
    const result = parseCourseDetails(raw);
    expect(result.code).toBe('CS101');
    expect(result.name).toBe('Introduction to Computer Science');
  });

  it('extracts from Arabic course titles', () => {
    const raw = '0401100 - تفاضل وتكامل 1';
    const result = parseCourseDetails(raw);
    expect(result.code).toBe('0401100');
    expect(result.name).toBe('تفاضل وتكامل 1');
  });

  it('provides sensible defaults for empty or general strings', () => {
    const result = parseCourseDetails('');
    expect(result.code).toBe('UOS');
    expect(result.name).toBe('General Course');
  });

  it('resolves raw Ultra stream tasks to official courses with resolveCourseInfo', () => {
    const rawPhysicsLab = {
      courseName: "Measuring Density, Student's Lab. ReportDue date: 9/11/26, 11:59 PM (UTC+4)",
      courseCode: 'UOS',
      title: 'Measuring Density - Lab Report'
    };
    const res1 = resolveCourseInfo(rawPhysicsLab);
    expect(res1.courseName).toBe('Physics 1 Lab');
    expect(res1.courseCode).toBe('1430116');

    const rawEnglish = {
      courseName: 'Topic of a paragraph',
      courseCode: 'UOS',
      title: 'Topic of a paragraph'
    };
    const res2 = resolveCourseInfo(rawEnglish);
    expect(res2.courseName).toBe('English for Academic Purposes');
    expect(res2.courseCode).toBe('0202112');
  });

  it('preserves user custom course names and resolves generic codes', () => {
    const custom = {
      courseName: 'Calculus I for Engineering',
      courseCode: '1440133',
      title: 'Assignment 2'
    };
    const res = resolveCourseInfo(custom);
    expect(res.courseName).toBe('Calculus I for Engineering');
    expect(res.courseCode).toBe('1440133');
  });

  it('never returns UOS as courseCode or courseName for generic courses', () => {
    const generic = {
      courseName: 'uos',
      courseCode: 'UOS',
      title: 'General Update'
    };
    const res = resolveCourseInfo(generic);
    expect(res.courseName).toBe('General Course');
    expect(res.courseCode).toBe('');
  });

  it('resolves course from description or snippet when title is a generic assessment', () => {
    const quizTask = {
      courseName: 'General Course',
      courseCode: '',
      title: 'Quiz 2',
      description: 'Dear students, Quiz 2 covering Calculus 1 chapter 3 will be held on Thursday in room A12-110.'
    };
    const res = resolveCourseInfo(quizTask);
    expect(res.courseName).toBe('Calculus I for Engineering');
    expect(res.courseCode).toBe('1440133');
  });
});

import { parseDirectStreamCard } from '../src/utils/streamParser';
import { isValidTask } from '../src/utils/courseHelper';

describe('Ghost Task Prevention & Stream Parser Resilience', () => {
  it('ignores submission receipts and attempt confirmation cards', () => {
    const receiptCard = `
      Calculus I for Engineering - 02
      You submitted Assignment 1 on 10/4/26, 11:30 PM. Confirmation number: #987654.
      Due Date: 10/4/26, 11:59 PM (UTC+4)
    `;
    const result = parseDirectStreamCard(receiptCard);
    expect(result).toBeNull();
  });

  it('ignores empty stream reminder cards with no course and generic title', () => {
    const ghostCard = `
      Due: Assignment
      Due Date: 10/12/26, 11:59 PM (UTC+4)
    `;
    const result = parseDirectStreamCard(ghostCard);
    expect(result).toBeNull();
  });

  it('successfully extracts valid direct deadline cards with real courses', () => {
    const validCard = `
      Calculus I for Engineering - 02 - حسبان 1 للمهندسين
      Due: Assignment-1-Graded
      Due Date: 10/18/26, 11:59 PM (UTC+4)
    `;
    const result = parseDirectStreamCard(validCard);
    expect(result).not.toBeNull();
    expect(result?.title).toBe('Assignment-1-Graded');
    expect(result?.courseName).toBe('Calculus I for Engineering');
    expect(result?.courseCode).not.toBe('UOS');
  });

  it('isValidTask filters out empty or ghost tasks', () => {
    // Ghost tasks:
    expect(isValidTask({ id: '1', title: '', courseName: '', dueDate: '' } as any)).toBe(false);
    expect(isValidTask({ id: '2', title: 'Assignment', courseName: 'General Course', courseCode: 'UOS', dueDate: '' } as any)).toBe(false);
    expect(isValidTask({ id: '3', title: 'Due in 2 days', courseName: 'General Course', courseCode: '', dueDate: '' } as any)).toBe(false);
    expect(isValidTask({ id: '4', title: 'Untitled', courseName: 'uos', courseCode: 'UOS', dueDate: '' } as any)).toBe(false);

    // Valid tasks:
    expect(isValidTask({ id: '5', title: 'Quiz 2', courseName: 'Calculus I for Engineering', courseCode: '1440133', dueDate: '' } as any)).toBe(true);
    expect(isValidTask({ id: '6', title: 'Lab 1 Report', courseName: 'General Course', courseCode: '', dueDate: '' } as any)).toBe(true);
  });
});
