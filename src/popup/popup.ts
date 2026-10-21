import { DeadlineTask, TaskType, TaskPriority, TaskStatus, QuickLink, QuickLinkCategory, UserCourseConfig, CustomScheduleSlot, CustomSyllabusComponent, Weekday, TaskSubmissionUpdate, Announcement } from '../types';
import { getTasks, saveTasks, addTask, getSettings, saveSettings, saveAnnouncements, getLastScanCheckpoint, saveLastScanCheckpoint, getQuickLinks, saveQuickLinks, addQuickLink, updateQuickLink, deleteQuickLink, resetQuickLinksToDefault, getCachedTasksSync, getCachedQuickLinksSync, getCachedSettingsSync, getCachedCoursesSync, getUserCourses, saveUserCourses, resetUserCoursesToDefault, recalculateTasksWithActiveCourses, getCoursesUpdatedAt, autoRegisterDiscoveredCourses, generateUniqueSyncKey, normalizeRestoredSyncKey } from '../utils/storage';
import { createGoogleCalendarUrl, downloadIcsFile, formatCountdown, formatTaskTime, compareTasksByTime } from '../utils/calendar';
import { processAnnouncementsBatch } from '../engine/hybridExtractor';
import { extractDeadlinesLocally } from '../engine/localExtractor';
import { parseCourseDetails, sanitizeDoctorAnnouncementText, resolveCourseInfo, isValidTask, matchesSelectedCourseFilter, isBlackboardSystemNoise } from '../utils/courseHelper';
import { getCourseHex, getCourseColorTheme } from '../utils/courseColors';
import { resolveTaskWeight, getAllSyllabi } from '../utils/syllabusWeights';
import { findCourseSchedule, resolveTaskTimeWithSchedule, resolveTaskRoom, STUDENT_CLASS_SCHEDULE } from '../utils/courseSchedule';
import { pushTasksToSyncServer, getSyncServerStatus, normalizeSyncUrl } from '../utils/syncClient';
import { pushTasksToFirebase, fetchTasksFromFirebase } from '../utils/firebaseSync';
import { mergeCloudTasks, mergeTombstones, getTaskSeriesInfo, deduplicateTaskList } from '../utils/taskMerge';
import { parseBannerScheduleText, parseSyllabusWeightsText, parseCoursesFromJson, mergeImportedCourses } from '../core/courseImporter';
import { getActiveCourseLegend } from '../core/userCourses';
import { checkExtensionUpdate, dismissExtensionUpdate, acknowledgeExtensionUpdate, reloadExtension } from '../utils/updateChecker';
import { BUILD_INFO } from '../buildInfo';

// State
let currentTasks: DeadlineTask[] = [];
let currentQuickLinks: QuickLink[] = [];
let currentUserCourses: UserCourseConfig[] = [];
let currentFilterStatus: 'all' | 'pending' | 'completed' = 'pending';
let currentFilterCourse: string = 'all';
let currentFilterType: string = 'all';
let currentSearchQuery: string = '';

// Calendar State
const todayDate = new Date();
let calendarYear = todayDate.getFullYear();
let calendarMonth = todayDate.getMonth(); // 0-indexed (0 = Jan)
let selectedDateStr = formatDateKey(todayDate); // 'YYYY-MM-DD'
let selectedCourseFilter: string | null = null;

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

// Header Scan Banner Elements (slides down smoothly in header)
const headerScanBanner = document.getElementById('header-scan-banner') as HTMLDivElement | null;
const hsbIcon = document.getElementById('hsb-icon') as SVGElement | null;
const hsbText = document.getElementById('hsb-text') as HTMLSpanElement | null;
let scanBannerTimer: any = null;

function showScanBanner(
  text: string,
  type: 'active' | 'success' | 'info' | 'warning' = 'active',
  autoHideMs?: number
) {
  if (!headerScanBanner || !hsbText) return;
  if (scanBannerTimer) {
    clearTimeout(scanBannerTimer);
    scanBannerTimer = null;
  }

  hsbText.textContent = text;
  headerScanBanner.className = `header-scan-banner is-active is-${type}`;

  const spinner = headerScanBanner.querySelector('.hsb-spinner');
  if (hsbIcon) {
    if (type === 'active') {
      spinner?.classList.add('is-spinning');
      hsbIcon.innerHTML = `<use href="#icon-sparkles"></use>`;
    } else if (type === 'success') {
      spinner?.classList.remove('is-spinning');
      hsbIcon.innerHTML = `<use href="#icon-check"></use>`;
    } else if (type === 'warning') {
      spinner?.classList.remove('is-spinning');
      hsbIcon.innerHTML = `<use href="#icon-urgent"></use>`;
    } else {
      spinner?.classList.remove('is-spinning');
      hsbIcon.innerHTML = `<use href="#icon-sparkles"></use>`;
    }
  }

  if (autoHideMs && autoHideMs > 0) {
    scanBannerTimer = setTimeout(() => {
      hideScanBanner();
    }, autoHideMs);
  }
}

function hideScanBanner() {
  if (!headerScanBanner) return;
  if (scanBannerTimer) {
    clearTimeout(scanBannerTimer);
    scanBannerTimer = null;
  }
  headerScanBanner.classList.remove('is-active');
  const spinner = headerScanBanner.querySelector('.hsb-spinner');
  spinner?.classList.remove('is-spinning');
}

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

