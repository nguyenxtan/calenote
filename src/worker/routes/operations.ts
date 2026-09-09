import type { PublicConnection, PublicSessionUser } from "@/modules/auth/dashboard-service";
import type { OnboardingInput, OnboardingResult, RetryWebhookResult } from "@/modules/onboarding/service";
import type { RateLimitResult } from "@/modules/rate-limit/service";
import type { PublicReminder } from "@/modules/reminders/api-service";

export interface AuthOperations {
  requestLoginCode(input: { email: string; clientIp: string }): Promise<{ accepted: true }>;
  verifyLoginCode(input: { email: string; code: string; clientIp: string }): Promise<{ cookie: string }>;
  logout(request: Request): Promise<{ clearCookie: string }>;
  requireUser(request: Request): Promise<{ userId: string }>;
  getSessionUser(userId: string): Promise<PublicSessionUser>;
}

export interface ConnectionsOperations {
  requireUser(request: Request): Promise<{ userId: string }>;
  listConnections(userId: string): Promise<PublicConnection[]>;
  rotateConnectCode(input: { userId: string; publicId: string }): Promise<{ command: string; expiresAt: number }>;
  retryWebhook(input: { userId: string; publicId: string }): Promise<RetryWebhookResult>;
}

export interface RemindersOperations {
  requireUser(request: Request): Promise<{ userId: string }>;
  listReminders(userId: string): Promise<PublicReminder[]>;
  createReminder(input: {
    userId: string;
    title: string;
    scheduledAt: number;
    timezone: "Asia/Ho_Chi_Minh";
  }): Promise<PublicReminder>;
  cancelReminder(input: { userId: string; publicId: string }): Promise<{ cancelled: true }>;
}

export interface OnboardingOperations {
  digestRateLimitSubject(value: string): Promise<string>;
  consumeOnboardingRateLimit(subjectDigest: string): Promise<RateLimitResult>;
  onboard(input: OnboardingInput): Promise<OnboardingResult>;
}
