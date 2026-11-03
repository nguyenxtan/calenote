import type { PublicConnection, PublicSessionUser } from "@/modules/auth/dashboard-service";
import type { SessionCredentials, SessionPrincipal } from "@/modules/auth/session";
import type { ReminderListResponseV2 } from "@/contracts/api/reminders-v2";
import type { PublicPreviewV1, PreviewDecisionRequestV1 } from "@/contracts/api/conversation-previews";
import type { ConfirmationResult } from "@/modules/conversation/context-contract/store";
export interface ContextApiOperations {
  requireUser(credentials: SessionCredentials): Promise<SessionPrincipal>;
  listDetailedReminders(principal: SessionPrincipal): Promise<ReminderListResponseV2["data"]>;
  listPreviews(principal: SessionPrincipal): Promise<{ previews: PublicPreviewV1[]; hasMore: boolean }>;
  decidePreview(principal: SessionPrincipal, request: PreviewDecisionRequestV1): Promise<ConfirmationResult | { status: "DECLINED" | "ALREADY_DECLINED" }>;
}
import type { PublicSeriesView, SeriesDecisionRequest } from "@/contracts/api/reminder-series";
export interface SeriesOperations {
  requireUser(credentials: SessionCredentials): Promise<SessionPrincipal>;
  listSeries(principal: SessionPrincipal): Promise<PublicSeriesView[]>;
  decideSeries(principal: SessionPrincipal, decision: SeriesDecisionRequest): Promise<"CONFIRMED" | "ALREADY_CONFIRMED" | "PROPOSED" | "CANCELLED" | "ALREADY_CANCELLED" | "STALE">;
}
import type { OnboardingInput, OnboardingResult, RetryWebhookResult } from "@/modules/onboarding/service";
import type { RateLimitResult } from "@/modules/rate-limit/service";
import type { PublicReminder } from "@/modules/reminders/api-service";
import type { CandidateDecisionResult, PublicPendingActionCandidate } from "@/modules/source-actions/service";
import type { PublicPreferences, UpdatePreferences } from "@/contracts/api/preferences";
import type { PublicActivity } from "@/contracts/api/activity";

export interface AuthOperations {
  requestLoginCode(input: { email: string; clientIp: string }): Promise<{ accepted: true }>;
  verifyLoginCode(input: { email: string; code: string; clientIp: string }): Promise<{ cookie: string }>;
  logout(credentials: SessionCredentials | null): Promise<{ clearCookie: string }>;
  requireUser(credentials: SessionCredentials): Promise<{ userId: string }>;
  getSessionUser(userId: string): Promise<PublicSessionUser>;
}

export interface ConnectionsOperations {
  getPrimaryLogin(userId:string):Promise<{publicId:string|null}>;
  selectPrimaryLogin(input:{userId:string;publicId:string}):Promise<{publicId:string}>;
  addConnection(input:{userId:string;provider:"zalo"|"telegram";token:string}):Promise<import("@/modules/connections/add-service").AddConnectionResult>;
  disconnectConnection(input:{userId:string;publicId:string}):Promise<{disconnected:true}>;
  requireUser(credentials: SessionCredentials): Promise<{ userId: string }>;
  listConnections(userId: string): Promise<PublicConnection[]>;
  rotateConnectCode(input: { userId: string; publicId: string }): Promise<{ command: string; expiresAt: number }>;
  retryWebhook(input: { userId: string; publicId: string }): Promise<RetryWebhookResult>;
}

export interface RemindersOperations {
  resolveReminderIntent?(input: { userId: string; intentId: string }): Promise<{ state: "CREATED" | "ABANDONED"; publicId?: string }>;
  requireUser(credentials: SessionCredentials): Promise<{ userId: string }>;
  listReminders(userId: string, after?: string): Promise<PublicReminder[]>;
  createReminder(input: {
    userId: string;
    intentId?: string;
    connectionPublicId?: string;
    title: string;
    scheduledAt: number;
    timezone: "Asia/Ho_Chi_Minh";
  }): Promise<PublicReminder>;
  cancelReminder(input: { userId: string; publicId: string }): Promise<{ cancelled: true }>;
}

export interface ActionsOperations {
  requireUser(credentials: SessionCredentials): Promise<{ userId: string }>;
  listPendingActions(userId: string): Promise<PublicPendingActionCandidate[]>;
  approveAction(input: { userId: string; candidateId: string }): Promise<CandidateDecisionResult>;
  rejectAction(input: { userId: string; candidateId: string }): Promise<CandidateDecisionResult>;
}

export interface PreferencesOperations {
  requireUser(credentials: SessionCredentials): Promise<{ userId: string }>;
  getPreferences(userId: string): Promise<PublicPreferences>;
  savePreferences(input: { userId: string; preferences: UpdatePreferences }): Promise<PublicPreferences>;
}
export interface ActivityOperations { requireUser(credentials: SessionCredentials): Promise<{ userId: string }>; listActivity(userId: string): Promise<PublicActivity[]>; }

export interface OnboardingOperations {
  digestRateLimitSubject(value: string): Promise<string>;
  consumeOnboardingRateLimit(subjectDigest: string): Promise<RateLimitResult>;
  onboard(input: OnboardingInput): Promise<OnboardingResult>;
}
