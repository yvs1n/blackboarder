import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

describe('Mobile Web App Sorting Verification', () => {
  // Extract STUDENT_CLASS_SCHEDULE, getTaskSortTimestamp, and compareTasksByTime from mobile-web/app.js
  const appJsCode = fs.readFileSync(path.resolve('mobile-web/app.js'), 'utf-8');

  // Create a sandboxed context to evaluate the helper functions from mobile-web/app.js
  const sandbox: any = {
    console,
    Date,
    parseInt,
    parseFloat,
    String,
    isNaN,
    Infinity,
    RegExp
  };
  vm.createContext(sandbox);

  // Extract the necessary definitions from appJsCode
  const matchSchedule = appJsCode.match(/const STUDENT_CLASS_SCHEDULE = \[[\s\S]*?\];/);
  const matchGetSort = appJsCode.match(/function getTaskSortTimestamp\(task\) \{[\s\S]*?\n\}/);
  const matchCompare = appJsCode.match(/function compareTasksByTime\(a, b\) \{[\s\S]*?\n\}/);

  if (!matchSchedule || !matchGetSort || !matchCompare) {
    throw new Error('Could not extract sorting functions from mobile-web/app.js');
  }

  vm.runInContext(matchSchedule[0], sandbox);
  vm.runInContext(matchGetSort[0], sandbox);
  vm.runInContext(matchCompare[0], sandbox);

  const { compareTasksByTime, getTaskSortTimestamp } = sandbox;

  it('correctly sorts mobile day tasks earliest first', () => {
    const tasks = [
      { id: '1', title: 'Late Assignment', dueDate: '2026-10-15T18:00:00', hasSpecificTime: true },
      { id: '2', title: 'Early Quiz', dueDate: '2026-10-15T08:30:00', hasSpecificTime: true },
      { id: '3', title: 'Midday Lab', dueDate: '2026-10-15T11:00:00', hasSpecificTime: true }
    ];

    tasks.sort(compareTasksByTime);
    expect(tasks.map(t => t.id)).toEqual(['2', '3', '1']);
  });

  it('places tasks without specific time at schedule class time (e.g. Calculus 1 at 12:30 PM)', () => {
    const tasks = [
      { id: 'late', title: 'Late HW', dueDate: '2026-10-15T15:00:00', hasSpecificTime: true },
      { id: 'calc', courseName: 'Calculus I for Engineering', title: 'Midterm', dueDate: '2026-10-15T00:00:00', hasSpecificTime: false },
      { id: 'early', title: 'Morning Quiz', dueDate: '2026-10-15T09:00:00', hasSpecificTime: true }
    ];

    tasks.sort(compareTasksByTime);
    // 09:00 AM -> 12:30 PM -> 15:00 PM
    expect(tasks.map(t => t.id)).toEqual(['early', 'calc', 'late']);
  });

  it('defaults unscheduled tasks without specific time to 23:59', () => {
    const tasks = [
      { id: 'unscheduled', courseName: 'Unknown Subject', title: 'Homework', dueDate: '2026-10-15T00:00:00', hasSpecificTime: false },
      { id: 'afternoon', title: 'Presentation', dueDate: '2026-10-15T14:00:00', hasSpecificTime: true }
    ];

    tasks.sort(compareTasksByTime);
    expect(tasks.map(t => t.id)).toEqual(['afternoon', 'unscheduled']);
  });

  it('immediately re-sorts when edited task time changes', () => {
    const taskA = { id: 'a', title: 'Task A', dueDate: '2026-10-15T10:00:00', hasSpecificTime: true };
    const taskB = { id: 'b', title: 'Task B', dueDate: '2026-10-15T14:00:00', hasSpecificTime: true };

    const tasks = [taskA, taskB];
    tasks.sort(compareTasksByTime);
    expect(tasks[0].id).toBe('a');

    // Edit taskB to 07:30
    taskB.dueDate = '2026-10-15T07:30:00';
    tasks.sort(compareTasksByTime);
    expect(tasks[0].id).toBe('b');
    expect(tasks[1].id).toBe('a');
  });
});
