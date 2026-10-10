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
	hostedWebUrl: "https://yassinr-uossidekick.pages.dev",
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
async function a(e, t = "Chrome Extension", n, a, o) {
	try {
		let s = (/* @__PURE__ */ new Date()).toISOString(), c = {
			tasks: e,
			lastSync: s,
			device: t,
			count: e.length,
			syncKey: n || void 0,
			quickLinks: a || void 0,
			tombstones: o || void 0
		}, l = i(n), u = await fetch(l, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(c)
		});
		if (!u.ok) {
			let e = await u.text().catch(() => "");
			return {
				success: !1,
				message: `Firebase error (${u.status}): ${e}`
			};
		}
		if (n && l !== `${r}/data.json`) try {
			await fetch(`${r}/data.json`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(c)
			});
		} catch (e) {
			console.warn("Firebase root mirror error:", e);
		}
		return {
			success: !0,
			message: `Synchronized ${e.length} deadlines with Firebase Cloud`,
			lastSync: s,
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
			tombstones: r?.tombstones
		} : {
			success: !0,
			tasks: r.tasks,
			lastSync: r.lastSync,
			device: r.device,
			quickLinks: r.quickLinks,
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
//#region src/utils/taskMerge.ts
function s(e) {
	return new Date(e.updatedAt || e.createdAt || 0).getTime() || 0;
}
function c(e = {}, t = {}) {
	let n = { ...e };
	for (let [e, r] of Object.entries(t)) {
		let t = n[e];
		(!t || new Date(r).getTime() > new Date(t).getTime()) && (n[e] = r);
	}
	return n;
}
function l(e, t) {
	let n = t[e.id];
	if (!n) return !1;
	let r = new Date(n).getTime();
	return !isNaN(r) && r >= s(e);
}
var u = [
	"room",
	"notes",
	"weight",
	"weightDisplay",
	"syllabusNote"
], d = [
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
function f(e, t) {
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
	for (let e of u) t[e] === void 0 && (n[e] = void 0);
	return n;
}
function p(e, t, n) {
	let r = { ...e };
	(e.userEdited || t.userEdited) && (r.userEdited = !0);
	for (let n of d) {
		let i = e[n], a = t[n];
		(i == null || i === "") && a != null && a !== "" && (r[n] = a);
	}
	return n && t.status && t.status !== e.status && (r.status = t.status), r;
}
function m(e, t, n = {}) {
	let r = /* @__PURE__ */ new Map(), i = !1;
	for (let t of e) {
		if (l(t, n)) {
			i = !0;
			continue;
		}
		r.set(t.id, t);
	}
	for (let e of t) {
		if (l(e, n)) continue;
		let t = r.get(e.id);
		if (!t) {
			r.set(e.id, e), i = !0;
			continue;
		}
		let a = s(t), o = s(e), c = o > a ? f(t, e) : p(t, e, o === a);
		JSON.stringify(c) !== JSON.stringify(t) && (r.set(e.id, c), i = !0);
	}
	return {
		tasks: Array.from(r.values()).sort((e, t) => new Date(e.dueDate).getTime() - new Date(t.dueDate).getTime()),
		changed: i
	};
}
//#endregion
//#region node_modules/@typesafe-ai/sdk/dist/index.mjs
var h = (e) => e.get("x-typesafe-request-id") ?? void 0, g = class e extends Promise {
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
			requestId: h(t.headers)
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
}, _ = {
	apiKey: "TYPESAFE_API_KEY",
	baseURL: "TYPESAFE_BASE_URL",
	defaultModel: "TYPESAFE_DEFAULT_MODEL",
	logLevel: "TYPESAFE_LOG_LEVEL"
}, v = (e) => {
	if (!(typeof process > "u" || !process.env)) return process.env[e]?.trim() || void 0;
}, y = (e, t) => e ?? v(t), b = {
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
b.maxRetries;
var ee = (e, t = b) => t.httpStatuses.has(e), x = (e, t = Date.now()) => {
	let n = Number(e.get("retry-after-ms"));
	if (e.has("retry-after-ms") && Number.isFinite(n) && n >= 0) return n;
	let r = e.get("retry-after");
	if (r === null) return;
	let i = Number(r);
	if (Number.isFinite(i)) return i >= 0 ? i * 1e3 : void 0;
	let a = Date.parse(r);
	if (!Number.isNaN(a)) return Math.max(0, a - t);
}, te = (e, t, n = b, r = Math.random) => {
	if (n.respectRetryAfter && t !== void 0) {
		let e = x(t);
		if (e !== void 0 && e <= n.maxRetryAfterMs) return e;
	}
	let i = Math.min(n.backoffInitialMs * 2 ** e, n.backoffMaxMs);
	return Math.round(i * (1 - r() * n.backoffJitter));
}, ne = (e, t) => new Promise((n, r) => {
	if (t?.aborted) return r(t.reason);
	let i = () => {
		clearTimeout(a), r(t?.reason);
	}, a = setTimeout(() => {
		t?.removeEventListener("abort", i), n();
	}, e);
	t?.addEventListener("abort", i, { once: !0 });
}), S = class extends Error {
	constructor(e, t) {
		super(e, t), this.name = new.target.name;
	}
}, C = (e) => typeof e == "object" && !!e, re = (e) => {
	if (typeof e == "string") return e || void 0;
	if (!C(e)) return;
	let { error: t, message: n, detail: r } = e;
	if (typeof t == "string") return t;
	if (C(t) && typeof t.message == "string") return t.message;
	if (typeof n == "string") return n;
	if (typeof r == "string") return r;
	if (C(r) && typeof r.message == "string") return r.message;
	if (Array.isArray(r)) return ie(r);
}, ie = (e) => {
	let t = e.flatMap((e) => {
		if (!C(e) || typeof e.msg != "string") return [];
		let t = Array.isArray(e.loc) ? e.loc.filter((e) => e !== "body").join(".") : "";
		return [t ? `${t}: ${e.msg}` : e.msg];
	});
	return t.length > 0 ? t.join("; ") : void 0;
}, w = 200, T = class e extends S {
	status;
	headers;
	body;
	requestId;
	constructor(t, n, r, i) {
		super(i ?? e.describe(t, n)), this.status = t, this.body = n, this.headers = r, this.requestId = h(r);
	}
	static describe(e, t) {
		let n = re(t);
		if (n) return `${e} ${n}`;
		if (t === void 0) return `${e} status code (no body)`;
		let r = typeof t == "string" ? t : JSON.stringify(t);
		return `${e} ${r.length > w ? `${r.slice(0, w)}…` : r}`;
	}
	static fromResponse(t, n, r) {
		return t === 400 ? new ae(t, n, r) : t === 401 ? new oe(t, n, r) : t === 403 ? new se(t, n, r) : t === 404 ? new ce(t, n, r) : t === 422 ? new le(t, n, r) : t === 429 ? new ue(t, n, r) : t >= 500 ? new de(t, n, r) : new e(t, n, r);
	}
}, ae = class extends T {}, oe = class extends T {}, se = class extends T {}, ce = class extends T {}, le = class extends T {}, ue = class extends T {
	retryAfterMs = x(this.headers);
}, de = class extends T {}, E = class extends S {
	constructor(e = "Connection error.", t) {
		super(e, t);
	}
}, D = class extends E {
	timeoutMs;
	constructor(e, t) {
		super(`Request timed out after ${e}ms.`, t), this.timeoutMs = e;
	}
}, O = class extends S {
	constructor(e = "Request was aborted.", t) {
		super(e, t);
	}
}, k = [
	"debug",
	"info",
	"warn",
	"error",
	"off"
], fe = "warn", pe = (e) => k.includes(e), A = (e, t) => {
	if (pe(e)) return e;
	throw new S(`Invalid log level "${e}" from ${t}. Expected one of: ${k.join(", ")}.`);
}, j = "[typesafe-sdk]", me = {
	debug: (e, ...t) => console.debug(`${j} ${e}`, ...t),
	info: (e, ...t) => console.info(`${j} ${e}`, ...t),
	warn: (e, ...t) => console.warn(`${j} ${e}`, ...t),
	error: (e, ...t) => console.error(`${j} ${e}`, ...t)
}, M = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	off: 4
}, N = () => {}, he = (e, t) => {
	let n = (e) => M[e] >= M[t];
	return {
		debug: n("debug") ? (t, ...n) => e.debug(t, ...n) : N,
		info: n("info") ? (t, ...n) => e.info(t, ...n) : N,
		warn: n("warn") ? (t, ...n) => e.warn(t, ...n) : N,
		error: n("error") ? (t, ...n) => e.error(t, ...n) : N
	};
}, ge = /* @__PURE__ */ new Set([
	"authorization",
	"proxy-authorization",
	"x-api-key"
]), _e = /* @__PURE__ */ new Set(["cookie", "set-cookie"]), P = (e) => {
	let [t, n] = e.includes(" ") ? e.split(/\s+/, 2) : [void 0, e], r = n && n.length > 8 ? n.slice(-4) : "";
	return `${t ? `${t} ` : ""}***${r}`;
}, F = (e, t) => {
	let n = e.toLowerCase();
	return ge.has(n) ? P(t) : _e.has(n) ? "***" : t;
}, I = (e) => Object.fromEntries(Object.entries(e).map(([e, t]) => [e, F(e, t)])), L = (e = null, t) => ({
	type: "noul",
	instructions: e,
	criteria: t
}), ve = (e, t) => {
	if (!Array.isArray(t)) throw new S("Score criteria must be a list of descriptions indexed by score from zero, not a map.");
	return {
		type: "score",
		instructions: e,
		criteria: t
	};
}, ye = (e, t) => {
	if (Array.isArray(t)) throw new S("Choice criteria must be a map of labels to descriptions, not a list.");
	return {
		type: "choice",
		instructions: e,
		criteria: t
	};
}, be = (e) => {
	if (Object.keys(e).length === 0) throw new S("At least one question is required.");
	for (let [t, n] of Object.entries(e)) if (n.type === "score") {
		if (!Array.isArray(n.criteria)) throw new S(`Score question "${t}" has criteria that are not a list; score criteria must be a list of descriptions indexed by score from zero.`);
		if (n.criteria.length < 2) throw new S(`Score question "${t}" has ${n.criteria.length} criteria; at least two scores are required.`);
	}
}, R = class {
	#e;
	constructor(e) {
		this.#e = e;
	}
	list(e = {}) {
		return this.#e.request("GET", "/v1/models", e).map(xe);
	}
}, xe = (e) => {
	if (Array.isArray(e?.models)) return e.models;
	throw new S("Unexpected response shape from GET /v1/models; expected { models: [...] }.");
}, z = globalThis, B = () => z.window !== void 0 && z.window.document !== void 0 && z.navigator !== void 0, Se = () => {
	let e = z.process?.platform && z.process?.arch ? ` (${z.process.platform}; ${z.process.arch})` : "";
	return z.Bun?.version ? `bun/${z.Bun.version}${e}` : z.Deno?.version?.deno ? `deno/${z.Deno.version.deno}${e}` : z.EdgeRuntime === void 0 ? z.navigator?.userAgent === "Cloudflare-Workers" ? "cloudflare-workers" : z.process?.versions?.node ? `node/${z.process.versions.node}${e}` : B() ? "browser" : "unknown" : "vercel-edge";
}, V = "0.6.0", Ce = () => {
	throw new S(`No API key was provided. Pass \`apiKey\` to the TypeSafeClient constructor or set the ${_.apiKey} environment variable.`);
}, we = () => {
	throw new S("No global `fetch` is available in this runtime. Pass a `fetch` implementation to the TypeSafeClient constructor.");
}, Te = () => {
	throw new S("TypeSafeClient is running in a browser, which would expose your API key to anyone using the page. Call the API from a server instead, or pass `dangerouslyAllowBrowser: true` if you understand the risk.");
}, Ee = (e, t) => globalThis.fetch(e, t), De = (e, t) => {
	if (!Number.isInteger(t) || t < 0) throw new S(`\`${e}\` must be a non-negative integer, got ${String(t)}.`);
	return t;
}, H = (e, t) => {
	if (!Number.isFinite(t) || t <= 0) throw new S(`\`${e}\` must be a positive number of milliseconds, got ${String(t)}.`);
	return t;
}, U = (e, t) => {
	if (!Number.isFinite(t) || t < 0) throw new S(`\`${e}\` must be a non-negative number of milliseconds, got ${String(t)}.`);
	return t;
}, Oe = (e, t) => {
	if (!Number.isFinite(t) || t < 0 || t > 1) throw new S(`\`${e}\` must be between 0 and 1, got ${String(t)}.`);
	return t;
}, ke = (e, t) => {
	for (let n of t) if (!Number.isInteger(n) || n < 100 || n > 999) throw new S(`\`${e}\` must contain HTTP status codes, got ${String(n)}.`);
	return t;
}, W = (e, t) => {
	let n = t ?? {};
	return {
		maxRetries: n.maxRetries === void 0 ? e.maxRetries : De("retry.maxRetries", n.maxRetries),
		backoffInitialMs: n.backoffInitialMs === void 0 ? e.backoffInitialMs : U("retry.backoffInitialMs", n.backoffInitialMs),
		backoffMaxMs: n.backoffMaxMs === void 0 ? e.backoffMaxMs : U("retry.backoffMaxMs", n.backoffMaxMs),
		backoffJitter: n.backoffJitter === void 0 ? e.backoffJitter : Oe("retry.backoffJitter", n.backoffJitter),
		httpStatuses: new Set(n.httpStatuses === void 0 ? e.httpStatuses : ke("retry.httpStatuses", n.httpStatuses)),
		respectRetryAfter: n.respectRetryAfter ?? e.respectRetryAfter,
		maxRetryAfterMs: n.maxRetryAfterMs === void 0 ? e.maxRetryAfterMs : U("retry.maxRetryAfterMs", n.maxRetryAfterMs),
		apiConnectionError: n.apiConnectionError ?? e.apiConnectionError,
		apiTimeoutError: n.apiTimeoutError ?? e.apiTimeoutError
	};
}, Ae = (e, t) => e instanceof D ? t.apiTimeoutError : e instanceof E && t.apiConnectionError, je = (e) => {
	if (e !== void 0) return A(e, "the `logLevel` option");
	let t = v(_.logLevel);
	return t === void 0 ? fe : A(t, _.logLevel);
}, Me = (e) => e.replace(/\/+$/, ""), G = (...e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n of e) for (let [e, r] of Object.entries(n)) r === void 0 ? t.delete(e.toLowerCase()) : t.set(e.toLowerCase(), [e, r]);
	return Object.fromEntries(t.values());
}, Ne = async (e, t) => {
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
}, Pe = Se(), Fe = class {
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
		B() && !e.dangerouslyAllowBrowser && Te(), this.#e = y(e.apiKey, _.apiKey) ?? Ce(), this.baseURL = Me(y(e.baseURL, _.baseURL) ?? "https://api.typesafe.ai"), this.defaultModel = y(e.defaultModel, _.defaultModel) ?? "jev-latest", this.logLevel = je(e.logLevel), this.logger = he(e.logger ?? me, this.logLevel), this.retry = W(b, e.retry), this.timeout = H("timeout", e.timeout ?? 1e4), this.defaultHeaders = { ...e.defaultHeaders }, e.fetch === void 0 && typeof globalThis.fetch != "function" && we(), this.fetch = e.fetch ?? Ee;
		let t = {
			request: (e, t, n) => this.#n(e, t, n),
			defaultModel: this.defaultModel
		};
		this.models = new R(t);
	}
	systemOne(e, t = {}) {
		be(e.questions);
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
			headers: G(this.defaultHeaders, n.headers ?? {}),
			signal: n.signal,
			timeout: n.timeout === void 0 ? this.timeout : H("timeout", n.timeout),
			retry: W(this.retry, n.retry)
		}, i = `#${++this.#t} ${e} ${t}`;
		return new g(this.fetchWithRetries(i, r), async (e) => {
			let t = await K(e);
			return this.logger.debug(`${i} <- body`, t), t;
		});
	}
	async fetchWithRetries(e, t) {
		let n = `${this.baseURL}${t.path}`, r = G(t.headers, {
			Authorization: `Bearer ${this.#e}`,
			Accept: "application/json",
			"User-Agent": `typesafe-sdk/${V}`,
			"X-TypeSafe-SDK": `typesafe-sdk/${V}`,
			"X-TypeSafe-Runtime": Pe,
			"Content-Type": t.body === void 0 ? void 0 : "application/json",
			"X-TypeSafe-Retry-Count": void 0
		}), i = t.body === void 0 ? void 0 : JSON.stringify(t.body);
		for (let a = 0;; a++) {
			let o = t.retry.maxRetries - a, s = a === 0 ? r : {
				...r,
				"X-TypeSafe-Retry-Count": String(a)
			};
			this.logger.debug(`${e} -> ${n}`, {
				headers: I(s),
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
				if (n instanceof O || o <= 0 || !Ae(n, t.retry)) throw n;
				await this.backOff(e, a, o, n.message, void 0, t);
				continue;
			}
			let u = h(l.headers);
			if (this.logger.info(`${e} <- ${l.status} in ${Date.now() - c}ms${u ? ` (request ${u})` : ""}`), l.ok) return l;
			let d = await K(l);
			this.logger.debug(`${e} <- error body`, d);
			let f = T.fromResponse(l.status, d, l.headers);
			if (o <= 0 || !ee(l.status, t.retry)) throw f;
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
			return await Ne(e, a.signal), e;
		} catch (t) {
			throw r?.aborted ? (this.logger.info(`${e} aborted by caller after ${u()}`), new O(void 0, { cause: t })) : s ? (this.logger.info(`${e} timed out after ${u()}`), new D(i, { cause: t })) : (this.logger.info(`${e} connection error after ${u()}`, t), new E(t instanceof Error ? `Connection error: ${t.message}` : void 0, { cause: t }));
		} finally {
			clearTimeout(c), r?.removeEventListener("abort", o);
		}
	}
	async backOff(e, t, n, r, i, { retry: a, signal: o }) {
		let s = te(t, i, a), c = t + 1, l = t + n;
		this.logger.info(`${e} retrying in ${s}ms (retry ${c}/${l}) after ${r}`);
		try {
			await ne(s, o);
		} catch (t) {
			throw this.logger.info(`${e} aborted by caller while waiting to retry`), new O(void 0, { cause: t });
		}
	}
}, K = async (e) => {
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
};
//#endregion
//#region src/engine/jevClassifier.ts
async function Ie(e, t, n = 6e3) {
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
		let r = new Fe({
			apiKey: t.trim(),
			dangerouslyAllowBrowser: !0,
			timeout: n
		}), i = e.length > 1200 ? e.slice(0, 1200) : e, a = (await r.systemOne({
			state: i,
			questions: {
				is_deadline: L("Does this text announce or discuss a specific academic deadline, due date, quiz, exam, test, homework, lab, or academic submission?"),
				category: ye("What type of academic task or event is described?", {
					quiz: "A quiz, pop quiz, short assessment, or test",
					exam: "A midterm exam, final exam, or major examination",
					assignment: "A homework assignment, problem set, essay, paper, or exercise",
					lab: "A laboratory session, lab report, lab experiment, or lab manual work",
					project: "A semester project, group project, milestone, presentation, or term project",
					not_a_task: "General announcement, lecture slides notice, office hours, syllabus info, or greetings with no upcoming assessment"
				}),
				urgency: ve("How urgent or high-priority is this academic event?", [
					"Low priority or non-mandatory notice",
					"Standard homework or recurring reading",
					"Medium priority assignment or lab report",
					"High priority quiz or milestone",
					"Critical high-stakes midterm or final exam"
				]),
				has_room: L("Does this text specify a particular room number, hall, classroom, auditorium, or lab location to attend in (e.g. room A8-103, hall TH005, lab 105, Central Lab)?"),
				has_time: L("Does this text specify an explicit clock time or time range for the assessment (e.g. at 12:30 pm, from 11:00 to 12:15, الساعة 12:30)?")
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
var q = "bbs_check_deadlines", J = "bbs_midnight_sync";
function Y() {
	let e = /* @__PURE__ */ new Date(), t = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1, 0, 0, 5).getTime();
	chrome.alarms.create(J, {
		when: t,
		periodInMinutes: 1440
	}), console.log(`[Auto-Sync] Scheduled daily midnight sync for ${new Date(t).toLocaleString()}`);
}
async function X() {
	try {
		let e = await chrome.storage.local.get(["bbs_settings", "bbs_tombstones"]), t = e.bbs_settings?.syncKey, n = await o(t);
		if (!n.success || !Array.isArray(n.tasks)) return !1;
		let r = (await chrome.storage.local.get(["bbs_tasks"])).bbs_tasks || [], i = e.bbs_tombstones || {}, a = c(i, n.tombstones || {});
		JSON.stringify(a) !== JSON.stringify(i) && await chrome.storage.local.set({ bbs_tombstones: a });
		let { tasks: s, changed: l } = m(r, n.tasks, a);
		return l ? (await chrome.storage.local.set({ bbs_tasks: s }), await Q(), console.log("[Background Sync] Pulled and merged latest deadlines & course changes from Firebase into storage"), !0) : !1;
	} catch (e) {
		return console.warn("[Background Sync] Failed pulling tasks from Firebase:", e), !1;
	}
}
async function Z() {
	try {
		await X();
		let t = await chrome.storage.local.get([
			"bbs_tasks",
			"bbs_settings",
			"bbs_quick_links"
		]), r = t.bbs_tasks || [], i = t.bbs_settings || e;
		if (i.autoSyncMidnight === !1) return console.log("[Auto-Sync] Skipped: autoSyncMidnight is disabled in settings"), {
			ok: !1,
			reason: "disabled"
		};
		let o = (await chrome.storage.local.get(["bbs_tombstones"])).bbs_tombstones || {}, [s, c] = await Promise.all([a(r, "Midnight Extension Sync", i.syncKey, t.bbs_quick_links, o), n(r, i, t.bbs_quick_links)]);
		return console.log("[Auto-Sync] Firebase Result:", s, "Server Result:", c), {
			ok: s.success || c.success,
			fbResult: s,
			serverResult: c
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
	chrome.alarms.create(q, { periodInMinutes: 30 }), Y(), X().then(() => Q());
}), chrome.alarms.onAlarm.addListener((e) => {
	e.name === q ? X().then(() => $()) : e.name === J && (Z(), Y());
}), chrome.runtime.onMessage.addListener((e, t, n) => e.type === "PROXY_JEV_CLASSIFY" || e.type === "CLASSIFY_JEV" ? (Ie(e.text, e.apiKey, e.timeoutMs).then((e) => n({
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
}), !0) : e.type === "PULL_FIREBASE" ? (X().then((e) => n({
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
})), !0) : e.type === "SYNC_TO_SERVER" ? (Z().then((e) => n(e)).catch((e) => n({
	ok: !1,
	error: String(e)
})), !0) : e.type === "OPEN_POPUP" && (chrome.action.openPopup?.().catch(() => {}), n({ ok: !0 }), !0));
//#endregion
export { X as pullTasksFromFirebaseToLocal };
