import { DeadlineTask, TaskType, TaskPriority, TaskStatus, QuickLink, QuickLinkCategory, DEFAULT_QUICK_LINKS } from '../types';
import { getTasks, saveTasks, addTask, updateTask, deleteTask, getSettings, saveSettings, saveAnnouncements, getLastScanCheckpoint, saveLastScanCheckpoint, getQuickLinks, saveQuickLinks, addQuickLink, updateQuickLink, deleteQuickLink, resetQuickLinksToDefault, getCachedTasksSync, getCachedQuickLinksSync, getCachedSettingsSync } from '../utils/storage';
import { createGoogleCalendarUrl, downloadIcsFile, formatCountdown, formatTaskTime, compareTasksByTime } from '../utils/calendar';
import { processAnnouncementsBatch } from '../engine/hybridExtractor';
import { extractDeadlinesLocally } from '../engine/localExtractor';
import { parseCourseDetails, sanitizeDoctorAnnouncementText, resolveCourseInfo, isValidTask } from '../utils/courseHelper';
import { getCourseHex, getCourseColorTheme, PERMANENT_COURSE_LEGEND } from '../utils/courseColors';
import { resolveTaskWeight, getAllSyllabi } from '../utils/syllabusWeights';
import { getAllCourseSchedules, findCourseSchedule, resolveTaskTimeWithSchedule, resolveTaskRoom, STUDENT_CLASS_SCHEDULE } from '../utils/courseSchedule';
import { pushTasksToSyncServer, getSyncServerStatus, normalizeSyncUrl } from '../utils/syncClient';
import { pushTasksToFirebase, fetchTasksFromFirebase, FIREBASE_DB_URL } from '../utils/firebaseSync';
import { mergeCloudTasks, mergeTombstones } from '../utils/taskMerge';

// State
let currentTasks: DeadlineTask[] = [];
let currentQuickLinks: QuickLink[] = [];
let currentFilterStatus: 'all' | 'pending' | 'completed' = 'pending';
let currentFilterCourse: string = 'all';
let currentFilterType: string = 'all';
let currentSearchQuery: string = '';

// Calendar State
const todayDate = new Date();
let calendarYear = todayDate.getFullYear();
let calendarMonth = todayDate.getMonth(); // 0-indexed (0 = Jan)
let selectedDateStr = formatDateKey(todayDate); // 'YYYY-MM-DD'

// DOM Elements: Views & Nav
const tabNavCalendar = document.getElementById('tab-nav-calendar') as HTMLButtonElement;
const tabNavDetails = document.getElementById('tab-nav-details') as HTMLButtonElement;
const navBadgeCount = document.getElementById('nav-badge-count') as HTMLElement;

const viewCalendar = document.getElementById('view-calendar') as HTMLElement;
const viewDetails = document.getElementById('view-details') as HTMLElement;
const viewAdd = document.getElementById('view-add') as HTMLElement;
const viewSettings = document.getElementById('view-settings') as HTMLElement;

// Calendar Elements
const calMonthTitle = document.getElementById('cal-month-title') as HTMLElement;
const btnCalPrev = document.getElementById('btn-cal-prev') as HTMLButtonElement;
const btnCalNext = document.getElementById('btn-cal-next') as HTMLButtonElement;
const btnCalToday = document.getElementById('btn-cal-today') as HTMLButtonElement;
const calendarGrid = document.getElementById('calendar-grid') as HTMLDivElement;
const legendChipsContainer = document.getElementById('legend-chips-container') as HTMLDivElement;
const selectedDayTitle = document.getElementById('selected-day-title') as HTMLElement;
const selectedDayList = document.getElementById('selected-day-list') as HTMLDivElement;
const btnAddOnDate = document.getElementById('btn-add-on-date') as HTMLButtonElement;

// Expanded Day View Drawer Elements
const dayExpandedBackdrop = document.getElementById('day-expanded-backdrop') as HTMLDivElement;
const dayExpandedDrawer = document.getElementById('day-expanded-drawer') as HTMLElement;
const dayDrawerTitle = document.getElementById('day-drawer-title') as HTMLElement;
const dayDrawerSubtitle = document.getElementById('day-drawer-subtitle') as HTMLElement;
const btnDrawerAdd = document.getElementById('btn-drawer-add') as HTMLButtonElement;
const btnDrawerClose = document.getElementById('btn-drawer-close') as HTMLButtonElement;
const dayDrawerBody = document.getElementById('day-drawer-body') as HTMLDivElement;

// Details / List Elements
const taskListEl = document.getElementById('task-list') as HTMLDivElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const filterCourseSelect = document.getElementById('filter-course') as HTMLSelectElement;
const filterTypeSelect = document.getElementById('filter-type') as HTMLSelectElement;
const tabButtons = document.querySelectorAll('.tab-btn');

const statUrgentCount = document.getElementById('stat-urgent-count') as HTMLElement;
const statWeekCount = document.getElementById('stat-week-count') as HTMLElement;
const statTotalCount = document.getElementById('stat-total-count') as HTMLElement;

// Header Buttons
const btnScanTab = document.getElementById('btn-scan-tab') as HTMLButtonElement;
const btnAddModal = document.getElementById('btn-add-modal') as HTMLButtonElement;
const btnExportAllIcs = document.getElementById('btn-export-all-ics') as HTMLButtonElement;
const btnSettingsToggle = document.getElementById('btn-settings-toggle') as HTMLButtonElement;
const btnThemeToggle = document.getElementById('btn-theme-toggle') as HTMLButtonElement | null;
const btnCancelAdd = document.getElementById('btn-cancel-add') as HTMLButtonElement;
const btnCancelSettings = document.getElementById('btn-cancel-settings') as HTMLButtonElement;

// Theme Management
let currentThemeSetting: 'light' | 'dark' | 'system' = 'light';

function applyTheme(theme: 'light' | 'dark' | 'system' = 'light') {
  currentThemeSetting = theme;
  let isDark = false;
  if (theme === 'system') {
    isDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } else {
    isDark = theme === 'dark';
  }

  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

  if (btnThemeToggle) {
    btnThemeToggle.innerHTML = isDark
      ? `<svg class="ui-icon"><use href="#icon-sun"></use></svg>`
      : `<svg class="ui-icon"><use href="#icon-moon"></use></svg>`;
    btnThemeToggle.title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    btnThemeToggle.setAttribute('aria-label', btnThemeToggle.title);
  }

  const themeSelect = document.getElementById('setting-theme') as HTMLSelectElement | null;
  if (themeSelect && themeSelect.value !== theme) {
    themeSelect.value = theme;
  }
}

async function toggleTheme() {
  const currentEffectiveDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const newTheme: 'light' | 'dark' = currentEffectiveDark ? 'light' : 'dark';

  applyTheme(newTheme);
  try {
    localStorage.setItem('bbs_theme', newTheme);
    await saveSettings({ theme: newTheme });
    const channel = new BroadcastChannel('bbs_sync_channel');
    channel.postMessage({ type: 'THEME_CHANGED', theme: newTheme });
    channel.close();
  } catch {}
}

function initThemeSync() {
  let theme: 'light' | 'dark' | 'system' = 'light';
  try {
    const localTheme = localStorage.getItem('bbs_theme') as any;
    if (localTheme) {
      theme = localTheme;
    } else {
      const cached = getCachedSettingsSync();
      if (cached.theme) theme = cached.theme;
    }
  } catch {}
  applyTheme(theme);
}

async function initTheme() {
  initThemeSync();
  try {
    const settings = await getSettings();
    if (settings.theme && settings.theme !== currentThemeSetting) {
      applyTheme(settings.theme);
    }
  } catch {}
}


// Forms
const formAddTask = document.getElementById('form-add-task') as HTMLFormElement;
const formSettings = document.getElementById('form-settings') as HTMLFormElement;

const addTypeSelect = document.getElementById('add-type') as HTMLSelectElement | null;
const addRoomInput = document.getElementById('add-room') as HTMLInputElement;
const addWeightInput = document.getElementById('add-weight') as HTMLInputElement;
const btnCalcAddWeight = document.getElementById('btn-calc-add-weight') as HTMLButtonElement;
const addWeightHint = document.getElementById('add-weight-hint') as HTMLElement;

function updateAddRoomVisibility() {
  const isHwOrProj = addTypeSelect?.value === 'assignment' || (addTypeSelect?.value as string) === 'hw' || addTypeSelect?.value === 'project';
  const group = addRoomInput ? addRoomInput.closest('.form-group') as HTMLElement | null : null;
  if (group) group.style.display = isHwOrProj ? 'none' : '';
  if (isHwOrProj && addRoomInput) addRoomInput.value = '';
}

function updateEditRoomVisibility() {
  const isHwOrProj = editTypeSelect?.value === 'assignment' || (editTypeSelect?.value as string) === 'hw' || editTypeSelect?.value === 'project';
  const group = editRoomInput ? editRoomInput.closest('.form-group') as HTMLElement | null : null;
  if (group) group.style.display = isHwOrProj ? 'none' : '';
  if (isHwOrProj && editRoomInput) editRoomInput.value = '';
}

// Edit Modal Elements
const modalEditTask = document.getElementById('modal-edit-task') as HTMLDivElement;
const formEditTask = document.getElementById('form-edit-task') as HTMLFormElement;
const btnCloseEditModal = document.getElementById('btn-close-edit-modal') as HTMLButtonElement;
const btnCancelEdit = document.getElementById('btn-cancel-edit') as HTMLButtonElement;
const btnDeleteFromModal = document.getElementById('btn-delete-from-modal') as HTMLButtonElement;
const editTaskIdInput = document.getElementById('edit-task-id') as HTMLInputElement;
const editTitleInput = document.getElementById('edit-title') as HTMLInputElement;
const editCourseInput = document.getElementById('edit-course') as HTMLInputElement;
const editDateInput = document.getElementById('edit-date') as HTMLInputElement;
const editTimeInput = document.getElementById('edit-time') as HTMLInputElement;
const editRoomInput = document.getElementById('edit-room') as HTMLInputElement;
const editTypeSelect = document.getElementById('edit-type') as HTMLSelectElement;
const editPrioritySelect = document.getElementById('edit-priority') as HTMLSelectElement;
const editStatusSelect = document.getElementById('edit-status') as HTMLSelectElement;
const editWeightInput = document.getElementById('edit-weight') as HTMLInputElement;
const btnCalcEditWeight = document.getElementById('btn-calc-edit-weight') as HTMLButtonElement;
const editWeightHint = document.getElementById('edit-weight-hint') as HTMLElement;
const editDescInput = document.getElementById('edit-desc') as HTMLTextAreaElement;
const editNotesInput = document.getElementById('edit-notes') as HTMLTextAreaElement;

// Backup / Restore & Syllabus Reference Elements
const btnBackupJson = document.getElementById('btn-backup-json') as HTMLButtonElement;
const btnRestoreJsonTrigger = document.getElementById('btn-restore-json-trigger') as HTMLButtonElement;
const inputRestoreJson = document.getElementById('input-restore-json') as HTMLInputElement;
const syllabusReferenceContainer = document.getElementById('syllabus-reference-container') as HTMLDivElement;
const scheduleReferenceContainer = document.getElementById('schedule-reference-container') as HTMLDivElement;

// ============================================================================
// View Navigation
// ============================================================================
type AppView = 'calendar' | 'details' | 'add' | 'settings';

function switchView(view: AppView) {
  closeDayExpandedDrawer();

  viewCalendar.classList.remove('active');
  viewDetails.classList.remove('active');
  viewAdd.classList.remove('active');
  viewSettings.classList.remove('active');

  tabNavCalendar.classList.remove('active');
  tabNavDetails.classList.remove('active');

  if (view === 'calendar') {
    viewCalendar.classList.add('active');
    tabNavCalendar.classList.add('active');
    renderCalendar();
    renderSelectedDay();
  } else if (view === 'details') {
    viewDetails.classList.add('active');
    tabNavDetails.classList.add('active');
    renderTasks();
  } else if (view === 'add') {
    viewAdd.classList.add('active');
    updateAddRoomVisibility();
  } else if (view === 'settings') {
    viewSettings.classList.add('active');
    loadSettingsForm();
    renderSyllabusReference();
    renderScheduleReference();
  }
}

// Format date key to 'YYYY-MM-DD'
function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Format month header: "September 2026"
function formatMonthYear(year: number, month: number): string {
  const date = new Date(year, month, 1);
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function getSvgIcon(name: string, extraClass: string = ''): string {
  const cls = extraClass ? `ui-icon ${extraClass}` : 'ui-icon';
  return `<svg class="${cls}"><use href="#icon-${name}"></use></svg>`;
}

function getTaskTypeIcon(type: TaskType): string {
  switch (type) {
    case 'quiz': return getSvgIcon('timer');
    case 'exam': return getSvgIcon('list-check');
    case 'assignment': return getSvgIcon('notebook-pen');
    case 'project': return getSvgIcon('presentation');
    case 'lab': return getSvgIcon('flask-conical');
    case 'meeting': return getSvgIcon('users');
    default: return getSvgIcon('pin');
  }
}

// ============================================================================
// Calendar Rendering
// ============================================================================
function renderCalendar() {
  calMonthTitle.textContent = formatMonthYear(calendarYear, calendarMonth);

  // Group active tasks by YYYY-MM-DD
  const tasksByDate = new Map<string, DeadlineTask[]>();
  currentTasks.forEach(task => {
    const d = new Date(task.dueDate);
    if (!isNaN(d.getTime())) {
      const key = formatDateKey(d);
      if (!tasksByDate.has(key)) {
        tasksByDate.set(key, []);
      }
      tasksByDate.get(key)!.push(task);
    }
  });

  // Ensure tasks for every day are sorted chronologically from earliest to latest
  tasksByDate.forEach(dayTasks => {
    dayTasks.sort(compareTasksByTime);
  });

  calendarGrid.innerHTML = '';

  const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay(); // 0 = Sun
  const offset = (firstDayIndex + 6) % 7; // Monday = 0, Sunday = 6
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const prevMonthDays = new Date(calendarYear, calendarMonth, 0).getDate();

  const todayKey = formatDateKey(new Date());

  // 1. Previous Month Leading Days
  for (let i = offset - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    const prevDate = new Date(calendarYear, calendarMonth - 1, dayNum);
    const dateKey = formatDateKey(prevDate);
    const dayEl = createDayCell(dayNum, dateKey, true, tasksByDate.get(dateKey) || []);
    calendarGrid.appendChild(dayEl);
  }

  // 2. Current Month Days
  for (let d = 1; d <= daysInMonth; d++) {
    const currDate = new Date(calendarYear, calendarMonth, d);
    const dateKey = formatDateKey(currDate);
    const dayTasks = tasksByDate.get(dateKey) || [];
    const dayEl = createDayCell(d, dateKey, false, dayTasks, dateKey === todayKey, dateKey === selectedDateStr);
    calendarGrid.appendChild(dayEl);
  }

  // 3. Next Month Trailing Days (fill 42 total slots or end of week)
  const totalSlots = calendarGrid.children.length;
  const remaining = (7 - (totalSlots % 7)) % 7;
  for (let n = 1; n <= remaining; n++) {
    const nextDate = new Date(calendarYear, calendarMonth + 1, n);
    const dateKey = formatDateKey(nextDate);
    const dayEl = createDayCell(n, dateKey, true, tasksByDate.get(dateKey) || []);
    calendarGrid.appendChild(dayEl);
  }
}

function openAddModalOnDate(dateStr: string) {
  const addDateInput = document.getElementById('add-date') as HTMLInputElement;
  if (addDateInput) {
    addDateInput.value = dateStr;
  }
  switchView('add');
}

function createDayCell(
  dayNum: number,
  dateKey: string,
  isOtherMonth: boolean,
  tasks: DeadlineTask[],
  isToday: boolean = false,
  isSelected: boolean = false
): HTMLDivElement {
  const cell = document.createElement('div');
  cell.className = 'cal-day';
  cell.dataset.date = dateKey;
  cell.setAttribute('role', 'button');
  cell.setAttribute('tabindex', '0');
  if (isOtherMonth) cell.classList.add('other-month');
  if (isToday) cell.classList.add('is-today');
  if (isSelected) cell.classList.add('is-selected');

  // Day header with number
  const header = document.createElement('div');
  header.className = 'cal-day-header';
  const numSpan = document.createElement('span');
  numSpan.className = 'cal-day-num';
  numSpan.textContent = String(dayNum);
  header.appendChild(numSpan);
  cell.appendChild(header);

  // Event chips container
  const chipsContainer = document.createElement('div');
  chipsContainer.className = 'cal-event-chips-container';

  const maxVisibleChips = 2;
  const visibleTasks = tasks.slice(0, maxVisibleChips);

  visibleTasks.forEach(task => {
    const isCompleted = task.status === 'completed';
    const resolved = resolveCourseInfo(task);
    const courseHex = getCourseHex(resolved.courseName, resolved.courseCode, task.title);
    const timeStr = formatTaskTime(task);

    const chip = document.createElement('div');
    chip.className = 'cal-event-chip';

    // The user requested:
    // 1. NO square brackets in the title!
    // 2. The title should be the exact same title present in task/title section (task.title).
    // 3. Gray out and completed styling if completed.
    if (isCompleted) {
      chip.classList.add('is-completed');
      chip.style.removeProperty('background-color');
      chip.style.borderLeftColor = courseHex;
      chip.innerHTML = `${getSvgIcon('check')} <span>${escapeHtml(task.title)}</span>`;
      chip.title = `[Completed] ${resolved.courseName}: ${task.title} - Click to expand day view`;
    } else {
      chip.style.backgroundColor = courseHex;
      chip.style.setProperty('background-color', courseHex, 'important');
      chip.style.borderLeftColor = 'rgba(0, 0, 0, 0.25)';
      chip.innerHTML = `${getTaskTypeIcon(task.type)} <span>${escapeHtml(task.title)}</span>`;
      chip.title = `${resolved.courseName}: ${task.title} ${task.weightDisplay ? `(${task.weightDisplay})` : ''} - ${timeStr} - Click to expand day view`;
    }

    // Clicking directly on chip expands the view of this day
    chip.addEventListener('click', e => {
      e.stopPropagation();
      selectDay(dateKey, true);
    });

    chipsContainer.appendChild(chip);
  });

  if (tasks.length > maxVisibleChips) {
    const more = document.createElement('div');
    more.className = 'cal-event-more';
    more.textContent = `+${tasks.length - maxVisibleChips} more`;
    more.addEventListener('click', e => {
      e.stopPropagation();
      selectDay(dateKey, true);
    });
    chipsContainer.appendChild(more);
  }

  cell.appendChild(chipsContainer);

  // Click handler on day cell to select this day and expand its view
  cell.addEventListener('click', () => {
    selectDay(dateKey, true);
  });

  // Keyboard accessibility
  cell.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectDay(dateKey, true);
    }
  });

  return cell;
}

