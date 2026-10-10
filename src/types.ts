export type TaskType = 
  | 'quiz' 
  | 'assignment' 
  | 'exam' 
  | 'project' 
  | 'lab' 
  | 'meeting' 
  | 'other';

export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'completed' | 'dismissed';

export interface Announcement {
  id: string;
  courseCode: string;
  courseName: string;
  title: string;
  author?: string;
  postedAt?: string; // ISO date string
  contentText: string;
  contentHtml?: string;
  sourceUrl: string;
  scannedAt: string;
}

export interface DeadlineTask {
  id: string;
  announcementId?: string;
  courseCode: string;
  courseName: string;
  title: string;
  description: string;
  dueDate: string; // ISO 8601 string
  hasSpecificTime: boolean;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  sourceSnippet: string;
  confidence: number; // 0.0 - 1.0
  extractedBy: 'local' | 'ai' | 'manual';
  weight?: number; // Grade percentage, e.g. 5 for 5%
  weightDisplay?: string; // Formatted badge text, e.g. "5% of Grade"
  syllabusNote?: string; // Syllabus rule explanation
  room?: string; // Classroom, lab, or hall (e.g. "A8-103", "W8-Lab 3")
  notes?: string; // Student custom notes and instructions
  calendarSynced?: boolean;
  userEdited?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserSettings {
  openRouterApiKey: string;
  openRouterModel: string;
  useAiExtraction: boolean;
  jevApiKey?: string;
  useJevClassification?: boolean;
  autoScanOnPageLoad: boolean;
  badgeNotification: boolean;
  reminderHoursBefore: number;
  customDomains: string[];
  customWeights?: Record<string, any>;
  syncServerUrl?: string;
  syncSecretKey?: string;
  autoSyncMidnight?: boolean;
  autoSyncOnScan?: boolean;
  syncKey?: string;
  hostedWebUrl?: string;
  theme?: 'light' | 'dark' | 'system';
}

export const DEFAULT_SETTINGS: UserSettings = {
  openRouterApiKey: '',
  openRouterModel: 'google/gemini-3.8-flash',
  useAiExtraction: false,
  jevApiKey: '',
  useJevClassification: false,
  autoScanOnPageLoad: true,
  badgeNotification: true,
  reminderHoursBefore: 24,
  customDomains: ['blackboard.sharjah.ac.ae', 'elearning.sharjah.ac.ae', 'blackboard.com'],
  syncServerUrl: 'http://localhost:3456',
  syncSecretKey: '',
  autoSyncMidnight: true,
  autoSyncOnScan: true,
  syncKey: '',
  hostedWebUrl: 'https://yassinr-uossidekick.pages.dev',
  theme: 'light'
};

export interface ScanResult {
  announcementsFound: number;
  newDeadlinesFound: number;
  tasks: DeadlineTask[];
}

export type QuickLinkCategory = 'attendance' | 'study_plan' | 'marks' | 'portal' | 'other';

export interface QuickLink {
  id: string;
  title: string;
  url: string;
  category: QuickLinkCategory;
  icon?: string;
  createdAt: string;
  updatedAt?: string;
}

export const DEFAULT_QUICK_LINKS: QuickLink[] = [
  {
    id: 'ql-attendance',
    title: 'Attendance (Banner)',
    url: 'https://banner.sharjah.ac.ae',
    category: 'attendance',
    createdAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: 'ql-studyplan',
    title: 'Study Plan & Degree Audit',
    url: 'https://banner.sharjah.ac.ae/StudentRegistrationSsb/',
    category: 'study_plan',
    createdAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: 'ql-marks',
    title: 'Final Marks & Transcript',
    url: 'https://banner.sharjah.ac.ae',
    category: 'marks',
    createdAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: 'ql-blackboard',
    title: 'Blackboard Ultra Portal',
    url: 'https://elearning.sharjah.ac.ae/ultra/course',
    category: 'portal',
    createdAt: '2026-09-01T00:00:00.000Z'
  }
];

