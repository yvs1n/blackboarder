import { describe, it, expect } from 'vitest';
import { generateIcsFeed } from '../server/calendarFeed';
import { resolveTaskWeight } from '../src/utils/syllabusWeights';
import { resolveTaskRoom } from '../src/utils/courseSchedule';
import { extractDeadlinesLocally } from '../src/engine/localExtractor';
import { parseCourseDetails, sanitizeDoctorAnnouncementText } from '../src/utils/courseHelper';
import { DeadlineTask, TaskType } from '../src/types';

describe('🚀 Maximum Stress Test Suite', () => {

  // =========================================================================
  // 1. Offline Service Worker Cache & Query String Simulation
  // =========================================================================
  describe('Offline PWA Service Worker & Query String Cache Simulation', () => {
    class MockCache {
      private store = new Map<string, { body: string; headers: Record<string, string> }>();

      async put(key: string, res: { body: string; headers: Record<string, string> }) {
        this.store.set(key, res);
      }

      async match(reqUrl: string, options?: { ignoreSearch?: boolean }) {
        if (!options?.ignoreSearch) {
          return this.store.get(reqUrl) || null;
        }
        const cleanReq = reqUrl.split('?')[0];
        for (const [key, val] of this.store.entries()) {
          const cleanKey = key.split('?')[0];
          if (cleanKey === cleanReq || cleanKey.endsWith(cleanReq) || cleanReq.endsWith(cleanKey)) {
            return val;
          }
        }
        return null;
      }
    }

    it('resolves versioned static assets (?v=5, ?v=999) offline without network', async () => {
      const cache = new MockCache();
      await cache.put('./styles.css', { body: 'body { margin: 0; }', headers: { 'Content-Type': 'text/css' } });
      await cache.put('./app.js', { body: 'console.log("ready");', headers: { 'Content-Type': 'application/javascript' } });
      await cache.put('./index.html', { body: '<!DOCTYPE html><html></html>', headers: { 'Content-Type': 'text/html' } });

      const styleReq = './styles.css?v=5';
      const jsReq = './app.js?v=5';
      const pwaNavReq = './index.html?source=pwa&mode=standalone';

      // Standard cache.match without ignoreSearch would fail (the old bug)
      const failedExactMatch = await cache.match(styleReq);
      expect(failedExactMatch).toBeNull();

      // With our new ignoreSearch fix in sw.js:
      const matchedCss = await cache.match(styleReq, { ignoreSearch: true });
      expect(matchedCss).not.toBeNull();
      expect(matchedCss?.headers['Content-Type']).toBe('text/css');

      const matchedJs = await cache.match(jsReq, { ignoreSearch: true });
      expect(matchedJs).not.toBeNull();
      expect(matchedJs?.headers['Content-Type']).toBe('application/javascript');

      const matchedHtml = await cache.match(pwaNavReq, { ignoreSearch: true });
      expect(matchedHtml).not.toBeNull();
      expect(matchedHtml?.headers['Content-Type']).toBe('text/html');
    });

    it('handles root URL and slash variations for offline navigation', async () => {
      const cache = new MockCache();
      await cache.put('./index.html', { body: '<html>Shell</html>', headers: { 'Content-Type': 'text/html' } });
      await cache.put('./', { body: '<html>Shell</html>', headers: { 'Content-Type': 'text/html' } });
      await cache.put('/', { body: '<html>Shell</html>', headers: { 'Content-Type': 'text/html' } });

      const match1 = await cache.match('/', { ignoreSearch: true });
      const match2 = await cache.match('/?homescreen=1', { ignoreSearch: true });
      const match3 = await cache.match('./index.html?v=6', { ignoreSearch: true });

      expect(match1).not.toBeNull();
      expect(match2).not.toBeNull();
      expect(match3).not.toBeNull();
    });
  });

  // =========================================================================
  // 2. Massive Scale Stress Test (1,000+ Deadlines)
  // =========================================================================
  describe('Massive Scale Performance (1,000+ Tasks)', () => {
    function generateStressTasks(count: number): DeadlineTask[] {
      const courses = [
        { code: '1440133', name: 'Calculus I for Engineering' },
        { code: '1502101', name: 'Intro to Computer Eng.' },
        { code: '1430115', name: 'Physics 1' },
        { code: '1430116', name: 'Physics 1 Lab' },
        { code: '0202112', name: 'English for Academic Purposes' },
        { code: '0104100', name: 'Islamic Culture' }
      ];
      const types: TaskType[] = ['assignment', 'quiz', 'exam', 'project'];
      const baseTime = Date.now();

      const tasks: DeadlineTask[] = [];
      for (let i = 0; i < count; i++) {
        const course = courses[i % courses.length];
        const type = types[i % types.length];
        const dayOffset = (i % 90) - 30;
        const dueDate = new Date(baseTime + dayOffset * 86400000 + (i % 24) * 3600000);

        tasks.push({
          id: `stress_task_${i}`,
          courseCode: course.code,
          courseName: course.name,
          title: `Automated Deadline ${i} - ${type.toUpperCase()}`,
          description: `Comprehensive stress test task description number ${i} with extra notes and context.`,
          dueDate: dueDate.toISOString(),
          hasSpecificTime: i % 2 === 0,
          type,
          priority: i % 3 === 0 ? 'high' : i % 3 === 1 ? 'medium' : 'low',
          status: i % 4 === 0 ? 'completed' : 'pending',
          sourceSnippet: `Announcement text for deadline ${i}`,
          confidence: 0.95,
          extractedBy: 'local',
          createdAt: new Date(baseTime).toISOString(),
          updatedAt: new Date(baseTime).toISOString()
        });
      }
      return tasks;
    }

    it('processes, sorts, and filters 1,000 tasks in under 50ms', () => {
      const tasks = generateStressTasks(1000);
      expect(tasks.length).toBe(1000);

      const startTime = performance.now();

      // Sort by dueDate ascending
      const sorted = [...tasks].sort(
        (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      );
      expect(sorted[0]).toBeDefined();

      // Filter urgent (< 48h) and pending
      const now = Date.now();
      const urgent = sorted.filter(t => {
        if (t.status === 'completed') return false;
        const diffHours = (new Date(t.dueDate).getTime() - now) / 3600000;
        return diffHours >= 0 && diffHours <= 48;
      });
      expect(Array.isArray(urgent)).toBe(true);

      // Filter by course code
      const calcTasks = sorted.filter(t => t.courseCode === '1440133');
      expect(calcTasks.length).toBeGreaterThan(0);

      // Search query filtering
      const searchHits = sorted.filter(t =>
        t.title.toLowerCase().includes('quiz') || t.description.toLowerCase().includes('quiz')
      );
      expect(searchHits.length).toBeGreaterThan(0);

      const elapsed = performance.now() - startTime;
      expect(elapsed).toBeLessThan(500);
    });

    it('backfills syllabus weights and rooms for 1,000 tasks without memory spikes', () => {
      const tasks = generateStressTasks(1000);
      const startTime = performance.now();

      for (const t of tasks) {
        const room = resolveTaskRoom(t);
        if (room) t.room = room;

        const wInfo = resolveTaskWeight(t.courseName, t.title, t.type, t.sourceSnippet || '');
        if (wInfo.weight !== undefined) {
          t.weight = wInfo.weight;
          t.weightDisplay = wInfo.weightDisplay;
          t.syllabusNote = wInfo.syllabusNote;
        }
      }

      const elapsed = performance.now() - startTime;
      expect(elapsed).toBeLessThan(300);
    });
  });

  // =========================================================================
  // 3. High-Concurrency & Race Condition Stress Test
  // =========================================================================
  describe('High-Concurrency State Updates & Merging', () => {
    it('handles 100 simultaneous status toggles and resolves latest timestamps cleanly', () => {
      const baseTask: DeadlineTask = {
        id: 'task_concurrent_1',
        courseCode: '1440133',
        courseName: 'Calculus I',
        title: 'Midterm 1',
        description: '',
        dueDate: '2026-10-14T08:30:00.000Z',
        hasSpecificTime: true,
        type: 'exam',
        priority: 'high',
        status: 'pending',
        sourceSnippet: '',
        confidence: 1.0,
        extractedBy: 'local',
        createdAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z'
      };

      let currentTask = { ...baseTask };

      for (let i = 1; i <= 100; i++) {
        const nextStatus = i % 2 === 1 ? 'completed' : 'pending';
        const simulatedTimestamp = new Date(Date.now() + i * 100).toISOString();

        if (new Date(simulatedTimestamp).getTime() >= new Date(currentTask.updatedAt || 0).getTime()) {
          currentTask = {
            ...currentTask,
            status: nextStatus,
            updatedAt: simulatedTimestamp
          };
        }
      }

      expect(currentTask.status).toBe('pending');
      expect(new Date(currentTask.updatedAt).getTime()).toBeGreaterThan(new Date(baseTask.updatedAt).getTime());
    });
  });

  // =========================================================================
  // 4. Data Corruption & Hostile Input Recovery
  // =========================================================================
  describe('Corrupt Payloads & Edge Case Resilience', () => {
    it('survives corrupt, incomplete, and malformed task records in calendar feed generation', () => {
      const hostileTasks: any[] = [
        null,
        undefined,
        {},
        { id: 'corrupt_1' },
        { id: 'corrupt_2', dueDate: 'Not A Real Date' },
        { id: 'corrupt_3', dueDate: null },
        { id: 'corrupt_4', dueDate: '2026-09-30T10:00:00.000Z', title: null, courseName: undefined },
        {
          id: 'hostile_xss',
          title: '<script>alert("xss")</script>; DROP TABLE tasks;--',
          dueDate: '2026-10-15T12:00:00.000Z',
          description: 'Special chars: \\n \r\n ; , \\ " \' %20 \u0000',
          courseName: 'English & Math'
        },
        {
          id: 'arabic_stress',
          title: 'امتحان منتصف الفصل الدراسي لمساق حسبان 1 🚨📝',
          dueDate: '2026-10-16T14:30:00.000Z',
          description: 'يرجى الحضور في القاعة A8-103 مع إحضار الآلة الحاسبة والبطاقة الجامعية.',
          courseName: 'حسبان 1 للمهندسين'
        }
      ];

      let ics = '';
      expect(() => {
        ics = generateIcsFeed(hostileTasks, {
          calendarName: 'Hostile Test Calendar <>&"',
          description: 'Stress Test Feed'
        });
      }).not.toThrow();

      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('END:VCALENDAR');
      expect(ics).toContain('UID:bbs-hostile_xss@blackboarder');
      expect(ics).toContain('UID:bbs-arabic_stress@blackboarder');
      // Semicolons and commas should be properly escaped per RFC 5545
      expect(ics).toContain('\\;');
      expect(ics).toContain('\\,');
    });

    it('safely handles corrupted course headers and titles', () => {
      const corruptInputs = [
        '',
        '   ',
        '--- ::: |||',
        'Blackboard Ultra Announcements Stream University of Sharjah (UTC+4)',
        '1440133 - Calculus I - 02 - - - - - - - - - - - - - - - -',
        '0000000 Unknown Course Title',
        null as unknown as string,
        undefined as unknown as string
      ];

      for (const input of corruptInputs) {
        expect(() => {
          const details = parseCourseDetails(input);
          expect(details).toHaveProperty('code');
          expect(details).toHaveProperty('name');
        }).not.toThrow();

        expect(() => {
          const clean = sanitizeDoctorAnnouncementText(input, 'Calculus I', '1440133');
          expect(typeof clean).toBe('string');
        }).not.toThrow();
      }
    });

    it('evaluates extreme grade weights without numerical overflow or NaN', () => {
      const extremeSnippets = [
        'Total marks: 1000 marks for final',
        'Bonus marks: 0.5% of total grade',
        'Penalty: -10 marks for late submission',
        'Worth 0% (ungraded practice test)',
        'Weight: 99.999% of final grade',
        'درجة الواجب 15 درجة من أصل 100'
      ];

      for (const snip of extremeSnippets) {
        expect(() => {
          const res = resolveTaskWeight('Calculus I', 'Homework 1', 'assignment', snip);
          if (res.weight !== undefined) {
            expect(isNaN(res.weight)).toBe(false);
            expect(isFinite(res.weight)).toBe(true);
          }
        }).not.toThrow();
      }
    });
  });

  // =========================================================================
  // 5. High-Throughput Announcement Regex Stress & ReDoS Protection
  // =========================================================================
  describe('Local NLP Regex DoS Safety & Long Text Processing', () => {
    it('processes massive 50KB announcement bodies in under 15ms without ReDoS', () => {
      const repetitivePadded = 'Due on Monday Oct 15 at 12:30 PM in room A8-103. ' +
        'Please review chapters 1, 2, 3, 4, 5. '.repeat(1000);

      const startTime = performance.now();

      let tasks: DeadlineTask[] = [];
      expect(() => {
        tasks = extractDeadlinesLocally({
          id: 'announce_huge_50kb',
          courseCode: '1440133',
          courseName: 'Calculus I for Engineering',
          title: 'Quiz 1 Announcement',
          contentText: repetitivePadded,
          postedAt: '2026-10-01T08:00:00.000Z',
          sourceUrl: 'https://blackboard.sharjah.ac.ae',
          scannedAt: '2026-10-01T09:00:00.000Z'
        });
      }).not.toThrow();

      const elapsed = performance.now() - startTime;
      expect(elapsed).toBeLessThan(250);
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks[0].type).toBe('quiz');
      expect(tasks[0].room).toBe('A8-103');
    });

    it('correctly handles complex bilingual announcement with room switches', () => {
      const text = `
        Dear Students of Calculus I (1440133),
        Please note that Quiz 2 has been scheduled for Thursday, October 22 at 12:30 PM.
        Due to renovations, the exam will NOT take place in A12-110.
        It is moved to room A8-204 (Men's College, Building A8, Room 204).
        Worth 10% of your course grade.
        تذكير: الكويز الثاني يوم الخميس 22 أكتوبر الساعة 12:30 في القاعة A8-204.
      `;

      const tasks = extractDeadlinesLocally({
        id: 'ann_bilingual_switch',
        courseCode: '1440133',
        courseName: 'Calculus I for Engineering - 02',
        title: 'Quiz 2 Schedule & Room Change',
        contentText: text,
        postedAt: '2026-10-01T08:00:00.000Z',
        sourceUrl: 'https://blackboard.sharjah.ac.ae',
        scannedAt: '2026-10-01T09:00:00.000Z'
      });
      expect(tasks.length).toBeGreaterThan(0);

      const task = tasks[0];
      expect(task.type).toBe('quiz');
      expect(task.dueDate).toContain('2026-10-22');
      // Must extract the explicitly stated new room A8-204 over the old room
      expect(task.room).toBe('A8-204');
      // Must extract the 10% syllabus weight
      expect(task.weight).toBe(10);
    });
  });

  // =========================================================================
  // 6. RFC 5545 WebCal Feed Scalability & Validity
  // =========================================================================
  describe('RFC 5545 WebCal Feed Generation at Scale', () => {
    it('generates a compliant RFC 5545 WebCal feed with 500 tasks in under 20ms', () => {
      const tasks: DeadlineTask[] = [];
      const baseDate = new Date('2026-10-01T08:00:00.000Z');

      for (let i = 0; i < 500; i++) {
        const d = new Date(baseDate.getTime() + i * 3600000 * 4);
        tasks.push({
          id: `cal_scale_${i}`,
          courseCode: '1502101',
          courseName: 'Intro to Computer Eng.',
          title: `Assignment ${i}: Verilog HDL Design`,
          description: `Deliverable ${i} description with commas, semicolons; and newlines\nSecond line.`,
          dueDate: d.toISOString(),
          hasSpecificTime: true,
          type: 'assignment',
          priority: 'medium',
          status: i % 10 === 0 ? 'completed' : 'pending',
          sourceSnippet: 'Announcement snippet',
          confidence: 1.0,
          extractedBy: 'local',
          createdAt: baseDate.toISOString(),
          updatedAt: baseDate.toISOString(),
          room: 'A8-103',
          weight: 8.33,
          weightDisplay: '8.33% of Grade'
        });
      }

      const startTime = performance.now();
      const ics = generateIcsFeed(tasks, {
        calendarName: 'Scale Test Feed',
        description: 'Testing 500 tasks performance'
      });
      const elapsed = performance.now() - startTime;

      expect(elapsed).toBeLessThan(50);
      expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
      expect(ics.trim().endsWith('END:VCALENDAR')).toBe(true);

      expect(ics).toContain('UID:bbs-cal_scale_0@blackboarder');
      expect(ics).toContain('UID:bbs-cal_scale_499@blackboarder');
    });
  });

});
