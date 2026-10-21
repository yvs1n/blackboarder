import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { extractRoomFromText } from '../src/core/courseSchedule';
import { resolveTaskWeight } from '../src/core/syllabusWeights';
import { compileCoursePattern, compileSyllabusComponentMatcher, userCoursesToScheduleEntries } from '../src/core/userCourses';
import { sanitizeCloudTasks, sanitizeCloudCourses, safeHexColor } from '../src/utils/cloudSanitize';
import { UserCourseConfig } from '../src/types';

const baseCourse = (over: Partial<UserCourseConfig> = {}): UserCourseConfig => ({
  id: 'c1',
  courseCode: '1234567',
  courseName: 'Test Course',
  colorHex: '#123456',
  aliases: [],
  scheduleSlots: [],
  syllabus: [],
  ...over
});

describe('room extraction no longer treats ordinary words as rooms', () => {
  it('ignores "lab report", "label" and "classroom rules"', () => {
    expect(extractRoomFromText('The lab report is due Sunday')).toBeNull();
    expect(extractRoomFromText('Please check the label on your sheet')).toBeNull();
    expect(extractRoomFromText('classroom rules apply')).toBeNull();
  });

  it('still finds real rooms', () => {
    expect(extractRoomFromText('Quiz in room 204')).toBe('204');
    expect(extractRoomFromText('Held in A8-103 at noon')).toBe('A8-103');
    expect(extractRoomFromText('in Lab 3')).toBe('3');
  });
});

describe('explicit marks in titles', () => {
  it('reads a percentage followed by punctuation, e.g. "(10%)"', () => {
    expect(resolveTaskWeight({ title: 'Assignment 1 (10%)', courseName: 'Unknown Course' }).weight).toBe(10);
    expect(resolveTaskWeight({ title: 'Project worth 15% of the grade', courseName: 'Unknown Course' }).weight).toBe(15);
  });
});

describe('user supplied aliases and keywords cannot break matching', () => {
  it('survives an invalid regex alias and still matches the course code', () => {
    const course = baseCourse({ aliases: ['[unclosed', '(', 'valid\\s*alias'] });
    expect(() => compileCoursePattern(course)).not.toThrow();
    expect(compileCoursePattern(course).test('see 1234567 today')).toBe(true);
    expect(compileCoursePattern(course).test('a valid   alias')).toBe(true);
  });

  it('matches suspicious nested-quantifier patterns literally instead of as a regex', () => {
    const matcher = compileSyllabusComponentMatcher({
      id: 's', name: 'Quiz', type: 'quiz', totalWeight: 10, keywords: ['(a+)+$']
    });
    // The pattern is escaped, so a long run of "a" characters does not match or hang
    expect(matcher.test('a'.repeat(5000) + 'b')).toBe(false);
  });

  it('drops unknown weekday names instead of turning them into Sunday', () => {
    const entries = userCoursesToScheduleEntries([
      baseCourse({ scheduleSlots: [{ days: ['Tuesday', 'Funday' as any], startTime: '10:00', endTime: '11:00', room: 'A1-100' }] })
    ]);
    expect(entries[0].dayIndices).toEqual([2]);
  });
});

describe('cloud sanitizers', () => {
  it('drops tasks with unusable dates and coerces numeric fields', () => {
    const result = sanitizeCloudTasks([
      { id: 'good', title: 'T', dueDate: '2026-11-01T10:00:00.000Z', weight: '<img src=x>', score: '9.5', type: 'quiz' },
      { id: 'baddate', title: 'T', dueDate: 'not a date' },
      { id: 'nostrings', dueDate: '2026-11-01T10:00:00.000Z', courseCode: 42 }
    ]);
    expect(result.map(t => t.id)).toEqual(['good', 'nostrings']);
    expect((result[0] as any).weight).toBeUndefined();
    expect(result[0].score).toBe(9.5);
    expect(result[1].courseCode).toBe('');
    expect(result[1].title).toBe('');
  });

  it('repairs courses: safe colors, array defaults and a stable fallback id', () => {
    const [course] = sanitizeCloudCourses([{ courseCode: 'CS101', courseName: 'Intro', colorHex: 'red;background:url(x)', scheduleSlots: null }])!;
    expect(course.colorHex).toBe('#2563eb');
    expect(course.scheduleSlots).toEqual([]);
    expect(course.syllabus).toEqual([]);
    expect(course.id).toMatch(/^course_cs101/);
    expect(safeHexColor('#abc')).toBe('#abc');
    expect(safeHexColor('#abc;color:red')).toBe('#2563eb');
  });
});

describe('mobile web app behaviours', () => {
  const appJs = fs.readFileSync(path.resolve('mobile-web/app.js'), 'utf-8');
  let sandbox: any;

  beforeEach(() => {
    sandbox = { console, Date, Number, String, Boolean, RegExp, Array, Object, Math, isNaN, parseInt, parseFloat };
    vm.createContext(sandbox);
    const region = appJs.match(/\/\/ =+\s*\n\/\/ Dynamic Course Configurations[\s\S]*?recompileDynamicCourseData\(initialMobileCourses\);/)!;
    // The region reads localStorage when it loads
    sandbox.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    sandbox.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
    vm.runInContext(region[0], sandbox);
    vm.runInContext(appJs.match(/function extractRoomFromText\(text\) \{[\s\S]*?\n\}/)![0], sandbox);
    vm.runInContext(appJs.match(/function extractExplicitPoints\(text\) \{[\s\S]*?\n\}/)![0], sandbox);
    vm.runInContext(appJs.match(/function localDateKey\(input\) \{[\s\S]*?\n\}/)![0], sandbox);
  });

  const call = (name: string, ...args: any[]) => vm.runInContext(name, sandbox)(...args);

  it('sanitizes cloud tasks and courses like the extension does', () => {
    const tasks = call('sanitizeCloudTasks', [
      { id: 'x" onmouseover="alert(1)', title: 'bad', dueDate: '2026-11-01T10:00:00Z' },
      { id: 'ok', title: 'fine', dueDate: '2026-11-01T10:00:00Z', weight: 'abc', type: '<b>' },
      { id: 'nodate', title: 'x', dueDate: 'nope' }
    ]);
    expect(tasks.map((t: any) => t.id)).toEqual(['ok']);
    expect(tasks[0].type).toBe('other');
    expect(tasks[0].weight).toBeUndefined();

    const [course] = call('sanitizeCloudCourses', [{ id: 'c', courseCode: 'A1', courseName: 'N', colorHex: 'url(javascript:1)' }]);
    expect(course.colorHex).toBe('#2563eb');
    expect(course.scheduleSlots).toEqual([]);
  });

  it('does not crash on invalid regex aliases', () => {
    expect(() => call('compileCoursePattern', { id: 'c', courseCode: '1111111', courseName: 'N', aliases: ['[bad', '(x'] })).not.toThrow();
  });

  it('applies the same room and percent fixes', () => {
    expect(call('extractRoomFromText', 'The lab report is due Sunday')).toBeNull();
    expect(call('extractRoomFromText', 'Quiz in room 204')).toBe('204');
    expect(call('extractExplicitPoints', 'Assignment (10%)')).toBe(10);
  });

  it('builds day keys from the local calendar day, not the UTC date', () => {
    // 2026-10-20 23:30 local time must stay on the 20th even when it is already the 21st in UTC
    const local = new Date(2026, 9, 20, 23, 30, 0);
    expect(call('localDateKey', local)).toBe('2026-10-20');
    expect(call('localDateKey', local.toISOString())).toBe('2026-10-20');
    expect(call('localDateKey', 'garbage')).toBe('');
  });
});
