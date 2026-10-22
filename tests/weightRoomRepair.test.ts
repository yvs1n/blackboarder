import { describe, it, expect, beforeEach } from 'vitest';
import { setActiveUserCourses, DEFAULT_USER_COURSES } from '../src/core/userCourses';
import { extractStatedWeight, resolveTaskWeight } from '../src/core/syllabusWeights';
import { isPlausibleRoom, resolveTaskRoom } from '../src/core/courseSchedule';
import { repairTaskWeightsAndRooms } from '../src/utils/taskRepair';
import fs from 'node:fs';

// Text copied from the owner's real tasks (2026-10-22 backup)
const CPE_TEXT = 'Dear Students,As announced before, the Midterm exam is scheduled on Monday, 12 October 2026, from 12:30 pm to 13:30 pm in A10:006. No makeup Midterm will be given as mentioned in class. Those who miss the midterm with an official excuse that is acceptable will have their final exam out of 75%.';
const ISLAMIC_TEXT = 'الطلبة الأعزاءتعليمات مهمة لإجراء امتحان المنتصف -الثقافة الإسلامية خريف 2026-2027م التاريخ: السبت الموافق 10/10/2026 قاعة الامتحان: الامتحان سيعقد حضوريا في الجامعة بالقاعة (A12 -007 و A12-008 ) امتحان نهائي';

beforeEach(() => setActiveUserCourses(DEFAULT_USER_COURSES));

const task = (o: any) => ({ id: 'x', status: 'pending', dueDate: '2026-10-12T12:30:00', extractedBy: 'local', ...o });

describe('extractStatedWeight', () => {
  it('only counts a percentage tied to the item', () => {
    expect(extractStatedWeight('This quiz is worth 5% of your grade')).toBe(5);
    expect(extractStatedWeight('The project counts for 15%')).toBe(15);
    expect(extractStatedWeight('It is 10% of the total grade')).toBe(10);
    expect(extractStatedWeight('Weight: 20%')).toBe(20);
    expect(extractStatedWeight(CPE_TEXT)).toBeNull();
    expect(extractStatedWeight('Scored 75% on average last year')).toBeNull();
  });
});

describe('weights', () => {
  it('CPE midterm gets the syllabus 30%, not the 75% from the final exam sentence', () => {
    const w = resolveTaskWeight(task({ title: 'Midterm', type: 'exam', courseName: 'Introduction to Computer Eng.', description: CPE_TEXT, sourceSnippet: CPE_TEXT }));
    expect(w.weight).toBe(30);
  });

  it('Islamic midterm matches the midterm (25%), not the final mentioned in the text', () => {
    const w = resolveTaskWeight(task({ title: 'Midterm', type: 'exam', courseName: 'Islamic Culture', courseCode: '0104100', description: ISLAMIC_TEXT, sourceSnippet: ISLAMIC_TEXT }));
    expect(w.weight).toBe(25);
  });
});

describe('rooms', () => {
  it('reads "A10:006" as A10-006 but not a time like 12:30', () => {
    const r = resolveTaskRoom({ courseNameOrCode: 'Introduction to Computer Eng.', announcementText: CPE_TEXT, title: 'Midterm', type: 'exam' });
    expect(r.room).toBe('A10-006');
  });

  it('isPlausibleRoom rejects junk', () => {
    expect(isPlausibleRoom('s')).toBe(false);
    expect(isPlausibleRoom('Please')).toBe(false);
    expect(isPlausibleRoom('')).toBe(false);
    expect(isPlausibleRoom('A10-006')).toBe(true);
    expect(isPlausibleRoom('M10-TH001')).toBe(true);
  });

  it('a junk saved room is replaced; a real one is kept', () => {
    expect(resolveTaskRoom({ courseNameOrCode: 'Introduction to Computer Eng.', announcementText: CPE_TEXT, title: 'Midterm', type: 'exam', existingRoom: 's' }).room).toBe('A10-006');
    expect(resolveTaskRoom({ courseNameOrCode: 'Introduction to Computer Eng.', announcementText: 'Bring a calculator', title: 'Midterm', type: 'exam', existingRoom: 'B5-101' }).room).toBe('B5-101');
  });
});

describe('repairTaskWeightsAndRooms', () => {
  it('fixes stored wrong values once and leaves edited tasks alone', () => {
    const cpe: any = task({ title: 'Midterm', type: 'exam', courseName: 'Introduction to Computer Eng.', description: CPE_TEXT, sourceSnippet: CPE_TEXT, weight: 75, room: 's', updatedAt: 'old' });
    const edited: any = task({ title: 'Midterm', type: 'exam', courseName: 'Introduction to Computer Eng.', description: CPE_TEXT, weight: 75, room: 's', userEdited: true, updatedAt: 'old' });
    expect(repairTaskWeightsAndRooms([cpe, edited])).toBe(1);
    expect(cpe.weight).toBe(30);
    expect(cpe.room).toBe('A10-006');
    expect(edited.weight).toBe(75);
    expect(edited.room).toBe('s');
    // A second pass changes nothing, so it does not trigger another sync
    expect(repairTaskWeightsAndRooms([cpe])).toBe(0);
  });

  it('the phone app only fills missing weights', () => {
    const src = fs.readFileSync('mobile-web/companion/app.js', 'utf8');
    expect(src).toContain("t.weight === undefined && !t.userEdited && t.extractedBy !== 'manual'");
  });
});
