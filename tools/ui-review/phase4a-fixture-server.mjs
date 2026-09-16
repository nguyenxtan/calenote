import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const scenarios = new Set(["populated", "action-candidate", "empty", "partial-failure", "calendar-populated", "calendar-empty", "calendar-error", "inbox-populated", "inbox-empty", "inbox-error", "reminders-populated", "reminders-empty", "reminders-error", "connections", "connections-attention", "activity", "activity-empty", "settings", "landing", "login-email", "login-otp", "onboarding-welcome", "onboarding-provider", "onboarding-connection", "onboarding-success"]);
const scenario = process.argv[process.argv.indexOf("--scenario") + 1];
const port = Number(process.argv[process.argv.indexOf("--port") + 1] ?? 4174);
const outputRootArgument = process.argv.indexOf("--output-root");
const outputRoot = path.resolve(outputRootArgument === -1 ? "out" : process.argv[outputRootArgument + 1]);

if (process.env.CALENOTE_VISUAL_FIXTURE !== "1" || process.env.NODE_ENV === "production" || !scenarios.has(scenario)) {
  throw new Error("This localhost-only visual fixture requires CALENOTE_VISUAL_FIXTURE=1, a non-production NODE_ENV, and a supported --scenario.");
}

const session = { data: { user: { displayName: "Mai", email: "mai.fixture@example.test", timezone: "Asia/Ho_Chi_Minh" } } };
function todayAt(hour, minute, dayOffset = 0) {
  const fields = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "numeric", day: "numeric" }).formatToParts();
  const value = (type) => Number(fields.find((field) => field.type === type)?.value);
  return Date.UTC(value("year"), value("month") - 1, value("day") + dayOffset, hour - 7, minute);
}
const reminders = { data: { reminders: [
  { publicId: "populated-reminder-0001", title: "Gọi khách hàng ABC", scheduledAt: todayAt(9, 30), timezone: "Asia/Ho_Chi_Minh", status: "PENDING" },
  { publicId: "populated-reminder-0002", title: "Gửi báo giá", scheduledAt: todayAt(14, 0), timezone: "Asia/Ho_Chi_Minh", status: "PENDING" },
  { publicId: "populated-reminder-0003", title: "Uống thuốc", scheduledAt: todayAt(18, 30), timezone: "Asia/Ho_Chi_Minh", status: "PENDING" },
] } };
const candidate = { data: { actions: [{ id: "fixtureactioncandidate", title: "Họp với team vận hành", scheduledAt: todayAt(9, 0, 1), timezone: "Asia/Ho_Chi_Minh", status: "PENDING" }] } };
const empty = { data: { reminders: [] } };
const emptyActions = { data: { actions: [] } };
const contentTypes = { ".css": "text/css", ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
function fixture(pathname, method) {
  if (pathname === "/api/session") return [scenario.startsWith("login-") || scenario.startsWith("onboarding-") ? 401 : 200, scenario.startsWith("login-") || scenario.startsWith("onboarding-") ? { error: { code: "UNAUTHENTICATED", message: "Đăng nhập là cần thiết." } } : session];
  if (pathname === "/api/auth/request-code" && method === "POST") return [202, { data: { accepted: true } }];
  if (pathname === "/api/auth/verify-code" && method === "POST") return [200, { data: { authenticated: true } }];
  if (pathname === "/api/onboarding" && method === "POST") return [201, { data: { bot: { publicId: "fixture-telegram", provider: "telegram", displayName: "Telegram Mai", handle: "@mai", state: scenario === "onboarding-success" ? "ACTIVE_BOUND" : "ACTIVE_UNBOUND" }, connectCommand: scenario === "onboarding-success" ? null : "/connect FIXTURE-CODE", connectCodeExpiresAt: scenario === "onboarding-success" ? null : 1_900_000_000_000, activationCode: null } }];
  if (pathname === "/api/connections") return [200, { data: { connections: scenario === "connections-attention" ? [{ publicId: "fixture-telegram", provider: "telegram", displayName: "Telegram Mai", handle: "@mai", state: "WEBHOOK_FAILED" }] : [{ publicId: "fixture-telegram", provider: "telegram", displayName: "Telegram Mai", handle: "@mai", state: "ACTIVE_BOUND" }, { publicId: "fixture-zalo", provider: "zalo", displayName: "Zalo Mai", handle: null, state: "ACTIVE_UNBOUND" }] } }];
  if (pathname === "/api/activity") return scenario === "activity-empty" ? [200, { data: { activities: [] } }] : [200, { data: { activities: [{ action: "REMINDER_CREATED", createdAt: Date.now() - 3600000 }, { action: "CHAT_BOUND", createdAt: Date.now() - 7200000 }] } }];
  if (pathname === "/api/preferences") return [200, { data: { preferences: { addressStyle: "ban", customDisplayName: null, tone: "friendly" } } }];
  if (pathname === "/api/reminders") { if (["calendar-error", "reminders-error"].includes(scenario)) return [500, { error: { code: "INTERNAL_ERROR", message: "Chưa thể tải lời nhắc." } }]; return [200, ["empty", "action-candidate", "calendar-empty", "inbox-populated", "inbox-empty", "inbox-error", "reminders-empty"].includes(scenario) ? empty : reminders]; }
  if (pathname === "/api/actions") {
    if (["partial-failure", "inbox-error"].includes(scenario)) return [500, { error: { code: "INTERNAL_ERROR", message: "Không thể tải đề xuất." } }];
    return [200, ["action-candidate", "inbox-populated"].includes(scenario) ? candidate : emptyActions];
  }
  return null;
}

function localFile(pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname.endsWith("/") ? `${pathname}index.html` : pathname;
  const direct = path.resolve(outputRoot, `.${requested}`);
  const html = path.resolve(outputRoot, `.${requested}.html`);
  const candidatePath = [direct, html].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  return candidatePath?.startsWith(outputRoot) ? candidatePath : null;
}

http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const mocked = fixture(url.pathname, request.method);
  if (mocked) {
    const [status, body] = mocked;
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
    return;
  }
  const file = localFile(url.pathname);
  if (!file) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "content-type": contentTypes[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`Phase 4A visual fixture (${scenario}) listening at http://127.0.0.1:${port}/app/today`));
