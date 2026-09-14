import type { PublicConnection, PublicSessionUser } from "@/modules/auth/dashboard-service";
import type { SessionCredentials } from "@/modules/auth/session";
import type { OnboardingInput, OnboardingResult, RetryWebhookResult } from "@/modules/onboarding/service";
import type { ZaloPollDiagnosticResult } from "@/modules/onboarding/zalo-poll-diagnostic";
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
  requireUser(credentials: SessionCredentials): Promise<{ userId: string }>;
  listConnections(userId: string): Promise<PublicConnection[]>;
  rotateConnectCode(input: { userId: string; publicId: string }): Promise<{ command: string; expiresAt: number }>;
  retryWebhook(input: { userId: string; publicId: string }): Promise<RetryWebhookResult>;
  runZaloPollDiagnostic(input: { userId: string; publicId: string }): Promise<ZaloPollDiagnosticResult>;
}

export interface RemindersOperations {
  requireUser(credentials: SessionCredentials): Promise<{ userId: string }>;
  listReminders(userId: string): Promise<PublicReminder[]>;
  createReminder(input: {
    userId: string;
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
