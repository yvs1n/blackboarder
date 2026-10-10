// ============================================================================
// Blackboarder iOS Widget (Lock Screen, Small & Medium Home Screen)
// Offline-Ready with Native Disk Caching
// ============================================================================

const BASE_URL = "https://yassinr-uossidekick.pages.dev/api/tasks";

// Enter your personal pairing key if paired (e.g. "BBS-ABC123"), or pass it
// via the widget parameter in iOS:
let SYNC_KEY = ""; 
if (typeof args !== "undefined" && args.widgetParameter && args.widgetParameter.trim()) {
  SYNC_KEY = args.widgetParameter.trim();
}

// ----------------------------------------------------------------------------
// Offline Cache Setup (Scriptable FileManager)
// ----------------------------------------------------------------------------
const fm = FileManager.local();
const cacheDir = fm.joinPath(fm.documentsDirectory(), "blackboarder_cache");
const keySlug = SYNC_KEY ? SYNC_KEY.replace(/[^a-zA-Z0-9_-]/g, "") : "default";
const cachePath = fm.joinPath(cacheDir, `tasks_${keySlug}.json`);

let res = null;
let isOffline = false;

// Attempt online fetch with quick timeout (4s) so poor signals don't hang iOS
const url = BASE_URL + (SYNC_KEY ? `?key=${encodeURIComponent(SYNC_KEY)}` : "");
try {
  const req = new Request(url);
  req.timeoutInterval = 4;
  res = await req.loadJSON();

  if (res && Array.isArray(res.tasks)) {
    // Write successful response to offline cache
    if (!fm.fileExists(cacheDir)) {
      fm.createDirectory(cacheDir, true);
    }
    fm.writeString(cachePath, JSON.stringify(res));
  } else {
    throw new Error("Invalid response format");
  }
} catch (netErr) {
  // Network failed or offline: fall back to local disk cache
  isOffline = true;
  if (fm.fileExists(cachePath)) {
    try {
      const cachedRaw = fm.readString(cachePath);
      res = JSON.parse(cachedRaw);
    } catch (parseErr) {
      res = null;
    }
  }
}

// ----------------------------------------------------------------------------
// Data Processing & Sorting
// ----------------------------------------------------------------------------
const allTasks = (res && Array.isArray(res.tasks) ? res.tasks : []).filter(
  t => t.status !== "completed" && t.status !== "dismissed"
);
const tasks = allTasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
const nextTask = tasks[0];

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function getCleanCourse(t) {
  let name = (t.courseName || t.courseCode || "Course").trim();
  name = name.replace(/\s*\(\d+[\s\d]*\)/g, "").trim();
  if (/calculus|calc/i.test(name)) return "Calculus 1";
  if (/intro.*comp|computer.*eng/i.test(name)) return "Intro to Comp";
  if (/phys.*lab/i.test(name)) return "Physics 1 Lab";
  if (/phys/i.test(name)) return "Physics 1";
  if (/english|eap/i.test(name)) return "English";
  if (/islamic/i.test(name)) return "Islamic";
  return name.split(/[-–|]/)[0].trim() || name;
}

