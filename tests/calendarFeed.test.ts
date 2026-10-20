import { describe, it, expect } from 'vitest';
import { DeadlineTask } from '../src/types';
import { generateIcsFeed, escapeIcsText, formatUtcTimestamp, formatDateOnly } from '../server/calendarFeed.js';

describe('Server RFC 5545 Calendar Feed Generator', () => {
  const sampleTask: DeadlineTask = {
    id: 'task-feed-1',
    courseCode: '1440131',
    courseName: 'Calculus I for Engineering',
    title: 'Midterm Exam: Derivatives & Integrals',
    description: 'Exam in Hall M9-021',
    dueDate: '2026-10-20T12:30:00.000Z',
    hasSpecificTime: true,
    type: 'exam',
    priority: 'high',
    status: 'pending',
    weight: 30,
    weightDisplay: '30% Midterm (Paper)',
    syllabusNote: 'Official midterm examination worth 30% of total grade',
    sourceSnippet: 'Dear students, Midterm exam is on October 20 at 12:30 PM in Hall M9-021.',
    confidence: 1.0,
    extractedBy: 'ai',
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z'
  };

  const allDayTask: DeadlineTask = {
    id: 'task-feed-2',
    courseCode: '0401102',
    courseName: 'Introduction to Computer Engineering',
    title: 'Quiz 2: Best of 3/4',
    description: 'In class quiz',
    dueDate: '2026-10-25T00:00:00.000Z',
    hasSpecificTime: false,
    type: 'quiz',
    priority: 'medium',
    status: 'completed',
    weight: 6.67,
    weightDisplay: '6.7% per Quiz',
    sourceSnippet: 'Quiz 2 will be held during our normal lecture time.',
    confidence: 0.95,
    extractedBy: 'local',
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z'
  };

  it('escapes special characters correctly according to RFC 5545', () => {
    const raw = 'Math, Science; Physics\\Intro\nNext line';
    const escaped = escapeIcsText(raw);
    expect(escaped).toBe('Math\\, Science\\; Physics\\\\Intro\\nNext line');
  });

  it('formats UTC timestamps correctly', () => {
    const d = new Date('2026-10-20T12:30:00.000Z');
    expect(formatUtcTimestamp(d)).toBe('20261020T123000Z');
  });

  it('formats date only correctly', () => {
    const d = new Date(2026, 9, 25); // Oct 25, 2026
    expect(formatDateOnly(d)).toBe('20261025');
  });

  it('generates a valid calendar feed with correct VCALENDAR headers and refresh rate', () => {
    const feed = generateIcsFeed([sampleTask]);
    expect(feed).toContain('BEGIN:VCALENDAR');
    expect(feed).toContain('VERSION:2.0');
    expect(feed).toContain('X-WR-CALNAME:Blackboard Deadlines (UOS)');
    expect(feed).toContain('X-PUBLISHED-TTL:PT1H');
    expect(feed).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
    expect(feed).toContain('END:VCALENDAR');
  });

  it('includes event with specific start and end time and 1-hour duration default', () => {
    const feed = generateIcsFeed([sampleTask]);
    expect(feed).toContain('BEGIN:VEVENT');
    expect(feed).toContain('SUMMARY:[1440131] Midterm Exam: Derivatives & Integrals');
    expect(feed).toContain('DTSTART:20261020T123000Z');
    expect(feed).toContain('DTEND:20261020T133000Z');
    expect(feed).toContain('PRIORITY:1');
    expect(feed).toContain('STATUS:CONFIRMED');
    expect(feed).toContain('CATEGORIES:EXAM');
  });

  it('includes alarms 24 hours (-P1D) and 2 hours (-PT2H) before event', () => {
    const feed = generateIcsFeed([sampleTask]);
    expect(feed).toContain('BEGIN:VALARM');
    expect(feed).toContain('TRIGGER:-P1D');
    expect(feed).toContain('TRIGGER:-PT2H');
    expect(feed).toContain('END:VALARM');
  });

  it('includes syllabus weight and doctor announcement quote in event description', () => {
    const feed = generateIcsFeed([sampleTask]);
    expect(feed).toContain('Weight: 30% Midterm (Paper)');
    expect(feed).toContain('Syllabus Note: Official midterm examination');
    expect(feed).toContain('Doctor\\\'s Announcement:'.replace(/\\'/g, "'"));
    expect(feed).toContain('Dear students\\, Midterm exam is on October 20');
  });

  it('handles all-day task and marks status completed properly with checkmark and alarm suppression', () => {
    const feed = generateIcsFeed([allDayTask]);
    expect(feed).toContain('BEGIN:VEVENT');
    expect(feed).toContain('DTSTART;VALUE=DATE:20261025');
    expect(feed).toContain('SUMMARY:✓ [0401102] Quiz 2: Best of 3/4 (Done)');
    expect(feed).toContain('STATUS:COMPLETED');
    expect(feed).toContain('Status: Completed (Done)');
    expect(feed).toContain('CATEGORIES:QUIZ');
    // Completed tasks must have alarms suppressed so finished deadlines do not trigger alerts
    expect(feed).not.toContain('BEGIN:VALARM');
  });

  it('includes LOCATION tag and Room in description when task has room specified', () => {
    const taskWithRoom: DeadlineTask = {
      ...sampleTask,
      id: 'task-with-room-1',
      room: 'A12-110'
    };
    const feed = generateIcsFeed([taskWithRoom]);
    expect(feed).toContain('LOCATION:A12-110');
    expect(feed).toContain('Room: A12-110');
  });
});