// Backup / Restore
const btnBackupJson = document.getElementById('btn-backup-json') as HTMLButtonElement;
const btnRestoreJsonTrigger = document.getElementById('btn-restore-json-trigger') as HTMLButtonElement;
const inputRestoreJson = document.getElementById('input-restore-json') as HTMLInputElement;

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
    renderUserCoursesManager();
    renderQuickLinksManager();
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

  // Group active tasks by YYYY-MM-DD (filtered by selectedCourseFilter if active)
  const tasksByDate = new Map<string, DeadlineTask[]>();
  currentTasks.forEach(task => {
    if (!matchesSelectedCourseFilter(task, selectedCourseFilter)) return;
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
    if (!matchesSelectedCourseFilter(task, selectedCourseFilter)) return false;
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
      ${task.scoreDisplay || task.score !== undefined ? `
        <div class="task-grade-pill" title="Grade / Score released on Blackboard">
          ${getSvgIcon('star', 'mr-1')} <span>${escapeHtml(task.scoreDisplay || `${task.score} pts`)}</span>
        </div>
      ` : (task.submissionStatus === 'graded' ? `
        <div class="task-grade-pill">
          ${getSvgIcon('star', 'mr-1')} <span>Graded</span>
        </div>
      ` : '')}
      ${task.submissionStatus === 'submitted' ? `
        <div class="task-submitted-pill" title="${task.submissionReceipt ? `Receipt: ${escapeHtml(task.submissionReceipt)}` : 'Submitted to Blackboard'}">
          ${getSvgIcon('check', 'mr-1')} <span>Submitted</span>
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
    currentTasks = applyTaskUpdateLocal(task.id, { status: nextStatus });
    refreshAllViews();
    syncTasksToCloud(currentTasks, 'Drawer Status Change');
    showToast(
      nextStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
      'Undo',
      async () => {
        currentTasks = applyTaskUpdateLocal(task.id, { status: prevStatus });
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
    recordLocalTombstone(task.id);
    currentTasks = removeTaskLocal(task.id);
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

  const filterLabel = selectedCourseFilter ? ` <span style="font-weight: 500; font-size: 11px; color: var(--text-muted);">&bull; ${escapeHtml(selectedCourseFilter)}</span>` : '';
  selectedDayTitle.innerHTML = `${getSvgIcon('calendar', 'mr-1')} <span>Deadlines for ${escapeHtml(formattedHeader)}${filterLabel}</span>`;

  const tasksOnDate = currentTasks.filter(task => {
    if (!matchesSelectedCourseFilter(task, selectedCourseFilter)) return false;
    const taskD = new Date(task.dueDate);
    return !isNaN(taskD.getTime()) && formatDateKey(taskD) === selectedDateStr;
  });
  tasksOnDate.sort(compareTasksByTime);

  selectedDayList.innerHTML = '';

  if (tasksOnDate.length === 0) {
    selectedDayList.innerHTML = `
      <div class="selected-day-empty">
        <span>No deadlines scheduled for this day${selectedCourseFilter ? ' matching selected course' : ''}.</span>
      </div>
    `;
    return;
  }

  tasksOnDate.forEach(task => {
    const card = createDaySummaryCard(task);
    selectedDayList.appendChild(card);
  });
}


// Render permanent course color legend with interactive filtering
function renderLegend() {
  if (!legendChipsContainer) return;
  const activeLegend = getActiveCourseLegend();
  const legendPanel = document.getElementById('course-legend-panel');

  if (activeLegend.length === 0) {
    legendChipsContainer.innerHTML = '';
    if (legendPanel) legendPanel.style.display = 'none';
    return;
  }

  if (legendPanel) legendPanel.style.display = '';
  legendChipsContainer.innerHTML = '';
  legendChipsContainer.classList.toggle('has-filter', selectedCourseFilter !== null);

  // 1. "All" filter chip
  const allChip = document.createElement('div');
  allChip.className = `legend-chip ${selectedCourseFilter === null ? 'is-active' : ''}`;
  allChip.setAttribute('data-course', '');
  allChip.setAttribute('role', 'button');
  allChip.setAttribute('tabindex', '0');
  allChip.setAttribute('title', 'Show deadlines for all courses');
  allChip.innerHTML = `<span>All</span>`;
  allChip.addEventListener('click', () => {
    selectedCourseFilter = null;
    renderLegend();
    renderCalendar();
    renderSelectedDay();
  });
  legendChipsContainer.appendChild(allChip);

  // 2. Individual Course chips (dynamically from active courses)
  getActiveCourseLegend().forEach(course => {
    const chip = document.createElement('div');
    const isActive = selectedCourseFilter === course.name;
    chip.className = `legend-chip ${isActive ? 'is-active' : ''}`;
    chip.setAttribute('data-course', course.name);
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('title', `Filter calendar by ${course.name}`);
    chip.innerHTML = `
      <span class="legend-dot" style="background-color: ${course.hex};"></span>
      <span>${escapeHtml(course.name)}</span>
    `;
    chip.addEventListener('click', () => {
      selectedCourseFilter = selectedCourseFilter === course.name ? null : course.name;
      renderLegend();
      renderCalendar();
      renderSelectedDay();
    });
    legendChipsContainer.appendChild(chip);
  });
}

// ============================================================================
// My Courses, Schedule & Syllabus Manager
// ============================================================================

function renderUserCoursesManager() {
  const container = document.getElementById('user-courses-list');
  const countPill = document.getElementById('pill-course-count');
  if (!container) return;

  // Filter out any Blackboard navigation tabs (Content, Calendar, Discussions, Gradebook, etc.)
  currentUserCourses = currentUserCourses.filter(c => {
    const name = (c.courseName || '').trim();
    const code = (c.courseCode || '').trim();
    if (isBlackboardSystemNoise(name) && (!code || isBlackboardSystemNoise(code) || code.toLowerCase() === name.toLowerCase())) {
      return false;
    }
    return true;
  });

  if (countPill) {
    countPill.textContent = `${currentUserCourses.length} Active`;
  }

  container.innerHTML = '';

  if (currentUserCourses.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 20px 10px; color: var(--text-muted); background: var(--surface-hover); border-radius: var(--radius-sm); border: 1px dashed var(--surface-border);">
        <p style="font-size: 12px; margin-bottom: 8px;">No courses configured yet. Click <b>+ Add Course</b> or scan Blackboard to detect your courses automatically.</p>
        <button type="button" class="btn-primary" id="btn-empty-add-course" style="font-size: 11px; padding: 4px 10px;">
          + Add Your First Course
        </button>
      </div>
    `;
    container.querySelector('#btn-empty-add-course')?.addEventListener('click', () => openCourseEditor());
    return;
  }

  currentUserCourses.forEach(course => {
    const card = document.createElement('div');
    card.className = 'user-course-card';
    card.style.borderLeft = `3px solid ${course.colorHex}`;

    // Total weight calculation
    const totalWeight = (course.syllabus || []).reduce((acc, c) => acc + (Number(c.totalWeight) || 0), 0);

    // Schedule badges
    let scheduleHtml = '';
    if (course.scheduleSlots && course.scheduleSlots.length > 0) {
      scheduleHtml = course.scheduleSlots.map(slot => {
        const daysDisplay = slot.days.map(d => d.slice(0, 3).toUpperCase()).join('/');
        const roomDisplay = slot.room ? `Room ${escapeHtml(slot.room)}` : 'Room TBD';
        return `
          <span class="ucc-schedule-badge">
            ${getSvgIcon('calendar', 'mr-1')} <b>${daysDisplay}</b> • ${escapeHtml(slot.startTime)}–${escapeHtml(slot.endTime)} • ${roomDisplay}
          </span>
        `;
      }).join('');
    } else {
      scheduleHtml = `<span style="font-size: 10.5px; color: var(--text-muted); font-style: italic;">No meeting times scheduled</span>`;
    }

    // Syllabus breakdown pills
    let syllabusHtml = '';
    if (course.syllabus && course.syllabus.length > 0) {
      syllabusHtml = course.syllabus.map(comp => {
        const unitText = comp.count && comp.count > 1 && comp.unitWeight !== undefined
          ? ` (${comp.count}x ${comp.unitWeight}%)`
          : '';
        return `
          <span class="ucc-syllabus-pill" title="${escapeHtml(comp.note || comp.name)}">
            ${escapeHtml(comp.name)}: <span class="weight-bold">${comp.totalWeight}%</span>${unitText}
          </span>
        `;
      }).join('');
    } else {
      syllabusHtml = `<span style="font-size: 10.5px; color: var(--text-muted); font-style: italic;">No syllabus breakdown defined</span>`;
    }

    // Weight status badge
    let weightStatusBadge = '';
    if (totalWeight === 100) {
      weightStatusBadge = `<span class="settings-pill pill-green" style="font-size: 10px;">Total Weight: 100%</span>`;
    } else if (totalWeight < 100) {
      weightStatusBadge = `<span class="settings-pill pill-orange" style="font-size: 10px;">Total Weight: ${totalWeight}% (Incomplete)</span>`;
    } else {
      weightStatusBadge = `<span class="settings-pill pill-red" style="font-size: 10px; color: var(--danger);">Total Weight: ${totalWeight}% (Exceeds 100%)</span>`;
    }

    const crnBadge = course.crn ? `<span class="ucc-code" style="margin-left: 4px;" title="CRN">CRN: ${escapeHtml(course.crn)}</span>` : '';

    card.innerHTML = `
      <div class="ucc-header">
        <div class="ucc-title-group">
          <span class="ucc-color-dot" style="background-color: ${course.colorHex};"></span>
          <span class="ucc-name" title="${escapeHtml(course.courseName)}">${escapeHtml(course.courseName)}</span>
          <span class="ucc-code">${escapeHtml(course.courseCode)}</span>
          ${crnBadge}
        </div>
        <div class="ucc-actions">
          <button type="button" class="ucc-action-btn edit" title="Edit course" aria-label="Edit course">
            <svg class="ui-icon" style="width: 13px; height: 13px;"><use href="#icon-pencil"></use></svg>
          </button>
          <button type="button" class="ucc-action-btn delete" title="Delete course" aria-label="Delete course">
            <svg class="ui-icon" style="width: 13px; height: 13px;"><use href="#icon-trash"></use></svg>
          </button>
        </div>
      </div>
      <div class="ucc-schedule-list">
        ${scheduleHtml}
      </div>
      <div class="ucc-syllabus-section">
        <div class="ucc-syllabus-pills">
          ${syllabusHtml}
        </div>
        <div class="ucc-weight-status">
          <span>Grade Allocation</span>
          ${weightStatusBadge}
        </div>
      </div>
    `;

    card.querySelector('.ucc-action-btn.edit')?.addEventListener('click', () => openCourseEditor(course.id));
    card.querySelector('.ucc-action-btn.delete')?.addEventListener('click', () => handleDeleteCourse(course.id, course.courseName));

    container.appendChild(card);
  });
}

// ============================================================================
// Course & Syllabus Editor Modal
// ============================================================================
let editingCourseId: string | null = null;
const ALL_WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function openCourseEditor(courseId?: string) {
  const modal = document.getElementById('modal-course-editor');
  if (!modal) return;

  editingCourseId = courseId || null;
  const titleEl = document.getElementById('course-editor-title');
  const dotEl = document.getElementById('editor-header-dot');
  const codeInput = document.getElementById('editor-course-code') as HTMLInputElement;
  const nameInput = document.getElementById('editor-course-name') as HTMLInputElement;
  const crnInput = document.getElementById('editor-course-crn') as HTMLInputElement;
  const colorPicker = document.getElementById('editor-color-picker') as HTMLInputElement;
  const colorHexInput = document.getElementById('editor-color-hex') as HTMLInputElement;
  const aliasesInput = document.getElementById('editor-course-aliases') as HTMLInputElement;
  const slotsContainer = document.getElementById('course-editor-slots');
  const syllabusContainer = document.getElementById('course-editor-syllabus');

  if (slotsContainer) slotsContainer.innerHTML = '';
  if (syllabusContainer) syllabusContainer.innerHTML = '';

  const course = courseId ? currentUserCourses.find(c => c.id === courseId) : null;

  if (course) {
    if (titleEl) titleEl.textContent = 'Edit Course';
    if (codeInput) codeInput.value = course.courseCode || '';
    if (nameInput) nameInput.value = course.courseName || '';
    if (crnInput) crnInput.value = course.crn || '';
    const color = course.colorHex || '#2563eb';
    if (colorPicker) colorPicker.value = color;
    if (colorHexInput) colorHexInput.value = color;
    if (dotEl) dotEl.style.backgroundColor = color;
    if (aliasesInput) aliasesInput.value = (course.aliases || []).join(', ');

    if (course.scheduleSlots && course.scheduleSlots.length > 0) {
      course.scheduleSlots.forEach(slot => addScheduleSlotRow(slot));
    } else {
      addScheduleSlotRow();
    }

    if (course.syllabus && course.syllabus.length > 0) {
      course.syllabus.forEach(comp => addSyllabusRow(comp));
    } else {
      addSyllabusRow();
    }
  } else {
    if (titleEl) titleEl.textContent = 'Add Course';
    if (codeInput) codeInput.value = '';
    if (nameInput) nameInput.value = '';
    if (crnInput) crnInput.value = '';
    const defaultColor = '#2563eb';
    if (colorPicker) colorPicker.value = defaultColor;
    if (colorHexInput) colorHexInput.value = defaultColor;
    if (dotEl) dotEl.style.backgroundColor = defaultColor;
    if (aliasesInput) aliasesInput.value = '';

    addScheduleSlotRow();
    addSyllabusRow();
  }

  updateEditorTotalWeight();
  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function closeCourseEditor() {
  const modal = document.getElementById('modal-course-editor');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
  editingCourseId = null;
}

function addScheduleSlotRow(slot?: Partial<CustomScheduleSlot>) {
  const container = document.getElementById('course-editor-slots');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'slot-editor-row';

  const selectedDays = new Set<Weekday>(slot?.days || ['mon', 'wed']);
  const dayPillsHtml = ALL_WEEKDAYS.map(day => {
    const isSelected = selectedDays.has(day);
    const label = day.charAt(0).toUpperCase() + day.slice(1, 3);
    return `<button type="button" class="day-pill-btn ${isSelected ? 'selected' : ''}" data-day="${day}">${label}</button>`;
  }).join('');

  row.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span style="font-size: 10px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Meeting Days</span>
      <button type="button" class="ucc-action-btn delete btn-remove-slot" title="Remove slot" style="width: 20px; height: 20px;">✕</button>
    </div>
    <div class="day-pills-row" style="display: flex; gap: 4px; flex-wrap: wrap;">
      ${dayPillsHtml}
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-top: 4px;">
      <div>
        <label style="font-size: 9.5px; color: var(--text-muted); display: block;">Start</label>
        <input type="time" class="form-input slot-start-time" value="${slot?.startTime || '11:00'}" required style="font-size: 11px; padding: 4px 6px;">
      </div>
      <div>
        <label style="font-size: 9.5px; color: var(--text-muted); display: block;">End</label>
        <input type="time" class="form-input slot-end-time" value="${slot?.endTime || '12:15'}" required style="font-size: 11px; padding: 4px 6px;">
      </div>
      <div>
        <label style="font-size: 9.5px; color: var(--text-muted); display: block;">Room</label>
        <input type="text" class="form-input slot-room" placeholder="e.g. A8-103" value="${escapeHtml(slot?.room || '')}" style="font-size: 11px; padding: 4px 6px;">
      </div>
    </div>
  `;

  row.querySelectorAll('.day-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('selected');
    });
  });

  row.querySelector('.btn-remove-slot')?.addEventListener('click', () => {
    row.remove();
  });

  container.appendChild(row);
}

function addSyllabusRow(comp?: Partial<CustomSyllabusComponent>) {
  const container = document.getElementById('course-editor-syllabus');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'syllabus-editor-row';

  const compType = comp?.type || 'quiz';
  const totalWeight = comp?.totalWeight !== undefined ? comp.totalWeight : 20;
  const count = comp?.count || '';
  const unitWeight = comp?.unitWeight !== undefined ? `${comp.unitWeight}% each` : '';

  row.innerHTML = `
    <div style="display: flex; gap: 6px; align-items: center;">
      <input type="text" class="form-input comp-name" placeholder="Component Name (e.g. Quizzes, Midterm)" value="${escapeHtml(comp?.name || '')}" required style="flex: 2; font-size: 11.5px; padding: 4px 6px;">
      <select class="form-select comp-type" style="flex: 1.2; font-size: 11px; padding: 4px 6px;">
        <option value="quiz" ${compType === 'quiz' ? 'selected' : ''}>Quiz</option>
        <option value="exam" ${compType === 'exam' ? 'selected' : ''}>Exam</option>
        <option value="assignment" ${compType === 'assignment' ? 'selected' : ''}>Assignment</option>
        <option value="project" ${compType === 'project' ? 'selected' : ''}>Project</option>
        <option value="lab" ${compType === 'lab' ? 'selected' : ''}>Lab</option>
        <option value="other" ${compType === 'other' ? 'selected' : ''}>Other</option>
      </select>
      <input type="number" min="0" max="100" class="form-input comp-weight" placeholder="Weight %" value="${totalWeight}" required style="width: 60px; font-size: 11.5px; padding: 4px 6px;">
      <input type="number" min="1" max="50" class="form-input comp-count" placeholder="Count" value="${count}" title="Optional number of items (e.g. 4 quizzes)" style="width: 52px; font-size: 11.5px; padding: 4px 6px;">
      <button type="button" class="ucc-action-btn delete btn-remove-syllabus" title="Remove component" style="width: 22px; height: 22px; flex-shrink: 0;">✕</button>
    </div>
    <div class="comp-unit-calc" style="font-size: 10px; color: var(--text-muted); text-align: right; padding-right: 28px;">
      ${unitWeight}
    </div>
  `;

  const weightInput = row.querySelector('.comp-weight') as HTMLInputElement;
  const countInput = row.querySelector('.comp-count') as HTMLInputElement;
  const unitCalcEl = row.querySelector('.comp-unit-calc') as HTMLElement;

  function recalculateUnit() {
    const w = parseFloat(weightInput.value) || 0;
    const c = parseInt(countInput.value, 10) || 0;
    if (c > 1 && w > 0) {
      const u = Math.round((w / c) * 10) / 10;
      unitCalcEl.textContent = `${c} items x ${u}% each`;
    } else {
      unitCalcEl.textContent = '';
    }
    updateEditorTotalWeight();
  }

  weightInput.addEventListener('input', recalculateUnit);
  countInput.addEventListener('input', recalculateUnit);

  row.querySelector('.btn-remove-syllabus')?.addEventListener('click', () => {
    row.remove();
    updateEditorTotalWeight();
  });

  container.appendChild(row);
}

function updateEditorTotalWeight() {
  const badge = document.getElementById('editor-syllabus-total-badge');
  if (!badge) return;

  const container = document.getElementById('course-editor-syllabus');
  let total = 0;
  if (container) {
    const weightInputs = container.querySelectorAll('.comp-weight') as NodeListOf<HTMLInputElement>;
    weightInputs.forEach(inp => {
      total += parseFloat(inp.value) || 0;
    });
  }

  badge.textContent = `Total: ${total}% / 100%`;
  badge.classList.remove('pill-green', 'pill-blue', 'pill-orange', 'pill-red');
  if (total === 100) {
    badge.classList.add('pill-green');
  } else if (total < 100) {
    badge.classList.add('pill-orange');
  } else {
    badge.classList.add('pill-red');
  }
}

async function handleSaveCourse(e: Event) {
  e.preventDefault();
  const code = (document.getElementById('editor-course-code') as HTMLInputElement).value.trim();
  const name = (document.getElementById('editor-course-name') as HTMLInputElement).value.trim();
  const crn = (document.getElementById('editor-course-crn') as HTMLInputElement).value.trim();
  const hex = (document.getElementById('editor-color-hex') as HTMLInputElement).value.trim() || '#2563eb';
  const aliasesRaw = (document.getElementById('editor-course-aliases') as HTMLInputElement).value;
  const aliases = aliasesRaw.split(',').map(s => s.trim()).filter(Boolean);

  if (!code || !name) {
    alert('Please enter both course code and course name.');
    return;
  }

  // Collect schedule slots
  const slots: CustomScheduleSlot[] = [];
  const slotRows = document.querySelectorAll('#course-editor-slots .slot-editor-row');
  slotRows.forEach(row => {
    const days: Weekday[] = [];
    row.querySelectorAll('.day-pill-btn.selected').forEach(btn => {
      const d = btn.getAttribute('data-day') as Weekday;
      if (d) days.push(d);
    });
    const startTime = (row.querySelector('.slot-start-time') as HTMLInputElement)?.value || '11:00';
    const endTime = (row.querySelector('.slot-end-time') as HTMLInputElement)?.value || '12:15';
    const room = (row.querySelector('.slot-room') as HTMLInputElement)?.value.trim() || '';

    if (days.length > 0) {
      slots.push({
        days,
        startTime,
        endTime,
        room
      });
    }
  });

  // Collect syllabus components
  const syllabus: CustomSyllabusComponent[] = [];
  const syllabusRows = document.querySelectorAll('#course-editor-syllabus .syllabus-editor-row');
  syllabusRows.forEach((row, idx) => {
    const cName = (row.querySelector('.comp-name') as HTMLInputElement)?.value.trim();
    const cType = ((row.querySelector('.comp-type') as HTMLSelectElement)?.value || 'quiz') as TaskType;
    const cWeight = parseFloat((row.querySelector('.comp-weight') as HTMLInputElement)?.value) || 0;
    const cCount = parseInt((row.querySelector('.comp-count') as HTMLInputElement)?.value, 10) || undefined;
    const uWeight = (cCount && cCount > 1 && cWeight > 0) ? Math.round((cWeight / cCount) * 10) / 10 : undefined;

    if (cName && cWeight > 0) {
      syllabus.push({
        id: `comp_${idx + 1}`,
        name: cName,
        type: cType,
        totalWeight: cWeight,
        count: cCount,
        unitWeight: uWeight
      });
    }
  });

  const courseId = editingCourseId || `course_${Date.now()}`;
  const courseConfig: UserCourseConfig = {
    id: courseId,
    courseCode: code,
    courseName: name,
    crn: crn || undefined,
    colorHex: hex,
    aliases,
    scheduleSlots: slots,
    syllabus
  };

  let nextCourses: UserCourseConfig[];
  if (editingCourseId) {
    nextCourses = currentUserCourses.map(c => c.id === editingCourseId ? courseConfig : c);
  } else {
    nextCourses = [...currentUserCourses, courseConfig];
  }

  await handleCoursesUpdated(nextCourses);
  closeCourseEditor();
  showToast(`Saved course "${name}"`);
}

async function handleDeleteCourse(courseId: string, courseName: string) {
  if (!confirm(`Are you sure you want to delete "${courseName}"? Existing deadlines will remain but will no longer match this course schedule.`)) {
    return;
  }
  const nextCourses = currentUserCourses.filter(c => c.id !== courseId);
  await handleCoursesUpdated(nextCourses);
  showToast(`Deleted "${courseName}"`);
}

async function handleCoursesUpdated(courses: UserCourseConfig[]) {
  currentUserCourses = courses;
  await saveUserCourses(courses);
  currentTasks = await recalculateTasksWithActiveCourses();
  currentTasks.sort(compareTasksByTime);

  renderUserCoursesManager();
  renderLegend();
  updateCourseFilterOptions(currentTasks);
  refreshAllViews();

  // Cloud sync to Firebase & Sync Server
  const settings = await getSettings();
  const tombstones = await getLocalTombstones();
  const coursesUpdatedAt = await getCoursesUpdatedAt();
  pushTasksToFirebase(currentTasks, 'Course Configuration Update', settings.syncKey, currentQuickLinks, tombstones, courses, coursesUpdatedAt || undefined).catch(() => {});
  if (settings.autoSyncOnScan !== false) {
    pushTasksToSyncServer(currentTasks, settings, currentQuickLinks).catch(() => {});
  }
}

// ============================================================================
// Smart Course & Schedule Importer Modal
// ============================================================================
let detectedImportCourses: Partial<UserCourseConfig>[] = [];

function openCourseImporter() {
  const modal = document.getElementById('modal-course-import');
  if (!modal) return;
  detectedImportCourses = [];
  const previewContainer = document.getElementById('import-banner-preview-container');
  if (previewContainer) previewContainer.style.display = 'none';
  const bannerText = document.getElementById('import-banner-text') as HTMLTextAreaElement;
  if (bannerText) bannerText.value = '';
  const jsonText = document.getElementById('import-json-text') as HTMLTextAreaElement;
  if (jsonText) jsonText.value = '';

  switchImporterTab('banner');
  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function closeCourseImporter() {
  const modal = document.getElementById('modal-course-import');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
}

function switchImporterTab(tab: 'banner' | 'json') {
  const tabBanner = document.getElementById('tab-import-banner');
  const tabJson = document.getElementById('tab-import-json');
  const contentBanner = document.getElementById('tab-content-banner');
  const contentJson = document.getElementById('tab-content-json');

  if (tab === 'banner') {
    tabBanner?.classList.add('active');
    tabJson?.classList.remove('active');
    if (contentBanner) contentBanner.style.display = 'block';
    if (contentJson) contentJson.style.display = 'none';
  } else {
    tabBanner?.classList.remove('active');
    tabJson?.classList.add('active');
    if (contentBanner) contentBanner.style.display = 'none';
    if (contentJson) contentJson.style.display = 'block';
  }
}

function handlePreviewBanner() {
  const text = (document.getElementById('import-banner-text') as HTMLTextAreaElement)?.value || '';
  if (!text.trim()) {
    showToast('Please paste Banner schedule text first.');
    return;
  }
  detectedImportCourses = parseBannerScheduleText(text);
  const container = document.getElementById('import-banner-preview-container');
  const list = document.getElementById('import-banner-preview-list');
  if (!container || !list) return;

  if (detectedImportCourses.length === 0) {
    showToast('No courses detected in text. Please check the Banner schedule format.');
    container.style.display = 'none';
    return;
  }

  list.innerHTML = detectedImportCourses.map(c => {
    const slots = (c.scheduleSlots || []).map(s => `${s.days.map(d => d.slice(0, 3).toUpperCase()).join('/')} ${s.startTime}–${s.endTime} (${s.room || 'TBD'})`).join(', ');
    return `
      <div class="import-preview-card">
        <div style="font-weight: 700;">${escapeHtml(c.courseName || '')} <span style="font-weight: normal; color: var(--text-muted); font-family: monospace;">(${escapeHtml(c.courseCode || '')})</span></div>
        <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">
          ${c.crn ? `CRN: ${escapeHtml(c.crn)} • ` : ''}${slots || 'No slots'}
        </div>
      </div>
    `;
  }).join('');

  container.style.display = 'block';
}

async function handleConfirmBannerImport() {
  if (detectedImportCourses.length === 0) return;
  const merged = mergeImportedCourses(currentUserCourses, detectedImportCourses);
  await handleCoursesUpdated(merged);
  closeCourseImporter();
  showToast(`Imported and merged ${detectedImportCourses.length} courses!`);
}

async function handleConfirmJsonImport() {
  const jsonText = (document.getElementById('import-json-text') as HTMLTextAreaElement)?.value || '';
  if (!jsonText.trim()) {
    showToast('Please paste JSON course data or select a file.');
    return;
  }
  try {
    const parsed = parseCoursesFromJson(jsonText);
    if (parsed.length === 0) {
      showToast('No valid courses found in JSON.');
      return;
    }
    const merged = mergeImportedCourses(currentUserCourses, parsed);
    await handleCoursesUpdated(merged);
    closeCourseImporter();
    showToast(`Imported ${parsed.length} courses from JSON!`);
  } catch (err: any) {
    alert(`Invalid JSON format: ${err.message || err}`);
  }
}

function exportCoursesJson() {
  const jsonStr = JSON.stringify(currentUserCourses, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'blackboarder-courses.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Exported blackboarder-courses.json');
}

async function handleResetCourses() {
  if (!confirm('Reset all courses, class schedules, and grading weights to the 6 official UOS defaults?')) {
    return;
  }
  const resetCourses = await resetUserCoursesToDefault();
  await handleCoursesUpdated(resetCourses);
  showToast('Reset courses to official UOS defaults!');
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
        ${task.scoreDisplay || task.score !== undefined ? `
          <span class="task-grade-pill" title="Grade / Score released on Blackboard">
            ${getSvgIcon('star', 'mr-1')} <span>${escapeHtml(task.scoreDisplay || `${task.score} pts`)}</span>
          </span>
        ` : (task.submissionStatus === 'graded' ? `
          <span class="task-grade-pill">
            ${getSvgIcon('star', 'mr-1')} <span>Graded</span>
          </span>
        ` : '')}
        ${task.submissionStatus === 'submitted' ? `
          <span class="task-submitted-pill" title="${task.submissionReceipt ? `Receipt: ${escapeHtml(task.submissionReceipt)}` : 'Submitted to Blackboard'}">
            ${getSvgIcon('check', 'mr-1')} <span>Submitted</span>
          </span>
        ` : ''}
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
      currentTasks = applyTaskUpdateLocal(task.id, { status: nextStatus });
      refreshAllViews();
      syncTasksToCloud(currentTasks, 'Status Change');
      showToast(
        nextStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
        'Undo',
        async () => {
          currentTasks = applyTaskUpdateLocal(task.id, { status: prevStatus });
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
    <div style="display: flex; align-items: center; gap: 6px;">
      <span class="type-pill type-${task.type || 'assignment'}">
        <span>${getTaskTypeIcon(task.type)}</span>
        <span>${(task.type || 'assignment').toUpperCase()}</span>
      </span>
    </div>
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
    currentTasks = applyTaskUpdateLocal(task.id, { status: nextStatus });
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
  currentTasks = applyTaskUpdateLocal(taskId, { room: cleanedRoom || undefined, userEdited: true });
  refreshAllViews();
  syncTasksToCloud(currentTasks, 'Room Change');
  showToast(`Room updated to "${cleanedRoom || 'None'}"`);
}

// Refresh all views after task change
let refreshScheduled = false;
function refreshAllViews() {
  if (refreshScheduled) return;
  refreshScheduled = true;
  // Let the browser paint any toast/UI feedback added in this task before the heavy re-render
  requestAnimationFrame(() => {
    setTimeout(() => {
      refreshScheduled = false;
      renderAllViewsNow();
    }, 0);
  });
}

function renderAllViewsNow() {
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

// Optimistic UI: in-memory state is the source of truth, storage writes are queued in order
let persistChain: Promise<void> = Promise.resolve();
function persistTasksInBackground(tasks: DeadlineTask[]): Promise<void> {
  persistChain = persistChain.then(() => saveTasks(tasks)).catch(() => {});
  return persistChain;
}

function applyTaskUpdateLocal(taskId: string, updates: Partial<DeadlineTask>): DeadlineTask[] {
  const now = new Date().toISOString();
  currentTasks = currentTasks.map(t => (t.id === taskId ? { ...t, ...updates, updatedAt: now } : t));
  persistTasksInBackground(currentTasks);
  return currentTasks;
}

function removeTaskLocal(taskId: string): DeadlineTask[] {
  currentTasks = currentTasks.filter(t => t.id !== taskId);
  persistTasksInBackground(currentTasks);
  return currentTasks;
}

let tombstoneChain: Promise<void> = Promise.resolve();
function recordLocalTombstone(taskId: string): Promise<void> {
  tombstoneChain = tombstoneChain.then(() => writeLocalTombstone(taskId)).catch(() => {});
  return tombstoneChain;
}

async function writeLocalTombstone(taskId: string): Promise<void> {
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
    await Promise.all([persistChain, tombstoneChain]);
    // Merge in anything the phone changed since the last pull before overwriting the cloud copy
    const pulled = await pullTasksFromFirebaseIfNewer();
    const toPush = pulled ?? tasks;
    const [settings, tombstones, coursesUpdatedAt] = await Promise.all([getSettings(), getLocalTombstones(), getCoursesUpdatedAt()]);

    pushTasksToFirebase(toPush, actionDescription, settings.syncKey, currentQuickLinks, tombstones, currentUserCourses, coursesUpdatedAt || undefined).then(res => {
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

      if (Array.isArray(res.courses)) {
        const localUpdatedAt = await getCoursesUpdatedAt();
        const cloudTime = res.coursesUpdatedAt ? new Date(res.coursesUpdatedAt).getTime() : 0;
        const localTime = localUpdatedAt ? new Date(localUpdatedAt).getTime() : 0;

        // Only overwrite local courses if cloud timestamp is newer, or if local has no timestamp yet
        if (!localUpdatedAt || cloudTime > localTime) {
          if (JSON.stringify(res.courses) !== JSON.stringify(currentUserCourses)) {
            currentUserCourses = res.courses;
            await saveUserCourses(currentUserCourses, res.coursesUpdatedAt);
            currentTasks = await recalculateTasksWithActiveCourses();
            renderUserCoursesManager();
            renderLegend();
            updateCourseFilterOptions(currentTasks);
            refreshAllViews();
          }
        }
      }

      // If this is a brand new or uninitialized syncKey node in Firebase, initialize it
      if (res.lastSync === undefined && settings.syncKey) {
        const coursesUpdatedAt = await getCoursesUpdatedAt();
        pushTasksToFirebase(
          currentTasks,
          'Initial Sync Key Provisioning',
          settings.syncKey,
          currentQuickLinks,
          tombstones,
          currentUserCourses,
          coursesUpdatedAt || undefined
        ).catch(() => {});
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

  const settingBbDark = document.getElementById('setting-blackboard-dark-mode') as HTMLInputElement | null;
  if (settingBbDark) settingBbDark.checked = settings.blackboardDarkMode !== false;

  const settingSyncUrl = document.getElementById('setting-sync-url') as HTMLInputElement | null;
  if (settingSyncUrl) settingSyncUrl.value = normalizeSyncUrl(settings.syncServerUrl || 'http://localhost:3456');
  const settingSyncMidnight = document.getElementById('setting-sync-midnight') as HTMLInputElement | null;
  if (settingSyncMidnight) settingSyncMidnight.checked = settings.autoSyncMidnight !== false;
  const settingSyncOnScan = document.getElementById('setting-sync-onscan') as HTMLInputElement | null;
  if (settingSyncOnScan) settingSyncOnScan.checked = settings.autoSyncOnScan !== false;

  const settingSyncKey = document.getElementById('setting-sync-key') as HTMLInputElement | null;
  if (settingSyncKey) settingSyncKey.value = (settings.syncKey || '').toUpperCase();
  const settingHostedUrl = document.getElementById('setting-hosted-url') as HTMLInputElement | null;
  if (settingHostedUrl) settingHostedUrl.value = settings.hostedWebUrl || 'https://blackboarder.pages.dev';

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
  btnScanTab.innerHTML = `${getSvgIcon('refresh', 'mr-1 is-spinning')}<span>Scan...</span>`;
  showScanBanner(
    fullRescan ? 'Full re-scanning Blackboard stream & courses...' : 'Scanning Blackboard page for deadlines...',
    'active'
  );

  try {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      btnScanTab.innerHTML = `${getSvgIcon('urgent', 'mr-1')}<span>Error</span>`;
      showScanBanner('Please open Blackboard in an active tab first.', 'warning', 4000);
      setTimeout(() => {
        btnScanTab.disabled = false;
        btnScanTab.style.background = '';
        btnScanTab.innerHTML = `${getSvgIcon('bolt', 'mr-1')}<span>Scan</span>`;
      }, 3000);
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      btnScanTab.innerHTML = `${getSvgIcon('urgent', 'mr-1')}<span>Error</span>`;
      showScanBanner('No active Blackboard tab detected.', 'warning', 4000);
      setTimeout(() => {
        btnScanTab.disabled = false;
        btnScanTab.style.background = '';
        btnScanTab.innerHTML = `${getSvgIcon('bolt', 'mr-1')}<span>Scan</span>`;
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
      btnScanTab.innerHTML = `${getSvgIcon('urgent', 'mr-1')}<span>Error</span>`;
      showScanBanner('Please navigate to Blackboard Ultra Stream or Course page first.', 'warning', 4500);
      setTimeout(() => {
        btnScanTab.disabled = false;
        btnScanTab.style.background = '';
        btnScanTab.innerHTML = `${getSvgIcon('bolt', 'mr-1')}<span>Scan</span>`;
      }, 3500);
      return;
    }

    const announcements = response.announcements || [];
    const directTasks: DeadlineTask[] = response.directTasks || [];
    const submissionUpdates: TaskSubmissionUpdate[] = (response as any).submissionUpdates || [];
    const discoveredCourses = (response as any).discoveredCourses || [];

    // Keep user informed with real-time banner and compact button
    btnScanTab.innerHTML = `${getSvgIcon('sparkles', 'mr-1 is-spinning')}<span>Parse...</span>`;
    showScanBanner(`Scanned ${announcements.length} announcements & ${directTasks.length} stream items. Extracting...`, 'active');

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

    const finalTasks = [...newlyAddedDirect, ...mergedAnnTasks].filter(isValidTask).sort(compareTasksByTime);

    // Apply submission and grade updates to matching tasks
    for (const update of submissionUpdates) {
      const match = finalTasks.find(t => {
        const res = resolveCourseInfo(t);
        const courseMatches = !update.courseCode || !res.courseCode || update.courseCode === res.courseCode ||
          (update.courseName && res.courseName && res.courseName.toLowerCase().includes(update.courseName.toLowerCase()));
        if (!courseMatches) return false;
        const cleanUpdateTitle = (update.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const cleanTaskTitle = (t.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return cleanUpdateTitle.length >= 3 && (cleanTaskTitle.includes(cleanUpdateTitle) || cleanUpdateTitle.includes(cleanTaskTitle));
      });

      if (match) {
        if (update.submissionStatus === 'graded') {
          match.submissionStatus = 'graded';
          if (update.score !== undefined) match.score = update.score;
          if (update.maxScore !== undefined) match.maxScore = update.maxScore;
          if (update.scoreDisplay) match.scoreDisplay = update.scoreDisplay;
          match.status = 'completed';
          match.updatedAt = new Date().toISOString();
        } else if (update.submissionStatus === 'submitted') {
          if (match.submissionStatus !== 'graded') {
            match.submissionStatus = 'submitted';
            if (update.submittedAt) match.submittedAt = update.submittedAt;
            if (update.submissionReceipt) match.submissionReceipt = update.submissionReceipt;
            match.status = 'completed';
            match.updatedAt = new Date().toISOString();
          }
        }
      }
    }

    // Auto-register any new courses found in scanned tasks or discovered courses
    currentUserCourses = await autoRegisterDiscoveredCourses([...finalTasks, ...discoveredCourses]).catch(() => currentUserCourses);
    updateCourseFilterOptions(finalTasks);
    renderUserCoursesManager();
    renderLegend();

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

    // Display clear visual results on the compact button and in the extended banner
    if (totalFound > 0 && totalUpdated > 0) {
      btnScanTab.innerHTML = `${getSvgIcon('check', 'mr-1')}<span>+${totalFound}</span>`;
      btnScanTab.style.background = '#16a34a';
      showScanBanner(`Found ${totalFound} new deadline${totalFound > 1 ? 's' : ''}, updated ${totalUpdated}!`, 'success', 5000);
      switchView('calendar');
    } else if (totalFound > 0) {
      btnScanTab.innerHTML = `${getSvgIcon('check', 'mr-1')}<span>+${totalFound}</span>`;
      btnScanTab.style.background = '#16a34a';
      showScanBanner(`Added ${totalFound} new deadline${totalFound > 1 ? 's' : ''} to calendar!`, 'success', 5000);
      switchView('calendar');
    } else if (totalUpdated > 0) {
      btnScanTab.innerHTML = `${getSvgIcon('check', 'mr-1')}<span>Updated</span>`;
      btnScanTab.style.background = '#0284c7';
      showScanBanner(`Updated ${totalUpdated} existing deadline${totalUpdated > 1 ? 's' : ''}!`, 'success', 5000);
      switchView('calendar');
    } else {
      btnScanTab.innerHTML = `${getSvgIcon('check', 'mr-1')}<span>Synced</span>`;
      btnScanTab.style.background = '#059669';
      showScanBanner(`Up to date. Scanned ${announcements.length + directTasks.length} items with no new deadlines.`, 'info', 4500);
    }

    // Keep the completion state visible for 4.5 seconds before returning to default state
    setTimeout(() => {
      btnScanTab.disabled = false;
      btnScanTab.style.background = '';
      btnScanTab.innerHTML = `${getSvgIcon('bolt', 'mr-1')}<span>Scan</span>`;
    }, 4500);

  } catch (err: any) {
    console.error('Scan failed:', err);
    btnScanTab.innerHTML = `${getSvgIcon('urgent', 'mr-1')}<span>Failed</span>`;
    showScanBanner(err?.message ? `Scan error: ${err.message}` : 'Scan failed. Make sure you are logged into Blackboard.', 'warning', 5000);
    setTimeout(() => {
      btnScanTab.disabled = false;
      btnScanTab.style.background = '';
      btnScanTab.innerHTML = `${getSvgIcon('bolt', 'mr-1')}<span>Scan</span>`;
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

    currentTasks = deduplicateTaskList(await addTask(newTask));
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
      addWeightHint.innerHTML = `${getSvgIcon('scale', 'mr-1')} <b>${escapeHtml(resolved.weightDisplay || '')}</b>: ${escapeHtml(resolved.syllabusNote || '')}`;
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

    persistTasksInBackground(currentTasks);

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
      editWeightHint.innerHTML = `${getSvgIcon('scale', 'mr-1')} <b>${escapeHtml(resolved.weightDisplay || '')}</b>: ${escapeHtml(resolved.syllabusNote || '')}`;
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

    recordLocalTombstone(editingTaskId);
    currentTasks = removeTaskLocal(editingTaskId);
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

  // Helper to toggle Blackboard Ultra Dark Theme and broadcast to active tabs
  async function setBlackboardDarkMode(enabled: boolean) {
    await saveSettings({ blackboardDarkMode: enabled });
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ blackboardDarkMode: enabled, darkModeEnabled: enabled });
    }
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      const notifyOrInjectTab = (tab: chrome.tabs.Tab) => {
        if (!tab.id) return;
        const tabId = tab.id;
        chrome.tabs.sendMessage(tabId, {
          action: 'toggleDarkMode',
          type: 'TOGGLE_BLACKBOARD_DARK_MODE',
          enabled
        }).catch(() => {
          if (enabled && chrome.scripting && tab.url && /(?:sharjah\.ac\.ae|blackboard\.com|^file:\/\/)/i.test(tab.url)) {
            chrome.scripting.insertCSS({
              target: { tabId, allFrames: true },
              files: ['blackboard-dark.css']
            }).catch(() => {});
            chrome.scripting.executeScript({
              target: { tabId, allFrames: true },
              files: ['blackboard-dark.js']
            }).catch(() => {});
          }
        });
      };

      // 1. Instantly notify active tab for zero-latency response
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        tabs?.forEach(notifyOrInjectTab);
      });
      // 2. Broadcast to all open tabs so background Blackboard pages update immediately
      chrome.tabs.query({}, tabs => {
        tabs?.forEach(notifyOrInjectTab);
      });
    }
  }

  // Live instant toggle for Blackboard Dark Mode
  const settingBbDarkToggle = document.getElementById('setting-blackboard-dark-mode') as HTMLInputElement | null;
  settingBbDarkToggle?.addEventListener('change', async () => {
    const isChecked = settingBbDarkToggle.checked;
    await setBlackboardDarkMode(isChecked);
    showToast(`Blackboard Dark Mode ${isChecked ? 'Enabled' : 'Disabled'}`);
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
    const hostedUrl = (document.getElementById('setting-hosted-url') as HTMLInputElement)?.value?.trim() || 'https://blackboarder.pages.dev';
    const selectedTheme = ((document.getElementById('setting-theme') as HTMLSelectElement)?.value || 'light') as 'light' | 'dark' | 'system';
    const bbDark = (document.getElementById('setting-blackboard-dark-mode') as HTMLInputElement)?.checked ?? true;

    const prevSettings = await getSettings();
    const prevSyncKey = prevSettings.syncKey;

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
      theme: selectedTheme,
      blackboardDarkMode: bbDark
    });

    await setBlackboardDarkMode(bbDark);

    if (syncKey && syncKey !== prevSyncKey) {
      await pullTasksFromFirebaseIfNewer();
    }

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
      rescanStatusMsg.textContent = 'Scan cache cleared! Next scan will evaluate all announcements.';
      rescanStatusMsg.style.color = '#16a34a';
    }
    alert('Scan cache has been cleared. Your next scan will examine all announcements from scratch and update existing tasks in place without resetting your data.');
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
    const hostedBase = (settings.hostedWebUrl || 'https://blackboarder.pages.dev').replace(/\/+$/, '');
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
    const [tombstones, coursesUpdatedAt] = await Promise.all([getLocalTombstones(), getCoursesUpdatedAt()]);
    const [fbRes, serverRes] = await Promise.all([
      pushTasksToFirebase(currentTasks, 'Extension Manual Sync', settings.syncKey, currentQuickLinks, tombstones, currentUserCourses, coursesUpdatedAt || undefined),
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
    const hostedBase = (settings.hostedWebUrl || 'https://blackboarder.pages.dev').replace(/\/+$/, '');
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
    const hostedBase = (settings.hostedWebUrl || 'https://blackboarder.pages.dev').replace(/\/+$/, '');
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

  // Course Manager Toolbar
  document.getElementById('btn-add-course')?.addEventListener('click', () => openCourseEditor());
  document.getElementById('btn-import-courses')?.addEventListener('click', openCourseImporter);
  document.getElementById('btn-export-courses')?.addEventListener('click', exportCoursesJson);
  document.getElementById('btn-reset-courses')?.addEventListener('click', handleResetCourses);

  // Course Editor Modal Events
  document.getElementById('btn-close-course-editor')?.addEventListener('click', closeCourseEditor);
  document.getElementById('btn-cancel-course-editor')?.addEventListener('click', closeCourseEditor);
  document.getElementById('modal-course-editor')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modal-course-editor')) closeCourseEditor();
  });
  document.getElementById('form-course-editor')?.addEventListener('submit', handleSaveCourse);
  document.getElementById('btn-add-schedule-slot')?.addEventListener('click', () => addScheduleSlotRow());
  document.getElementById('btn-add-syllabus-row')?.addEventListener('click', () => addSyllabusRow());

  // Quick Syllabus Text Paste
  document.getElementById('btn-parse-syllabus-paste')?.addEventListener('click', () => {
    const textarea = document.getElementById('editor-syllabus-paste-text') as HTMLTextAreaElement;
    if (!textarea || !textarea.value.trim()) return;
    const comps = parseSyllabusWeightsText(textarea.value);
    if (comps.length > 0) {
      const container = document.getElementById('course-editor-syllabus');
      if (container) container.innerHTML = '';
      comps.forEach(c => addSyllabusRow(c));
      updateEditorTotalWeight();
      showToast(`Parsed ${comps.length} grading components!`);
    } else {
      showToast('Could not detect syllabus weights from text.');
    }
  });

  // Editor Color Picker & Swatches
  const colorPickerEl = document.getElementById('editor-color-picker') as HTMLInputElement;
  const colorHexInputEl = document.getElementById('editor-color-hex') as HTMLInputElement;
  colorPickerEl?.addEventListener('input', () => {
    if (colorHexInputEl) colorHexInputEl.value = colorPickerEl.value;
    const dotEl = document.getElementById('editor-header-dot');
    if (dotEl) dotEl.style.backgroundColor = colorPickerEl.value;
  });
  colorHexInputEl?.addEventListener('input', () => {
    if (/^#([A-Fa-f0-9]{6})$/.test(colorHexInputEl.value)) {
      if (colorPickerEl) colorPickerEl.value = colorHexInputEl.value;
      const dotEl = document.getElementById('editor-header-dot');
      if (dotEl) dotEl.style.backgroundColor = colorHexInputEl.value;
    }
  });
  document.querySelectorAll('#editor-color-swatches .swatch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.getAttribute('data-color') || '#2563eb';
      if (colorPickerEl) colorPickerEl.value = color;
      if (colorHexInputEl) colorHexInputEl.value = color;
      const dotEl = document.getElementById('editor-header-dot');
      if (dotEl) dotEl.style.backgroundColor = color;
    });
  });

  // Course Importer Modal Events
  document.getElementById('btn-close-course-import')?.addEventListener('click', closeCourseImporter);
  document.getElementById('btn-cancel-banner-import')?.addEventListener('click', closeCourseImporter);
  document.getElementById('modal-course-import')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modal-course-import')) closeCourseImporter();
  });
  document.getElementById('tab-import-banner')?.addEventListener('click', () => switchImporterTab('banner'));
  document.getElementById('tab-import-json')?.addEventListener('click', () => switchImporterTab('json'));
  document.getElementById('btn-preview-banner')?.addEventListener('click', handlePreviewBanner);
  document.getElementById('btn-confirm-banner-import')?.addEventListener('click', handleConfirmBannerImport);
  document.getElementById('btn-confirm-json-import')?.addEventListener('click', handleConfirmJsonImport);
  document.getElementById('input-import-json-file')?.addEventListener('change', e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = evt => {
        const content = evt.target?.result as string;
        const textarea = document.getElementById('import-json-text') as HTMLTextAreaElement;
        if (textarea && content) {
          textarea.value = content;
        }
      };
      reader.readAsText(file);
    }
  });

  // Global Escape key listener to close modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const editorModal = document.getElementById('modal-course-editor');
      if (editorModal && editorModal.style.display !== 'none' && !editorModal.classList.contains('hidden')) {
        closeCourseEditor();
      }
      const importModal = document.getElementById('modal-course-import');
      if (importModal && importModal.style.display !== 'none' && !importModal.classList.contains('hidden')) {
        closeCourseImporter();
      }
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
    const [settings, tombstones, coursesUpdatedAt] = await Promise.all([getSettings(), getLocalTombstones(), getCoursesUpdatedAt()]);
    await pushTasksToFirebase(currentTasks, 'Chrome Extension', settings.syncKey, currentQuickLinks, tombstones, currentUserCourses, coursesUpdatedAt || undefined);
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
            description: text.trim() || t.description || '',
            sourceSnippet: text.trim() || t.sourceSnippet || '',
            notes: (t as any).notes || (t.description && t.description !== text.trim() ? t.description : ''),
            room: t.room,
            weight: t.weight,
            weightDisplay: t.weightDisplay,
            syllabusNote: t.syllabusNote,
            confidence: t.confidence ?? 1.0,
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
      if (area === 'local' && changes.bbs_user_courses) {
        currentUserCourses = (changes.bbs_user_courses.newValue as UserCourseConfig[]) || [];
        renderUserCoursesManager();
        renderLegend();
        updateCourseFilterOptions(currentTasks);
        refreshAllViews();
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
    const freshCourses = await getUserCourses();
    let viewsNeedUpdate = false;

    if (Array.isArray(freshCourses) && JSON.stringify(freshCourses) !== JSON.stringify(currentUserCourses)) {
      currentUserCourses = freshCourses;
      renderUserCoursesManager();
      renderLegend();
      updateCourseFilterOptions(currentTasks);
      viewsNeedUpdate = true;
    }

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
    // Ensure every user has a unique, isolated Sync Key on first run, recovering any existing student vault
    if (!currentSettings.syncKey) {
      let recoveredKey: string | null = null;
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
          const tabs = await chrome.tabs.query({ url: ['*://*.sharjah.ac.ae/*', '*://*.blackboard.com/*'] });
          for (const tab of tabs) {
            if (tab.id) {
              const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STUDENT_SYNC_VAULT' }).catch(() => null);
              if (res?.syncKey && typeof res.syncKey === 'string' && res.syncKey.trim()) {
                recoveredKey = normalizeRestoredSyncKey(res.syncKey.trim());
                break;
              }
            }
          }
        }
      } catch {}

      const keyToUse = recoveredKey || generateUniqueSyncKey();
      await saveSettings({ syncKey: keyToUse });
      currentSettings.syncKey = keyToUse;
      if (recoveredKey) {
        showToast('Restored your existing student account & sync key!');
      }
    }

    // Mirror sync key to Blackboard session vault for maximum durability
    if (currentSettings.syncKey && typeof chrome !== 'undefined' && chrome.tabs?.query) {
      chrome.tabs.query({ url: ['*://*.sharjah.ac.ae/*', '*://*.blackboard.com/*'] }).then(tabs => {
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'SET_STUDENT_SYNC_VAULT',
              syncKey: currentSettings.syncKey
            }).catch(() => {});
          }
        }
      }).catch(() => {});
    }

    // 3. Proactively pull freshest updates from Firebase Cloud BEFORE performing retroactive upgrades
    await pullTasksFromFirebaseIfNewer();
    currentTasks = deduplicateTaskList(currentTasks.filter(isValidTask));

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
      const seriesInfo = getTaskSeriesInfo(task, currentTasks);
      const resolved = resolveTaskWeight(
        courseName || courseCode,
        task.title,
        task.type,
        description || sourceSnippet,
        seriesInfo?.index
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

    currentTasks = deduplicateTaskList(currentTasks.filter(isValidTask));
    currentTasks.sort(compareTasksByTime);
    const rawLocalTasks = await getTasks();
    if (rawLocalTasks.length !== currentTasks.length) {
      updatedAny = true;
    }
    if (updatedAny) {
      await saveTasks(currentTasks);
      syncTasksToCloud(currentTasks, 'Retroactive Upgrades & Cleanup');
      refreshAllViews();
    }
  } catch (err) {
    console.warn('[Popup] Background data refresh encountered error:', err);
  }
}

async function initWalkthroughModal() {
  const modal = document.getElementById('modal-walkthrough');
  if (!modal) return;

  const btnClose = document.getElementById('btn-close-walkthrough');
  const btnNext = document.getElementById('btn-walkthrough-next');
  const btnBack = document.getElementById('btn-walkthrough-back');
  const btnSkip = document.getElementById('btn-walkthrough-skip');
  const btnReplay = document.getElementById('btn-replay-walkthrough');
  const keyDisplay = document.getElementById('wt-key-display');
  const btnCopyKey = document.getElementById('btn-wt-copy-key');
  const stepButtons = modal.querySelectorAll<HTMLButtonElement>('.walkthrough-step-btn');
  const panes = modal.querySelectorAll<HTMLDivElement>('.walkthrough-pane');

  let currentStep = 1;
  const totalSteps = 4;

  const settings = await getSettings();
  if (keyDisplay && settings.syncKey) {
    keyDisplay.textContent = settings.syncKey;
  }

  function setStep(step: number) {
    currentStep = Math.max(1, Math.min(totalSteps, step));

    stepButtons.forEach(btn => {
      const s = parseInt(btn.getAttribute('data-step') || '1', 10);
      btn.classList.toggle('active', s === currentStep);
    });

    panes.forEach(pane => {
      pane.classList.remove('active');
    });
    const activePane = document.getElementById(`walkthrough-pane-${currentStep}`);
    if (activePane) activePane.classList.add('active');

    if (btnBack) {
      btnBack.style.visibility = currentStep > 1 ? 'visible' : 'hidden';
    }

    if (btnNext) {
      btnNext.textContent = currentStep === totalSteps ? 'Get Started' : 'Next Step ->';
    }
  }

  function openModal() {
    if (!modal) return;
    getSettings().then(s => {
      if (keyDisplay && s.syncKey) keyDisplay.textContent = s.syncKey;
    }).catch(() => {});
    setStep(1);
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
  }

  function closeModal(markSeen: boolean = true) {
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.add('hidden');
    if (markSeen) {
      try {
        localStorage.setItem('bbs_walkthrough_seen', 'true');
      } catch {}
    }
  }

  btnNext?.addEventListener('click', () => {
    if (currentStep < totalSteps) {
      setStep(currentStep + 1);
    } else {
      closeModal(true);
      showToast('Welcome to Blackboarder! Ready to scan your courses.');
    }
  });

  btnBack?.addEventListener('click', () => {
    if (currentStep > 1) {
      setStep(currentStep - 1);
    }
  });

  btnSkip?.addEventListener('click', () => {
    closeModal(true);
  });

  btnClose?.addEventListener('click', () => {
    closeModal(true);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal(true);
  });

  stepButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const s = parseInt(btn.getAttribute('data-step') || '1', 10);
      setStep(s);
    });
  });

  btnCopyKey?.addEventListener('click', async () => {
    const s = await getSettings();
    const key = s.syncKey;
    if (key) {
      try {
        await navigator.clipboard.writeText(key);
        showToast(`Copied Sync Key: ${key}`);
      } catch {
        showToast(`Sync Key: ${key}`);
      }
    }
  });

  btnReplay?.addEventListener('click', () => {
    openModal();
  });

  // Check if first-time user
  const hasSeen = localStorage.getItem('bbs_walkthrough_seen');
  if (!hasSeen) {
    // Show automatically on first download/install
    openModal();
  }
}

function initExtensionUpdateSystem() {
  const versionBadge = document.getElementById('ext-version-badge');
  const localCommitEl = document.getElementById('ext-local-commit');
  const localDateEl = document.getElementById('ext-local-date');
  const updateBanner = document.getElementById('ext-update-banner');
  const commitBadge = document.getElementById('eub-commit-badge');
  const bannerTitle = document.getElementById('eub-title');
  const bannerDesc = document.getElementById('eub-desc');
  const btnDismiss = document.getElementById('btn-ext-update-dismiss');
  const btnLater = document.getElementById('btn-ext-update-later');
  const btnDownloadBanner = document.getElementById('btn-ext-download-update');
  const btnReloadBanner = document.getElementById('btn-ext-reload');
  const btnCheckManual = document.getElementById('btn-check-ext-update');
  const btnReloadSettings = document.getElementById('btn-reload-ext-settings');
  const btnDownloadSettings = document.getElementById('btn-download-ext-zip');
  const btnOpenGithub = document.getElementById('btn-open-github-repo');
  const statusPill = document.getElementById('ext-update-status-pill');
  const statusDesc = document.getElementById('ext-update-status-desc');

  if (versionBadge) versionBadge.textContent = 'v' + BUILD_INFO.version;
  if (localCommitEl) localCommitEl.textContent = BUILD_INFO.shortCommit;
  if (localDateEl) {
    try {
      const d = new Date(BUILD_INFO.timestamp);
      localDateEl.textContent = isNaN(d.getTime()) ? 'latest build' : d.toLocaleDateString();
    } catch {
      localDateEl.textContent = 'latest build';
    }
  }

  let latestRemoteSha: string | null = null;

  const openUrl = (url: string) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        chrome.tabs.create({ url });
        return;
      }
    } catch {}
    window.open(url, '_blank');
  };

  const downloadUpdatePackage = () => {
    const updateZipUrl = 'https://raw.githubusercontent.com/yvs1n/blackboarder/main/release/blackboarder-extension.zip';
    try {
      if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
        chrome.downloads.download({
          url: updateZipUrl,
          filename: 'blackboarder-extension.zip',
          conflictAction: 'overwrite',
          saveAs: false
        }, () => {
          if (chrome.runtime?.lastError) {
            openUrl(updateZipUrl);
          } else {
            showToast('Update zip downloaded! Run update.bat in your folder to apply in-place.');
          }
        });
        return;
      }
    } catch {}
    openUrl(updateZipUrl);
  };

  btnDownloadBanner?.addEventListener('click', downloadUpdatePackage);
  btnDownloadSettings?.addEventListener('click', downloadUpdatePackage);

  btnOpenGithub?.addEventListener('click', () => {
    openUrl('https://github.com/yvs1n/blackboarder');
  });

  const handleReloadClick = async () => {
    if (latestRemoteSha) {
      await acknowledgeExtensionUpdate(latestRemoteSha);
    }
    reloadExtension();
  };

  btnReloadBanner?.addEventListener('click', handleReloadClick);

  btnReloadSettings?.addEventListener('click', handleReloadClick);

  const dismissCurrentBanner = () => {
    if (updateBanner) updateBanner.style.display = 'none';
    if (latestRemoteSha) {
      dismissExtensionUpdate(latestRemoteSha);
    }
  };

  btnDismiss?.addEventListener('click', dismissCurrentBanner);
  btnLater?.addEventListener('click', dismissCurrentBanner);

  const performCheck = async (manual = false) => {
    if (manual) {
      if (statusPill) {
        statusPill.textContent = 'Checking...';
        statusPill.className = 'settings-pill pill-blue';
      }
      if (statusDesc) {
        statusDesc.textContent = 'Connecting to GitHub repository to check for latest commits...';
      }
    }

    try {
      const res = await checkExtensionUpdate(manual);
      if (res.updateAvailable && res.remote) {
        latestRemoteSha = res.remote.commit;
        if (!res.dismissed || manual) {
          if (updateBanner) updateBanner.style.display = 'flex';
          if (commitBadge) commitBadge.textContent = res.remote.shortCommit;
          if (bannerTitle) bannerTitle.textContent = 'New update available on GitHub';
          if (bannerDesc) {
            bannerDesc.textContent = `${res.remote.message}. Run update.bat in your folder for 1-click update, or click Download. Your data and Sync Key stay 100% intact.`;
          }
        }

        if (statusPill) {
          statusPill.textContent = 'Update Available';
          statusPill.className = 'settings-pill pill-orange';
        }
        if (statusDesc) {
          statusDesc.textContent = `New GitHub commit: ${res.remote.shortCommit} - "${res.remote.message}". Run update.bat or click Download Update. All tasks, courses, and Sync Key stay preserved.`;
        }

        if (manual) {
          showToast('New update found on GitHub!');
        }
      } else if (res.error) {
        if (statusPill) {
          statusPill.textContent = 'Offline';
          statusPill.className = 'settings-pill pill-gray';
        }
        if (statusDesc) {
          statusDesc.textContent = `Could not query GitHub (${res.error}).`;
        }
        if (manual) {
          showToast('Could not reach GitHub right now.');
        }
      } else {
        if (updateBanner) updateBanner.style.display = 'none';
        if (statusPill) {
          statusPill.textContent = 'Up to Date';
          statusPill.className = 'settings-pill pill-green';
        }
        if (statusDesc) {
          statusDesc.textContent = `Installed build: ${BUILD_INFO.shortCommit}. You are running the latest code from GitHub.`;
        }
        if (manual) {
          showToast('Blackboarder is up to date!');
        }
      }
    } catch (e) {
      if (manual) showToast('Failed to check for updates.');
    }
  };

  btnCheckManual?.addEventListener('click', () => performCheck(true));

  // Perform non-blocking check on popup launch
  setTimeout(() => performCheck(false), 350);
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
  // Load and render user courses synchronously from cache
  currentUserCourses = getCachedCoursesSync();
  renderUserCoursesManager();
  renderLegend();

  // Load and render academic quick links synchronously from cache
  currentQuickLinks = getCachedQuickLinksSync();
  renderQuickLinksBar();
  initQuickLinksModal();

  // Load and render deadlines synchronously from cache (<5ms)
  currentTasks = deduplicateTaskList(getCachedTasksSync().filter(isValidTask));
  currentTasks.sort(compareTasksByTime);

  // Render all views immediately so the popup appears instantly populated like on mobile
  refreshAllViews();
  switchView('calendar');

  // Initialize first-time setup walkthrough modal
  initWalkthroughModal();

  // Initialize extension GitHub update system
  initExtensionUpdateSystem();

  // Set up listeners for reactive updates
  setupStorageAndSyncListeners();

  // Run cloud pull and retroactive upgrades non-blockingly in the background
  refreshDataInBackground();
}

document.addEventListener('DOMContentLoaded', initApp);