function formatDay(t) {
  const d = new Date(t.dueDate);
  if (isNaN(d.getTime())) return "TBD";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const tomorrow = new Date();
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(t) {
  if (!t.hasSpecificTime) return "";
  const d = new Date(t.dueDate);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatDayAndTime(t) {
  const day = formatDay(t);
  const time = formatTime(t);
  return time ? `${day} • ${time}` : day;
}

function getLocation(t) {
  const type = (t.type || "").toLowerCase();
  // Only show room if NOT HW or Project
  if (type === "assignment" || type === "hw" || type === "project") return "";
  let r = (t.room || "").trim();
  if (!r) return "";
  r = r.replace(/^(?:room|rm)\s+/i, "");
  r = r.split(/\s*[\(\[,\-–—]\s*(?:men|bldg|building|hall)/i)[0].trim();
  return `📍 ${r}`;
}

function getPendingTypeSummary(taskList) {
  const counts = {};
  for (const t of taskList) {
    const raw = (t.type || "assignment").toLowerCase();
    const type = raw === "hw" ? "assignment" : raw;
    counts[type] = (counts[type] || 0) + 1;
  }
  const parts = [];
  if (counts.quiz) parts.push(`${counts.quiz} Quiz${counts.quiz > 1 ? "zes" : ""}`);
  if (counts.exam) parts.push(`${counts.exam} Exam${counts.exam > 1 ? "s" : ""}`);
  if (counts.assignment) parts.push(`${counts.assignment} HW`);
  if (counts.lab) parts.push(`${counts.lab} Lab${counts.lab > 1 ? "s" : ""}`);
  if (counts.project) parts.push(`${counts.project} Proj${counts.project > 1 ? "s" : ""}`);
  if (counts.other) parts.push(`${counts.other} Other`);
  return parts.join(" • ");
}

// ----------------------------------------------------------------------------
// Widget Construction
// ----------------------------------------------------------------------------
const widget = new ListWidget();
widget.url = "https://yassinr-uossidekick.pages.dev";
widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000); // 15-min auto refresh

if (config.runsInAccessoryWidget) {
  // ==========================================================================
  // LOCK SCREEN WIDGET (Course Name, Title, Day & Time, Location)
  // ==========================================================================
  if (!nextTask) {
    const empty = widget.addText(isOffline ? "Offline • No cache" : "No pending deadlines 🎉");
    empty.font = Font.systemFont(12);
  } else {
    const courseName = getCleanCourse(nextTask);
    const loc = getLocation(nextTask);
    const dayAndTime = formatDayAndTime(nextTask);

    // Line 1: Course + Location (dynamic scaling prevents truncation)
    const line1Text = loc ? `${courseName} • ${loc}` : courseName;
    const line1 = widget.addText(line1Text);
    line1.font = Font.boldSystemFont(10.5);
    line1.lineLimit = 1;
    line1.minimumScaleFactor = 0.65;

    // Line 2: What the due date is (title)
    const line2 = widget.addText(nextTask.title);
    line2.font = Font.systemFont(12);
    line2.lineLimit = 1;
    line2.minimumScaleFactor = 0.75;

    // Line 3: Day and time due
    const line3 = widget.addText(dayAndTime);
    line3.font = Font.caption2();
    line3.lineLimit = 1;
    line3.minimumScaleFactor = 0.75;
  }
} else {
  // ==========================================================================
  // HOME SCREEN WIDGET (Invisible Table Grid: 3 on Medium, 2 on Small)
  // ==========================================================================
  widget.backgroundColor = new Color("#0f172a");

  const isMedium = config.widgetFamily === "medium";
  const isLarge = config.widgetFamily === "large";
  
  // Padding & spacing adjustments
  widget.setPadding(10, 14, 10, 14);

  // 1. Header: Blackboarder title (+ subtle offline indicator) + Pending summary
  const header = widget.addStack();
  header.centerAlignContent();
  
  const title = header.addText("Blackboarder");
  title.font = Font.boldSystemFont(11.5);
  title.textColor = new Color("#94a3b8");

  if (isOffline) {
    header.addSpacer(4);
    const cachedBadge = header.addText("cached");
    cachedBadge.font = Font.systemFont(9);
    cachedBadge.textColor = new Color("#64748b");
  }

  header.addSpacer();

  const typeSummary = getPendingTypeSummary(tasks);
  if (typeSummary && (isMedium || isLarge)) {
    // In Medium/Large: place pending summary directly on the top-right
    const summaryText = header.addText(typeSummary);
    summaryText.font = Font.semiboldSystemFont(10);
    summaryText.textColor = new Color("#38bdf8");
  }

  // In Small widget: put pending summary below the title
  if (!isMedium && !isLarge && typeSummary) {
    widget.addSpacer(2);
    const summaryText = widget.addText(typeSummary);
    summaryText.font = Font.semiboldSystemFont(9.5);
    summaryText.textColor = new Color("#38bdf8");
    summaryText.lineLimit = 1;
    summaryText.minimumScaleFactor = 0.75;
  }

  widget.addSpacer(isMedium ? 6 : 7);

  // 2. Invisible Table Grid (3 items for Medium, 2 for Small, 5 for Large)
  const maxItems = isLarge ? 5 : (isMedium ? 3 : 2);
  const upcoming = tasks.slice(0, maxItems);

  if (upcoming.length === 0) {
    const empty = widget.addText(isOffline ? "Offline • No cache yet" : "All caught up! 🎉");
    empty.font = Font.mediumSystemFont(12);
    empty.textColor = new Color("#cbd5e1");
  } else {
    for (let i = 0; i < upcoming.length; i++) {
      const t = upcoming[i];
      const loc = getLocation(t);
      const dayStr = formatDay(t);
      const timeStr = formatTime(t);

      // Table Row Container
      const tableRow = widget.addStack();
      tableRow.layoutHorizontally();
      tableRow.centerAlignContent();

      // Column 1 (Left Column): Course on top, Title & Room on bottom
      const colLeft = tableRow.addStack();
      colLeft.layoutVertically();

      const courseRow = colLeft.addStack();
      courseRow.centerAlignContent();
      const dot = courseRow.addText("● ");
      dot.font = Font.boldSystemFont(9);
      dot.textColor = new Color(t.courseColor || "#60a5fa");

      const courseText = courseRow.addText(getCleanCourse(t));
      courseText.font = Font.boldSystemFont(11);
      courseText.textColor = new Color("#f1f5f9");
      courseText.lineLimit = 1;
      courseText.minimumScaleFactor = 0.8;

      const subStr = loc ? `${t.title} • ${loc}` : t.title;
      const subText = colLeft.addText(subStr);
      subText.font = Font.systemFont(10);
      subText.textColor = new Color("#94a3b8");
      subText.lineLimit = 1;
      subText.minimumScaleFactor = 0.7;

      // Space between Column 1 and Column 2
      tableRow.addSpacer();

      // Column 2 (Right Column): Date on top, Time on bottom (Right-aligned)
      const colRight = tableRow.addStack();
      colRight.layoutVertically();

      const dateText = colRight.addText(dayStr);
      dateText.font = Font.semiboldSystemFont(10.5);
      dateText.textColor = new Color("#e2e8f0");
      dateText.rightAlignText();
      dateText.lineLimit = 1;
      dateText.minimumScaleFactor = 0.8;

      if (timeStr) {
        const timeText = colRight.addText(timeStr);
        timeText.font = Font.systemFont(10);
        timeText.textColor = new Color("#38bdf8");
        timeText.rightAlignText();
        timeText.lineLimit = 1;
      }

      if (i < upcoming.length - 1) {
        widget.addSpacer(isMedium ? 5 : 7);
      }
    }
  }
}

Script.setWidget(widget);
Script.complete();
