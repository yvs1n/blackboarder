import { describe, it, expect } from 'vitest';
import { buildSyllabusProgress, syllabusProgressHtml } from '../src/utils/syllabusProgress';
import fs from 'node:fs';

const syllabi = [
  { courseName: 'English', courseCodePattern: /english/i, totalWeight: 100 },
  { courseName: 'Calculus', courseCodePattern: /calc/i, totalWeight: 100 }
];

describe('Syllabus Progress', () => {
  it('splits each course weight into done, pending and not announced', () => {
    const p = buildSyllabusProgress([
      { id: '1', title: 'Quiz 1', courseName: 'English for Academic Purposes', status: 'completed', weight: 5 },
      { id: '2', title: 'Midterm', courseName: 'English for Academic Purposes', status: 'completed', weight: 20 },
      { id: '3', title: 'Final', courseName: 'English for Academic Purposes', status: 'pending', weight: 40 }
    ] as any, syllabi);
    const en = p.courses[0];
    expect(en.completedWeight).toBe(25);
    expect(en.pendingWeight).toBe(40);
    expect(en.upcomingWeight).toBe(35);
    expect(en.percentDone).toBe(25);
    expect(p.courses[1].percentDone).toBe(0);
    expect(p.overallPercent).toBe(13); // 25 of 200
    const html = syllabusProgressHtml(p, () => '#000');
    expect(html).toContain('25% done');
    expect(html).toContain('Not announced 35%');
  });

  it('is shown in the popup and the phone app next to Marks', () => {
    expect(fs.readFileSync('src/popup/index.html', 'utf8')).toContain('id="syllabus-tracker-breakdown"');
    expect(fs.readFileSync('mobile-web/companion/index.html', 'utf8')).toContain('id="mobile-syllabus-tracker-breakdown"');
    expect(fs.readFileSync('mobile-web/companion/app.js', 'utf8')).toContain('BB.buildSyllabusProgress(state.tasks');
  });
});
