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
});