// Select a day in the calendar and optionally open the expanded day drawer
function selectDay(dateKey: string, openDrawer: boolean = true) {
  selectedDateStr = dateKey;
  document.querySelectorAll('.cal-day.is-selected').forEach(el => el.classList.remove('is-selected'));
  const activeEl = document.querySelector(`.cal-day[data-date="${dateKey}"]`);
  if (activeEl) {
    activeEl.classList.add('is-selected');
  }

  // Update inline drawer below calendar
  renderSelectedDay();

  // If openDrawer is requested, expand the Day View Drawer
  if (openDrawer) {
    openDayExpandedDrawer(dateKey);
  }
}

// Open the expanded day drawer modal with short summary cards
function openDayExpandedDrawer(dateKey: string) {
  if (!dayExpandedDrawer || !dayExpandedBackdrop) return;

  const [y, m, d] = dateKey.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const formattedDate = dateObj.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const tasksOnDate = currentTasks.filter(task => {
    const taskD = new Date(task.dueDate);
    return !isNaN(taskD.getTime()) && formatDateKey(taskD) === dateKey;
  });
  tasksOnDate.sort(compareTasksByTime);

  dayDrawerTitle.innerHTML = `${getSvgIcon('calendar', 'mr-1')} <span>${escapeHtml(formattedDate)}</span>`;
  dayDrawerSubtitle.textContent = tasksOnDate.length === 1
    ? '1 Deadline Scheduled'
    : `${tasksOnDate.length} Deadlines Scheduled`;

  dayDrawerBody.innerHTML = '';

  if (tasksOnDate.length === 0) {
    dayDrawerBody.innerHTML = `
      <div class="day-drawer-empty">
        <div class="empty-icon">${getSvgIcon('coffee')}</div>
        <div class="empty-text">No deadlines scheduled for this day.</div>
        <button type="button" class="btn-drawer-add-action" id="btn-drawer-add-empty">
          ${getSvgIcon('plus', 'mr-1')}
          <span>Add Deadline for this Date</span>
        </button>
      </div>
    `;
    document.getElementById('btn-drawer-add-empty')?.addEventListener('click', () => {
      closeDayExpandedDrawer();
      openAddModalOnDate(dateKey);
    });
  } else {
    tasksOnDate.forEach(task => {
      const card = createDaySummaryCard(task);
      dayDrawerBody.appendChild(card);
    });
  }

  dayExpandedBackdrop.classList.remove('hidden');
  dayExpandedDrawer.classList.remove('hidden');
  requestAnimationFrame(() => {
    dayExpandedBackdrop.classList.add('open');
    dayExpandedDrawer.classList.add('open');
  });
}

function closeDayExpandedDrawer() {
  if (!dayExpandedDrawer || !dayExpandedBackdrop) return;
  dayExpandedBackdrop.classList.remove('open');
  dayExpandedDrawer.classList.remove('open');
  setTimeout(() => {
    dayExpandedBackdrop.classList.add('hidden');
    dayExpandedDrawer.classList.add('hidden');
  }, 220);
}

// Create a summary card for a day event: Task Name, Subject (in permanent color), and Time
function createDaySummaryCard(task: DeadlineTask): HTMLDivElement {
  const isCompleted = task.status === 'completed';
  const resolved = resolveCourseInfo(task);
  const courseHex = getCourseHex(resolved.courseName, resolved.courseCode, task.title);
  const courseTheme = getCourseColorTheme(resolved.courseName, resolved.courseCode, task.title);
  const countdown = formatCountdown(task.dueDate, task.hasSpecificTime);
  const timeDisplay = formatTaskTime(task);

  const isHwOrProject = task.type === 'assignment' || (task.type as string) === 'hw' || task.type === 'project';

  const card = document.createElement('div');
  card.className = `day-summary-card ${isCompleted ? 'is-completed' : ''}`;
  card.style.borderLeft = `4px solid ${courseHex}`;
  card.style.setProperty('border-left-color', courseHex, 'important');

  card.innerHTML = `
    <div class="day-card-header">
      <span class="day-card-course-badge" style="background: ${courseTheme.bgLight}; color: ${courseTheme.textDark}; border: 1px solid ${courseTheme.border};" title="${escapeHtml(resolved.courseName)} ${resolved.courseCode ? `(${escapeHtml(resolved.courseCode)})` : ''}">
        <span class="day-card-course-dot" style="background-color: ${courseHex};"></span>
        <span class="day-card-course-name">${escapeHtml(resolved.courseName)}</span>
        ${resolved.courseCode && resolved.courseCode !== resolved.courseName ? `<span class="day-card-course-code">(${escapeHtml(resolved.courseCode)})</span>` : ''}
      </span>
      <div style="display: flex; align-items: center; gap: 5px;">
        <span class="type-pill type-${task.type}" style="font-size: 9px; padding: 1px 5px; display: inline-flex; align-items: center; gap: 3px;">
          ${getTaskTypeIcon(task.type)}
          <span>${task.type}</span>
        </span>
        <span class="day-card-status-badge ${isCompleted ? 'status-done' : countdown.urgency}">
          ${isCompleted ? `${getSvgIcon('check', 'mr-1')} Completed` : countdown.label}
        </span>
      </div>
    </div>

    <div class="day-card-title-row">
      <div class="day-card-title ${isCompleted ? 'title-completed' : ''}">
        ${escapeHtml(task.title)}
      </div>
    </div>

    <div class="day-card-meta-row">
      <div class="day-card-time" title="Scheduled / Due Time">
        ${getSvgIcon('clock', 'mr-1')} <span class="day-card-time-text">${escapeHtml(timeDisplay)}</span>
      </div>
      ${(!isHwOrProject && task.room) ? `
        <div class="day-card-room" title="Classroom / Exam Hall" style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: #4338ca; background: #e0e7ff; padding: 2px 7px; border-radius: 4px; border: 1px solid #c7d2fe;">
          ${getSvgIcon('pin', 'mr-1')} <span class="day-card-room-text">${escapeHtml(task.room)}</span>
        </div>
      ` : ''}
      ${task.weightDisplay ? `
        <div class="day-card-weight" title="${task.syllabusNote ? escapeHtml(task.syllabusNote) : 'Syllabus grade weight'}">
          ${getSvgIcon('scale', 'mr-1')} <span class="day-card-weight-text">${escapeHtml(task.weightDisplay)}</span>
        </div>
      ` : ''}
    </div>

    ${(task.description || task.sourceSnippet) && !(task.description || task.sourceSnippet).startsWith('Blackboard Ultra Stream item') ? `
      <div class="day-card-announcement">
        <span class="day-card-announcement-label" style="display: inline-flex; align-items: center; gap: 4px;">
          ${getSvgIcon('message')}
          <span>Announcement:</span>
        </span>
        <span class="day-card-announcement-text">"${escapeHtml(task.description || task.sourceSnippet)}"</span>
      </div>
    ` : ''}

    ${task.notes ? `
      <div class="day-card-student-notes" style="margin-top: 6px; padding: 6px 10px; background: rgba(59, 130, 246, 0.08); border-left: 3px solid #3b82f6; border-radius: 4px;">
        <span style="font-size: 10px; font-weight: 700; color: #2563eb; display: inline-flex; align-items: center; gap: 4px;">
          ${getSvgIcon('pencil')}
          <span>Student Notes:</span>
        </span>
        <div style="font-size: 11px; color: var(--text-main); margin-top: 2px; white-space: pre-wrap;">${escapeHtml(task.notes)}</div>
      </div>
    ` : ''}

    <div class="day-card-actions">
      <button type="button" class="btn-card-action btn-card-toggle ${isCompleted ? 'btn-is-completed' : ''}" title="${isCompleted ? 'Mark as Pending' : 'Mark as Done'}">
        ${isCompleted ? `${getSvgIcon('check', 'mr-1')} Completed` : `${getSvgIcon('circle', 'mr-1')} Mark Done`}
      </button>
      <button type="button" class="btn-card-action btn-card-share" title="Share / Copy Task Details">
        ${getSvgIcon('share', 'mr-1')} Share
      </button>
      <button type="button" class="btn-card-action btn-card-edit" title="Edit Deadline">
        ${getSvgIcon('pencil', 'mr-1')} Edit
      </button>
      <a class="btn-card-action btn-card-gcal" href="${createGoogleCalendarUrl(task)}" target="_blank" rel="noopener noreferrer" title="Add to Google Calendar">
        ${getSvgIcon('calendar', 'mr-1')} G-Cal
      </a>
      <button type="button" class="btn-card-action btn-card-delete" title="Delete Deadline">
        ${getSvgIcon('trash')}
      </button>
    </div>
  `;

  // Attach event listeners
  card.querySelector('.btn-card-toggle')?.addEventListener('click', async e => {
    e.stopPropagation();
    const prevStatus = task.status;
    const nextStatus: TaskStatus = isCompleted ? 'pending' : 'completed';
    currentTasks = await updateTask(task.id, { status: nextStatus });
    refreshAllViews();
    syncTasksToCloud(currentTasks, 'Drawer Status Change');
    showToast(
      nextStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
      'Undo',
      async () => {
        currentTasks = await updateTask(task.id, { status: prevStatus });
        refreshAllViews();
        syncTasksToCloud(currentTasks, 'Revert Status Change');
        showToast('Status reverted');
      }
    );
  });

  card.querySelector('.btn-card-share')?.addEventListener('click', e => {
    e.stopPropagation();
    shareTask(task);
  });

  card.querySelector('.btn-card-edit')?.addEventListener('click', e => {
    e.stopPropagation();
    openEditModal(task);
  });

  card.querySelector('.btn-card-delete')?.addEventListener('click', async e => {
    e.stopPropagation();
    const taskToDelete = task;
    await recordLocalTombstone(task.id);
    currentTasks = await deleteTask(task.id);
    refreshAllViews();
    syncTasksToCloud(currentTasks, 'Drawer Deleted Deadline');
    showToast(
      `Deleted "${taskToDelete.title.slice(0, 22)}..."`,
      'Undo',
      async () => {
        await removeLocalTombstone(taskToDelete.id);
        currentTasks = await addTask({ ...taskToDelete, updatedAt: new Date().toISOString() });
        refreshAllViews();
        syncTasksToCloud(currentTasks, 'Restored Deadline');
        showToast('Deadline restored');
      }
    );
  });

  return card;
}

// Render inline selected day drawer below calendar
function renderSelectedDay() {
  const [y, m, d] = selectedDateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const formattedHeader = dateObj.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

  selectedDayTitle.innerHTML = `${getSvgIcon('calendar', 'mr-1')} <span>Deadlines for ${escapeHtml(formattedHeader)}</span>`;

  const tasksOnDate = currentTasks.filter(task => {
    const taskD = new Date(task.dueDate);
    return !isNaN(taskD.getTime()) && formatDateKey(taskD) === selectedDateStr;
  });
  tasksOnDate.sort(compareTasksByTime);

  selectedDayList.innerHTML = '';

  if (tasksOnDate.length === 0) {
    selectedDayList.innerHTML = `
      <div class="selected-day-empty">
        <span>No deadlines scheduled for this day.</span>
      </div>
    `;
    return;
  }

  tasksOnDate.forEach(task => {
    const card = createDaySummaryCard(task);
    selectedDayList.appendChild(card);
  });
}


// Render permanent course color legend
function renderLegend() {
  legendChipsContainer.innerHTML = '';
  PERMANENT_COURSE_LEGEND.forEach(course => {
    const chip = document.createElement('div');
    chip.className = 'legend-chip';
    chip.innerHTML = `
      <span class="legend-dot" style="background-color: ${course.hex};"></span>
      <span>${escapeHtml(course.name)}</span>
    `;
    legendChipsContainer.appendChild(chip);
  });
}

// Render course syllabi and grade distributions reference in Settings
function renderSyllabusReference() {
  if (!syllabusReferenceContainer) return;
  const syllabi = getAllSyllabi();
  syllabusReferenceContainer.innerHTML = '';

  syllabi.forEach(s => {
    const hex = getCourseHex(s.courseName);
    const card = document.createElement('div');
    card.className = 'syllabus-course-card';
    card.style.borderLeft = `3px solid ${hex}`;

    const compHtml = s.components.map(c => {
      const weightDesc = c.count && c.count > 1 && c.unitWeight !== undefined
        ? `${c.totalWeight}% (${c.count}x ${c.unitWeight}%)`
        : `${c.totalWeight}%`;
      return `
        <div class="syllabus-comp-item" title="${escapeHtml(c.note || '')}">
          <span>${escapeHtml(c.name)}</span>
          <span class="syllabus-comp-pct">${weightDesc}</span>
        </div>
      `;
    }).join('');

    card.innerHTML = `
      <div class="syllabus-course-header">
        <div class="syllabus-course-title">
          <span class="syllabus-course-dot" style="background-color: ${hex};"></span>
          <span>${escapeHtml(s.courseName)}</span>
        </div>
        <span class="syllabus-course-source" title="Extracted from syllabus/${escapeHtml(s.sourcePdf)}">
          ${getSvgIcon('file-text', 'mr-1')} ${escapeHtml(s.sourcePdf)}
        </span>
      </div>
      <div class="syllabus-comp-grid">
        ${compHtml}
      </div>
    `;

    syllabusReferenceContainer.appendChild(card);
  });
}

// Render student weekly class schedule in Settings
function renderScheduleReference() {
  if (!scheduleReferenceContainer) return;
  const schedules = getAllCourseSchedules();
  scheduleReferenceContainer.innerHTML = '';

  schedules.forEach(s => {
    const hex = getCourseHex(s.courseName, s.courseCode);
    const card = document.createElement('div');
    card.className = 'syllabus-course-card';
    card.style.borderLeft = `3px solid ${hex}`;

    card.innerHTML = `
      <div class="syllabus-course-header">
        <div class="syllabus-course-title">
          <span class="syllabus-course-dot" style="background-color: ${hex};"></span>
          <span>${escapeHtml(s.courseName)}</span>
        </div>
        <span class="syllabus-course-source pill-green" style="font-weight: 700; display: inline-flex; align-items: center;">
          ${getSvgIcon('clock', 'mr-1')} <span>${escapeHtml(s.timeRangeDisplay)}</span>
        </span>
      </div>
      <div style="font-size: 10px; color: var(--text-muted); display: flex; justify-content: space-between; margin-top: 4px; border-top: 1px dashed var(--surface-border); padding-top: 4px;">
        <span style="display: inline-flex; align-items: center;">${getSvgIcon('calendar', 'mr-1')} <b>${s.days.join(', ')}</b></span>
        <span style="display: inline-flex; align-items: center;">${getSvgIcon('pin', 'mr-1')} <span>${escapeHtml(s.location)}</span></span>
      </div>
    `;

    scheduleReferenceContainer.appendChild(card);
  });
}

