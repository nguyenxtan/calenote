import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

if (process.env.CALENOTE_T9_VISUAL_FIXTURE !== "1" || process.env.NODE_ENV === "production") {
  throw new Error("Local synthetic Task 9 visual fixture only; set CALENOTE_T9_VISUAL_FIXTURE=1 outside production.");
}

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outputRoot = path.resolve("out");
const artifactRoot = path.resolve(".superpowers/sdd/2026-09-28-llm-context-contract-implementation/task-9-fix2-browser");
assert.ok(existsSync(path.join(outputRoot, "app/calendar.html")), "Build the local static app first");
assert.ok(existsSync(chromePath), "Local Google Chrome is required");

const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "numeric", day: "numeric" }).formatToParts();
const civilPart = kind => Number(parts.find(part => part.type === kind)?.value);
const today = new Date(Date.UTC(civilPart("year"), civilPart("month") - 1, civilPart("day"))).toISOString().slice(0, 10);
const at = (day, hour) => Date.parse(`${day}T${String(hour - 7).padStart(2, "0")}:00:00Z`);
const details = {
  schemaVersion: "calenote-reminder-details-1", location: "Phòng họp <A>", notes: "Mang giấy tờ & bút",
  eventDate: today, eventTime: "13:30", calendarProvenance: {
    calendar: "LUNAR_VN", sourceDate: { kind: "CIVIL_DATE", calendar: "LUNAR_VN", day: 1, month: 9, year: 2026, leapMonth: false },
    provenance: { kind: "EXPLICIT_USER" },
  }, resolutionVersion: "context-resolution-1",
};
const json = body => JSON.stringify(body);
const api = new Map([
  ["/api/session", { data: { user: { displayName: "Mai", email: "mai.fixture@example.test", timezone: "Asia/Ho_Chi_Minh" } } }],
  ["/api/actions", { data: { actions: [] } }],
  ["/api/reminder-series", { data: { series: [] } }],
  ["/api/v2/reminders", { data: { schemaVersion: "reminders-2", reminders: [{ publicId: "R".repeat(22), title: "Nhắc việc hôm nay", scheduledAt: at(today, 9), timezone: "Asia/Ho_Chi_Minh", status: "PENDING", details }], hasMore: false, scope: "OWNER" } }],
  ["/api/v2/conversation-previews", { data: { schemaVersion: "conversation-previews-1", previews: [{
    publicId: "A".repeat(22), draftRevision: 1, previewHash: "a".repeat(64), expiresAt: Date.now() + 86_400_000,
    decisionToken: "synthetic-local-only", title: "Xác nhận lịch thử", details,
    occurrences: [{ index: 0, localDate: today, scheduledAt: at(today, 9) }, { index: 1, localDate: today, scheduledAt: at(today, 10) }],
  }], hasMore: false } }],
]);
const contentTypes = { ".css": "text/css", ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (request.method !== "GET") { response.writeHead(405); response.end(); return; }
  if (api.has(pathname)) {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(json(api.get(pathname))); return;
  }
  const relative = pathname === "/" ? "index.html" : pathname.endsWith("/") ? `${pathname.slice(1)}index.html` : pathname.slice(1);
  const candidates = [path.resolve(outputRoot, relative), path.resolve(outputRoot, `${relative}.html`)];
  const file = candidates.find(candidate => candidate.startsWith(`${outputRoot}${path.sep}`) && existsSync(candidate) && statSync(candidate).isFile());
  if (!file) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "content-type": contentTypes[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(response);
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for local Chrome state`);
}
async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(`${item.method}: ${message.error.message}`));
      else item.resolve(message.result);
    } else for (const listener of listeners.get(message.method) ?? []) listener(message.params);
  });
  return {
    send(method, params = {}) { return new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject, method }); socket.send(json({ id: next, method, params })); }); },
    on(method, listener) { listeners.set(method, [...(listeners.get(method) ?? []), listener]); },
    close() { socket.close(); },
  };
}
async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result.value;
}
const rect = element => {
  const box = element.getBoundingClientRect();
  return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
};
const measure = (cdp, fn) => evaluate(cdp, `(() => { const rect = ${rect.toString()}; return (${fn.toString()})(); })()`);
function calendarMetrics() {
  const grid = document.querySelector('[class*="__month"]');
  const cells = [...(grid?.querySelectorAll("button") ?? [])];
  const labels = cells.map(cell => ({ solar: cell.querySelector('[class*="__solarDay"]')?.textContent,
    lunar: cell.querySelector('[class*="__lunarDay"]')?.textContent, accessible: cell.getAttribute("aria-label"),
    cell: rect(cell), lunarBox: cell.querySelector('[class*="__lunarDay"]') ? rect(cell.querySelector('[class*="__lunarDay"]')) : null }));
  return { viewport: window.innerWidth, documentWidth: document.documentElement.scrollWidth, gridDisplay: grid ? getComputedStyle(grid).display : null,
    columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : 0,
    grid: grid ? rect(grid) : null, labels,
    agendaButtonCount: document.querySelectorAll('[class*="__agendaItem"]').length,
    cssLoaded: [...document.styleSheets].some(sheet => sheet.href?.includes("/_next/static/chunks/")),
  };
}
function detailMetrics() {
  const detail = document.querySelector('[class*="__detail"]');
  const close = detail?.querySelector('button[aria-label="Đóng chi tiết"]');
  return { viewport: window.innerWidth, documentWidth: document.documentElement.scrollWidth, detail: detail ? rect(detail) : null,
    close: close ? rect(close) : null, text: detail?.textContent ?? "", detailScrollWidth: detail?.scrollWidth ?? 0, detailClientWidth: detail?.clientWidth ?? 0 };
}
function previewMetrics() {
  const card = document.querySelector('[class*="__previewCard"]');
  const buttons = [...(card?.querySelectorAll('[class*="__previewActions"] button') ?? [])];
  const items = [...(card?.querySelectorAll("ol li") ?? [])];
  return { viewport: window.innerWidth, documentWidth: document.documentElement.scrollWidth, card: card ? rect(card) : null,
    buttons: buttons.map(button => ({ text: button.textContent, box: rect(button), disabled: button.disabled })),
    items: items.map(item => ({ text: item.textContent, box: rect(item) })),
    text: card?.textContent ?? "", cardScrollWidth: card?.scrollWidth ?? 0, cardClientWidth: card?.clientWidth ?? 0 };
}
function within(box, width) { return box && box.width > 0 && box.height > 0 && box.left >= -1 && box.right <= width + 1; }
function assertCalendar(data) {
  assert.equal(data.viewport, 375, "Chrome viewport must be exactly 375 CSS pixels");
  assert.ok(data.cssLoaded, "the built stylesheet must load");
  assert.equal(data.gridDisplay, "grid", "mobile calendar grid must remain visible");
  assert.equal(data.columns, 7, "mobile calendar grid must keep seven columns");
  assert.ok(within(data.grid, 375), "mobile grid must fit the viewport");
  assert.ok(data.documentWidth <= 376, "calendar must not scroll horizontally");
  assert.ok(data.labels.length >= 28, "all day cells must render");
  assert.ok(data.labels.every(item => item.solar && item.lunar && item.accessible?.includes("Dương lịch") && item.accessible?.includes("Âm lịch") && within(item.cell, 375) && within(item.lunarBox, 375)), "every day must show reachable solar/lunar labels");
  assert.equal(data.agendaButtonCount, 1, "synthetic current-day reminder must be reachable");
}
function assertDetail(data) {
  assert.ok(within(data.detail, 375) && within(data.close, 375), "detail and close control must fit the viewport");
  assert.ok(data.documentWidth <= 376 && data.detailScrollWidth <= data.detailClientWidth + 1, "detail must not overflow horizontally");
  assert.match(data.text, /Phòng họp <A>/);
  assert.match(data.text, /Thông báo:/);
}
function assertPreview(data) {
  assert.ok(within(data.card, 375), "preview card must fit the viewport");
  assert.ok(data.documentWidth <= 376 && data.cardScrollWidth <= data.cardClientWidth + 1, "preview must not overflow horizontally");
  assert.equal(data.buttons.length, 2, "save and decline controls must both render");
  assert.ok(data.buttons.every(item => within(item.box, 375) && !item.disabled), "both preview decisions must be reachable");
  assert.equal(data.items.length, 2, "all synthetic occurrences must be visible");
  assert.ok(data.items.every(item => within(item.box, 375)), "occurrence rows must fit the viewport");
  assert.match(data.text, /Ngày|Sự kiện:/);
}

let chrome;
let cdp;
let profile;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  profile = await mkdtemp(path.join(os.tmpdir(), "calenote-t9-chrome-"));
  chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions", "--disable-gpu",
    "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=127.0.0.1;localhost", "about:blank"], { stdio: "ignore" });
  const debuggingPort = await until(async () => {
    try { return Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); } catch { return null; }
  });
  const target = await (await fetch(`http://127.0.0.1:${debuggingPort}/json/new?about:blank`, { method: "PUT" })).json();
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  cdp.on("Fetch.requestPaused", async request => {
    try {
      await cdp.send(request.request.url.startsWith(`${origin}/`) ? "Fetch.continueRequest" : "Fetch.failRequest",
        request.request.url.startsWith(`${origin}/`) ? { requestId: request.requestId } : { requestId: request.requestId, errorReason: "BlockedByClient" });
    } catch { /* Page shutdown can race an intercepted request. */ }
  });
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Page.navigate", { url: `${origin}/app/calendar` });
  await until(() => evaluate(cdp, "document.querySelectorAll('[class*=__month] button').length >= 28 && document.querySelectorAll('[class*=__agendaItem]').length === 1"));
  const calendar = await measure(cdp, calendarMetrics);
  assertCalendar(calendar);
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(path.join(artifactRoot, "calendar-375.png"), Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await evaluate(cdp, "document.querySelector('[class*=__agendaItem]').click()");
  await until(() => evaluate(cdp, "!!document.querySelector('[class*=__detail]')"));
  const detail = await measure(cdp, detailMetrics);
  assertDetail(detail);
  await writeFile(path.join(artifactRoot, "detail-375.png"), Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await cdp.send("Page.navigate", { url: `${origin}/app/inbox` });
  await until(() => evaluate(cdp, "!!document.querySelector('[class*=__previewCard]')"));
  const preview = await measure(cdp, previewMetrics);
  assertPreview(preview);
  await writeFile(path.join(artifactRoot, "preview-375.png"), Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  const reachable = await evaluate(cdp, `(async () => {
    const buttons = [...document.querySelectorAll('[class*=__previewActions] button')];
    const results = [];
    for (const button of buttons) {
      button.scrollIntoView({ block: 'center' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      results.push({ top: box.top, bottom: box.bottom, hit: button.contains(hit) });
    }
    return results;
  })()`);
  assert.ok(reachable.every(item => item.top >= 0 && item.bottom <= 812 && item.hit), "both preview buttons must become unobscured hit targets after scrolling");
  await writeFile(path.join(artifactRoot, "preview-controls-375.png"), Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await cdp.send("Page.navigate", { url: `${origin}/app/calendar` });
  await until(() => evaluate(cdp, "document.querySelectorAll('[class*=__month] button').length >= 28"));
  await evaluate(cdp, 'document.head.insertAdjacentHTML("beforeend", "<style id=negative-control>[class*=__month]{display:none!important}</style>")');
  const hidden = await measure(cdp, calendarMetrics);
  assert.throws(() => assertCalendar(hidden), /grid must remain visible/);
  await evaluate(cdp, 'document.getElementById("negative-control").textContent="[class*=__month]{width:500px!important}"');
  const overflowing = await measure(cdp, calendarMetrics);
  assert.throws(() => assertCalendar(overflowing), /grid must fit the viewport/);
  const result = { chrome: (await (await fetch(`http://127.0.0.1:${debuggingPort}/json/version`)).json()).Browser,
    viewport: "375x812 CSS px", builtAssetRoot: "out", syntheticOnly: true, localhostOnly: true,
    calendar, detail, preview, reachable, negativeControls: ["hidden-grid-detected", "overflowing-grid-detected"] };
  await writeFile(path.join(artifactRoot, "metrics.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ chrome: result.chrome, viewport: result.viewport, gridColumns: calendar.columns, dayCells: calendar.labels.length,
    documentWidths: [calendar.documentWidth, detail.documentWidth, preview.documentWidth], detailFits: true, previewControls: preview.buttons.length,
    previewOccurrences: preview.items.length, reachable, negativeControls: result.negativeControls, artifacts: artifactRoot }));
} finally {
  cdp?.close();
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise(resolve => chrome.once("exit", resolve));
    chrome.kill();
    await Promise.race([exited, sleep(3000)]);
  }
  await new Promise(resolve => server.close(resolve));
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
