import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

describe('Mobile Web App Custom Courses Dynamic Engine', () => {
  const appJsCode = fs.readFileSync(path.resolve('mobile-web/app.js'), 'utf-8');

  let sandbox: any;

  beforeEach(() => {
    const storageStore: Record<string, string> = {};

    sandbox = {
      console,
      Date,
      parseInt,
      parseFloat,
      String,
      isNaN,
      Infinity,
      RegExp,
      Array,
      Number,
      Math,
      document: {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => []
      },
      localStorage: {
        getItem: (k: string) => storageStore[k] ?? null,
        setItem: (k: string, v: string) => { storageStore[k] = String(v); },
        removeItem: (k: string) => { delete storageStore[k]; },
        clear: () => { Object.keys(storageStore).forEach(k => delete storageStore[k]); }
      }
    };
    vm.createContext(sandbox);

    // Extract dynamic course configuration and syllabus resolution functions
    const matchCourseBlock = appJsCode.match(/\/\/ =+\s*\n\/\/ Dynamic Course Configurations[\s\S]*?recompileDynamicCourseData\(initialMobileCourses\);/);
    const matchResolveCourse = appJsCode.match(/function resolveCourseInfo\(task\) \{[\s\S]*?\n\}/);
    const matchResolveRoom = appJsCode.match(/function resolveTaskRoom\(task\) \{[\s\S]*?\n\}/);
    const matchResolveWeight = appJsCode.match(/function resolveTaskWeight\(courseNameOrCode = ''[\s\S]*?\n\}/);
    const matchPoints = appJsCode.match(/function extractExplicitPoints\(text\) \{[\s\S]*?\n\}/);
    const matchExtractNumber = appJsCode.match(/function extractAssessmentNumber\(title, context\) \{[\s\S]*?\n\}/);
    const matchExtractRoom = appJsCode.match(/function extractRoomFromText\(text\) \{[\s\S]*?\n\}/);

    if (!matchCourseBlock || !matchResolveCourse || !matchResolveRoom || !matchResolveWeight || !matchPoints || !matchExtractNumber || !matchExtractRoom) {
      throw new Error('Could not extract required dynamic course functions from mobile-web/app.js');
    }

    vm.runInContext(matchCourseBlock[0], sandbox);
    vm.runInContext(matchPoints[0], sandbox);
    vm.runInContext(matchExtractNumber[0], sandbox);
    vm.runInContext(matchExtractRoom[0], sandbox);
    vm.runInContext(matchResolveCourse[0], sandbox);
    vm.runInContext(matchResolveRoom[0], sandbox);
    vm.runInContext(matchResolveWeight[0], sandbox);
  });

  const getLegend = () => vm.runInContext('PERMANENT_COURSE_LEGEND', sandbox);
  const getSchedule = () => vm.runInContext('STUDENT_CLASS_SCHEDULE', sandbox);
  const getSyllabusDb = () => vm.runInContext('DEFAULT_SYLLABUS_DATABASE', sandbox);
  const getSyllabusInfo = () => vm.runInContext('SYLLABUS_INFO', sandbox);
  const recompileCourses = (c: any) => vm.runInContext('recompileDynamicCourseData', sandbox)(c);
  const resolveCourse = (t: any) => vm.runInContext('resolveCourseInfo', sandbox)(t);
  const resolveRoom = (t: any) => vm.runInContext('resolveTaskRoom', sandbox)(t);
  const resolveWeight = (...args: any[]) => vm.runInContext('resolveTaskWeight', sandbox)(...args);
  const loadCourses = () => vm.runInContext('loadInitialUserCourses', sandbox)();

  it('compiles default UOS courses into runtime legend, schedule, and syllabus arrays', () => {
    expect(getLegend().length).toBe(6);
    expect(getSchedule().length).toBeGreaterThanOrEqual(6);
    expect(getSyllabusDb().length).toBe(6);
    expect(getSyllabusInfo().length).toBe(6);

    const calc1Schedule = getSchedule().find((s: any) => s.courseCode === '1440133');
    expect(calc1Schedule).toBeDefined();
    expect(calc1Schedule.room).toBe('A12-110');
    expect(calc1Schedule.time).toBe('12:30 PM - 01:45 PM');
  });

  it('dynamically adapts to imported custom user courses', () => {
    const customCourses = [
      {
        id: 'cs211',
        courseCode: '1501211',
        courseName: 'Data Structures and Algorithms',
        colorHex: '#8b5cf6',
        aliases: ['data structures', 'dsa', '1501 211'],
        scheduleSlots: [
          {
            days: ['Monday', 'Wednesday'],
            startTime: '09:30',
            endTime: '10:45',
            room: 'M9-102',
            location: "Men's Campus, M9-102"
          }
        ],
        syllabus: [
          { id: 'cs211_mid', name: 'Midterm Exam', type: 'exam', totalWeight: 30, unitWeight: 30, keywords: ['midterm'] },
          { id: 'cs211_lab', name: 'Lab Practical', type: 'lab', totalWeight: 20, unitWeight: 20, keywords: ['lab', 'practical'] },
          { id: 'cs211_fin', name: 'Final Exam', type: 'exam', totalWeight: 50, unitWeight: 50, keywords: ['final'] }
        ]
      }
    ];

    recompileCourses(customCourses);

    expect(getLegend().length).toBe(1);
    expect(getLegend()[0].name).toBe('Data Structures and Algorithms');
    expect(getLegend()[0].color).toBe('#8b5cf6');

    expect(getSchedule().length).toBe(1);
    expect(getSchedule()[0].room).toBe('M9-102');
    expect(getSchedule()[0].days).toBe('Mon / Wed');
    expect(getSchedule()[0].time).toBe('09:30 AM - 10:45 AM');

    // Verify resolveCourseInfo matches custom course
    const detected = resolveCourse({ title: 'DSA Midterm Preparation', courseName: 'General Course' });
    expect(detected.courseName).toBe('Data Structures and Algorithms');
    expect(detected.courseCode).toBe('1501211');

    // Verify resolveTaskRoom auto-fills custom room
    const room = resolveRoom({ title: 'DSA Midterm', courseName: 'Data Structures and Algorithms' });
    expect(room).toBe('M9-102');

    // Verify resolveTaskWeight calculates mark allocation
    const weight = resolveWeight('Data Structures and Algorithms', 'Midterm Exam', 'exam', '');
    expect(weight.weight).toBe(30);
    expect(weight.componentName).toBe('Midterm Exam');
  });

  it('persists and reloads custom courses from localStorage', () => {
    const savedCourses = [
      {
        id: 'bio101',
        courseCode: '1420101',
        courseName: 'General Biology I',
        colorHex: '#10b981',
        aliases: ['biology', 'bio 1'],
        scheduleSlots: [],
        syllabus: []
      }
    ];

    sandbox.localStorage.setItem('bbs_mobile_courses', JSON.stringify(savedCourses));
    const loaded = loadCourses();
    expect(loaded.length).toBe(1);
    expect(loaded[0].courseCode).toBe('1420101');
  });
});