// ============================================================================
// Toast & Native Share Helpers
// ============================================================================
function showToast(message: string, actionText?: string, onAction?: () => void) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';

  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  if (actionText && typeof onAction === 'function') {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'toast-btn-action';
    actionBtn.textContent = actionText;
    actionBtn.type = 'button';
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toast.remove();
      onAction();
    });
    toast.appendChild(actionBtn);
  }

  container.appendChild(toast);

  const duration = actionText ? 5000 : 3200;
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

async function shareTask(task: DeadlineTask) {
  const dueFormatted = new Date(task.dueDate).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: task.hasSpecificTime ? '2-digit' : undefined,
    minute: task.hasSpecificTime ? '2-digit' : undefined
  });
  const text = `📌 ${task.title}\n📚 ${task.courseCode || task.courseName}\n⏰ Due: ${dueFormatted}${task.room ? '\n📍 Room: ' + task.room : ''}${task.weightDisplay ? '\n⚖️ ' + task.weightDisplay : ''}\n\nManaged with Blackboarder`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: task.title,
        text
      });
      return;
    } catch (err: any) {
      if (err.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast('Task details copied to clipboard!');
  } catch (e) {
    showToast('Could not copy task details.');
  }
}

// ============================================================================
// Syllabus Grade Progress Tracker
// ============================================================================
function renderGradeTracker(tasks: DeadlineTask[]) {
  const badge = document.getElementById('grade-tracker-overall-badge');
  const breakdown = document.getElementById('grade-tracker-breakdown');
  if (!badge || !breakdown) return;

  const syllabi = getAllSyllabi();
  let totalTrackedCompleted = 0;
  let totalTrackedWeight = 0;

  const courseStats = syllabi.map(course => {
    const courseTasks = tasks.filter(t => {
      return course.courseCodePattern.test(t.courseName || '') ||
             course.courseCodePattern.test(t.courseCode || '') ||
             course.courseCodePattern.test(t.title || '');
    });

    let completedWeight = 0;
    let pendingWeight = 0;

    courseTasks.forEach(t => {
      const w = Number(t.weight) || 0;
      if (t.status === 'completed') {
        completedWeight += w;
      } else {
        pendingWeight += w;
      }
    });

    completedWeight = Math.round(completedWeight * 10) / 10;
    pendingWeight = Math.round(pendingWeight * 10) / 10;
    const tracked = completedWeight + pendingWeight;

    totalTrackedCompleted += completedWeight;
    totalTrackedWeight += tracked;

    return {
      course,
      completedWeight,
      pendingWeight,
      tracked,
      taskCount: courseTasks.length
    };
  });

  const overallPct = totalTrackedWeight > 0
    ? Math.min(100, Math.round((totalTrackedCompleted / totalTrackedWeight) * 100))
    : 0;

  badge.textContent = `${overallPct}% Done (${Math.round(totalTrackedCompleted)}% completed)`;

  breakdown.innerHTML = courseStats.map(stat => {
    const course = stat.course;
    const hex = getCourseHex(course.courseName);
    const pct = Math.min(100, Math.round((stat.completedWeight / (course.totalWeight || 100)) * 100));

    return `
      <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.12); border-radius: 6px; padding: 7px 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${hex};"></span>
            <span style="font-size: 11.5px; font-weight: 600; color: #f8fafc;">${escapeHtml(course.courseName)}</span>
          </div>
          <span style="font-size: 10.5px; font-weight: 600; color: ${pct > 0 ? '#34d399' : '#94a3b8'};">${stat.completedWeight}% / ${course.totalWeight}% (${pct}%)</span>
        </div>
        <div style="width: 100%; height: 5px; background: rgba(51, 65, 85, 0.7); border-radius: 9999px; overflow: hidden; display: flex;">
          <div style="width: ${pct}%; height: 100%; background: #34d399; transition: width 0.3s ease;"></div>
          <div style="width: ${Math.min(100 - pct, Math.round((stat.pendingWeight / course.totalWeight) * 100))}%; height: 100%; background: #38bdf8; transition: width 0.3s ease;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 9.5px; color: #94a3b8; margin-top: 3px;">
          <span>✓ Done: ${stat.completedWeight}%</span>
          <span>⏳ Pending: ${stat.pendingWeight}%</span>
          <span>Upcoming: ${Math.max(0, Math.round((course.totalWeight - stat.tracked) * 10) / 10)}%</span>
        </div>
      </div>
    `;
  }).join('');
}

function initGradeTrackerToggle() {
  const toggleBtn = document.getElementById('grade-tracker-toggle-btn');
  const breakdown = document.getElementById('grade-tracker-breakdown');
  const arrow = document.getElementById('grade-tracker-arrow');

  toggleBtn?.addEventListener('click', () => {
    if (!breakdown) return;
    const isHidden = breakdown.style.display === 'none' || !breakdown.style.display;
    breakdown.style.display = isHidden ? 'flex' : 'none';
    if (arrow) {
      arrow.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
    }
  });
}

// ============================================================================
// Details View (Task Cards List)
// ============================================================================
function updateStats(tasks: DeadlineTask[]) {
  const now = Date.now();
  const pendingTasks = tasks.filter(t => t.status === 'pending');

  let urgent = 0;
  let thisWeek = 0;

  for (const t of pendingTasks) {
    const dueTime = new Date(t.dueDate).getTime();
    const diffHours = (dueTime - now) / (1000 * 3600);

    if (diffHours <= 48) {
      urgent++;
    }
    if (diffHours > 0 && diffHours <= 168) {
      thisWeek++;
    }
  }

  statUrgentCount.textContent = String(urgent);
  statWeekCount.textContent = String(thisWeek);
  statTotalCount.textContent = String(pendingTasks.length);
  navBadgeCount.textContent = String(pendingTasks.length);

  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const allCount = tasks.length;
  const btnPending = document.querySelector('.filter-chip[data-status="pending"]');
  const btnAll = document.querySelector('.filter-chip[data-status="all"]');
  const btnCompleted = document.querySelector('.filter-chip[data-status="completed"]');
  if (btnPending) btnPending.textContent = `Pending (${pendingTasks.length})`;
  if (btnAll) btnAll.textContent = `All (${allCount})`;
  if (btnCompleted) btnCompleted.textContent = `Completed (${completedCount})`;
}

function updateCourseFilterOptions(tasks: DeadlineTask[]) {
  const courseMap = new Map<string, string>();

  tasks.forEach(t => {
    const resolved = resolveCourseInfo(t);
    const key = resolved.courseName;
    if (key && !courseMap.has(key)) {
      const hasCodeAndName = resolved.courseName && resolved.courseCode && resolved.courseName !== resolved.courseCode;
      const label = hasCodeAndName
        ? `${resolved.courseName} (${resolved.courseCode})`
        : (resolved.courseName || resolved.courseCode);
      courseMap.set(key, label);
    }
  });

  const currentVal = filterCourseSelect.value;
  filterCourseSelect.innerHTML = '<option value="all">All Courses</option>';
  courseMap.forEach((label, key) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    filterCourseSelect.appendChild(opt);
  });

  if (courseMap.has(currentVal)) {
    filterCourseSelect.value = currentVal;
  }
}

function renderTasks() {
  const filtered = currentTasks.filter(task => {
    if (currentFilterStatus === 'pending' && task.status !== 'pending') return false;
    if (currentFilterStatus === 'completed' && task.status !== 'completed') return false;

    if (currentFilterCourse !== 'all') {
      const resolved = resolveCourseInfo(task);
      const match = (task.courseCode === currentFilterCourse) ||
                    (task.courseName === currentFilterCourse) ||
                    (resolved.courseName === currentFilterCourse) ||
                    (resolved.courseCode === currentFilterCourse);
      if (!match) return false;
    }

    if (currentFilterType !== 'all' && task.type !== currentFilterType) {
      return false;
    }

    if (currentSearchQuery) {
      const q = currentSearchQuery.toLowerCase();
      const resolved = resolveCourseInfo(task);
      const match = task.title.toLowerCase().includes(q) ||
                    task.courseCode.toLowerCase().includes(q) ||
                    task.courseName.toLowerCase().includes(q) ||
                    resolved.courseName.toLowerCase().includes(q) ||
                    resolved.courseCode.toLowerCase().includes(q) ||
                    (task.description && task.description.toLowerCase().includes(q));
      if (!match) return false;
    }

    return true;
  });

  // Sort tasks: pending first, sorted by dueDate ascending (earliest first)
  filtered.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return compareTasksByTime(a, b);
  });

  taskListEl.innerHTML = '';

  if (filtered.length === 0) {
    taskListEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${getSvgIcon('calendar')}</div>
        <div class="empty-title">${currentTasks.length === 0 ? 'No Deadlines Extracted Yet' : 'No Matching Deadlines'}</div>
        <div class="empty-desc">
          ${currentTasks.length === 0
            ? 'Open Blackboard (e.g. <b>blackboard.sharjah.ac.ae</b>) in a browser tab and click <b>Scan Page</b> to automatically extract upcoming quizzes and assignments!'
            : 'Try adjusting your filters or search terms.'}
        </div>
      </div>
    `;
    return;
  }

  filtered.forEach(task => {
    const countdown = formatCountdown(task.dueDate, task.hasSpecificTime, task.status);
    const isCompleted = task.status === 'completed';
    const resolved = resolveCourseInfo(task);
    const courseTheme = getCourseColorTheme(resolved.courseName, resolved.courseCode, task.title);
    const gcalUrl = createGoogleCalendarUrl(task);

    // Room pill button (1-click room changer - only if not hw or project)
    const isHwOrProject = task.type === 'assignment' || (task.type as string) === 'hw' || task.type === 'project';
    let roomBadgeHtml = '';
    if (!isHwOrProject) {
      if (task.room) {
        roomBadgeHtml = `
          <button type="button" class="room-pill-btn" data-id="${task.id}" title="Click to change room">
            <span>${getSvgIcon('pin', 'mr-1')} ${escapeHtml(task.room)}</span>
            <span class="room-edit-hint">${getSvgIcon('pencil')}</span>
          </button>
        `;
      } else {
        roomBadgeHtml = `
          <button type="button" class="room-pill-btn" data-id="${task.id}" style="background:#f1f5f9; color:#64748b; border-color:#e2e8f0;" title="Click to assign room">
            <span>${getSvgIcon('pin', 'mr-1')} Add Room</span>
            <span class="room-edit-hint">${getSvgIcon('plus')}</span>
          </button>
        `;
      }
    }

    // Weight badge
    let weightBadgeHtml = '';
    if (task.weightDisplay || task.weight) {
      const weightVal = task.weight || 0;
      const isMajor = weightVal >= 20;
      const isMedium = weightVal >= 10 && weightVal < 20;
      const weightClass = isMajor ? 'weight-major' : (isMedium ? 'weight-medium' : '');
      const displayText = task.weightDisplay || `${task.weight}% of Grade`;
      weightBadgeHtml = `<span class="task-weight-pill ${weightClass}" title="${task.syllabusNote ? escapeHtml(task.syllabusNote) : 'Syllabus weight'}">${getSvgIcon('scale', 'mr-1')} ${escapeHtml(displayText)}</span>`;
    }

    // Class Time Indicator
    let classTimeBadgeHtml = '';
    if (!task.hasSpecificTime) {
      classTimeBadgeHtml = `<span class="meta-pill time-class">${getSvgIcon('clock', 'mr-1')} Class Time</span>`;
    }

    // Clean Doctor's announcement quote with expand/collapse toggle
    let doctorQuoteHtml = '';
    const snippet = (task.description || task.sourceSnippet || '').trim();
    if (snippet && !snippet.startsWith('Blackboard Ultra Stream item')) {
      const isLong = snippet.length > 110 || snippet.includes('\n');
      doctorQuoteHtml = `
        <div class="doctor-quote-box">
          <div class="quote-label-row">
            <div class="quote-label">
              <span>${getSvgIcon('message', 'mr-1')}</span>
              <span>DOCTOR ANNOUNCEMENT:</span>
            </div>
            <button type="button" class="btn-inspect-quote" data-id="${task.id}" title="Inspect full announcement">
              <span>${getSvgIcon('search', 'mr-1')} Full View</span>
            </button>
          </div>
          <div class="quote-body ${isLong ? 'clamped' : 'expanded'}" id="quote-body-${task.id}">${escapeHtml(snippet)}</div>
          ${isLong ? `
            <button type="button" class="btn-toggle-quote" data-id="${task.id}" aria-expanded="false">
              <span class="quote-toggle-icon">${getSvgIcon('book', 'mr-1')}</span>
              <span class="quote-toggle-text">Read Full Announcement ▾</span>
            </button>
          ` : ''}
        </div>
      `;
    }

    // Student Personal Notes
    let studentNotesHtml = '';
    if (task.notes && task.notes.trim()) {
      studentNotesHtml = `
        <div class="student-notes-box" style="margin-top: 6px; padding: 6px 10px; background: rgba(59, 130, 246, 0.08); border-left: 3px solid #3b82f6; border-radius: 4px;">
          <div style="font-size: 11px; font-weight: 700; color: #2563eb; display: inline-flex; align-items: center; gap: 4px; margin-bottom: 2px;">
            ${getSvgIcon('pencil')}
            <span>Student Notes:</span>
          </div>
          <div style="font-size: 12px; color: var(--text-main); white-space: pre-wrap; line-height: 1.4;">${escapeHtml(task.notes)}</div>
        </div>
      `;
    }

    const card = document.createElement('div');
    card.className = `task-card urgency-${countdown.urgency} status-${task.status}`;
    card.style.borderLeft = `4px solid ${courseTheme.hex}`;
    card.style.setProperty('border-left-color', courseTheme.hex, 'important');
    card.setAttribute('data-id', task.id);

    card.innerHTML = `
      <!-- Course Banner with Permanent Subject Color -->
      <div class="task-course-banner">
        <div class="course-badge-main" style="background: ${courseTheme.bgLight} !important; border: 1px solid ${courseTheme.border} !important; color: ${courseTheme.textDark} !important;" title="${escapeHtml(resolved.courseName)}${resolved.courseCode && resolved.courseCode !== 'UOS' ? ` (${escapeHtml(resolved.courseCode)})` : ''}">
          <span class="course-color-dot" style="width: 8px; height: 8px; border-radius: 50%; background: ${courseTheme.hex}; display: inline-block; flex-shrink: 0;"></span>
          <span class="course-name-text" style="color: ${courseTheme.textDark}; font-weight: 700;">${escapeHtml(resolved.courseName)}</span>
          ${resolved.courseCode && resolved.courseCode !== resolved.courseName && resolved.courseCode !== 'UOS' ? `<span class="course-code-tag" style="color: ${courseTheme.textDark}; border-color: ${courseTheme.border};">${escapeHtml(resolved.courseCode)}</span>` : ''}
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="type-pill type-${task.type}" style="display: inline-flex; align-items: center; gap: 3px;">
            ${getTaskTypeIcon(task.type)}
            <span>${(task.type || 'assignment').toUpperCase()}</span>
          </span>
        </div>
      </div>

      <!-- Task Title & Done Toggle -->
      <div class="task-title-row">
        <button type="button" class="status-checkbox-btn ${isCompleted ? 'checked' : ''}" data-id="${task.id}" aria-label="Toggle status" title="${isCompleted ? 'Mark as Pending' : 'Mark as Done'}">
          ${isCompleted ? '✓' : ''}
        </button>
        <div class="task-title-text">${escapeHtml(task.title)}</div>
      </div>

      <div class="task-due-row">
        <span class="urgency-badge ${countdown.urgency}">
          ${countdown.urgency === 'completed'
            ? `${getSvgIcon('check', 'mr-1')} ${countdown.label}`
            : (countdown.urgency === 'overdue' ? `${getSvgIcon('urgent', 'mr-1')} ${countdown.label}` : `${getSvgIcon('clock', 'mr-1')} ${countdown.label}`)}
        </span>
        ${roomBadgeHtml}
        ${weightBadgeHtml}
        ${classTimeBadgeHtml}
      </div>

      ${task.priority === 'high' ? '<div class="priority-label-row"><span class="high-priority-tag">HIGH PRIORITY</span></div>' : ''}

      ${doctorQuoteHtml}
      ${studentNotesHtml}

      <!-- Card Action Buttons matching website -->
      <div class="task-card-footer">
        <button type="button" class="btn-card-action btn-share-card" data-id="${task.id}" title="Share task details">
          ${getSvgIcon('share', 'mr-1')} <span class="btn-responsive-label">Share</span>
        </button>
        <button type="button" class="btn-card-action btn-edit-card" data-id="${task.id}" title="Edit deadline">
          ${getSvgIcon('pencil', 'mr-1')} <span class="btn-responsive-label">Edit</span>
        </button>
        <a class="btn-card-action btn-gcal" href="${gcalUrl}" target="_blank" rel="noopener noreferrer" title="Add to Google Calendar">
          ${getSvgIcon('calendar', 'mr-1')} <span class="btn-responsive-label">G-Calendar</span>
        </a>
        <button type="button" class="btn-card-action btn-card-toggle" data-id="${task.id}">
          ${isCompleted ? `${getSvgIcon('refresh', 'mr-1')} <span class="btn-responsive-label">Mark Pending</span>` : `${getSvgIcon('check', 'mr-1')} <span class="btn-responsive-label">Mark Done</span>`}
        </button>
      </div>
    `;

    // Card body click opens reading sheet
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button, a, input, select')) return;
      openReadingSheet(task);
    });

    // Inspect quote click
    card.querySelector('.btn-inspect-quote')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openReadingSheet(task);
    });

    // Toggle quote expansion
    card.querySelector('.btn-toggle-quote')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const body = card.querySelector(`#quote-body-${task.id}`);
      const btn = card.querySelector('.btn-toggle-quote') as HTMLElement;
      if (!body || !btn) return;
      const isClamped = body.classList.contains('clamped');
      if (isClamped) {
        body.classList.remove('clamped');
        body.classList.add('expanded');
        btn.innerHTML = `${getSvgIcon('book', 'mr-1')} <span class="quote-toggle-text">Show Less ▴</span>`;
      } else {
        body.classList.remove('expanded');
        body.classList.add('clamped');
        btn.innerHTML = `${getSvgIcon('book', 'mr-1')} <span class="quote-toggle-text">Read Full Announcement ▾</span>`;
      }
    });

    // Room pill button
    card.querySelector('.room-pill-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openRoomPicker(task.id);
    });

    // Share button
    card.querySelector('.btn-share-card')?.addEventListener('click', (e) => {
      e.stopPropagation();
      shareTask(task);
    });

    // Edit button
    card.querySelector('.btn-edit-card')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(task);
    });

    // Toggle Done
    const handleToggleDone = async (e: Event) => {
      e.stopPropagation();
      const prevStatus = task.status;
      const nextStatus: TaskStatus = isCompleted ? 'pending' : 'completed';
      currentTasks = await updateTask(task.id, { status: nextStatus });
      refreshAllViews();
      syncTasksToCloud(currentTasks, 'Status Change');
      showToast(
        nextStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
        'Undo',
        async () => {
          currentTasks = await updateTask(task.id, { status: prevStatus });
          refreshAllViews();
          syncTasksToCloud(currentTasks, 'Revert Status Change');
          showToast('Status reverted');
        }
      );
    };

    card.querySelector('.status-checkbox-btn')?.addEventListener('click', handleToggleDone);
    card.querySelector('.btn-card-toggle')?.addEventListener('click', handleToggleDone);

    taskListEl.appendChild(card);
  });
}

