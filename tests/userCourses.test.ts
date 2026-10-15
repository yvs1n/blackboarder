import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_USER_COURSES,
  userCoursesToScheduleEntries,
  userCoursesToSyllabi,
  userCoursesToLegend,
  getActiveUserCourses,
  setActiveUserCourses,
  resetActiveUserCourses,
  getActiveScheduleEntries,
  getActiveSyllabi,
  getActiveCourseLegend
} from '../src/core/userCourses';
import { findCourseSchedule, resolveTaskRoom } from '../src/core/courseSchedule';
import { findCourseSyllabus, resolveTaskWeight } from '../src/core/syllabusWeights';
import { UserCourseConfig, DeadlineTask } from '../src/types';
import {
  getUserCourses,
  saveUserCourses,
  resetUserCoursesToDefault,
  recalculateTasksWithActiveCourses,
  saveTasks,
  getTasks,
  autoRegisterDiscoveredCourses
} from '../src/utils/storage';

describe('Dynamic User Courses & Adapters (userCourses.ts)', () => {
  beforeEach(() => {
    resetActiveUserCourses();
  });

  it('contains 6 default courses with valid schedule and syllabus definitions', () => {
    expect(DEFAULT_USER_COURSES.length).toBe(6);

    const calc = DEFAULT_USER_COURSES.find(c => c.id === 'calc1');
    expect(calc).toBeDefined();
    expect(calc?.scheduleSlots[0].startTime).toBe('12:30');
    expect(calc?.scheduleSlots[0].endTime).toBe('13:45');
    expect(calc?.scheduleSlots[0].room).toBe('A12-110');
    expect(calc?.syllabus.length).toBeGreaterThan(0);

    const phyLab = DEFAULT_USER_COURSES.find(c => c.id === 'phy1lab');
    expect(phyLab).toBeDefined();
    expect(phyLab?.scheduleSlots[0].room).toBe('Central Lab Men - 105');
  });

  it('converts UserCourseConfig[] into CourseScheduleEntry[]', () => {
    const entries = userCoursesToScheduleEntries(DEFAULT_USER_COURSES);
    expect(entries.length).toBe(6);

    const comp = entries.find(e => e.courseId === 'compeng');
    expect(comp).toBeDefined();
    expect(comp?.startHour).toBe(11);
    expect(comp?.startMinute).toBe(0);
    expect(comp?.room).toBe('A8-103');
    expect(comp?.matcher.test('Introduction to Computer Eng.')).toBe(true);
    expect(comp?.matcher.test('1502101')).toBe(true);
  });

  it('converts UserCourseConfig[] into CourseSyllabus[]', () => {
    const syllabi = userCoursesToSyllabi(DEFAULT_USER_COURSES);
    expect(syllabi.length).toBe(6);

    const eap = syllabi.find(s => s.courseId === 'eap');
    expect(eap).toBeDefined();
    expect(eap?.components.length).toBe(5);

    const finalExam = eap?.components.find(c => c.id === 'eap_final');
    expect(finalExam?.totalWeight).toBe(40);
    expect(finalExam?.matcher.test('Final Exam')).toBe(true);
  });

  it('converts UserCourseConfig[] into permanent course legend items', () => {
    const legend = userCoursesToLegend(DEFAULT_USER_COURSES);
    expect(legend.length).toBe(6);
    expect(legend.find(l => l.name === 'Calculus I for Engineering')?.hex).toBe('#dc2626');
  });

  it('dynamically adapts findCourseSchedule and resolveTaskWeight when active courses change', () => {
    const customCourses: UserCourseConfig[] = [
      {
        id: 'softeng',
        courseCode: '1501 301',
        courseName: 'Software Engineering',
        colorHex: '#8b5cf6',
        aliases: ['software eng', 'sw eng'],
        scheduleSlots: [
          {
            days: ['Monday', 'Wednesday'],
            startTime: '10:00',
            endTime: '11:15',
            room: 'M9-205'
          }
        ],
        syllabus: [
          {
            id: 'se_sprint1',
            name: 'Sprint 1 Deliverable',
            type: 'project',
            totalWeight: 25,
            keywords: ['sprint 1', 'deliverable']
          }
        ]
      }
    ];

    setActiveUserCourses(customCourses);

    // Verify schedule entry matches custom course
    const schedule = findCourseSchedule('Software Engineering');
    expect(schedule).toBeDefined();
    expect(schedule?.room).toBe('M9-205');
    expect(schedule?.startHour).toBe(10);

    // Verify syllabus weights resolve custom component
    const syllabus = findCourseSyllabus('Software Engineering');
    expect(syllabus).toBeDefined();

    const weightRes = resolveTaskWeight({
      courseName: 'Software Engineering',
      title: 'Sprint 1 Deliverable submission'
    });
    expect(weightRes.weight).toBe(25);
    expect(weightRes.componentName).toBe('Sprint 1 Deliverable');
  });

  it('recalculates task weights and rooms when recalculateTasksWithActiveCourses is called', async () => {
    const customCourses: UserCourseConfig[] = [
      {
        id: 'bio101',
        courseCode: '1410 101',
        courseName: 'General Biology',
        colorHex: '#10b981',
        aliases: ['biology', 'bio'],
        scheduleSlots: [
          {
            days: ['Sunday', 'Tuesday', 'Thursday'],
            startTime: '09:00',
            endTime: '09:50',
            room: 'W11-102'
          }
        ],
        syllabus: [
          {
            id: 'bio_midterm',
            name: 'Midterm Exam',
            type: 'exam',
            totalWeight: 35,
            keywords: ['midterm']
          }
        ]
      }
    ];

    // Set custom courses
    await saveUserCourses(customCourses);

    // Create a task that previously had no weight and no room
    const testTask: DeadlineTask = {
      id: 'task_bio_test',
      title: 'Midterm Exam Biology',
      courseName: 'General Biology',
      courseCode: '1410 101',
      type: 'exam',
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      hasSpecificTime: false,
      completed: false,
      userEdited: false,
      createdAt: new Date().toISOString()
    };

    await saveTasks([testTask]);

    const updated = await recalculateTasksWithActiveCourses();
    const recalculated = updated.find(t => t.id === 'task_bio_test');

    expect(recalculated).toBeDefined();
    expect(recalculated?.weight).toBe(35);
    expect(recalculated?.room).toBe('W11-102');

    // Clean up
    await resetUserCoursesToDefault();
  });

  it('reactively updates active legend when custom courses are added or modified', async () => {
    const initialLegend = getActiveCourseLegend();
    expect(initialLegend.length).toBe(0);

    const extraCourse: UserCourseConfig = {
      id: 'chem1',
      courseCode: '1420 101',
      courseName: 'General Chemistry I',
      colorHex: '#059669',
      aliases: ['chem 1', 'chemistry'],
      scheduleSlots: [],
      syllabus: []
    };

    await saveUserCourses([...DEFAULT_USER_COURSES, extraCourse]);
    const updatedLegend = getActiveCourseLegend();
    expect(updatedLegend.length).toBe(7);

    const chemEntry = updatedLegend.find(l => l.name === 'General Chemistry I');
    expect(chemEntry).toBeDefined();
    expect(chemEntry?.hex).toBe('#059669');
    expect(chemEntry?.pattern.test('chem 1')).toBe(true);

    await resetUserCoursesToDefault();
    expect(getActiveCourseLegend().length).toBe(6);
  });

  it('automatically registers newly discovered courses during scans into user courses', async () => {
    // Start with empty custom courses
    await saveUserCourses([]);
    expect(getActiveUserCourses().length).toBe(0);

    const scannedTasks: DeadlineTask[] = [
      {
        id: 't-stat',
        title: 'Homework 1',
        courseName: 'Applied Statistics',
        courseCode: '1440 211',
        type: 'assignment',
        dueDate: '2026-10-20T23:59:00.000Z',
        hasSpecificTime: false,
        completed: false,
        userEdited: false,
        createdAt: new Date().toISOString()
      },
      {
        id: 't-algo',
        title: 'Quiz 1',
        courseName: 'Analysis of Algorithms',
        courseCode: '1501 331',
        type: 'quiz',
        dueDate: '2026-10-22T10:00:00.000Z',
        hasSpecificTime: true,
        completed: false,
        userEdited: false,
        createdAt: new Date().toISOString()
      }
    ];

    const result = await autoRegisterDiscoveredCourses(scannedTasks);
    expect(result.length).toBe(2);
    expect(result.some(c => c.courseName === 'Applied Statistics')).toBe(true);
    expect(result.some(c => c.courseName === 'Analysis of Algorithms')).toBe(true);

    // Running again with the same tasks should not create duplicates
    const rerun = await autoRegisterDiscoveredCourses(scannedTasks);
    expect(rerun.length).toBe(2);

    // Active legend reflects the newly auto-registered courses
    const legend = getActiveCourseLegend();
    expect(legend.length).toBe(2);
  });
});
