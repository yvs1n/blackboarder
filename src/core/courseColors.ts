/**
 * Permanent course color mapping for University of Sharjah subjects.
 * Colors requested by user:
 * - intro to comp eng: #7c7c7c
 * - calculus 1 for engineering: #dc2626
 * - physics 1: #4b99d2
 * - physics 1 lab: #4b99d2
 * - english for academic purposes: #525252
 * - islamic culture: #489160
 */

export interface CourseColorTheme {
  hex: string;
  bgLight: string;
  border: string;
  textDark: string;
}

const PERMANENT_COLORS: Array<{ pattern: RegExp; hex: string }> = [
  // Physics 1 Lab (must precede Physics 1)
  { pattern: /(?:phys(?:ics)?.*lab|lab.*phys(?:ics)?|مختبر.*فيزياء|1430116|1430117|0401116)/i, hex: '#4b99d2' },
  // Physics 1
  { pattern: /(?:phys(?:ics)?|الفيزياء|فيزياء|1430115|1430111|0401115)/i, hex: '#4b99d2' },
  // Calculus 1 for Engineering (supports Roman numeral I, digits, Arabic, and codes)
  { pattern: /(?:calculus|calc\b|حسبان|1440133|1440131|0401101|0401201)/i, hex: '#dc2626' },
  // Islamic Culture
  { pattern: /(?:islamic|إسلام|اسلام|0104100|0104101)/i, hex: '#489160' },
  // Intro to Comp Eng
  { pattern: /(?:intro.*comp|comp(?:uter)?\s*eng|هندسة.*حاسوب|حاسوب|1502101|0402101|0402102)/i, hex: '#7c7c7c' },
  // English for Academic Purposes
  { pattern: /(?:english|eap\b|academic\s*english|إنجليز|انجليز|0202112|0202111)/i, hex: '#525252' }
];

export const PERMANENT_COURSE_LEGEND = [
  { name: 'Intro to Comp Eng', hex: '#7c7c7c' },
  { name: 'Calculus 1 for Engineering', hex: '#dc2626' },
  { name: 'Physics 1', hex: '#4b99d2' },
  { name: 'Physics 1 Lab', hex: '#4b99d2' },
  { name: 'English for Academic Purposes', hex: '#525252' },
  { name: 'Islamic Culture', hex: '#489160' }
];

// Fallback deterministic colors for any other courses
const FALLBACK_PALETTE = [
  '#2563eb', // Blue
  '#7c3aed', // Purple
  '#059669', // Emerald
  '#d97706', // Amber
  '#db2777', // Pink
  '#0891b2'  // Cyan
];

/**
 * Returns the permanent hex color for a given course name/code or task context.
 */
export function getCourseHex(courseName: string = '', courseCode: string = '', extraContext: string = ''): string {
  const combined = `${courseName} ${courseCode} ${extraContext}`.trim();

  for (const item of PERMANENT_COLORS) {
    if (item.pattern.test(combined)) {
      return item.hex;
    }
  }

  // Deterministic fallback based on course string
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash << 5) - hash + combined.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[index];
}

/**
 * Generates complementary light background and border styles for UI badges and chips.
 */
export function getCourseColorTheme(courseName: string = '', courseCode: string = '', extraContext: string = ''): CourseColorTheme {
  const hex = getCourseHex(courseName, courseCode, extraContext);

  return {
    hex,
    bgLight: `${hex}18`, // 10% opacity for card/badge background
    border: `${hex}45`,  // 27% opacity for borders
    textDark: hex
  };
}
