//#region src/types.ts
var e = {
	openRouterApiKey: "",
	openRouterModel: "google/gemini-3.8-flash",
	useAiExtraction: !1,
	jevApiKey: "",
	useJevClassification: !1,
	autoScanOnPageLoad: !0,
	badgeNotification: !0,
	reminderHoursBefore: 24,
	customDomains: [
		"blackboard.sharjah.ac.ae",
		"elearning.sharjah.ac.ae",
		"blackboard.com"
	],
	syncServerUrl: "http://localhost:3456",
	syncSecretKey: "",
	autoSyncMidnight: !0,
	autoSyncOnScan: !0,
	syncKey: "",
	hostedWebUrl: "https://blackboarder.pages.dev",
	theme: "light"
};
//#endregion
//#region src/utils/syncClient.ts
function t(e) {
	let t = (e || "http://localhost:3456").trim().replace(/\/+$/, "");
	return !t.startsWith("http://") && !t.startsWith("https://") && (t = `https://${t}`), /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(?::\d+)?/i.test(t) || (t = t.replace(/^http:\/\//i, "https://")), t;
}
async function n(n, r, i) {
	let a = r || e, o = t(a.syncServerUrl);
	if (o.includes(".pages.dev")) return {
		success: !0,
		message: "Synchronized via Firebase Cloud for Cloudflare Pages dashboard",
		count: n.length,
		lastSync: (/* @__PURE__ */ new Date()).toISOString()
	};
	try {
		let e = await fetch(`${o}/api/sync`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...a.syncSecretKey ? { "x-sync-secret": a.syncSecretKey } : {}
			},
			body: JSON.stringify({
				tasks: n,
				device: "Chrome Extension",
				timestamp: (/* @__PURE__ */ new Date()).toISOString(),
				quickLinks: i || void 0
			})
		});
		if (!e.ok) {
			let t = await e.text().catch(() => "");
			return {
				success: !1,
				message: `Sync Server returned status ${e.status}: ${t}`
			};
		}
		let t = await e.json();
		return {
			success: !0,
			message: "Deadlines synchronized successfully",
			count: t.count || n.length,
			lastSync: t.lastSync
		};
	} catch {
		return {
			success: !1,
			message: `Could not connect to sync server at ${o}. Ensure server is running.`
		};
	}
}
var r = {
	apiKey: "AIzaSyD2cEybk7VtkON7-Q5p7YM5q5Dr9Znri9E",
	authDomain: "blackboard-sidekick.firebaseapp.com",
	databaseURL: "https://blackboard-sidekick-default-rtdb.asia-southeast1.firebasedatabase.app",
	projectId: "blackboard-sidekick",
	storageBucket: "blackboard-sidekick.firebasestorage.app",
	messagingSenderId: "799390689505",
	appId: "1:799390689505:web:c24bb79d67b5413029afa0"
}.databaseURL;
function i(e) {
	let t = (e || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
	return t ? `${r}/users/${t}/data.json` : `${r}/data.json`;
}
async function a(e, t = "Chrome Extension", n, r, a, o, s) {
	try {
		let c = (/* @__PURE__ */ new Date()).toISOString(), l = {
			tasks: e,
			lastSync: c,
			device: t,
			count: e.length,
			syncKey: n || void 0,
			quickLinks: r || void 0,
			courses: o || void 0,
			coursesUpdatedAt: s || void 0,
			tombstones: a || void 0
		}, u = i(n), d = await fetch(u, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(l)
		});
		if (!d.ok) {
			let e = await d.text().catch(() => "");
			return {
				success: !1,
				message: `Firebase error (${d.status}): ${e}`
			};
		}
		return {
			success: !0,
			message: `Synchronized ${e.length} deadlines with Firebase Cloud`,
			lastSync: c,
			count: e.length
		};
	} catch (e) {
		return {
			success: !1,
			message: `Could not connect to Firebase: ${e.message || e}`
		};
	}
}
async function o(e) {
	try {
		let t = i(e), n = await fetch(t, { cache: "no-store" });
		if (!n.ok) return {
			success: !1,
			tasks: [],
			error: `HTTP ${n.status}`
		};
		let r = await n.json();
		return !r || !Array.isArray(r.tasks) ? {
			success: !0,
			tasks: [],
			lastSync: void 0,
			quickLinks: r?.quickLinks,
			courses: r?.courses,
			coursesUpdatedAt: r?.coursesUpdatedAt,
			tombstones: r?.tombstones
		} : {
			success: !0,
			tasks: r.tasks,
			lastSync: r.lastSync,
			device: r.device,
			quickLinks: r.quickLinks,
			courses: r.courses,
			coursesUpdatedAt: r.coursesUpdatedAt,
			tombstones: r.tombstones
		};
	} catch (e) {
		return {
			success: !1,
			tasks: [],
			error: e.message || "Network error"
		};
	}
}
//#endregion
//#region src/core/userCourses.ts
function s(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function c(e) {
	let t = [];
	if (e.courseCode) {
		let n = e.courseCode.trim();
		t.push(s(n));
		let r = n.replace(/\s+/g, "");
		r !== n && t.push(s(r));
	}
	if (e.courseName) {
		let n = e.courseName.trim();
		e.id === "phy1" || n.toLowerCase() === "physics 1" ? t.push(`${s(n)}(?!\\s*lab)`) : t.push(s(n));
	}
	if (Array.isArray(e.aliases)) for (let n of e.aliases) {
		let e = n.trim();
		e && (/(?:\.\*|\\s\*|\(\?!|\[|\^|\$)/.test(e) ? t.push(e) : t.push(s(e)));
	}
	return t.length === 0 ? new RegExp(s(e.id || "general"), "i") : RegExp(`(?:${t.join("|")})`, "i");
}
var l = [
	{
		id: "compeng",
		courseCode: "1502101",
		courseName: "Introduction to Computer Eng.",
		crn: "12056",
		colorHex: "#7c7c7c",
		aliases: [
			"intro.*comp",
			"comp(?:uter)?\\s*eng",
			"هندسة.*حاسوب",
			"حاسوب",
			"1502 101 01",
			"1502 101",
			"1502101",
			"0402101",
			"0402102"
		],
		scheduleSlots: [{
			days: ["Tuesday", "Thursday"],
			startTime: "11:00",
			endTime: "12:15",
			room: "A8-103",
			location: "UOS Men's Campus, A8, 103",
			instructor: "Arain, Bilal"
		}],
		syllabus: [
			{
				id: "compeng_final",
				name: "Final Exam",
				type: "exam",
				totalWeight: 45,
				unitWeight: 45,
				note: "TBA (45%)",
				keywords: [
					"final\\s*exam",
					"final",
					"امتحان\\s*نهائي",
					"نهائي"
				]
			},
			{
				id: "compeng_midterm",
				name: "Midterm Exam",
				type: "exam",
				totalWeight: 30,
				unitWeight: 30,
				note: "TBA (30%)",
				keywords: [
					"midterm\\s*exam",
					"midterm",
					"امتحان\\s*نصفي",
					"نصفي",
					"منتصف"
				]
			},
			{
				id: "compeng_quizzes",
				name: "Quizzes",
				type: "quiz",
				totalWeight: 25,
				count: 3,
				unitWeight: 8.33,
				note: "Best 3 of 4 quizzes (average taken, ~8.33% each, 25% total, no HWs)",
				keywords: [
					"quiz",
					"كويز",
					"امتحان\\s*قصير"
				]
			}
		]
	},
	{
		id: "calc1",
		courseCode: "1440133",
		courseName: "Calculus I for Engineering",
		crn: "10806",
		colorHex: "#dc2626",
		aliases: [
			"calculus",
			"calc\\b",
			"حسبان",
			"1440 133 02",
			"1440 133",
			"1440133",
			"1440131",
			"0401101",
			"0401201"
		],
		scheduleSlots: [{
			days: ["Tuesday", "Thursday"],
			startTime: "12:30",
			endTime: "13:45",
			room: "A12-110",
			location: "UOS Men's Campus, A12, 110",
			instructor: "Al-Teraifi, Randa"
		}],
		syllabus: [
			{
				id: "calc1_final",
				name: "Final Exam",
				type: "exam",
				totalWeight: 40,
				unitWeight: 40,
				note: "On paper (40%)",
				keywords: [
					"final\\s*exam",
					"final",
					"امتحان\\s*نهائي",
					"نهائي"
				]
			},
			{
				id: "calc1_midterm",
				name: "Midterm Exam",
				type: "exam",
				totalWeight: 30,
				unitWeight: 30,
				note: "On paper (30%)",
				keywords: [
					"midterm\\s*exam",
					"midterm",
					"امتحان\\s*نصفي",
					"نصفي",
					"منتصف"
				]
			},
			{
				id: "calc1_quizzes",
				name: "Quizzes",
				type: "quiz",
				totalWeight: 20,
				count: 2,
				unitWeight: 10,
				note: "On paper, best 2 of 3 quizzes (10% each, 20% total)",
				keywords: [
					"quiz",
					"كويز",
					"امتحان\\s*قصير"
				]
			},
			{
				id: "calc1_assignments",
				name: "Homeworks",
				type: "assignment",
				totalWeight: 10,
				count: 3,
				unitWeight: 3.33,
				note: "Online, best 3 of 4 homeworks (~3.33% each, 10% total)",
				keywords: [
					"assignment",
					"hw",
					"homework",
					"واجب",
					"connect"
				]
			}
		]
	},
	{
		id: "eap",
		courseCode: "0202112",
		courseName: "English for Academic Purposes",
		crn: "10175",
		colorHex: "#525252",
		aliases: [
			"english",
			"eap\\b",
			"academic\\s*purposes",
			"academic\\s*english",
			"إنجليزي",
			"انجليزي",
			"0202 112 09",
			"0202 112",
			"0202112",
			"0202111"
		],
		scheduleSlots: [{
			days: ["Tuesday", "Thursday"],
			startTime: "14:00",
			endTime: "15:15",
			room: "A3-184",
			location: "UOS Men's Campus, A3, 184",
			instructor: "Manzol, Mutwakil"
		}],
		syllabus: [
			{
				id: "eap_final",
				name: "Final Exam",
				type: "exam",
				totalWeight: 40,
				unitWeight: 40,
				note: "Week 16 (40%)",
				keywords: [
					"final\\s*exam",
					"final",
					"نهائي"
				]
			},
			{
				id: "eap_midterm",
				name: "Midterm Exam",
				type: "exam",
				totalWeight: 20,
				unitWeight: 20,
				note: "Week 8 (20%)",
				keywords: [
					"midterm\\s*exam",
					"midterm",
					"نصفي",
					"منتصف"
				]
			},
			{
				id: "eap_quizzes",
				name: "Quizzes",
				type: "quiz",
				totalWeight: 20,
				count: 2,
				unitWeight: 10,
				note: "2 Quizzes: Quiz 1 in Wk 4, Quiz 2 in Wk 7 (10% each, 20% total)",
				keywords: ["quiz", "كويز"]
			},
			{
				id: "eap_essay",
				name: "Cause-Effect Essay",
				type: "assignment",
				totalWeight: 10,
				unitWeight: 10,
				note: "Week 12 Writing Assignment (10%)",
				keywords: [
					"essay",
					"cause.*effect",
					"writing\\s*assignment",
					"مقال"
				]
			},
			{
				id: "eap_employability",
				name: "Employability Skills",
				type: "assignment",
				totalWeight: 10,
				count: 5,
				unitWeight: 2,
				note: "5 Employability Tasks across Weeks 2-13 (2% each, 10% total)",
				keywords: [
					"employability",
					"skill",
					"task",
					"مهام",
					"مهارات"
				]
			}
		]
	},
	{
		id: "phy1lab",
		courseCode: "1430116",
		courseName: "Physics 1 Lab",
		crn: "10708",
		colorHex: "#4b99d2",
		aliases: [
			"physics.*lab",
			"phy(?:sics)?\\s*1\\s*lab",
			"مختبر.*فيزياء",
			"فيزياء.*عملي",
			"1430 116 11L",
			"1430 116",
			"1430116",
			"1430117",
			"0401116",
			"measuring\\s*density",
			"free\\s*fall",
			"student'?s\\s*lab"
		],
		scheduleSlots: [{
			days: ["Wednesday"],
			startTime: "14:00",
			endTime: "16:45",
			room: "Central Lab Men - 105",
			location: "UOS Men's Campus, Central Laboratories (Men), 105",
			instructor: "Khudada Mohamed, Abdulraheem"
		}],
		syllabus: [
			{
				id: "phy1lab_final",
				name: "Final Examination",
				type: "exam",
				totalWeight: 40,
				unitWeight: 40,
				note: "Practical Final Exam during last week (40%)",
				keywords: [
					"final\\s*exam",
					"final",
					"امتحان\\s*نهائي",
					"نهائي",
					"عملي"
				]
			},
			{
				id: "phy1lab_quizzes",
				name: "Lab Quizzes",
				type: "quiz",
				totalWeight: 30,
				count: 3,
				unitWeight: 10,
				note: "4 scheduled, top 3 counted (10% each, 30% total)",
				keywords: ["quiz", "كويز"]
			},
			{
				id: "phy1lab_reports",
				name: "Experiments & Lab Reports",
				type: "lab",
				totalWeight: 30,
				count: 9,
				unitWeight: 3.33,
				note: "9 Weekly lab reports (approx 3.33% each, 30% total)",
				keywords: [
					"report",
					"experiment",
					"تقرير",
					"تجربة",
					"مختبر"
				]
			}
		]
	},
	{
		id: "phy1",
		courseCode: "1430115",
		courseName: "Physics 1",
		crn: "10668",
		colorHex: "#4b99d2",
		aliases: [
			"physics\\s*1(?!\\s*lab)",
			"general\\s*physics\\s*1",
			"فيزياء\\s*1(?!\\s*عملي)",
			"فيزياء\\s*عامة\\s*1",
			"1430 115 02",
			"1430 115",
			"1430115",
			"1430111",
			"0401115"
		],
		scheduleSlots: [{
			days: ["Monday", "Wednesday"],
			startTime: "11:00",
			endTime: "12:15",
			room: "A8-110",
			location: "UOS Men's Campus, A8, 110",
			instructor: "Ahriche, Amine"
		}],
		syllabus: [
			{
				id: "phy1_final",
				name: "Final Exam",
				type: "exam",
				totalWeight: 45,
				unitWeight: 45,
				note: "Final Examination (45 marks)",
				keywords: [
					"final\\s*exam",
					"final",
					"امتحان\\s*نهائي",
					"نهائي"
				]
			},
			{
				id: "phy1_midterm",
				name: "Midterm Exam",
				type: "exam",
				totalWeight: 25,
				unitWeight: 25,
				note: "Midterm Exam (25 marks)",
				keywords: [
					"midterm\\s*exam",
					"midterm",
					"امتحان\\s*نصفي",
					"نصفي",
					"منتصف"
				]
			},
			{
				id: "phy1_quizzes",
				name: "Quizzes",
				type: "quiz",
				totalWeight: 20,
				unitWeight: 20,
				note: "Quizzes throughout semester (average = 20 marks)",
				keywords: [
					"quiz",
					"كويز",
					"امتحان\\s*قصير"
				]
			},
			{
				id: "phy1_assignments",
				name: "Assignments",
				type: "assignment",
				totalWeight: 10,
				unitWeight: 10,
				note: "Assignments / Homework (10 marks total)",
				keywords: [
					"assignment",
					"hw",
					"homework",
					"واجب"
				]
			}
		]
	},
	{
		id: "islamic",
		courseCode: "0104100",
		courseName: "Islamic Culture",
		crn: "10475",
		colorHex: "#489160",
		aliases: [
			"islamic",
			"ثقافة\\s*إسلامية",
			"ثقافة\\s*اسلامية",
			"إسلام",
			"اسلام",
			"0104 100 13A",
			"0104 100",
			"0104100",
			"0104101"
		],
		scheduleSlots: [{
			days: ["Monday", "Wednesday"],
			startTime: "17:00",
			endTime: "18:15",
			room: "A8-TH005",
			location: "UOS Men's Campus, A8, TH005",
			instructor: "Haq, Zia Ul"
		}],
		syllabus: [
			{
				id: "islamic_final",
				name: "Final Exam",
				type: "exam",
				totalWeight: 50,
				unitWeight: 50,
				note: "Comprehensive final exam (50%)",
				keywords: [
					"final\\s*exam",
					"final",
					"امتحان\\s*نهائي",
					"نهائي"
				]
			},
			{
				id: "islamic_midterm",
				name: "Midterm Exam",
				type: "exam",
				totalWeight: 25,
				unitWeight: 25,
				note: "Midterm exam (25%)",
				keywords: [
					"midterm\\s*exam",
					"midterm",
					"امتحان\\s*نصفي",
					"نصفي",
					"منتصف"
				]
			},
			{
				id: "islamic_coursework",
				name: "Coursework & Research",
				type: "project",
				totalWeight: 25,
				unitWeight: 15,
				note: "واجبات، تقارير، مشروعات، امتحانات قصيرة (25% total)",
				keywords: [
					"بحث",
					"مشروع",
					"تقرير",
					"واجب",
					"عرض",
					"project",
					"research",
					"assignment",
					"report",
					"quiz",
					"كويز"
				]
			}
		]
	}
], u = [...l];
function d() {
	return u;
}
function f(e) {
	u = Array.isArray(e) && e.length > 0 ? e : [...l];
}
//#endregion
//#region src/core/courseHelper.ts
function p(e) {
	let t = (e.courseName || "").trim(), n = (e.courseCode || "").trim(), r = (e.title || "").trim();
	if (/measuring\s*density/i.test(t) || /measuring\s*density/i.test(r) || /free\s*fall/i.test(t) || /free\s*fall/i.test(r) || /vectors?\s*exp/i.test(t) || /vectors?\s*exp/i.test(r) || /lab\.?\s*report/i.test(t) || /student's\s*lab/i.test(t) ? (t = "Physics 1 Lab", n = "1430116") : /topic\s*of\s*a\s*paragraph/i.test(t) || /topic\s*of\s*a\s*paragraph/i.test(r) ? (t = "English for Academic Purposes", n = "0202112") : t = t.replace(/(?:Report)?Due\s*date:.*$/gi, "").replace(/New\s*Group\s*\d+/gi, "").replace(/\(UTC[+-]?\d+\)/gi, "").replace(/^[:\-–—|\s]+|[:\-–—|\s]+$/g, "").trim(), !t || t.toLowerCase() === "uos" || t.toLowerCase() === "course" || t.toLowerCase() === "general course" || t === n) {
		let i = `${n} ${t} ${r} ${e.description || ""} ${e.sourceSnippet || ""} ${e.notes || ""}`, a = d(), o = !1;
		if (/(?:phys(?:ics)?.*lab|lab.*phys(?:ics)?|مختبر.*فيزياء|1430116)/i.test(i)) {
			let e = a.find((e) => e.id === "phy1lab" || /lab/i.test(e.courseName));
			e && (t = e.courseName, n = e.courseCode, o = !0);
		}
		if (!o) {
			for (let e of a) if (!(e.id === "phy1" && /(?:lab|مختبر|عملي)/i.test(i)) && c(e).test(i)) {
				t = e.courseName, n = e.courseCode, o = !0;
				break;
			}
		}
		o || (/(?:intro.*comp|comp(?:uter)?\s*eng|هندسة.*حاسوب|حاسوب|1502101|0402101)/i.test(i) ? (t = "Introduction to Computer Eng.", n = "1502101") : /(?:calculus|calc\b|حسبان|1440133|1440131|0401101)/i.test(i) ? (t = "Calculus I for Engineering", n = "1440133") : /(?:english|eap\b|academic\s*purposes|academic\s*english|إنجليزي|انجليزي|0202112)/i.test(i) ? (t = "English for Academic Purposes", n = "0202112") : /(?:phys(?:ics)?.*lab|lab.*phys(?:ics)?|مختبر.*فيزياء|1430116)/i.test(i) ? (t = "Physics 1 Lab", n = "1430116") : /(?:physics\s*1(?!\s*lab)|general\s*physics\s*1|فيزياء\s*1|1430115)/i.test(i) ? (t = "Physics 1", n = "1430115") : /(?:islamic|إسلام|اسلام|ثقافة|0104100)/i.test(i) && (t = "Islamic Culture", n = "0104100"));
	}
	let i = !t || t.toLowerCase() === "uos" ? "General Course" : t;
	return {
		courseName: i,
		courseCode: n && n.toUpperCase() !== "UOS" && n !== i ? n : ""
	};
}
//#endregion
//#region src/utils/taskMerge.ts
function m(e) {
	return new Date(e.updatedAt || e.createdAt || 0).getTime() || 0;
}
function h(e = {}, t = {}) {
	let n = { ...e };
	for (let [e, r] of Object.entries(t)) {
		let t = n[e];
		(!t || new Date(r).getTime() > new Date(t).getTime()) && (n[e] = r);
	}
	return n;
}
function g(e, t) {
	let n = t[e.id];
	if (!n) return !1;
	let r = new Date(n).getTime();
	return !isNaN(r) && r >= m(e);
}
var _ = [
	"room",
	"notes",
	"weight",
	"weightDisplay",
	"syllabusNote"
], ee = [
	"courseName",
	"courseCode",
	"notes",
	"room",
	"description",
	"sourceSnippet",
	"weight",
	"weightDisplay",
	"syllabusNote"
];
function te(e, t) {
	let n = {
		...e,
		...t,
		courseName: t.courseName || e.courseName,
		courseCode: t.courseCode === void 0 ? e.courseCode : t.courseCode,
		title: t.title || e.title,
		dueDate: t.dueDate || e.dueDate,
		type: t.type || e.type,
		priority: t.priority || e.priority,
		status: t.status || e.status,
		updatedAt: t.updatedAt || e.updatedAt
	};
	(t.userEdited || e.userEdited) && (n.userEdited = !0);
	for (let e of _) t[e] === void 0 && (n[e] = void 0);
	return n;
}
function ne(e, t, n) {
	let r = { ...e };
	(e.userEdited || t.userEdited) && (r.userEdited = !0);
	for (let n of ee) {
		let i = e[n], a = t[n];
		(i == null || i === "") && a != null && a !== "" && (r[n] = a);
	}
	return n && t.status && t.status !== e.status && (r.status = t.status), r;
}
function re(e, t, n = {}) {
	let r = /* @__PURE__ */ new Map(), i = !1;
	for (let t of e) {
		if (g(t, n)) {
			i = !0;
			continue;
		}
		r.set(t.id, t);
	}
	for (let e of t) {
		if (g(e, n)) continue;
		let t = r.get(e.id);
		if (!t) {
			r.set(e.id, e), i = !0;
			continue;
		}
		let a = m(t), o = m(e), s = o > a ? te(t, e) : ne(t, e, o === a);
		JSON.stringify(s) !== JSON.stringify(t) && (r.set(e.id, s), i = !0);
	}
	let a = Array.from(r.values()), o = se(a);
	return o.length !== a.length && (i = !0), {
		tasks: o.sort((e, t) => new Date(e.dueDate).getTime() - new Date(t.dueDate).getTime()),
		changed: i
	};
}
function ie(e) {
	let t = (e || "assignment").toLowerCase().trim();
	return t === "hw" || t === "homework" || t === "assignment" ? "assignment" : t === "quiz" || t === "test" ? "quiz" : t === "exam" || t === "midterm" || t === "final" ? "exam" : t === "lab" ? "lab" : t === "project" ? "project" : t;
}
function ae(e, t) {
	if (!e || !t) return !1;
	if (e.id === t.id || e.announcementId && t.announcementId && e.announcementId === t.announcementId) return !0;
	if (p(e).courseName.toLowerCase() !== p(t).courseName.toLowerCase()) return !1;
	let n = new Date(e.dueDate).getTime(), r = new Date(t.dueDate).getTime();
	if (isNaN(n) || isNaN(r)) return !1;
	let i = Math.abs(n - r), a = ie(e.type), o = ie(t.type), s = (e.title || "").toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, ""), c = (t.title || "").toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, ""), l = /^(?:assignment|homework|hw|due|duedate|task|untitled)$/i.test(e.title.trim()), u = /^(?:assignment|homework|hw|due|duedate|task|untitled)$/i.test(t.title.trim());
	return !!(i <= 3e5 && (l || u || a === o || s && c && (s === c || s.includes(c) || c.includes(s))) || new Date(e.dueDate).toISOString().slice(0, 10) === new Date(t.dueDate).toISOString().slice(0, 10) && s && c && (s === c || s.includes(c) || c.includes(s)) && (a === o || l || u));
}
function oe(e, t) {
	let n = !!(e.userEdited || t.userEdited), r = /^(?:assignment|homework|hw|due|duedate|task|untitled)$/i.test(e.title.trim()), i = /^(?:assignment|homework|hw|due|duedate|task|untitled)$/i.test(t.title.trim()), a = e.title;
	r && !i ? a = t.title : !r && !i && (a = e.title.length >= t.title.length ? e.title : t.title);
	let o = e.dueDate, s = e.hasSpecificTime;
	!e.hasSpecificTime && t.hasSpecificTime && (o = t.dueDate, s = !0);
	let c = e.status === "completed" || t.status === "completed" ? "completed" : e.status === "dismissed" ? "dismissed" : t.status, l = (e.description || "").length >= (t.description || "").length ? e.description : t.description, u = (e.sourceSnippet || "").length >= (t.sourceSnippet || "").length ? e.sourceSnippet : t.sourceSnippet, d = e.notes || t.notes || "", f = e.room || t.room, p = e.weight === void 0 ? t.weight : e.weight, m = e.weightDisplay || t.weightDisplay, h = e.syllabusNote || t.syllabusNote, g = e.id;
	return e.id.startsWith("stream_UOS_Assignment_") && !t.id.startsWith("stream_UOS_Assignment_") && (g = t.id), {
		...e,
		...t,
		id: g,
		title: a,
		dueDate: o,
		hasSpecificTime: s,
		status: c,
		description: l,
		sourceSnippet: u,
		notes: d,
		room: f,
		weight: p,
		weightDisplay: m,
		syllabusNote: h,
		userEdited: n,
		updatedAt: new Date(Math.max(new Date(e.updatedAt || e.createdAt || 0).getTime(), new Date(t.updatedAt || t.createdAt || 0).getTime(), Date.now())).toISOString()
	};
}
function se(e) {
	if (!e || e.length <= 1) return e || [];
	let t = [];
	for (let n of e) {
		if (!n || !n.title) continue;
		let e = t.findIndex((e) => ae(e, n));
		e === -1 ? t.push({ ...n }) : t[e] = oe(t[e], n);
	}
	return t.sort((e, t) => new Date(e.dueDate).getTime() - new Date(t.dueDate).getTime());
}
//#endregion
//#region node_modules/@typesafe-ai/sdk/dist/index.mjs
var v = (e) => e.get("x-typesafe-request-id") ?? void 0, ce = class e extends Promise {
	#e;
	#t;
	#n;
	constructor(e, t) {
		super((e) => e(void 0)), this.#e = e, this.#t = t;
	}
	asResponse() {
		return this.#e;
	}
	async withResponse() {
		let [e, t] = await Promise.all([this.#r(), this.#e]);
		return {
			data: e,
			response: t,
			requestId: v(t.headers)
		};
	}
	map(t) {
		return new e(this.#e, () => this.#r().then(t));
	}
	#r() {
		return this.#n ??= this.#e.then(this.#t), this.#n;
	}
	then(e, t) {
		return this.#r().then(e, t);
	}
	catch(e) {
		return this.#r().catch(e);
	}
	finally(e) {
		return this.#r().finally(e);
	}
}, y = {
	apiKey: "TYPESAFE_API_KEY",
	baseURL: "TYPESAFE_BASE_URL",
	defaultModel: "TYPESAFE_DEFAULT_MODEL",
	logLevel: "TYPESAFE_LOG_LEVEL"
}, b = (e) => {
	if (!(typeof process > "u" || !process.env)) return process.env[e]?.trim() || void 0;
}, x = (e, t) => e ?? b(t), S = {
	maxRetries: 2,
	backoffInitialMs: 500,
	backoffMaxMs: 5e3,
	backoffJitter: .25,
	httpStatuses: /* @__PURE__ */ new Set([
		408,
		429,
		...((e, t) => Array.from({ length: t - e }, (t, n) => e + n))(500, 600)
	]),
	respectRetryAfter: !0,
	maxRetryAfterMs: 6e4,
	apiConnectionError: !0,
	apiTimeoutError: !0
};
S.maxRetries;
var le = (e, t = S) => t.httpStatuses.has(e), C = (e, t = Date.now()) => {
	let n = Number(e.get("retry-after-ms"));
	if (e.has("retry-after-ms") && Number.isFinite(n) && n >= 0) return n;
	let r = e.get("retry-after");
	if (r === null) return;
	let i = Number(r);
	if (Number.isFinite(i)) return i >= 0 ? i * 1e3 : void 0;
	let a = Date.parse(r);
	if (!Number.isNaN(a)) return Math.max(0, a - t);
}, ue = (e, t, n = S, r = Math.random) => {
	if (n.respectRetryAfter && t !== void 0) {
		let e = C(t);
		if (e !== void 0 && e <= n.maxRetryAfterMs) return e;
	}
	let i = Math.min(n.backoffInitialMs * 2 ** e, n.backoffMaxMs);
	return Math.round(i * (1 - r() * n.backoffJitter));
}, de = (e, t) => new Promise((n, r) => {
	if (t?.aborted) return r(t.reason);
	let i = () => {
		clearTimeout(a), r(t?.reason);
	}, a = setTimeout(() => {
		t?.removeEventListener("abort", i), n();
	}, e);
	t?.addEventListener("abort", i, { once: !0 });
}), w = class extends Error {
	constructor(e, t) {
		super(e, t), this.name = new.target.name;
	}
}, T = (e) => typeof e == "object" && !!e, fe = (e) => {
	if (typeof e == "string") return e || void 0;
	if (!T(e)) return;
	let { error: t, message: n, detail: r } = e;
	if (typeof t == "string") return t;
	if (T(t) && typeof t.message == "string") return t.message;
	if (typeof n == "string") return n;
	if (typeof r == "string") return r;
	if (T(r) && typeof r.message == "string") return r.message;
	if (Array.isArray(r)) return pe(r);
}, pe = (e) => {
	let t = e.flatMap((e) => {
		if (!T(e) || typeof e.msg != "string") return [];
		let t = Array.isArray(e.loc) ? e.loc.filter((e) => e !== "body").join(".") : "";
		return [t ? `${t}: ${e.msg}` : e.msg];
	});
	return t.length > 0 ? t.join("; ") : void 0;
}, E = 200, D = class e extends w {
	status;
	headers;
	body;
	requestId;
	constructor(t, n, r, i) {
		super(i ?? e.describe(t, n)), this.status = t, this.body = n, this.headers = r, this.requestId = v(r);
	}
	static describe(e, t) {
		let n = fe(t);
		if (n) return `${e} ${n}`;
		if (t === void 0) return `${e} status code (no body)`;
		let r = typeof t == "string" ? t : JSON.stringify(t);
		return `${e} ${r.length > E ? `${r.slice(0, E)}…` : r}`;
	}
	static fromResponse(t, n, r) {
		return t === 400 ? new me(t, n, r) : t === 401 ? new he(t, n, r) : t === 403 ? new ge(t, n, r) : t === 404 ? new _e(t, n, r) : t === 422 ? new ve(t, n, r) : t === 429 ? new ye(t, n, r) : t >= 500 ? new be(t, n, r) : new e(t, n, r);
	}
}, me = class extends D {}, he = class extends D {}, ge = class extends D {}, _e = class extends D {}, ve = class extends D {}, ye = class extends D {
	retryAfterMs = C(this.headers);
}, be = class extends D {}, O = class extends w {
	constructor(e = "Connection error.", t) {
		super(e, t);
	}
}, k = class extends O {
	timeoutMs;
	constructor(e, t) {
		super(`Request timed out after ${e}ms.`, t), this.timeoutMs = e;
	}
}, A = class extends w {
	constructor(e = "Request was aborted.", t) {
		super(e, t);
	}
}, j = [
	"debug",
	"info",
	"warn",
	"error",
	"off"
], xe = "warn", Se = (e) => j.includes(e), M = (e, t) => {
	if (Se(e)) return e;
	throw new w(`Invalid log level "${e}" from ${t}. Expected one of: ${j.join(", ")}.`);
}, N = "[typesafe-sdk]", Ce = {
	debug: (e, ...t) => console.debug(`${N} ${e}`, ...t),
	info: (e, ...t) => console.info(`${N} ${e}`, ...t),
	warn: (e, ...t) => console.warn(`${N} ${e}`, ...t),
	error: (e, ...t) => console.error(`${N} ${e}`, ...t)
}, P = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	off: 4
}, F = () => {}, we = (e, t) => {
	let n = (e) => P[e] >= P[t];
	return {
		debug: n("debug") ? (t, ...n) => e.debug(t, ...n) : F,
		info: n("info") ? (t, ...n) => e.info(t, ...n) : F,
		warn: n("warn") ? (t, ...n) => e.warn(t, ...n) : F,
		error: n("error") ? (t, ...n) => e.error(t, ...n) : F
	};
}, Te = /* @__PURE__ */ new Set([
	"authorization",
	"proxy-authorization",
	"x-api-key"
]), Ee = /* @__PURE__ */ new Set(["cookie", "set-cookie"]), De = (e) => {
	let [t, n] = e.includes(" ") ? e.split(/\s+/, 2) : [void 0, e], r = n && n.length > 8 ? n.slice(-4) : "";
	return `${t ? `${t} ` : ""}***${r}`;
}, Oe = (e, t) => {
	let n = e.toLowerCase();
	return Te.has(n) ? De(t) : Ee.has(n) ? "***" : t;
}, ke = (e) => Object.fromEntries(Object.entries(e).map(([e, t]) => [e, Oe(e, t)])), I = (e = null, t) => ({
	type: "noul",
	instructions: e,
	criteria: t
}), Ae = (e, t) => {
	if (!Array.isArray(t)) throw new w("Score criteria must be a list of descriptions indexed by score from zero, not a map.");
	return {
		type: "score",
		instructions: e,
		criteria: t
	};
}, je = (e, t) => {
	if (Array.isArray(t)) throw new w("Choice criteria must be a map of labels to descriptions, not a list.");
	return {
		type: "choice",
		instructions: e,
		criteria: t
	};
}, Me = (e) => {
	if (Object.keys(e).length === 0) throw new w("At least one question is required.");
	for (let [t, n] of Object.entries(e)) if (n.type === "score") {
		if (!Array.isArray(n.criteria)) throw new w(`Score question "${t}" has criteria that are not a list; score criteria must be a list of descriptions indexed by score from zero.`);
		if (n.criteria.length < 2) throw new w(`Score question "${t}" has ${n.criteria.length} criteria; at least two scores are required.`);
	}
}, Ne = class {
	#e;
	constructor(e) {
		this.#e = e;
	}
	list(e = {}) {
		return this.#e.request("GET", "/v1/models", e).map(Pe);
	}
}, Pe = (e) => {
	if (Array.isArray(e?.models)) return e.models;
	throw new w("Unexpected response shape from GET /v1/models; expected { models: [...] }.");
}, L = globalThis, R = () => L.window !== void 0 && L.window.document !== void 0 && L.navigator !== void 0, Fe = () => {
	let e = L.process?.platform && L.process?.arch ? ` (${L.process.platform}; ${L.process.arch})` : "";
	return L.Bun?.version ? `bun/${L.Bun.version}${e}` : L.Deno?.version?.deno ? `deno/${L.Deno.version.deno}${e}` : L.EdgeRuntime === void 0 ? L.navigator?.userAgent === "Cloudflare-Workers" ? "cloudflare-workers" : L.process?.versions?.node ? `node/${L.process.versions.node}${e}` : R() ? "browser" : "unknown" : "vercel-edge";
}, z = "0.6.0", Ie = () => {
	throw new w(`No API key was provided. Pass \`apiKey\` to the TypeSafeClient constructor or set the ${y.apiKey} environment variable.`);
}, Le = () => {
	throw new w("No global `fetch` is available in this runtime. Pass a `fetch` implementation to the TypeSafeClient constructor.");
}, Re = () => {
	throw new w("TypeSafeClient is running in a browser, which would expose your API key to anyone using the page. Call the API from a server instead, or pass `dangerouslyAllowBrowser: true` if you understand the risk.");
}, ze = (e, t) => globalThis.fetch(e, t), Be = (e, t) => {
	if (!Number.isInteger(t) || t < 0) throw new w(`\`${e}\` must be a non-negative integer, got ${String(t)}.`);
	return t;
}, B = (e, t) => {
	if (!Number.isFinite(t) || t <= 0) throw new w(`\`${e}\` must be a positive number of milliseconds, got ${String(t)}.`);
	return t;
}, V = (e, t) => {
	if (!Number.isFinite(t) || t < 0) throw new w(`\`${e}\` must be a non-negative number of milliseconds, got ${String(t)}.`);
	return t;
}, Ve = (e, t) => {
	if (!Number.isFinite(t) || t < 0 || t > 1) throw new w(`\`${e}\` must be between 0 and 1, got ${String(t)}.`);
	return t;
}, He = (e, t) => {
	for (let n of t) if (!Number.isInteger(n) || n < 100 || n > 999) throw new w(`\`${e}\` must contain HTTP status codes, got ${String(n)}.`);
	return t;
}, H = (e, t) => {
	let n = t ?? {};
	return {
		maxRetries: n.maxRetries === void 0 ? e.maxRetries : Be("retry.maxRetries", n.maxRetries),
		backoffInitialMs: n.backoffInitialMs === void 0 ? e.backoffInitialMs : V("retry.backoffInitialMs", n.backoffInitialMs),
		backoffMaxMs: n.backoffMaxMs === void 0 ? e.backoffMaxMs : V("retry.backoffMaxMs", n.backoffMaxMs),
		backoffJitter: n.backoffJitter === void 0 ? e.backoffJitter : Ve("retry.backoffJitter", n.backoffJitter),
		httpStatuses: new Set(n.httpStatuses === void 0 ? e.httpStatuses : He("retry.httpStatuses", n.httpStatuses)),
		respectRetryAfter: n.respectRetryAfter ?? e.respectRetryAfter,
		maxRetryAfterMs: n.maxRetryAfterMs === void 0 ? e.maxRetryAfterMs : V("retry.maxRetryAfterMs", n.maxRetryAfterMs),
		apiConnectionError: n.apiConnectionError ?? e.apiConnectionError,
		apiTimeoutError: n.apiTimeoutError ?? e.apiTimeoutError
	};
}, Ue = (e, t) => e instanceof k ? t.apiTimeoutError : e instanceof O && t.apiConnectionError, We = (e) => {
	if (e !== void 0) return M(e, "the `logLevel` option");
	let t = b(y.logLevel);
	return t === void 0 ? xe : M(t, y.logLevel);
}, Ge = (e) => e.replace(/\/+$/, ""), U = (...e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n of e) for (let [e, r] of Object.entries(n)) r === void 0 ? t.delete(e.toLowerCase()) : t.set(e.toLowerCase(), [e, r]);
	return Object.fromEntries(t.values());
}, Ke = async (e, t) => {
	let n = e.clone().body?.getReader();
	if (!n) return;
	let r = () => {
		n.cancel(t.reason).catch(() => {}), e.body?.cancel(t.reason).catch(() => {});
	};
	t.addEventListener("abort", r, { once: !0 });
	try {
		for (t.aborted && r(), t.throwIfAborted(); !(await n.read()).done;) t.throwIfAborted();
		t.throwIfAborted();
	} finally {
		t.removeEventListener("abort", r), n.releaseLock();
	}
}, qe = Fe(), Je = class {
	#e;
	baseURL;
	defaultModel;
	logLevel;
	logger;
	retry;
	timeout;
	defaultHeaders;
	fetch;
	models;
	#t = 0;
	constructor(e = {}) {
		R() && !e.dangerouslyAllowBrowser && Re(), this.#e = x(e.apiKey, y.apiKey) ?? Ie(), this.baseURL = Ge(x(e.baseURL, y.baseURL) ?? "https://api.typesafe.ai"), this.defaultModel = x(e.defaultModel, y.defaultModel) ?? "jev-latest", this.logLevel = We(e.logLevel), this.logger = we(e.logger ?? Ce, this.logLevel), this.retry = H(S, e.retry), this.timeout = B("timeout", e.timeout ?? 1e4), this.defaultHeaders = { ...e.defaultHeaders }, e.fetch === void 0 && typeof globalThis.fetch != "function" && Le(), this.fetch = e.fetch ?? ze;
		let t = {
			request: (e, t, n) => this.#n(e, t, n),
			defaultModel: this.defaultModel
		};
		this.models = new Ne(t);
	}
	systemOne(e, t = {}) {
		Me(e.questions);
		let n = {
			...e,
			model: e.model ?? this.defaultModel
		};
		return this.#n("POST", "/v1/systemone", {
			...t,
			body: n
		});
	}
	#n(e, t, n = {}) {
		let r = {
			method: e,
			path: t,
			body: n.body,
			headers: U(this.defaultHeaders, n.headers ?? {}),
			signal: n.signal,
			timeout: n.timeout === void 0 ? this.timeout : B("timeout", n.timeout),
			retry: H(this.retry, n.retry)
		}, i = `#${++this.#t} ${e} ${t}`;
		return new ce(this.fetchWithRetries(i, r), async (e) => {
			let t = await W(e);
			return this.logger.debug(`${i} <- body`, t), t;
		});
	}
	async fetchWithRetries(e, t) {
		let n = `${this.baseURL}${t.path}`, r = U(t.headers, {
			Authorization: `Bearer ${this.#e}`,
			Accept: "application/json",
			"User-Agent": `typesafe-sdk/${z}`,
			"X-TypeSafe-SDK": `typesafe-sdk/${z}`,
			"X-TypeSafe-Runtime": qe,
			"Content-Type": t.body === void 0 ? void 0 : "application/json",
			"X-TypeSafe-Retry-Count": void 0
		}), i = t.body === void 0 ? void 0 : JSON.stringify(t.body);
		for (let a = 0;; a++) {
			let o = t.retry.maxRetries - a, s = a === 0 ? r : {
				...r,
				"X-TypeSafe-Retry-Count": String(a)
			};
			this.logger.debug(`${e} -> ${n}`, {
				headers: ke(s),
				body: t.body
			});
			let c = Date.now(), l;
			try {
				l = await this.attempt(e, n, {
					method: t.method,
					headers: s,
					body: i
				}, t);
			} catch (n) {
				if (n instanceof A || o <= 0 || !Ue(n, t.retry)) throw n;
				await this.backOff(e, a, o, n.message, void 0, t);
				continue;
			}
			let u = v(l.headers);
			if (this.logger.info(`${e} <- ${l.status} in ${Date.now() - c}ms${u ? ` (request ${u})` : ""}`), l.ok) return l;
			let d = await W(l);
			this.logger.debug(`${e} <- error body`, d);
			let f = D.fromResponse(l.status, d, l.headers);
			if (o <= 0 || !le(l.status, t.retry)) throw f;
			await this.backOff(e, a, o, `${l.status}`, l.headers, t);
		}
	}
	async attempt(e, t, n, { signal: r, timeout: i }) {
		let a = new AbortController(), o = () => a.abort(r?.reason);
		r?.aborted && o(), r?.addEventListener("abort", o, { once: !0 });
		let s = !1, c = setTimeout(() => {
			s = !0, a.abort();
		}, i), l = Date.now(), u = () => `${Date.now() - l}ms`;
		try {
			let e = await this.fetch(t, {
				...n,
				signal: a.signal
			});
			return await Ke(e, a.signal), e;
		} catch (t) {
			throw r?.aborted ? (this.logger.info(`${e} aborted by caller after ${u()}`), new A(void 0, { cause: t })) : s ? (this.logger.info(`${e} timed out after ${u()}`), new k(i, { cause: t })) : (this.logger.info(`${e} connection error after ${u()}`, t), new O(t instanceof Error ? `Connection error: ${t.message}` : void 0, { cause: t }));
		} finally {
			clearTimeout(c), r?.removeEventListener("abort", o);
		}
	}
	async backOff(e, t, n, r, i, { retry: a, signal: o }) {
		let s = ue(t, i, a), c = t + 1, l = t + n;
		this.logger.info(`${e} retrying in ${s}ms (retry ${c}/${l}) after ${r}`);
		try {
			await de(s, o);
		} catch (t) {
			throw this.logger.info(`${e} aborted by caller while waiting to retry`), new A(void 0, { cause: t });
		}
	}
}, W = async (e) => {
	let t = await e.text();
	if (t.length !== 0) {
		if ((e.headers.get("content-type") ?? "").includes("application/json")) try {
			return JSON.parse(t);
		} catch {
			return t;
		}
		try {
			return JSON.parse(t);
		} catch {
			return t;
		}
	}
}, G = {
	TASKS: "bbs_tasks",
	ANNOUNCEMENTS: "bbs_announcements",
	SETTINGS: "bbs_settings",
	LAST_SCANNED: "bbs_last_scanned",
	QUICK_LINKS: "bbs_quick_links",
	COURSES: "bbs_user_courses",
	COURSES_UPDATED_AT: "bbs_courses_updated_at"
};
function K() {
	try {
		return typeof chrome < "u" && !!chrome.runtime?.id && !!chrome.storage?.local;
	} catch {
		return !1;
	}
}
var Ye = /* @__PURE__ */ new Map();
function Xe() {
	try {
		return !(!(typeof localStorage < "u") || typeof window < "u" && typeof chrome < "u" && chrome.runtime?.id && (window.location?.protocol === "http:" || window.location?.protocol === "https:"));
	} catch {
		return !1;
	}
}
function q(e) {
	try {
		if (Xe()) return localStorage.getItem(e);
	} catch {}
	return Ye.get(e) || null;
}
function J(e, t) {
	try {
		if (Xe()) {
			localStorage.setItem(e, t);
			return;
		}
	} catch {}
	Ye.set(e, t);
}
function Ze() {
	let e = q(G.COURSES);
	if (e) try {
		let t = JSON.parse(e);
		if (Array.isArray(t) && t.length > 0) return t;
	} catch {}
	return l;
}
async function Y() {
	if (K()) try {
		return await new Promise((e) => {
			try {
				chrome.storage.local.get([G.COURSES], (t) => {
					try {
						if (chrome.runtime?.lastError) {
							let t = q(G.COURSES), n = t ? JSON.parse(t) : l, r = Array.isArray(n) && n.length > 0 ? n : l;
							f(r), e(r);
							return;
						}
						let n = t?.[G.COURSES], r = Array.isArray(n) && n.length > 0 ? n : l;
						J(G.COURSES, JSON.stringify(r)), f(r), e(r);
					} catch {
						let t = q(G.COURSES), n = t ? JSON.parse(t) : l, r = Array.isArray(n) && n.length > 0 ? n : l;
						f(r), e(r);
					}
				});
			} catch {
				let t = q(G.COURSES), n = t ? JSON.parse(t) : l, r = Array.isArray(n) && n.length > 0 ? n : l;
				f(r), e(r);
			}
		});
	} catch {}
	let e = q(G.COURSES);
	if (e) try {
		let t = JSON.parse(e);
		if (Array.isArray(t) && t.length > 0) return f(t), t;
	} catch {}
	return f(l), l;
}
async function Qe() {
	if (K()) try {
		return await new Promise((e) => {
			try {
				chrome.storage.local.get([G.COURSES_UPDATED_AT], (t) => {
					if (chrome.runtime?.lastError) {
						e(q(G.COURSES_UPDATED_AT));
						return;
					}
					e(t?.[G.COURSES_UPDATED_AT] || q(G.COURSES_UPDATED_AT) || null);
				});
			} catch {
				e(q(G.COURSES_UPDATED_AT));
			}
		});
	} catch {}
	return q(G.COURSES_UPDATED_AT);
}
async function $e(e, t) {
	let n = Array.isArray(e) && e.length > 0 ? e : l, r = t || (/* @__PURE__ */ new Date()).toISOString();
	if (J(G.COURSES, JSON.stringify(n)), J(G.COURSES_UPDATED_AT, r), f(n), K()) try {
		await new Promise((e) => {
			try {
				chrome.storage.local.set({
					[G.COURSES]: n,
					[G.COURSES_UPDATED_AT]: r
				}, () => e());
			} catch {
				e();
			}
		});
		return;
	} catch {}
}
try {
	let e = Ze();
	Array.isArray(e) && e.length > 0 && f(e);
} catch {}
//#endregion
//#region src/engine/jevClassifier.ts
async function et(e, t, n = 6e3) {
	let r = {
		isDeadline: !0,
		deadlineProbability: .5,
		category: "other",
		categoryConfidence: .5,
		priority: "medium",
		urgencyScore: 2
	};
	if (!t || !t.trim() || !e || !e.trim()) return r;
	if (typeof window < "u" && window.location && window.location.origin && window.location.protocol !== "chrome-extension:") try {
		let n = await fetch("/api/ai/classify", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				text: e,
				apiKey: t
			})
		});
		if (n.ok) {
			let e = await n.json();
			if (e && e.ok && e.data) {
				let t = e.data, n = t.is_deadline ?? t.isDeadline ?? !1, r = t.category || "other", i = typeof t.urgency == "number" ? t.urgency : 2.5, a = "medium";
				return i >= 4 ? a = "high" : i < 2 && (a = "low"), {
					isDeadline: n,
					deadlineProbability: n ? .95 : .05,
					category: r,
					categoryConfidence: .9,
					priority: a,
					urgencyScore: i,
					hasRoom: !!t.has_room,
					hasTime: !!t.has_time
				};
			}
		}
	} catch {}
	try {
		let r = new Je({
			apiKey: t.trim(),
			dangerouslyAllowBrowser: !0,
			timeout: n
		}), i = e.length > 1200 ? e.slice(0, 1200) : e, a = (await r.systemOne({
			state: i,
			questions: {
				is_deadline: I("Does this text announce or discuss a specific academic deadline, due date, quiz, exam, test, homework, lab, or academic submission?"),
				category: je("What type of academic task or event is described?", {
					quiz: "A quiz, pop quiz, short assessment, or test",
					exam: "A midterm exam, final exam, or major examination",
					assignment: "A homework assignment, problem set, essay, paper, or exercise",
					lab: "A laboratory session, lab report, lab experiment, or lab manual work",
					project: "A semester project, group project, milestone, presentation, or term project",
					not_a_task: "General announcement, lecture slides notice, office hours, syllabus info, or greetings with no upcoming assessment"
				}),
				urgency: Ae("How urgent or high-priority is this academic event?", [
					"Low priority or non-mandatory notice",
					"Standard homework or recurring reading",
					"Medium priority assignment or lab report",
					"High priority quiz or milestone",
					"Critical high-stakes midterm or final exam"
				]),
				has_room: I("Does this text specify a particular room number, hall, classroom, auditorium, or lab location to attend in (e.g. room A8-103, hall TH005, lab 105, Central Lab)?"),
				has_time: I("Does this text specify an explicit clock time or time range for the assessment (e.g. at 12:30 pm, from 11:00 to 12:15, الساعة 12:30)?")
			}
		})).answers, o = a.is_deadline?.noul ?? .5, s = a.category?.choice ?? "not_a_task", c = a.category?.confidence ?? .5, l = a.urgency?.score ?? 2, u = a.has_room?.noul ?? .5, d = a.has_time?.noul ?? .5, f = u >= .5, p = d >= .5, m = "medium";
		l >= 2.8 ? m = "high" : l < 1.3 && (m = "low");
		let h = s === "not_a_task", g = !h && o >= .35, _ = "other";
		return h ? _ = "not_a_task" : (s === "quiz" || s === "exam" || s === "assignment" || s === "lab" || s === "project") && (_ = s), {
			isDeadline: g,
			deadlineProbability: o,
			category: _,
			categoryConfidence: c,
			priority: m,
			urgencyScore: l,
			hasRoom: f,
			hasRoomProbability: u,
			hasTime: p,
			hasTimeProbability: d
		};
	} catch (e) {
		return console.warn("[Jev Classifier] Triage failed or timed out, falling back:", e), r;
	}
}
//#endregion
//#region src/background/serviceWorker.ts
var X = "bbs_check_deadlines", tt = "bbs_midnight_sync";
function nt() {
	let e = /* @__PURE__ */ new Date(), t = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1, 0, 0, 5).getTime();
	chrome.alarms.create(tt, {
		when: t,
		periodInMinutes: 1440
	}), console.log(`[Auto-Sync] Scheduled daily midnight sync for ${new Date(t).toLocaleString()}`);
}
async function Z() {
	try {
		let e = await chrome.storage.local.get(["bbs_settings", "bbs_tombstones"]), t = e.bbs_settings?.syncKey, n = await o(t);
		if (!n.success || !Array.isArray(n.tasks)) return !1;
		if (n.courses && Array.isArray(n.courses) && n.courses.length > 0) {
			let e = await Qe(), t = n.coursesUpdatedAt ? new Date(n.coursesUpdatedAt).getTime() : 0, r = e ? new Date(e).getTime() : 0;
			(!e || t > r) && await $e(n.courses, n.coursesUpdatedAt);
		}
		let r = (await chrome.storage.local.get(["bbs_tasks"])).bbs_tasks || [], i = e.bbs_tombstones || {}, a = h(i, n.tombstones || {});
		JSON.stringify(a) !== JSON.stringify(i) && await chrome.storage.local.set({ bbs_tombstones: a });
		let { tasks: s, changed: c } = re(r, n.tasks, a);
		return c ? (await chrome.storage.local.set({ bbs_tasks: s }), await Q(), console.log("[Background Sync] Pulled and merged latest deadlines & course changes from Firebase into storage"), !0) : !1;
	} catch (e) {
		return console.warn("[Background Sync] Failed pulling tasks from Firebase:", e), !1;
	}
}
async function rt() {
	try {
		await Z();
		let t = await chrome.storage.local.get([
			"bbs_tasks",
			"bbs_settings",
			"bbs_quick_links"
		]), r = t.bbs_tasks || [], i = t.bbs_settings || e;
		if (i.autoSyncMidnight === !1) return console.log("[Auto-Sync] Skipped: autoSyncMidnight is disabled in settings"), {
			ok: !1,
			reason: "disabled"
		};
		let o = (await chrome.storage.local.get(["bbs_tombstones"])).bbs_tombstones || {}, s = await Y(), c = await Qe(), [l, u] = await Promise.all([a(r, "Midnight Extension Sync", i.syncKey, t.bbs_quick_links, o, s, c || void 0), n(r, i, t.bbs_quick_links)]);
		return console.log("[Auto-Sync] Firebase Result:", l, "Server Result:", u), {
			ok: l.success || u.success,
			fbResult: l,
			serverResult: u
		};
	} catch (e) {
		return console.error("[Auto-Sync] Failed syncing to mobile server:", e), {
			ok: !1,
			error: e
		};
	}
}
async function Q() {
	try {
		let e = (await chrome.storage.local.get(["bbs_tasks"])).bbs_tasks || [], t = Date.now(), n = e.filter((e) => {
			if (e.status !== "pending") return !1;
			let n = (new Date(e.dueDate).getTime() - t) / 36e5;
			return n > -12 && n <= 48;
		});
		n.length > 0 ? (await chrome.action.setBadgeText({ text: String(n.length) }), await chrome.action.setBadgeBackgroundColor({ color: "#ef4444" })) : await chrome.action.setBadgeText({ text: "" });
	} catch (e) {
		console.error("Failed to update extension badge:", e);
	}
}
async function $() {
	try {
		let t = await chrome.storage.local.get([
			"bbs_tasks",
			"bbs_settings",
			"bbs_notified"
		]), n = t.bbs_tasks || [], r = t.bbs_settings || e, i = t.bbs_notified || {};
		if (!r.badgeNotification) return;
		let a = Date.now(), o = r.reminderHoursBefore * 3600 * 1e3;
		for (let e of n) {
			if (e.status !== "pending") continue;
			let t = new Date(e.dueDate).getTime() - a;
			if (t > 0 && t <= o && a - (i[e.id] || 0) > 432e5) {
				i[e.id] = a;
				let n = Math.round(t / 36e5), r = n <= 1 ? "under 1 hour" : `about ${n} hours`;
				chrome.notifications.create(`reminder_${e.id}`, {
					type: "basic",
					iconUrl: chrome.runtime.getURL("icons/icon128.png"),
					title: `[Urgent] Upcoming ${e.type.toUpperCase()}: ${e.title}`,
					message: `Due in ${r}! Course: ${e.courseCode} - ${e.courseName}`,
					priority: 2
				});
			}
		}
		await chrome.storage.local.set({ bbs_notified: i }), await Q();
	} catch (e) {
		console.error("Failed checking upcoming deadlines:", e);
	}
}
chrome.runtime.onInstalled.addListener(() => {
	chrome.alarms.create(X, { periodInMinutes: 30 }), nt(), Y().catch(() => {}), Z().then(() => Q());
}), chrome.storage.onChanged.addListener((e, t) => {
	t === "local" && e.bbs_user_courses && Y().catch(() => {});
}), chrome.alarms.onAlarm.addListener((e) => {
	e.name === X ? Z().then(() => $()) : e.name === tt && (rt(), nt());
}), chrome.runtime.onMessage.addListener((e, t, n) => e.type === "PROXY_JEV_CLASSIFY" || e.type === "CLASSIFY_JEV" ? (et(e.text, e.apiKey, e.timeoutMs).then((e) => n({
	ok: !0,
	result: e,
	data: e
})).catch((e) => n({
	ok: !1,
	error: String(e)
})), !0) : e.type === "PROXY_OPENROUTER_CHAT" ? (fetch("https://openrouter.ai/api/v1/chat/completions", {
	method: "POST",
	headers: {
		Authorization: `Bearer ${e.apiKey}`,
		"Content-Type": "application/json",
		"HTTP-Referer": "https://blackboarder.local",
		"X-Title": "Blackboarder Extension"
	},
	body: JSON.stringify(e.body)
}).then(async (e) => {
	let t = await e.json().catch(() => null);
	n({
		ok: e.ok,
		status: e.status,
		data: t
	});
}).catch((e) => {
	n({
		ok: !1,
		error: String(e)
	});
}), !0) : e.type === "PULL_FIREBASE" ? (Z().then((e) => n({
	ok: !0,
	changed: e
})).catch((e) => n({
	ok: !1,
	error: String(e)
})), !0) : e.type === "UPDATE_BADGE" ? (Q().then(() => n({ ok: !0 })).catch((e) => n({
	ok: !1,
	error: String(e)
})), !0) : e.type === "CHECK_DEADLINES" ? ($().then(() => n({ ok: !0 })).catch((e) => n({
	ok: !1,
	error: String(e)
})), !0) : e.type === "SYNC_TO_SERVER" ? (rt().then((e) => n(e)).catch((e) => n({
	ok: !1,
	error: String(e)
})), !0) : e.type === "OPEN_POPUP" && (chrome.action.openPopup?.().catch(() => {}), n({ ok: !0 }), !0));
//#endregion
export { Z as pullTasksFromFirebaseToLocal };
