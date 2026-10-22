import { describe, it, expect } from 'vitest';
import { buildMarksSummary, marksSummaryHtml, marksBadgeText, formatScore } from '../src/utils/marks';
import fs from 'node:fs';

const syllabi = [
  { courseName: 'English', courseCodePattern: /english/i, totalWeight: 100 },
  { courseName: 'Physics 1', courseCodePattern: /physics/i, totalWeight: 100 }
];
const t = (o: any) => ({ id: o.title, status: 'completed', dueDate: '2026-10-01', courseName: 'English for Academic Purposes', ...o });

describe('Marks summary', () => {
  it('groups graded and submitted items by course with the earned share', () => {
    const s = buildMarksSummary([
      t({ title: 'Quiz 1', submissionStatus: 'graded', score: 4.5, maxScore: 5, weight: 5 }),
      t({ title: 'Midterm', submissionStatus: 'graded', score: 20, maxScore: 20, weight: 20 }),
      t({ title: 'Essay', submissionStatus: 'submitted' }),
      t({ title: 'HW1', courseName: 'Physics 1', submissionStatus: 'graded', score: 9, maxScore: 10 }),
      t({ title: 'Not graded', courseName: 'Physics 1' })
    ] as any, syllabi);
    expect(s.gradedCount).toBe(3);
    expect(s.submittedCount).toBe(1);
    const en = s.courses.find(c => c.courseName === 'English')!;
    expect(en.marks.map(m => m.title)).toEqual(['Quiz 1', 'Midterm', 'Essay']);
    expect(en.gradedWeight).toBe(25);
    expect(en.earnedWeight).toBe(24.5);
    const ph = s.courses.find(c => c.courseName === 'Physics 1')!;
    expect(ph.marks).toHaveLength(1);
    expect(ph.marks[0].percent).toBe(90);
    expect(marksBadgeText(s)).toBe('3 marks · 1 awaiting');
  });

  it('renders escaped html and an empty state', () => {
    const s = buildMarksSummary([t({ title: '<b>x</b>', submissionStatus: 'graded', score: 1, maxScore: 2 })] as any, syllabi);
    const html = marksSummaryHtml(s, () => '#123456');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('1 / 2');
    expect(marksSummaryHtml(buildMarksSummary([], syllabi), () => '')).toContain('No marks yet');
    expect(formatScore(19.95, 20)).toBe('20 / 20');
  });

  it('popup and phone both use the shared Marks list', () => {
    expect(fs.readFileSync('src/popup/popup.ts', 'utf8')).toContain('buildMarksSummary(tasks, getAllSyllabi())');
    expect(fs.readFileSync('mobile-web/companion/app.js', 'utf8')).toContain('BB.buildMarksSummary(state.tasks');
  });
});