// ============================================================================
// MODAL MANAGERS: Reading Sheet, Room Picker & Extract
// ============================================================================

function openReadingSheet(task: DeadlineTask) {
  const modal = document.getElementById('modal-reading-sheet');
  const badgeGroup = document.getElementById('reading-modal-badges');
  const content = document.getElementById('reading-modal-content');
  if (!modal || !badgeGroup || !content) return;

  const resolved = resolveCourseInfo(task);
  const courseTheme = getCourseColorTheme(resolved.courseName, resolved.courseCode, task.title);
  const isCompleted = task.status === 'completed';
  const isHwOrProject = task.type === 'assignment' || (task.type as string) === 'hw' || task.type === 'project';
  const countdown = formatCountdown(task.dueDate, task.hasSpecificTime, task.status);
  const gcalUrl = createGoogleCalendarUrl(task);

  const fullAnnouncement = (task.description || task.sourceSnippet || '').trim();
  const hasAnnouncement = fullAnnouncement && !fullAnnouncement.startsWith('Blackboard Ultra Stream item');

  badgeGroup.innerHTML = `
    <div class="course-badge-main" style="background: ${courseTheme.bgLight}; border: 1px solid ${courseTheme.border}; color: ${courseTheme.textDark};">
      <span class="course-color-dot" style="width: 8px; height: 8px; border-radius: 50%; background: ${courseTheme.hex}; display: inline-block;"></span>
      <span class="course-name-text">${escapeHtml(resolved.courseName)}</span>
      ${resolved.courseCode && resolved.courseCode !== 'UOS' ? `<span class="course-code-tag" style="color: ${courseTheme.textDark}; border-color: ${courseTheme.border};">${escapeHtml(resolved.courseCode)}</span>` : ''}
    </div>
    <span class="type-pill type-${task.type || 'assignment'}">
      <span>${getTaskTypeIcon(task.type)}</span>
      <span>${(task.type || 'assignment').toUpperCase()}</span>
    </span>
  `;

  content.innerHTML = `
    <h2 class="reading-pane-title">${escapeHtml(task.title)}</h2>

    <div class="reading-meta-section">
      <span class="urgency-badge ${countdown.urgency}">
        ${countdown.urgency === 'completed'
          ? `${getSvgIcon('check', 'mr-1')} ${escapeHtml(countdown.label)}`
          : (countdown.urgency === 'overdue' ? `${getSvgIcon('urgent', 'mr-1')} ${escapeHtml(countdown.label)}` : `${getSvgIcon('clock', 'mr-1')} ${escapeHtml(countdown.label)}`)}
      </span>
      ${!isHwOrProject ? `
      <button type="button" class="room-pill-btn modal-reading-room-btn" data-task-id="${task.id}">
        <span>${getSvgIcon('pin', 'mr-1')} ${escapeHtml(task.room || 'No room set')}</span>
        <span class="room-edit-hint">${getSvgIcon('pencil')}</span>
      </button>
      ` : ''}
      ${task.weightDisplay || task.weight ? `<span class="task-weight-pill weight-major">${getSvgIcon('scale', 'mr-1')} ${escapeHtml(task.weightDisplay || `${task.weight}%`)}</span>` : ''}
      ${task.priority === 'high' ? '<span class="high-priority-tag">HIGH PRIORITY</span>' : ''}
    </div>

    <div class="reading-announcement-box">
      <div class="reading-box-header">
        <span class="reading-box-title">
          <span>${getSvgIcon('message', 'mr-1')}</span>
          <span>Doctor Announcement</span>
        </span>
        ${hasAnnouncement ? `
          <button type="button" class="btn-copy-announcement" id="btn-copy-drawer-text">
            <span>${getSvgIcon('copy', 'mr-1')} Copy</span>
          </button>
        ` : ''}
      </div>
      <div class="reading-box-content" style="max-height: 45vh; overflow-y: auto;">
        ${hasAnnouncement ? escapeHtml(fullAnnouncement) : '<span style="color: var(--text-muted);">No detailed announcement text available.</span>'}
      </div>
    </div>

    ${task.notes && task.notes.trim() ? `
      <div class="reading-notes-box" style="margin-top: 8px; padding: 10px 12px; background: rgba(59, 130, 246, 0.08); border-left: 3px solid #3b82f6; border-radius: var(--radius-sm);">
        <div style="font-size: 11px; font-weight: 700; color: #2563eb; display: flex; align-items: center; gap: 4px; margin-bottom: 4px;">
          ${getSvgIcon('pencil')}
          <span>Student Personal Notes</span>
        </div>
        <div style="font-size: 12px; color: var(--text-main); white-space: pre-wrap; line-height: 1.4;">${escapeHtml(task.notes)}</div>
      </div>
    ` : ''}

    <div class="reading-actions-bar">
      <button type="button" class="btn-primary-action modal-reading-toggle-btn" style="flex: 1; min-height: 36px;">
        ${isCompleted ? `${getSvgIcon('refresh', 'mr-1')} Mark Pending` : `${getSvgIcon('check', 'mr-1')} Mark Done`}
      </button>
      <button type="button" class="btn-card-action modal-reading-share-btn" style="min-height: 36px; padding: 0 10px;">
        <span>${getSvgIcon('share', 'mr-1')} Share</span>
      </button>
      <a class="btn-card-action" href="${gcalUrl}" target="_blank" rel="noopener noreferrer" style="min-height: 36px; display: inline-flex; align-items: center; text-decoration: none; padding: 0 10px;">
        <span>${getSvgIcon('calendar', 'mr-1')} G-Cal</span>
      </a>
      <button type="button" class="btn-card-action modal-reading-edit-btn" style="min-height: 36px; padding: 0 10px;">
        <span>${getSvgIcon('pencil', 'mr-1')} Edit</span>
      </button>
    </div>
  `;

  content.querySelector('#btn-copy-drawer-text')?.addEventListener('click', () => {
    navigator.clipboard.writeText(fullAnnouncement).then(() => {
      showToast('Announcement text copied to clipboard!');
    });
  });

  content.querySelector('.modal-reading-room-btn')?.addEventListener('click', () => {
    closeReadingSheet();
    openRoomPicker(task.id);
  });

  content.querySelector('.modal-reading-toggle-btn')?.addEventListener('click', async () => {
    const nextStatus: TaskStatus = isCompleted ? 'pending' : 'completed';
    currentTasks = await updateTask(task.id, { status: nextStatus });
    refreshAllViews();
    syncTasksToCloud(currentTasks, 'Status Change');
    closeReadingSheet();
    showToast(nextStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending');
  });

  content.querySelector('.modal-reading-share-btn')?.addEventListener('click', () => {
    shareTask(task);
  });

  content.querySelector('.modal-reading-edit-btn')?.addEventListener('click', () => {
    closeReadingSheet();
    openEditModal(task);
  });

  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function closeReadingSheet() {
  const modal = document.getElementById('modal-reading-sheet');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
}

let activeRoomPickerTaskId: string | null = null;

function openRoomPicker(taskId: string) {
  const task = currentTasks.find(t => t.id === taskId);
  if (!task) return;
  activeRoomPickerTaskId = taskId;

  const modal = document.getElementById('modal-room-picker');
  const presetsContainer = document.getElementById('room-presets-container');
  const customInput = document.getElementById('input-custom-room') as HTMLInputElement;
  if (!modal || !presetsContainer) return;

  const currentRoom = (task.room || '').trim();
  if (customInput) customInput.value = currentRoom;

  presetsContainer.innerHTML = STUDENT_CLASS_SCHEDULE.map(s => {
    const isCurrent = currentRoom.toLowerCase() === s.room.toLowerCase();
    return `
      <button type="button" class="room-preset-btn ${isCurrent ? 'is-active' : ''}" data-room="${escapeHtml(s.room)}">
        <div class="room-preset-left">
          <span class="room-preset-code">${getSvgIcon('pin', 'mr-1')} ${escapeHtml(s.room)}</span>
          <span class="room-preset-course">${escapeHtml(s.courseName)}</span>
        </div>
        ${isCurrent ? '<span style="color:#4338ca; font-size:11px; font-weight:700;">✓ Current</span>' : '<span style="color:var(--text-muted); font-size:11px;">Select</span>'}
      </button>
    `;
  }).join('');

  presetsContainer.querySelectorAll('.room-preset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const selectedRoom = btn.getAttribute('data-room');
      await applyRoomChange(taskId, selectedRoom || '');
      closeRoomPicker();
    });
  });

  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function closeRoomPicker() {
  const modal = document.getElementById('modal-room-picker');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
  activeRoomPickerTaskId = null;
}

async function applyRoomChange(taskId: string, newRoom: string) {
  const cleanedRoom = (newRoom || '').trim();
  currentTasks = await updateTask(taskId, { room: cleanedRoom || undefined, userEdited: true });
  refreshAllViews();
  syncTasksToCloud(currentTasks, 'Room Change');
  showToast(`Room updated to "${cleanedRoom || 'None'}"`);
}

// Refresh all views after task change
function refreshAllViews() {
  updateStats(currentTasks);
  updateCourseFilterOptions(currentTasks);
  renderGradeTracker(currentTasks);
  renderCalendar();
  renderSelectedDay();
  renderQuickLinksBar();
  renderTasks();
  if (dayExpandedDrawer && dayExpandedDrawer.classList.contains('open')) {
    openDayExpandedDrawer(selectedDateStr);
  }
}

async function recordLocalTombstone(taskId: string): Promise<void> {
  try {
    const raw = await new Promise<any>(resolve => {
      chrome.storage?.local?.get(['bbs_tombstones'], res => resolve(res?.bbs_tombstones || {}));
    });
    const map = (typeof raw === 'object' && raw) ? { ...raw } : {};
    map[taskId] = new Date().toISOString();
    await new Promise<void>(resolve => {
      chrome.storage?.local?.set({ bbs_tombstones: map }, () => resolve());
    });
  } catch {}
}

async function removeLocalTombstone(taskId: string): Promise<void> {
  try {
    const raw = await new Promise<any>(resolve => {
      chrome.storage?.local?.get(['bbs_tombstones'], res => resolve(res?.bbs_tombstones || {}));
    });
    if (typeof raw === 'object' && raw && raw[taskId]) {
      delete raw[taskId];
      await new Promise<void>(resolve => {
        chrome.storage?.local?.set({ bbs_tombstones: raw }, () => resolve());
      });
    }
  } catch {}
}

async function getLocalTombstones(): Promise<Record<string, string>> {
  try {
    const raw = await new Promise<any>(resolve => {
      chrome.storage?.local?.get(['bbs_tombstones'], res => resolve(res?.bbs_tombstones || {}));
    });
    return (typeof raw === 'object' && raw) ? raw : {};
  } catch {
    return {};
  }
}

/**
 * Automatically pushes deadlines to Firebase Realtime Database and Sync Server.
 */
function syncTasksToCloud(tasks: DeadlineTask[], actionDescription: string = 'Extension Update') {
  (async () => {
    // Merge in anything the phone changed since the last pull before overwriting the cloud copy
    const pulled = await pullTasksFromFirebaseIfNewer();
    const toPush = pulled ?? tasks;
    const [settings, tombstones] = await Promise.all([getSettings(), getLocalTombstones()]);

    pushTasksToFirebase(toPush, actionDescription, settings.syncKey, currentQuickLinks, tombstones).then(res => {
      console.log(`[Firebase Cloud Sync] ${actionDescription}:`, res);
    }).catch(err => {
      console.warn('[Firebase Cloud Sync error]:', err);
    });

    if (settings.autoSyncOnScan !== false) {
      pushTasksToSyncServer(toPush, settings, currentQuickLinks).catch(err => {
        console.warn('[Sync Server error]:', err);
      });
    }

    try {
      const channel = new BroadcastChannel('bbs_sync_channel');
      channel.postMessage({ type: 'TASKS_UPDATED', timestamp: Date.now() });
      channel.close();
    } catch {}
  })().catch(err => console.warn('[Cloud Sync error]:', err));
}

/**
 * Pulls the cloud copy from Firebase and merges it into local state.
 * Returns the merged list when local data changed, otherwise null.
 */
async function pullTasksFromFirebaseIfNewer(): Promise<DeadlineTask[] | null> {
  let result: DeadlineTask[] | null = null;
  try {
    const settings = await getSettings();
    const res = await fetchTasksFromFirebase(settings.syncKey);
    if (res.success && Array.isArray(res.tasks)) {
      const localTombs = await getLocalTombstones();
      const tombstones = mergeTombstones(localTombs, res.tombstones || {});
      if (JSON.stringify(tombstones) !== JSON.stringify(localTombs)) {
        chrome.storage?.local?.set({ bbs_tombstones: tombstones });
      }

      const { tasks, changed } = mergeCloudTasks(currentTasks, res.tasks, tombstones);
      if (changed) {
        currentTasks = tasks.sort(compareTasksByTime);
        await saveTasks(currentTasks);
        refreshAllViews();
        result = currentTasks;
        console.log('[Firebase Sync] Merged notes & deadline updates from mobile phone/cloud');
      }

      if (res.quickLinks && Array.isArray(res.quickLinks) && res.quickLinks.length > 0) {
        currentQuickLinks = res.quickLinks;
        await saveQuickLinks(currentQuickLinks);
        renderQuickLinksBar();
        renderQuickLinksManager();
      }
    }
  } catch (err) {
    console.warn('[Firebase Sync] Could not pull from cloud:', err);
  }
  return result;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// Edit Task Modal Handlers
// ============================================================================
let editingTaskId: string | null = null;

function openEditModal(task: DeadlineTask) {
  editingTaskId = task.id;
  editTaskIdInput.value = task.id;
  editTitleInput.value = task.title;
  const resolved = resolveCourseInfo(task);
  editCourseInput.value = resolved.courseName || resolved.courseCode;

  const d = new Date(task.dueDate);
  if (!isNaN(d.getTime())) {
    editDateInput.value = formatDateKey(d);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    editTimeInput.value = `${hh}:${mm}`;
  } else {
    editDateInput.value = selectedDateStr;
    editTimeInput.value = '23:59';
  }

  editTypeSelect.value = task.type || 'assignment';
  editPrioritySelect.value = task.priority || 'medium';
  editStatusSelect.value = task.status || 'pending';
  if (editDescInput) {
    editDescInput.value = task.description || task.sourceSnippet || '';
  }
  editNotesInput.value = task.notes || '';
  if (editRoomInput) {
    editRoomInput.value = task.room || '';
  }
  updateEditRoomVisibility();
  editWeightInput.value = task.weight !== undefined && task.weight !== null ? String(task.weight) : '';
  editWeightHint.textContent = task.syllabusNote || (task.weightDisplay ? `Saved weight: ${task.weightDisplay}` : '');

  modalEditTask.style.display = 'flex';
}

function closeEditModal() {
  modalEditTask.style.display = 'none';
  editingTaskId = null;
}

// ============================================================================
// Backup & Restore
// ============================================================================
async function exportJsonBackup() {
  const settings = await getSettings();
  const backupData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    tasks: currentTasks,
    settings
  };

  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `blackboarder_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function handleRestoreJson(file: File) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.tasks || !Array.isArray(data.tasks)) {
      alert('Invalid backup file format.');
      return;
    }

    const existingMap = new Map<string, DeadlineTask>();
    currentTasks.forEach(t => existingMap.set(t.id, t));

    // Merge imported tasks
    data.tasks.forEach((t: DeadlineTask) => {
      if (t.id && t.title && t.dueDate) {
        existingMap.set(t.id, t);
      }
    });

    const merged = Array.from(existingMap.values()).sort(compareTasksByTime);

    await saveTasks(merged);
    currentTasks = merged;

    if (data.settings) {
      await saveSettings(data.settings);
    }

    refreshAllViews();
    syncTasksToCloud(currentTasks, 'Restored Backup');
    alert(`Successfully restored ${data.tasks.length} deadlines!`);
  } catch (err) {
    console.error('Failed to parse backup JSON:', err);
    alert('Failed to read or parse the JSON backup file.');
  }
}

// ============================================================================
// Settings Form
// ============================================================================
async function loadSettingsForm() {
  const settings = await getSettings();
  (document.getElementById('setting-apikey') as HTMLInputElement).value = settings.openRouterApiKey || '';
  (document.getElementById('setting-model') as HTMLSelectElement).value = settings.openRouterModel || 'google/gemini-3.8-flash';
  (document.getElementById('setting-use-ai') as HTMLInputElement).checked = settings.useAiExtraction;
  (document.getElementById('setting-autoscan') as HTMLInputElement).checked = settings.autoScanOnPageLoad;
  (document.getElementById('setting-badge-notif') as HTMLInputElement).checked = settings.badgeNotification;
  (document.getElementById('setting-reminder-hours') as HTMLSelectElement).value = String(settings.reminderHoursBefore || 24);
  const settingTheme = document.getElementById('setting-theme') as HTMLSelectElement | null;
  if (settingTheme) settingTheme.value = settings.theme || 'light';

  const settingSyncUrl = document.getElementById('setting-sync-url') as HTMLInputElement | null;
  if (settingSyncUrl) settingSyncUrl.value = normalizeSyncUrl(settings.syncServerUrl || 'http://localhost:3456');
  const settingSyncMidnight = document.getElementById('setting-sync-midnight') as HTMLInputElement | null;
  if (settingSyncMidnight) settingSyncMidnight.checked = settings.autoSyncMidnight !== false;
  const settingSyncOnScan = document.getElementById('setting-sync-onscan') as HTMLInputElement | null;
  if (settingSyncOnScan) settingSyncOnScan.checked = settings.autoSyncOnScan !== false;

  const settingSyncKey = document.getElementById('setting-sync-key') as HTMLInputElement | null;
  if (settingSyncKey) settingSyncKey.value = (settings.syncKey || '').toUpperCase();
  const settingHostedUrl = document.getElementById('setting-hosted-url') as HTMLInputElement | null;
  if (settingHostedUrl) settingHostedUrl.value = settings.hostedWebUrl || 'https://yassinr-uossidekick.pages.dev';

  const settingJevKey = document.getElementById('setting-jev-key') as HTMLInputElement | null;
  if (settingJevKey) settingJevKey.value = settings.jevApiKey || '';
  const settingUseJev = document.getElementById('setting-use-jev') as HTMLInputElement | null;
  if (settingUseJev) settingUseJev.checked = settings.useJevClassification !== false;

  // Check Firebase cloud status
  const fbBadge = document.getElementById('firebase-status-badge');
  if (fbBadge) {
    fetchTasksFromFirebase(settings.syncKey).then(res => {
      fbBadge.classList.toggle('is-warn', !res.success);
      if (res.success) {
        fbBadge.innerHTML = `
          <div class="fb-status-main">
            <svg class="ui-icon fb-status-icon"><use href="#icon-flame"></use></svg>
            <span>Firebase Cloud: Online (${res.tasks.length} tasks synced${settings.syncKey ? ` - ${settings.syncKey}` : ''})</span>
          </div>
          <span class="fb-status-sub">24/7 Always Active</span>
        `;
      } else {
        fbBadge.innerHTML = `
          <div class="fb-status-main">
            <svg class="ui-icon fb-status-icon"><use href="#icon-urgent"></use></svg>
            <span>Firebase Cloud: Connecting...</span>
          </div>
          <span class="fb-status-sub">Offline fallback active</span>
        `;
      }
    }).catch(() => {});
  }

  // Check sync server status
  const statusEl = document.getElementById('sync-status-msg');
  if (statusEl) {
    statusEl.textContent = 'Checking sync server status...';
    getSyncServerStatus(settings).then(res => {
      if (res.success) {
        statusEl.innerHTML = `<span style="color: #16a34a; display: inline-flex; align-items: center; gap: 4px;">${getSvgIcon('check')} <span>Server Online (${res.count || 0} tasks synced)</span></span>`;
      } else {
        statusEl.innerHTML = `<span style="color: #d97706; display: inline-flex; align-items: center; gap: 4px;">${getSvgIcon('urgent')} <span>Server Offline (Run npm run server to sync)</span></span>`;
      }
    });
  }
}

// ============================================================================
// Scan Active Tab (Incremental from checkpoint by default, or full rescan)
// ============================================================================
async function scanActiveTab(fullRescan: boolean = false) {
  btnScanTab.disabled = true;
  btnScanTab.style.background = '';
  btnScanTab.innerHTML = fullRescan
    ? `${getSvgIcon('refresh', 'mr-1')}<span>Full Scan...</span>`
    : `${getSvgIcon('refresh', 'mr-1')}<span>Scanning Page...</span>`;

  try {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      btnScanTab.innerHTML = `${getSvgIcon('urgent', 'mr-1')}<span>Browser Only</span>`;
      setTimeout(() => {
        btnScanTab.disabled = false;
        btnScanTab.innerHTML = `${getSvgIcon('bolt', 'mr-1')}<span>Scan Page</span>`;
      }, 3000);
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      btnScanTab.innerHTML = `${getSvgIcon('urgent', 'mr-1')}<span>No Active Tab</span>`;
      setTimeout(() => {
        btnScanTab.disabled = false;
        btnScanTab.innerHTML = `${getSvgIcon('bolt', 'mr-1')}<span>Scan Page</span>`;
      }, 3000);
      return;
    }

    // Await response from content script (incremental from checkpoint by default)
    let response = await new Promise<{ announcements?: Announcement[]; directTasks?: DeadlineTask[]; isIncremental?: boolean } | null>(resolve => {
      try {
        chrome.tabs.sendMessage(tab.id!, { type: 'SCRAPE_PAGE', fullRescan }, res => {
          if (chrome.runtime.lastError) {
            // Tab needs content script injection or is not a Blackboard tab
            resolve(null);
          } else {
            resolve(res || null);
          }
        });
      } catch {
        resolve(null);
      }
    });

    // If communication failed (e.g. content script not yet injected into tab), attempt injection and retry
    if (!response && (chrome as any).scripting) {
      try {
        await (chrome as any).scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        await new Promise(r => setTimeout(r, 400));
        response = await new Promise(resolve => {
          try {
            chrome.tabs.sendMessage(tab.id!, { type: 'SCRAPE_PAGE', fullRescan }, res => {
              if (chrome.runtime.lastError) resolve(null);
              else resolve(res || null);
            });
          } catch {
            resolve(null);
          }
        });
      } catch {
        // ignore injection failure on restricted browser pages
      }
    }

    if (!response || (!response.announcements && !response.directTasks)) {
      btnScanTab.innerHTML = `${getSvgIcon('urgent', 'mr-1')}<span>Open Blackboard First</span>`;
      setTimeout(() => {
        btnScanTab.disabled = false;
        btnScanTab.innerHTML = `${getSvgIcon('bolt', 'mr-1')}<span>Scan Page</span>`;
      }, 3500);
      return;
    }

    const announcements = response.announcements || [];
    const directTasks: DeadlineTask[] = response.directTasks || [];

    // Keep user informed with real-time button progress
    btnScanTab.innerHTML = `${getSvgIcon('sparkles', 'mr-1')}<span>Extracting Deadlines...</span>`;

    const settings = await getSettings();
    const existingTasks = await getTasks();
    const checkpoint = fullRescan ? { lastScannedAt: '', processedAnnouncementIds: [], processedDirectTaskIds: [] } : await getLastScanCheckpoint();

    // Save announcements to storage (merges with existing stored announcements)
    if (announcements.length > 0) {
      await saveAnnouncements(announcements);
    }

    const { newTasks: extractedTasks, allTasks: mergedAnnTasks, updatedTasks } = await processAnnouncementsBatch(
      announcements,
      existingTasks,
      settings,
      fullRescan ? undefined : new Set(checkpoint.processedAnnouncementIds)
    );

    // Merge direct stream tasks with deduplication
    const existingKeySet = new Set(mergedAnnTasks.map(t => `${t.courseCode}_${t.title}_${new Date(t.dueDate).toISOString().slice(0, 10)}`));
    const newlyAddedDirect: DeadlineTask[] = [];

    for (const dt of directTasks) {
      if (!dt.room) {
        const resolvedRoom = resolveTaskRoom({
          courseNameOrCode: dt.courseName || dt.courseCode,
          announcementText: dt.description || dt.sourceSnippet,
          title: dt.title
        });
        if (resolvedRoom.room) {
          dt.room = resolvedRoom.room;
        }
      }
      const key = `${dt.courseCode}_${dt.title}_${new Date(dt.dueDate).toISOString().slice(0, 10)}`;
      if (!existingKeySet.has(key)) {
        existingKeySet.add(key);
        newlyAddedDirect.push(dt);
      }
    }

    const finalTasks = [...newlyAddedDirect, ...mergedAnnTasks].sort(compareTasksByTime);
    await saveTasks(finalTasks);

    // Save scan checkpoint so future scans only scan from where it left off
    const annKeys = announcements.flatMap(a => [
      a.title.toLowerCase().trim(),
      `${a.courseCode}_${a.title.toLowerCase().trim()}`
    ]);
    await saveLastScanCheckpoint({
      lastScannedAt: new Date().toISOString(),
      processedAnnouncementIds: announcements.map(a => a.id),
      processedDirectTaskIds: directTasks.map(d => d.id),
      processedAnnouncementKeys: annKeys
    });

    currentTasks = finalTasks;
    refreshAllViews();

    // Automatically push to Firebase Cloud & mobile sync server
    syncTasksToCloud(finalTasks, 'Blackboard Extension Scanner');

    const totalFound = newlyAddedDirect.length + extractedTasks.length;
    const totalUpdated = updatedTasks ? updatedTasks.length : 0;

    // Display clear visual results on the button and persist it so user sees the outcome
    if (totalFound > 0 && totalUpdated > 0) {
      btnScanTab.innerHTML = `${getSvgIcon('check', 'mr-1')}<span>+${totalFound} New, ${totalUpdated} Updated!</span>`;
      btnScanTab.style.background = '#16a34a';
      switchView('calendar');
    } else if (totalFound > 0) {
      btnScanTab.innerHTML = `${getSvgIcon('check', 'mr-1')}<span>+${totalFound} New Deadlines!</span>`;
      btnScanTab.style.background = '#16a34a';
      switchView('calendar');
    } else if (totalUpdated > 0) {
      btnScanTab.innerHTML = `${getSvgIcon('check', 'mr-1')}<span>${totalUpdated} Deadlines Updated!</span>`;
      btnScanTab.style.background = '#0284c7';
      switchView('calendar');
    } else {
      btnScanTab.innerHTML = `${getSvgIcon('check', 'mr-1')}<span>Up to Date (${announcements.length + directTasks.length} Scanned)</span>`;
      btnScanTab.style.background = '#059669';
    }

    // Keep the completion state visible for 4.5 seconds before returning to default state
    setTimeout(() => {
      btnScanTab.disabled = false;
      btnScanTab.style.background = '';
      btnScanTab.innerHTML = `${getSvgIcon('bolt', 'mr-1')}<span>Scan Page</span>`;
    }, 4500);

  } catch (err) {
    console.error('Scan failed:', err);
    btnScanTab.innerHTML = `${getSvgIcon('urgent', 'mr-1')}<span>Scan Failed</span>`;
    setTimeout(() => {
      btnScanTab.disabled = false;
      btnScanTab.style.background = '';
      btnScanTab.innerHTML = `${getSvgIcon('bolt', 'mr-1')}<span>Scan Page</span>`;
    }, 3000);
  }
}

// ============================================================================
// Setup Event Listeners
// ============================================================================
function setupEvents() {
  // Top Navigation Tabs
  tabNavCalendar.addEventListener('click', () => switchView('calendar'));
  tabNavDetails.addEventListener('click', () => switchView('details'));

  // Calendar Controls
  btnCalPrev.addEventListener('click', () => {
    calendarMonth--;
    if (calendarMonth < 0) {
      calendarMonth = 11;
      calendarYear--;
    }
    renderCalendar();
  });

  btnCalNext.addEventListener('click', () => {
    calendarMonth++;
    if (calendarMonth > 11) {
      calendarMonth = 0;
      calendarYear++;
    }
    renderCalendar();
  });

  btnCalToday.addEventListener('click', () => {
    const now = new Date();
    calendarYear = now.getFullYear();
    calendarMonth = now.getMonth();
    selectedDateStr = formatDateKey(now);
    renderCalendar();
    renderSelectedDay();
  });

  // Add deadline on selected day
  btnAddOnDate.addEventListener('click', () => {
    (document.getElementById('add-date') as HTMLInputElement).value = selectedDateStr;
    switchView('add');
  });

  // Expanded Day View Drawer Controls
  btnDrawerClose?.addEventListener('click', closeDayExpandedDrawer);
  dayExpandedBackdrop?.addEventListener('click', closeDayExpandedDrawer);
  btnDrawerAdd?.addEventListener('click', () => {
    closeDayExpandedDrawer();
    openAddModalOnDate(selectedDateStr);
  });

  // Close drawer on Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && dayExpandedDrawer && dayExpandedDrawer.classList.contains('open')) {
      closeDayExpandedDrawer();
    }
  });

  // Header Actions
  btnAddModal.addEventListener('click', () => {
    (document.getElementById('add-date') as HTMLInputElement).value = selectedDateStr;
    switchView('add');
  });
  btnSettingsToggle.addEventListener('click', () => switchView('settings'));
  btnThemeToggle?.addEventListener('click', toggleTheme);
  btnCancelAdd.addEventListener('click', () => switchView('calendar'));
  btnCancelSettings.addEventListener('click', () => switchView('calendar'));

  // Listen to OS theme changes if user has system theme selected
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentThemeSetting === 'system') {
        applyTheme('system');
      }
    });
  }

  // Scan Button (normal click: incremental from checkpoint; Shift+click: full rescan)
  btnScanTab.title = 'Scan Blackboard (Shift+Click for Full Re-scan)';
  btnScanTab.addEventListener('click', (e: MouseEvent) => scanActiveTab(e.shiftKey));

  // Export All ICS
  btnExportAllIcs.addEventListener('click', () => {
    const activeTasks = currentTasks.filter(t => t.status === 'pending');
    if (activeTasks.length === 0) {
      alert('No active deadlines to export.');
      return;
    }
    downloadIcsFile(activeTasks, 'uos_blackboard_deadlines.ics');
  });

  // Filter Tabs in Details View
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilterStatus = (btn.getAttribute('data-status') || 'all') as any;
      renderTasks();
    });
  });

  // Search input
  searchInput.addEventListener('input', e => {
    currentSearchQuery = (e.target as HTMLInputElement).value;
    renderTasks();
  });

  // Course select filter
  filterCourseSelect.addEventListener('change', () => {
    currentFilterCourse = filterCourseSelect.value;
    renderTasks();
  });

  // Type select filter
  filterTypeSelect.addEventListener('change', () => {
    currentFilterType = filterTypeSelect.value;
    renderTasks();
  });

  // Type selection changes dynamically toggle room visibility
  addTypeSelect?.addEventListener('change', updateAddRoomVisibility);
  editTypeSelect?.addEventListener('change', updateEditRoomVisibility);

  // Auto-suggest class meeting time and default room when user enters course in Add Task
  const addCourseInput = document.getElementById('add-course') as HTMLInputElement;
  addCourseInput?.addEventListener('input', () => {
    const courseVal = addCourseInput.value;
    const sched = findCourseSchedule(courseVal);
    const timeInput = document.getElementById('add-time') as HTMLInputElement;
    if (sched && timeInput && (!timeInput.value || timeInput.value === '23:59')) {
      const hh = String(sched.startHour).padStart(2, '0');
      const mm = String(sched.startMinute).padStart(2, '0');
      timeInput.value = `${hh}:${mm}`;
    }
    const isHwOrProj = addTypeSelect?.value === 'assignment' || (addTypeSelect?.value as string) === 'hw' || addTypeSelect?.value === 'project';
    if (!isHwOrProj && sched && addRoomInput && !addRoomInput.value) {
      addRoomInput.value = sched.room || '';
    }
  });

  // Add Task Form Submit
  formAddTask.addEventListener('submit', async e => {
    e.preventDefault();
    const title = (document.getElementById('add-title') as HTMLInputElement).value;
    const course = (document.getElementById('add-course') as HTMLInputElement).value;
    const dateVal = (document.getElementById('add-date') as HTMLInputElement).value;
    const rawTimeVal = ((document.getElementById('add-time') as HTMLInputElement).value || '').trim();
    const type = (document.getElementById('add-type') as HTMLSelectElement).value as TaskType;
    const priority = (document.getElementById('add-priority') as HTMLSelectElement).value as TaskPriority;
    const notes = (document.getElementById('add-notes') as HTMLTextAreaElement).value;

    const parsedCourse = parseCourseDetails(course);

    const [y, m, d] = dateVal.split('-').map(Number);
    let dueDate: Date;
    let hasSpecificTime: boolean;

    if (rawTimeVal) {
      const [hh, mm] = rawTimeVal.split(':').map(Number);
      dueDate = new Date(y, m - 1, d, hh, mm, 0, 0);
      hasSpecificTime = true;
    } else {
      const defaultDate = new Date(y, m - 1, d, 23, 59, 0, 0);
      const schedRes = resolveTaskTimeWithSchedule({
        dueDate: defaultDate,
        courseNameOrCode: parsedCourse.name || parsedCourse.code,
        hasSpecificTime: false,
        announcementText: notes,
        title
      });
      if (schedRes.appliedSchedule) {
        dueDate = schedRes.dueDate;
        hasSpecificTime = schedRes.hasSpecificTime;
      } else {
        dueDate = defaultDate;
        hasSpecificTime = false;
      }
    }

    const isHwOrProject = type === 'assignment' || (type as string) === 'hw' || type === 'project';
    const manualRoom = (!isHwOrProject && addRoomInput) ? addRoomInput.value.trim() : '';
    const resolvedRoomObj = isHwOrProject ? { room: '', isCustom: false } : resolveTaskRoom({
      courseNameOrCode: parsedCourse.name || parsedCourse.code,
      announcementText: notes,
      title,
      existingRoom: manualRoom,
      type
    });
    const room = (!isHwOrProject && resolvedRoomObj.room) ? resolvedRoomObj.room : undefined;

    const weightVal = addWeightInput ? addWeightInput.value.trim() : '';
    let weight: number | undefined = weightVal ? parseFloat(weightVal) : undefined;
    let weightDisplay: string | undefined = undefined;
    let syllabusNote: string | undefined = undefined;

    if (weight !== undefined && !isNaN(weight)) {
      weightDisplay = `${weight}% of Grade`;
      syllabusNote = addWeightHint ? (addWeightHint.textContent || 'Custom manual weight') : 'Custom manual weight';
    } else {
      const resolved = resolveTaskWeight(parsedCourse.name || parsedCourse.code, title, type, notes);
      if (resolved.weight !== undefined) {
        weight = resolved.weight;
        weightDisplay = resolved.weightDisplay;
        syllabusNote = resolved.syllabusNote;
      }
    }

    const newTask: DeadlineTask = {
      id: `task_manual_${Date.now()}`,
      courseCode: parsedCourse.code,
      courseName: parsedCourse.name,
      title,
      room,
      description: notes,
      dueDate: dueDate.toISOString(),
      hasSpecificTime,
      type,
      priority,
      status: 'pending',
      sourceSnippet: notes,
      notes: notes,
      confidence: 1.0,
      extractedBy: 'manual',
      userEdited: true,
      weight,
      weightDisplay,
      syllabusNote,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    currentTasks = await addTask(newTask);
    currentTasks.sort(compareTasksByTime);
    await saveTasks(currentTasks);

    formAddTask.reset();
    if (addRoomInput) addRoomInput.value = '';
    if (addWeightInput) addWeightInput.value = '';
    if (addWeightHint) addWeightHint.textContent = '';
    selectedDateStr = dateVal;
    refreshAllViews();
    switchView('calendar');
    syncTasksToCloud(currentTasks, 'Added Deadline');
  });

  // Auto-Weight preview button for Add Task
  btnCalcAddWeight?.addEventListener('click', () => {
    const title = (document.getElementById('add-title') as HTMLInputElement).value;
    const course = (document.getElementById('add-course') as HTMLInputElement).value;
    const type = (document.getElementById('add-type') as HTMLSelectElement).value as TaskType;
    const notes = (document.getElementById('add-notes') as HTMLTextAreaElement).value;
    const resolved = resolveTaskWeight(course, title, type, notes);
    if (resolved.weight !== undefined) {
      addWeightInput.value = String(resolved.weight);
      addWeightHint.innerHTML = `${getSvgIcon('scale', 'mr-1')} <b>${escapeHtml(resolved.weightDisplay)}</b>: ${escapeHtml(resolved.syllabusNote)}`;
      addWeightHint.style.color = '#166534';
    } else {
      addWeightHint.innerHTML = `${getSvgIcon('info', 'mr-1')} <span>Course or weight not found in syllabus database.</span>`;
      addWeightHint.style.color = '#718096';
    }
  });

  // Edit Modal Form Submit
  formEditTask.addEventListener('submit', async e => {
    e.preventDefault();
    if (!editingTaskId) return;

    const title = editTitleInput.value;
    const course = editCourseInput.value;
    const dateVal = editDateInput.value;
    const rawTimeVal = editTimeInput.value ? editTimeInput.value.trim() : '';
    const type = editTypeSelect.value as TaskType;
    const priority = editPrioritySelect.value as TaskPriority;
    const status = editStatusSelect.value as TaskStatus;
    const descVal = editDescInput ? editDescInput.value.trim() : '';
    const notesVal = editNotesInput ? editNotesInput.value.trim() : '';

    const parsedCourse = parseCourseDetails(course);

    const [y, m, d] = dateVal.split('-').map(Number);
    let dueDate: Date;
    let hasSpecificTime: boolean;

    if (rawTimeVal) {
      const [hh, mm] = rawTimeVal.split(':').map(Number);
      dueDate = new Date(y, m - 1, d, hh, mm, 0, 0);
      hasSpecificTime = true;
    } else {
      const defaultDate = new Date(y, m - 1, d, 23, 59, 0, 0);
      const schedRes = resolveTaskTimeWithSchedule({
        dueDate: defaultDate,
        courseNameOrCode: parsedCourse.name || parsedCourse.code,
        hasSpecificTime: false,
        announcementText: `${descVal} ${notesVal}`,
        title
      });
      if (schedRes.appliedSchedule) {
        dueDate = schedRes.dueDate;
        hasSpecificTime = schedRes.hasSpecificTime;
      } else {
        dueDate = defaultDate;
        hasSpecificTime = false;
      }
    }

    const isHwOrProject = type === 'assignment' || (type as string) === 'hw' || type === 'project';
    const roomVal = (!isHwOrProject && editRoomInput) ? editRoomInput.value.trim() : '';
    const room = (!isHwOrProject && roomVal) ? roomVal : undefined;

    const weightVal = editWeightInput ? editWeightInput.value.trim() : '';
    let weight: number | undefined = weightVal ? parseFloat(weightVal) : undefined;
    let weightDisplay: string | undefined = undefined;
    let syllabusNote: string | undefined = undefined;

    if (weight !== undefined && !isNaN(weight)) {
      weightDisplay = `${weight}% of Grade`;
      syllabusNote = editWeightHint ? (editWeightHint.textContent || 'Custom manual weight') : 'Custom manual weight';
    } else {
      const resolved = resolveTaskWeight(parsedCourse.name || parsedCourse.code, title, type, `${descVal} ${notesVal}`);
      if (resolved.weight !== undefined) {
        weight = resolved.weight;
        weightDisplay = resolved.weightDisplay;
        syllabusNote = resolved.syllabusNote;
      }
    }

    const updatedTaskFields: Partial<DeadlineTask> = {
      title,
      courseName: parsedCourse.name,
      courseCode: parsedCourse.code,
      dueDate: dueDate.toISOString(),
      hasSpecificTime,
      room,
      type,
      priority,
      status,
      description: descVal,
      sourceSnippet: descVal,
      notes: notesVal,
      weight,
      weightDisplay,
      syllabusNote,
      userEdited: true,
      updatedAt: new Date().toISOString()
    };

    currentTasks = currentTasks.map(t => (t.id === editingTaskId ? { ...t, ...updatedTaskFields } : t));
    currentTasks.sort(compareTasksByTime);

    await saveTasks(currentTasks);

    closeEditModal();
    selectedDateStr = dateVal;
    refreshAllViews();

    if (dayExpandedDrawer && dayExpandedDrawer.classList.contains('open')) {
      openDayExpandedDrawer(dateVal);
    }

    syncTasksToCloud(currentTasks, 'Edited Deadline');
  });

  // Auto-Weight preview button for Edit Modal
  btnCalcEditWeight?.addEventListener('click', () => {
    const title = editTitleInput.value;
    const course = editCourseInput.value;
    const type = editTypeSelect.value as TaskType;
    const desc = editDescInput ? editDescInput.value : '';
    const notes = editNotesInput.value;
    const resolved = resolveTaskWeight(course, title, type, `${desc} ${notes}`);
    if (resolved.weight !== undefined) {
      editWeightInput.value = String(resolved.weight);
      editWeightHint.innerHTML = `${getSvgIcon('scale', 'mr-1')} <b>${escapeHtml(resolved.weightDisplay)}</b>: ${escapeHtml(resolved.syllabusNote)}`;
      editWeightHint.style.color = '#166534';
    } else {
      editWeightHint.innerHTML = `${getSvgIcon('info', 'mr-1')} <span>Course or weight not found in syllabus database.</span>`;
      editWeightHint.style.color = '#718096';
    }
  });

  // Delete button inside edit modal with 5-Second Undo
  btnDeleteFromModal.addEventListener('click', async () => {
    if (!editingTaskId) return;
    const taskToDelete = currentTasks.find(t => t.id === editingTaskId);
    if (!taskToDelete) return;

    await recordLocalTombstone(editingTaskId);
    currentTasks = await deleteTask(editingTaskId);
    closeEditModal();
    refreshAllViews();
    syncTasksToCloud(currentTasks, 'Deleted Deadline');

    showToast(
      `Deleted "${taskToDelete.title.slice(0, 22)}..."`,
      'Undo',
      async () => {
        await removeLocalTombstone(taskToDelete.id);
        currentTasks = await addTask({ ...taskToDelete, updatedAt: new Date().toISOString() });
        refreshAllViews();
        syncTasksToCloud(currentTasks, 'Restored Deadline');
        showToast('Deadline restored');
      }
    );
  });

  btnCloseEditModal.addEventListener('click', closeEditModal);
  btnCancelEdit.addEventListener('click', closeEditModal);
  modalEditTask.addEventListener('click', e => {
    if (e.target === modalEditTask) closeEditModal();
  });

  // Settings Form Submit
  formSettings.addEventListener('submit', async e => {
    e.preventDefault();
    const apiKey = (document.getElementById('setting-apikey') as HTMLInputElement).value;
    const model = (document.getElementById('setting-model') as HTMLSelectElement).value;
    const useAi = (document.getElementById('setting-use-ai') as HTMLInputElement).checked;
    const autoScan = (document.getElementById('setting-autoscan') as HTMLInputElement).checked;
    const badgeNotif = (document.getElementById('setting-badge-notif') as HTMLInputElement).checked;
    const reminderHours = parseInt((document.getElementById('setting-reminder-hours') as HTMLSelectElement).value, 10);

    const rawSyncUrl = (document.getElementById('setting-sync-url') as HTMLInputElement)?.value || 'http://localhost:3456';
    const syncUrl = normalizeSyncUrl(rawSyncUrl);
    const settingSyncUrl = document.getElementById('setting-sync-url') as HTMLInputElement | null;
    if (settingSyncUrl) settingSyncUrl.value = syncUrl;
    const syncMidnight = (document.getElementById('setting-sync-midnight') as HTMLInputElement)?.checked ?? true;
    const syncOnScan = (document.getElementById('setting-sync-onscan') as HTMLInputElement)?.checked ?? true;

    const jevKey = (document.getElementById('setting-jev-key') as HTMLInputElement)?.value?.trim() || '';
    const useJev = (document.getElementById('setting-use-jev') as HTMLInputElement)?.checked ?? true;

    const syncKey = (document.getElementById('setting-sync-key') as HTMLInputElement)?.value?.trim().toUpperCase() || '';
    const hostedUrl = (document.getElementById('setting-hosted-url') as HTMLInputElement)?.value?.trim() || 'https://yassinr-uossidekick.pages.dev';
    const selectedTheme = ((document.getElementById('setting-theme') as HTMLSelectElement)?.value || 'light') as 'light' | 'dark' | 'system';

    await saveSettings({
      openRouterApiKey: apiKey,
      openRouterModel: model,
      useAiExtraction: useAi,
      jevApiKey: jevKey,
      useJevClassification: useJev,
      autoScanOnPageLoad: autoScan,
      badgeNotification: badgeNotif,
      reminderHoursBefore: reminderHours,
      syncServerUrl: syncUrl,
      autoSyncMidnight: syncMidnight,
      autoSyncOnScan: syncOnScan,
      syncKey,
      hostedWebUrl: hostedUrl,
      theme: selectedTheme
    });

    applyTheme(selectedTheme);
    try {
      localStorage.setItem('bbs_theme', selectedTheme);
      const channel = new BroadcastChannel('bbs_sync_channel');
      channel.postMessage({ type: 'THEME_CHANGED', theme: selectedTheme });
      channel.close();
    } catch {}

    alert('Settings saved successfully!');
    switchView('calendar');
  });

  // Scanner Maintenance Actions
  const btnTriggerFullRescan = document.getElementById('btn-trigger-full-rescan');
  const btnResetCheckpoint = document.getElementById('btn-reset-checkpoint');
  const rescanStatusMsg = document.getElementById('rescan-status-msg');

  btnTriggerFullRescan?.addEventListener('click', async () => {
    if (rescanStatusMsg) {
      rescanStatusMsg.textContent = 'Triggering Full Re-scan on active tab...';
      rescanStatusMsg.style.color = '#3b82f6';
    }
    await scanActiveTab(true);
    if (rescanStatusMsg) {
      rescanStatusMsg.textContent = 'Full Re-scan completed!';
      rescanStatusMsg.style.color = '#16a34a';
    }
  });

  btnResetCheckpoint?.addEventListener('click', async () => {
    await saveLastScanCheckpoint({
      lastScannedAt: '',
      processedAnnouncementIds: [],
      processedDirectTaskIds: [],
      processedAnnouncementKeys: []
    });
    if (rescanStatusMsg) {
      rescanStatusMsg.textContent = 'Checkpoint reset! Next scan will be a full scan.';
      rescanStatusMsg.style.color = '#16a34a';
    }
    alert('Scan checkpoint has been reset. Your next scan will examine all visible announcements from scratch and update existing tasks in place without resetting your data.');
  });

  // Mobile Sync Actions
  const btnSyncToServer = document.getElementById('btn-sync-to-server');
  const btnOpenMobileWeb = document.getElementById('btn-open-mobile-web');
  const btnCopyWebcalLink = document.getElementById('btn-copy-webcal-link');
  const btnCopyPairingLink = document.getElementById('btn-copy-pairing-link');
  const btnCopySyncKey = document.getElementById('btn-copy-sync-key');
  const btnRegenSyncKey = document.getElementById('btn-regen-sync-key');
  const btnQuickSyncMobile = document.getElementById('btn-quick-sync-mobile');

  // Copy Sync Key
  btnCopySyncKey?.addEventListener('click', async () => {
    const input = document.getElementById('setting-sync-key') as HTMLInputElement;
    if (input && input.value) {
      try {
        await navigator.clipboard.writeText(input.value.trim());
        showToast(`Copied Sync Key: ${input.value.trim()}`);
      } catch {
        prompt('Your Sync Key:', input.value.trim());
      }
    }
  });

  // Regenerate Sync Key
  btnRegenSyncKey?.addEventListener('click', () => {
    const input = document.getElementById('setting-sync-key') as HTMLInputElement;
    const newKey = 'BBS-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    if (input) {
      input.value = newKey;
      showToast(`Generated new Sync Key: ${newKey}. Click Save Settings to apply.`);
    }
  });

  // Copy Phone Pairing Link
  btnCopyPairingLink?.addEventListener('click', async () => {
    const settings = await getSettings();
    const hostedBase = (settings.hostedWebUrl || 'https://yassinr-uossidekick.pages.dev').replace(/\/+$/, '');
    const syncKey = settings.syncKey || '';
    const pairUrl = syncKey ? `${hostedBase}/?key=${encodeURIComponent(syncKey)}` : hostedBase;
    try {
      await navigator.clipboard.writeText(pairUrl);
      alert(`Copied Mobile Pairing Link to clipboard:\n${pairUrl}\n\nOpen this link on your phone (or send it via WhatsApp) to instantly view and sync your deadlines!`);
    } catch {
      prompt('Mobile Pairing Link:', pairUrl);
    }
  });

  async function handleManualSyncToMobile() {
    const settings = await getSettings();
    const statusEl = document.getElementById('sync-status-msg');
    if (statusEl) {
      statusEl.textContent = 'Syncing deadlines with cloud (bidirectional)...';
      statusEl.style.color = '#3b82f6';
    }

    // 1. Proactively pull freshest updates from phone / cloud first so mobile edits are preserved
    await pullTasksFromFirebaseIfNewer();

    // 2. Push current tasks & tombstones to Firebase Cloud & sync server
    const tombstones = await getLocalTombstones();
    const [fbRes, serverRes] = await Promise.all([
      pushTasksToFirebase(currentTasks, 'Extension Manual Sync', settings.syncKey, currentQuickLinks, tombstones),
      pushTasksToSyncServer(currentTasks, settings, currentQuickLinks)
    ]);

    refreshAllViews();

    if (fbRes.success || serverRes.success) {
      if (statusEl) {
        statusEl.innerHTML = `<span style="color: #16a34a; display: inline-flex; align-items: center; gap: 4px;">${getSvgIcon('check')} <span>Synced ${currentTasks.length} deadlines with Firebase Cloud!</span></span>`;
      }
      alert(`Successfully synchronized ${currentTasks.length} deadlines with Firebase Realtime Database!\n\nBoth laptop and mobile devices are now up to date.`);
    } else {
      if (statusEl) {
        statusEl.innerHTML = `<span style="color: #dc2626; display: inline-flex; align-items: center; gap: 4px;">${getSvgIcon('urgent')} <span>${escapeHtml(fbRes.message || serverRes.message || 'Sync error')}</span></span>`;
      }
      alert(`Mobile sync failed: ${fbRes.message || serverRes.message}`);
    }
  }

  btnSyncToServer?.addEventListener('click', handleManualSyncToMobile);
  btnQuickSyncMobile?.addEventListener('click', handleManualSyncToMobile);

  btnOpenMobileWeb?.addEventListener('click', async () => {
    const settings = await getSettings();
    const hostedBase = (settings.hostedWebUrl || 'https://yassinr-uossidekick.pages.dev').replace(/\/+$/, '');
    const syncKey = settings.syncKey || '';
    const targetUrl = syncKey ? `${hostedBase}/?key=${encodeURIComponent(syncKey)}` : hostedBase;
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: targetUrl });
    } else {
      window.open(targetUrl, '_blank');
    }
  });

  btnCopyWebcalLink?.addEventListener('click', async () => {
    const settings = await getSettings();
    const hostedBase = (settings.hostedWebUrl || 'https://yassinr-uossidekick.pages.dev').replace(/\/+$/, '');
    const syncKey = settings.syncKey || '';
    const webcalUrl = hostedBase.replace(/^https?:/, 'webcal:') + `/feed.ics${syncKey ? `?key=${encodeURIComponent(syncKey)}` : ''}`;
    try {
      await navigator.clipboard.writeText(webcalUrl);
      alert(`Copied WebCal link to clipboard:\n${webcalUrl}\n\nPaste this link into Apple Calendar on your iPhone or Google Calendar on the web to subscribe!`);
    } catch {
      prompt('WebCal Subscription Link:', webcalUrl);
    }
  });

  // Backup & Restore
  btnBackupJson.addEventListener('click', exportJsonBackup);
  btnRestoreJsonTrigger.addEventListener('click', () => inputRestoreJson.click());
  inputRestoreJson.addEventListener('change', e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      handleRestoreJson(file);
      (e.target as HTMLInputElement).value = '';
    }
  });
}

// ============================================================================
// Academic Quick Links Logic
// ============================================================================
function getQuickLinkCategoryMeta(category: QuickLinkCategory): { label: string; icon: string; badgeClass: string; color: string; bg: string } {
  switch (category) {
    case 'attendance':
      return { label: 'Attendance', icon: '📌', badgeClass: 'ql-cat-attendance', color: '#0284c7', bg: '#e0f2fe' };
    case 'study_plan':
      return { label: 'Study Plan', icon: '📋', badgeClass: 'ql-cat-study_plan', color: '#059669', bg: '#d1fae5' };
    case 'marks':
      return { label: 'Marks', icon: '🏆', badgeClass: 'ql-cat-marks', color: '#7c3aed', bg: '#ede9fe' };
    case 'portal':
      return { label: 'Portal', icon: '🌐', badgeClass: 'ql-cat-portal', color: '#d97706', bg: '#fef3c7' };
    case 'other':
    default:
      return { label: 'Link', icon: '🔗', badgeClass: 'ql-cat-other', color: '#475569', bg: '#f1f5f9' };
  }
}

function openQuickLinkUrl(rawUrl: string) {
  let url = (rawUrl || '').trim();
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function renderQuickLinksBar() {
  const container = document.getElementById('calendar-quick-links-chips');
  if (!container) return;

  if (!currentQuickLinks || currentQuickLinks.length === 0) {
    container.innerHTML = `<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">No quick links added yet. Click + Manage to add.</span>`;
    return;
  }

  container.innerHTML = currentQuickLinks.map(link => {
    const meta = getQuickLinkCategoryMeta(link.category);
    return `
      <a class="ql-chip ${meta.badgeClass}" data-id="${link.id}" data-url="${escapeHtml(link.url)}" title="${escapeHtml(link.title)} (${escapeHtml(link.url)})">
        <span class="ql-chip-dot" style="background: ${meta.color};"></span>
        <span>${escapeHtml(link.title)}</span>
        <svg class="ql-chip-external-icon"><use href="#icon-external-link"></use></svg>
      </a>
    `;
  }).join('');

  container.querySelectorAll('.ql-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const url = chip.getAttribute('data-url');
      if (url) openQuickLinkUrl(url);
    });
  });
}

function renderQuickLinksManager() {
  const listContainer = document.getElementById('quick-links-manager-list');
  if (!listContainer) return;

  if (!currentQuickLinks || currentQuickLinks.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 20px 10px; color: var(--text-muted); font-size: 12px;">
        No quick links configured. Click <strong>Add Link</strong> or <strong>Reset Defaults</strong> to get started.
      </div>
    `;
    return;
  }

  listContainer.innerHTML = currentQuickLinks.map(link => {
    const meta = getQuickLinkCategoryMeta(link.category);
    let hostname = '';
    try {
      const parsed = new URL(link.url.startsWith('http') ? link.url : `https://${link.url}`);
      hostname = parsed.hostname;
    } catch {
      hostname = link.url;
    }

    return `
      <div class="ql-item-card ${meta.badgeClass}" data-id="${link.id}">
        <div class="ql-item-left">
          <div class="ql-item-icon-box" style="background: ${meta.bg}; color: ${meta.color};">
            ${meta.icon}
          </div>
          <div class="ql-item-info">
            <div class="ql-item-title-row">
              <span class="ql-item-title" title="${escapeHtml(link.title)}">${escapeHtml(link.title)}</span>
              <span class="ql-category-badge" style="background: ${meta.bg}; color: ${meta.color};">${meta.label}</span>
            </div>
            <span class="ql-item-url" title="${escapeHtml(link.url)}">${escapeHtml(hostname)}</span>
          </div>
        </div>
        <div class="ql-item-actions">
          <button type="button" class="btn-ql-open btn-open-link" data-url="${escapeHtml(link.url)}" title="Open in new tab">
            <span>Open</span>
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-external-link"></use></svg>
          </button>
          <button type="button" class="btn-ql-action btn-edit-ql" data-id="${link.id}" title="Edit link" aria-label="Edit link">
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-pencil"></use></svg>
          </button>
          <button type="button" class="btn-ql-action delete btn-delete-ql" data-id="${link.id}" title="Delete link" aria-label="Delete link">
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-trash"></use></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Wire buttons
  listContainer.querySelectorAll('.btn-open-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      if (url) openQuickLinkUrl(url);
    });
  });

  listContainer.querySelectorAll('.btn-edit-ql').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const target = currentQuickLinks.find(l => l.id === id);
      if (!target) return;

      const form = document.getElementById('form-quick-link') as HTMLFormElement | null;
      const editIdInput = document.getElementById('ql-edit-id') as HTMLInputElement | null;
      const titleInput = document.getElementById('ql-title') as HTMLInputElement | null;
      const urlInput = document.getElementById('ql-url') as HTMLInputElement | null;
      const catSelect = document.getElementById('ql-category') as HTMLSelectElement | null;
      const saveBtn = document.getElementById('btn-save-ql') as HTMLButtonElement | null;

      if (form && editIdInput && titleInput && urlInput && catSelect) {
        editIdInput.value = target.id;
        titleInput.value = target.title;
        urlInput.value = target.url;
        catSelect.value = target.category || 'other';
        if (saveBtn) saveBtn.textContent = 'Update Link';
        form.style.display = 'block';
        titleInput.focus();
      }
    });
  });

  listContainer.querySelectorAll('.btn-delete-ql').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (!id) return;
      const target = currentQuickLinks.find(l => l.id === id);
      const title = target ? target.title : 'link';
      currentQuickLinks = await deleteQuickLink(id);
      renderQuickLinksBar();
      renderQuickLinksManager();
      syncQuickLinksToCloud();
      showToast(`Removed "${title}" from quick links`);
    });
  });
}

function initQuickLinksModal() {
  const modal = document.getElementById('modal-quick-links');
  const btnToggle = document.getElementById('btn-quick-links-toggle');
  const btnClose = document.getElementById('btn-close-quick-links');
  const btnBarManage = document.getElementById('btn-bar-manage-links');
  const btnToggleForm = document.getElementById('btn-toggle-add-link-form');
  const btnReset = document.getElementById('btn-reset-quick-links');
  const form = document.getElementById('form-quick-link') as HTMLFormElement | null;
  const btnCancelForm = document.getElementById('btn-cancel-ql-form');

  const openModal = () => {
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.remove('hidden');
      renderQuickLinksManager();
    }
  };

  const closeModal = () => {
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
    if (form) {
      form.reset();
      form.style.display = 'none';
      const editId = document.getElementById('ql-edit-id') as HTMLInputElement | null;
      if (editId) editId.value = '';
      const saveBtn = document.getElementById('btn-save-ql') as HTMLButtonElement | null;
      if (saveBtn) saveBtn.textContent = 'Save Link';
    }
  };

  btnToggle?.addEventListener('click', openModal);
  btnBarManage?.addEventListener('click', openModal);
  btnClose?.addEventListener('click', closeModal);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  btnToggleForm?.addEventListener('click', () => {
    if (form) {
      const isVisible = form.style.display !== 'none';
      if (isVisible) {
        form.style.display = 'none';
      } else {
        form.reset();
        const editId = document.getElementById('ql-edit-id') as HTMLInputElement | null;
        if (editId) editId.value = '';
        const saveBtn = document.getElementById('btn-save-ql') as HTMLButtonElement | null;
        if (saveBtn) saveBtn.textContent = 'Save Link';
        form.style.display = 'block';
        (document.getElementById('ql-title') as HTMLInputElement | null)?.focus();
      }
    }
  });

  btnCancelForm?.addEventListener('click', () => {
    if (form) {
      form.reset();
      form.style.display = 'none';
      const editId = document.getElementById('ql-edit-id') as HTMLInputElement | null;
      if (editId) editId.value = '';
    }
  });

  // Preset chips
  document.querySelectorAll('.btn-preset-ql').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      const titleInput = document.getElementById('ql-title') as HTMLInputElement | null;
      const urlInput = document.getElementById('ql-url') as HTMLInputElement | null;
      const catSelect = document.getElementById('ql-category') as HTMLSelectElement | null;

      if (form) form.style.display = 'block';

      if (preset === 'attendance') {
        if (titleInput) titleInput.value = 'Attendance (Banner)';
        if (urlInput) urlInput.value = 'https://banner.sharjah.ac.ae';
        if (catSelect) catSelect.value = 'attendance';
      } else if (preset === 'study_plan') {
        if (titleInput) titleInput.value = 'Study Plan & Degree Audit';
        if (urlInput) urlInput.value = 'https://banner.sharjah.ac.ae/StudentRegistrationSsb/';
        if (catSelect) catSelect.value = 'study_plan';
      } else if (preset === 'marks') {
        if (titleInput) titleInput.value = 'Final Marks & Transcript';
        if (urlInput) urlInput.value = 'https://banner.sharjah.ac.ae';
        if (catSelect) catSelect.value = 'marks';
      } else if (preset === 'portal') {
        if (titleInput) titleInput.value = 'Blackboard Ultra Portal';
        if (urlInput) urlInput.value = 'https://elearning.sharjah.ac.ae/ultra/course';
        if (catSelect) catSelect.value = 'portal';
      }
    });
  });

  // Reset defaults
  btnReset?.addEventListener('click', async () => {
    if (confirm('Reset quick links to standard university presets?')) {
      currentQuickLinks = await resetQuickLinksToDefault();
      renderQuickLinksBar();
      renderQuickLinksManager();
      syncQuickLinksToCloud();
      showToast('Quick links reset to defaults');
    }
  });

  // Form submit (Add or Edit)
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = (document.getElementById('ql-edit-id') as HTMLInputElement | null)?.value || '';
    const title = (document.getElementById('ql-title') as HTMLInputElement | null)?.value.trim() || '';
    let url = (document.getElementById('ql-url') as HTMLInputElement | null)?.value.trim() || '';
    const category = ((document.getElementById('ql-category') as HTMLSelectElement | null)?.value || 'other') as QuickLinkCategory;

    if (!title || !url) {
      showToast('Please provide both title and URL.');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    if (editId) {
      currentQuickLinks = await updateQuickLink(editId, { title, url, category });
      showToast(`Updated "${title}"`);
    } else {
      currentQuickLinks = await addQuickLink({ title, url, category });
      showToast(`Added "${title}" to quick links!`);
    }

    form.reset();
    form.style.display = 'none';
    const idInput = document.getElementById('ql-edit-id') as HTMLInputElement | null;
    if (idInput) idInput.value = '';

    renderQuickLinksBar();
    renderQuickLinksManager();
    syncQuickLinksToCloud();
  });
}

async function syncQuickLinksToCloud() {
  try {
    const settings = await getSettings();
    await pushTasksToFirebase(currentTasks, 'Chrome Extension', settings.syncKey, currentQuickLinks, await getLocalTombstones());
    await pushTasksToSyncServer(currentTasks, settings, currentQuickLinks);
  } catch {}
}

function initAiExtractModal() {
  const extractModal = document.getElementById('modal-ai-extract');
  const btnOpen = document.getElementById('btn-ai-extract-modal');
  const btnClose = document.getElementById('btn-close-extract-modal');
  const btnCancel = document.getElementById('btn-cancel-extract');
  const btnRun = document.getElementById('btn-run-extract');
  const btnAddCustom = document.getElementById('btn-add-deadline-header');

  btnAddCustom?.addEventListener('click', () => {
    switchView('add');
  });

  function closeExtractModal() {
    if (extractModal) {
      extractModal.style.display = 'none';
      extractModal.classList.add('hidden');
    }
  }

  btnOpen?.addEventListener('click', () => {
    if (extractModal) {
      extractModal.style.display = 'flex';
      extractModal.classList.remove('hidden');
      const input = document.getElementById('input-extract-text') as HTMLTextAreaElement;
      if (input) input.focus();
    }
  });

  btnClose?.addEventListener('click', closeExtractModal);
  btnCancel?.addEventListener('click', closeExtractModal);
  extractModal?.addEventListener('click', (e) => {
    if (e.target === extractModal) closeExtractModal();
  });

  // Room picker close bindings
  document.getElementById('btn-close-room-picker')?.addEventListener('click', closeRoomPicker);
  document.getElementById('modal-room-picker')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-room-picker')) closeRoomPicker();
  });

  document.getElementById('btn-apply-custom-room')?.addEventListener('click', async () => {
    if (!activeRoomPickerTaskId) return;
    const customVal = (document.getElementById('input-custom-room') as HTMLInputElement)?.value.trim() || '';
    await applyRoomChange(activeRoomPickerTaskId, customVal);
    closeRoomPicker();
  });

  // Reading sheet close bindings
  document.getElementById('btn-close-reading-sheet')?.addEventListener('click', closeReadingSheet);
  document.getElementById('modal-reading-sheet')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-reading-sheet')) closeReadingSheet();
  });

  // Run extract handler
  btnRun?.addEventListener('click', async () => {
    const textArea = document.getElementById('input-extract-text') as HTMLTextAreaElement;
    const courseSelect = document.getElementById('extract-course-hint') as HTMLSelectElement;
    const statusBox = document.getElementById('extract-status-box') as HTMLElement;
    const previewList = document.getElementById('extract-preview-list') as HTMLElement;
    const btnIcon = document.getElementById('extract-btn-icon') as HTMLElement;
    const btnText = document.getElementById('extract-btn-text') as HTMLElement;

    const text = (textArea?.value || '').trim();
    const courseHint = courseSelect?.value || '';

    if (!text) {
      showToast('Please paste an announcement text first.');
      return;
    }

    if (btnRun) (btnRun as HTMLButtonElement).disabled = true;
    if (btnIcon) btnIcon.innerHTML = getSvgIcon('refresh');
    if (btnText) btnText.textContent = 'Extracting...';
    if (statusBox) {
      statusBox.style.display = 'block';
      statusBox.innerHTML = `
        <div class="extract-status-pill loading">
          <span>${getSvgIcon('bolt', 'mr-1')} Analyzing announcement...</span>
        </div>
      `;
    }
    if (previewList) previewList.innerHTML = '';

    try {
      const extractAnnouncement = {
        id: 'manual-extract',
        courseCode: courseHint || '',
        courseName: courseHint || '',
        title: 'Manual Extract',
        contentText: text,
        sourceUrl: '',
        scannedAt: new Date().toISOString()
      };
      const extracted = extractDeadlinesLocally(extractAnnouncement);
      if (!extracted || extracted.length === 0) {
        if (statusBox) {
          statusBox.innerHTML = `
            <div class="extract-status-pill error">
              <span>No deadline dates detected in this announcement text.</span>
            </div>
          `;
        }
        showToast('No deadlines detected in announcement.');
        return;
      }

      if (statusBox) {
        statusBox.innerHTML = `
          <div class="extract-status-pill success">
            <span>${getSvgIcon('check', 'mr-1')} Found ${extracted.length} deadline(s)!</span>
          </div>
        `;
      }

      previewList.innerHTML = extracted.map((task, idx) => {
        const d = new Date(task.dueDate);
        const dateStr = !isNaN(d.getTime()) ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date pending';
        const timeStr = task.hasSpecificTime && !isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Class time';
        return `
          <div class="extract-result-item" id="extract-item-${idx}">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
              <div>
                <h4 style="font-size: 12.5px; font-weight: 700; color: var(--text-main);">${escapeHtml(task.title)}</h4>
                <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
                  <span>${getSvgIcon('book', 'mr-1')} ${escapeHtml(task.courseName || '')}</span>
                  <span>${getSvgIcon('calendar', 'mr-1')} ${dateStr} at ${timeStr}</span>
                  ${task.room ? `<span style="color:#4338ca; font-weight:600;">${getSvgIcon('pin', 'mr-1')} ${escapeHtml(task.room)}</span>` : ''}
                </div>
              </div>
              <button type="button" class="btn-primary btn-add-extracted-item" data-idx="${idx}" style="font-size: 11px; padding: 4px 10px; white-space: nowrap;">
                <span>${getSvgIcon('plus', 'mr-1')} Add</span>
              </button>
            </div>
          </div>
        `;
      }).join('');

      previewList.querySelectorAll('.btn-add-extracted-item').forEach(addBtn => {
        addBtn.addEventListener('click', async () => {
          const idx = parseInt(addBtn.getAttribute('data-idx') || '0', 10);
          const t = extracted[idx];
          if (!t) return;
          const newTask: DeadlineTask = {
            id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            title: t.title,
            courseName: t.courseName,
            courseCode: t.courseCode,
            dueDate: t.dueDate,
            hasSpecificTime: t.hasSpecificTime,
            type: t.type || 'assignment',
            priority: t.priority || 'medium',
            status: 'pending',
            description: t.description || text,
            sourceSnippet: t.sourceSnippet || text,
            room: t.room,
            weight: t.weight,
            weightDisplay: t.weightDisplay,
            syllabusNote: t.syllabusNote,
            extractedBy: 'ai',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          currentTasks = await addTask(newTask);
          currentTasks.sort(compareTasksByTime);
          await saveTasks(currentTasks);
          refreshAllViews();
          syncTasksToCloud(currentTasks, 'Extracted Announcement Added');
          (addBtn as HTMLButtonElement).disabled = true;
          addBtn.textContent = '✓ Added';
          showToast(`Added "${t.title}" to deadlines!`);
        });
      });
    } catch (err: any) {
      if (statusBox) {
        statusBox.innerHTML = `
          <div class="extract-status-pill error">
            <span>Extraction error: ${escapeHtml(err.message || 'Unknown error')}</span>
          </div>
        `;
      }
    } finally {
      if (btnRun) (btnRun as HTMLButtonElement).disabled = false;
      if (btnIcon) btnIcon.innerHTML = `<svg class="ui-icon mr-1"><use href="#icon-bolt"></use></svg>`;
      if (btnText) btnText.textContent = 'Extract Deadlines';
    }
  });
}

// ============================================================================
// Initialization
// ============================================================================
function setupStorageAndSyncListeners() {
  // Listen for storage changes from background sync or other tabs to update views reactively
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.bbs_tasks) {
        currentTasks = (changes.bbs_tasks.newValue as DeadlineTask[]) || [];
        currentTasks.sort(compareTasksByTime);
        refreshAllViews();
      }
      if (area === 'local' && changes.bbs_settings) {
        const newSettings = changes.bbs_settings.newValue as any;
        if (newSettings?.theme && newSettings.theme !== currentThemeSetting) {
          applyTheme(newSettings.theme);
        }
      }
      if (area === 'local' && changes.bbs_quick_links) {
        currentQuickLinks = (changes.bbs_quick_links.newValue as QuickLink[]) || [];
        renderQuickLinksBar();
        renderQuickLinksManager();
      }
    });
  }

  // Cross-tab broadcast listener for theme sync
  try {
    const syncChannel = new BroadcastChannel('bbs_sync_channel');
    syncChannel.onmessage = (event) => {
      if (event.data?.type === 'THEME_CHANGED' && event.data.theme) {
        applyTheme(event.data.theme);
      }
    };
  } catch {}

  // Listen for window focus to pull latest updates if user edited on mobile
  window.addEventListener('focus', () => {
    pullTasksFromFirebaseIfNewer();
  });

  // Periodically check for updates while popup is open (every 25 seconds)
  setInterval(() => {
    pullTasksFromFirebaseIfNewer();
  }, 25000);
}

async function refreshDataInBackground() {
  try {
    // 1. Fetch from chrome.storage.local to pick up any background worker or content script additions
    const freshTasks = (await getTasks()).filter(isValidTask);
    const freshLinks = await getQuickLinks();
    let viewsNeedUpdate = false;

    if (freshLinks && freshLinks.length > 0 && JSON.stringify(freshLinks) !== JSON.stringify(currentQuickLinks)) {
      currentQuickLinks = freshLinks;
      renderQuickLinksBar();
      renderQuickLinksManager();
    }

    if (freshTasks && freshTasks.length > 0 && JSON.stringify(freshTasks) !== JSON.stringify(currentTasks)) {
      currentTasks = freshTasks;
      currentTasks.sort(compareTasksByTime);
      viewsNeedUpdate = true;
    }

    if (viewsNeedUpdate) {
      refreshAllViews();
    }

    // 2. Auto-upgrade legacy HTTP remote sync server URL to HTTPS to prevent CORS preflight redirect errors
    const currentSettings = await getSettings();
    if (currentSettings.syncServerUrl) {
      const normalized = normalizeSyncUrl(currentSettings.syncServerUrl);
      if (normalized !== currentSettings.syncServerUrl) {
        await saveSettings({ syncServerUrl: normalized });
      }
    }
    // Ensure every user has a unique, isolated Sync Key on first run
    if (!currentSettings.syncKey) {
      const generatedKey = 'BBS-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      await saveSettings({ syncKey: generatedKey });
    }

    // 3. Proactively pull freshest updates from Firebase Cloud BEFORE performing retroactive upgrades
    await pullTasksFromFirebaseIfNewer();
    currentTasks = currentTasks.filter(isValidTask);

    // 4. Retroactively refresh syllabus weights, sanitize doctor quotes, and repair assessment times
    let updatedAny = false;
    currentTasks = currentTasks.map(task => {
      // User-created or user-edited tasks must NEVER have their dates, times, rooms, or course names overridden!
      if (task.userEdited || task.extractedBy === 'manual') {
        return task;
      }

      let taskUpdated = false;
      let description = task.description || '';
      let sourceSnippet = task.sourceSnippet || '';

      // Clean legacy synthetic stream description if present
      if (description.startsWith('Blackboard Ultra Stream item')) {
        description = '';
        taskUpdated = true;
      }

      // Sanitize doctor announcement text in description and sourceSnippet
      const cleanDesc = sanitizeDoctorAnnouncementText(
        description,
        task.courseName,
        task.courseCode,
        task.title
      );
      if (cleanDesc !== description) {
        description = cleanDesc;
        taskUpdated = true;
      }

      const cleanSnippet = sanitizeDoctorAnnouncementText(
        sourceSnippet,
        task.courseName,
        task.courseCode,
        task.title
      );
      if (cleanSnippet !== sourceSnippet) {
        sourceSnippet = cleanSnippet;
        taskUpdated = true;
      }

      // Retroactively resolve course and strip generic 'UOS' code tag
      let courseName = task.courseName;
      let courseCode = task.courseCode;
      if (courseCode === 'UOS') {
        courseCode = '';
        taskUpdated = true;
      }
      const resolvedCourse = resolveCourseInfo({
        courseName,
        courseCode,
        title: task.title,
        description,
        sourceSnippet
      });
      if (resolvedCourse.courseName !== 'General Course' && (!courseName || courseName === 'General Course' || courseName.toLowerCase() === 'uos')) {
        courseName = resolvedCourse.courseName;
        taskUpdated = true;
      }
      if (resolvedCourse.courseCode && !courseCode) {
        courseCode = resolvedCourse.courseCode;
        taskUpdated = true;
      }

      // Refresh weights with updated syllabus database
      const resolved = resolveTaskWeight(
        courseName || courseCode,
        task.title,
        task.type,
        description || sourceSnippet
      );

      let weight = task.weight;
      let weightDisplay = task.weightDisplay;
      let syllabusNote = task.syllabusNote;

      if (resolved.weight !== undefined && (resolved.weight !== task.weight || resolved.weightDisplay !== task.weightDisplay)) {
        weight = resolved.weight;
        weightDisplay = resolved.weightDisplay;
        syllabusNote = resolved.syllabusNote;
        taskUpdated = true;
      }

      // Repair task due time if teacher gave an explicit time or if class schedule should apply
      let dueDate = task.dueDate;
      let hasSpecificTime = task.hasSpecificTime;
      const combinedDoctorText = `${task.title} ${task.sourceSnippet || ''} ${task.description || ''}`;

      // Test extraction on combined text to see if an explicit assessment time is stated
      const testAnn = {
        id: task.announcementId || 'temp',
        courseCode: courseCode,
        courseName: courseName,
        title: task.title,
        contentText: combinedDoctorText,
        sourceUrl: '',
        scannedAt: new Date().toISOString()
      };
      const extractedTasks = extractDeadlinesLocally(testAnn);
      if (extractedTasks.length > 0) {
        const best = extractedTasks[0];
        const bestDate = new Date(best.dueDate);
        const curDate = new Date(task.dueDate);

        // Only adopt if task currently lacks a specific time and best has an explicit time!
        if (!hasSpecificTime && best.hasSpecificTime) {
          curDate.setHours(bestDate.getHours(), bestDate.getMinutes(), 0, 0);
          dueDate = curDate.toISOString();
          hasSpecificTime = true;
          taskUpdated = true;
        }
      }

      // Adjust to class schedule time if no specific teacher time was recorded
      if (!hasSpecificTime) {
        const schedRes = resolveTaskTimeWithSchedule({
          dueDate: new Date(dueDate),
          courseNameOrCode: courseName || courseCode,
          hasSpecificTime: false,
          announcementText: description || sourceSnippet,
          title: task.title
        });
        if (schedRes.appliedSchedule) {
          dueDate = schedRes.dueDate.toISOString();
          hasSpecificTime = schedRes.hasSpecificTime;
          taskUpdated = true;
        }
      }

      // Clear room if task is hw or project; otherwise assign from announcement or course schedule if missing
      const isHwOrProj = task.type === 'assignment' || (task.type as string) === 'hw' || task.type === 'project';
      let room = task.room;
      if (isHwOrProj) {
        if (room) {
          room = undefined;
          taskUpdated = true;
        }
      } else if (!room) {
        const resolvedRoom = resolveTaskRoom({
          courseNameOrCode: courseName || courseCode,
          announcementText: description || sourceSnippet,
          title: task.title,
          type: task.type
        });
        if (resolvedRoom.room) {
          room = resolvedRoom.room;
          taskUpdated = true;
        }
      }

      if (taskUpdated) {
        updatedAny = true;
        return {
          ...task,
          courseName,
          courseCode,
          room,
          description,
          sourceSnippet,
          dueDate,
          hasSpecificTime,
          weight,
          weightDisplay,
          syllabusNote,
          updatedAt: new Date().toISOString()
        };
      }

      return task;
    });

    currentTasks.sort(compareTasksByTime);
    if (updatedAny) {
      await saveTasks(currentTasks);
      syncTasksToCloud(currentTasks, 'Retroactive Upgrades');
      refreshAllViews();
    }
  } catch (err) {
    console.warn('[Popup] Background data refresh encountered error:', err);
  }
}

function initApp() {
  // Synchronously initialize theme to eliminate light/dark flashes
  initThemeSync();

  const now = new Date();
  calendarYear = now.getFullYear();
  calendarMonth = now.getMonth();
  selectedDateStr = formatDateKey(now);

  setupEvents();
  initAiExtractModal();
  initGradeTrackerToggle();
  renderLegend();
  renderSyllabusReference();
  renderScheduleReference();

  // Load and render academic quick links synchronously from cache
  currentQuickLinks = getCachedQuickLinksSync();
  renderQuickLinksBar();
  initQuickLinksModal();

  // Load and render deadlines synchronously from cache (<5ms)
  currentTasks = getCachedTasksSync();
  currentTasks.sort(compareTasksByTime);

  // Render all views immediately so the popup appears instantly populated like on mobile
  refreshAllViews();
  switchView('calendar');

  // Set up listeners for reactive updates
  setupStorageAndSyncListeners();

  // Run cloud pull and retroactive upgrades non-blockingly in the background
  refreshDataInBackground();
}

document.addEventListener('DOMContentLoaded', initApp);
