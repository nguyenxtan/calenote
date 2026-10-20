import { requestEmailRegistration, verifyEmailRegistration } from "@/modules/auth/email-registration";
import { createRegistrationEmailSender } from "@/modules/auth/registration-email-sender";
import type { EmailRegistrationOperations } from "./routes/email-registration";
import { createPersonalMemoryChatHandler } from "@/modules/personal-assistant/chat";
import { D1PersonalAssistantStore } from "@/modules/personal-assistant/store";
import { personalBrief, D1PersonalAssistantRuntime } from "@/modules/personal-assistant/runtime";
import type { PersonalAssistantOperations } from "./routes/personal-assistant";
import { createFollowThroughChatHandler } from '@/modules/follow-through/chat-adapter';
import { D1FollowThroughService } from '@/modules/follow-through/service';
import type { FollowThroughOperations } from './routes/follow-through';
import { D1EmailDiscoveryStore, continueWithEmail } from "@/modules/auth/email-discovery";
import type { EmailDiscoveryOperations } from "./routes/auth-continue";
import { D1AccountService } from "@/modules/account/service";
import type { AccountOperations } from "./routes/account";
import { D1PrimaryLoginStore, PrimaryLoginSelectionError } from "@/modules/connections/primary-login";
import { addConnection } from "@/modules/connections/add-service";
import { D1ConnectionLifecycleStore, ConnectionDisconnectError } from "@/modules/connections/lifecycle";
import { randomOpaqueId, cryptoRandomBytes } from "@/modules/platform/types";
import {D1LocalMonthQueryStore} from '@/modules/reminders/infrastructure/d1/local-month-query-store';
import { D1DashboardStore } from "@/modules/auth/dashboard-service";
import {
  deliverLoginCode,
  D1LoginCodeStore,
  redriveLoginCodes,
  requestLoginCode,
  verifyLoginCode,
} from "@/modules/auth/login-service";
import { requireSession, revokeSession, SessionAuthError } from "@/modules/auth/session";
import type { BotProvider, WebhookRegistration } from "@/modules/connections/contracts";
import { setTelegramWebhook } from "@/modules/connections/providers/telegram";
import { setZaloWebhook } from "@/modules/connections/providers/zalo";
import { verifyBotToken } from "@/modules/connections/verify-bot-token";
import { D1OnboardingStore } from "@/modules/db/onboarding-store";
import { D1UserPreferencesStore } from "@/modules/db/preferences-store";
import { D1RateLimitStore } from "@/modules/db/rate-limit-store";
import { D1SessionStore } from "@/modules/db/session-store";
import { D1InboundProcessorStore, processInbound } from "@/modules/inbound/processor";
import { acceptWebhookMessage, D1InboundWebhookStore } from "@/modules/inbound/webhook";
import { onboard, retryWebhook as retryConnectionWebhook, rotateConnectCode, RateLimitExceededError } from "@/modules/onboarding/service";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { deliverReminder } from "@/modules/reminders/delivery";
import { D1ReminderApiStore } from "@/modules/reminders/infrastructure/d1/api-store";
import { D1ReminderCommandStore } from "@/modules/reminders/infrastructure/d1/command-store";
import { D1ReminderDeliveryStore } from "@/modules/reminders/infrastructure/d1/delivery-store";
import { D1ReminderSchedulerStore } from "@/modules/reminders/infrastructure/d1/scheduler-store";
import { resolveManualReminderIntent, cancelPublicReminder, createManualReminder, listPublicReminders } from "@/modules/reminders/api-service";
import { listDetailedReminders } from "@/modules/reminders/details-api-service";
import { PreviewUnavailableError } from "./routes/conversation-previews";
import { claimDueReminders, D1InboundDispatchStore, redriveInboundOrphans } from "@/modules/reminders/scheduler";
import { createKeyring, type Keyring } from "@/modules/security/keyring";
import { D1SourceActionStore } from "@/modules/source-actions/infrastructure/d1/store";
import {
  approveActionCandidate,
  listOwnedPendingActionCandidates,
  rejectActionCandidate,
} from "@/modules/source-actions/service";
import { getUserPreferences, saveUserPreferences } from "@/modules/preferences/service";
import type { QueueOperations, ScheduledOperations } from "./index";
import type {
  AuthOperations,
  ActionsOperations,
  ConnectionsOperations,
  OnboardingOperations,
  PreferencesOperations,
  RemindersOperations,
} from "./routes/operations";
import type { WebhookRouteDependencies } from "./routes/webhooks";
import { createNullIntelligenceGateway } from "@/modules/intelligence/service";
import type { IntelligenceGateway, IntelligenceMode } from "@/modules/intelligence/contracts";
import { createOpenRouterGateway } from "@/modules/intelligence/infrastructure/openrouter/gateway";
import { createSemanticGateway, createConversationGateway } from "@/modules/intelligence/infrastructure/openrouter/semantic-gateway";
import { createContextContractGateway, createContextHttpTransport } from "@/modules/intelligence/infrastructure/openrouter/semantic-gateway";
import { parseContextContractRuntimeConfig } from "@/modules/intelligence/infrastructure/openrouter/config";
import { D1ContextContractStore } from "@/modules/conversation/context-contract/infrastructure/d1/store";
import { createD1ContextContractStoreV3 } from "@/modules/conversation/context-contract/infrastructure/d1/store";
import { createD1ContextRuntimeStoreV3 } from "@/modules/conversation/context-contract/runtime-store";
import { CONTEXT_PROTOCOL_V3 } from "@/modules/conversation/context-contract/protocol";
import { D1SemanticReminderQueryStore } from "@/modules/reminders/infrastructure/d1/semantic-query-store";
import { observeContextEvent } from "@/modules/conversation/context-contract/observability";
import { D1ConversationStore } from "@/modules/conversation/infrastructure/d1/context-store";
import { D1ConversationRuntimeStore } from "@/modules/conversation/infrastructure/d1/runtime-store";
import { D1SeriesStore } from "@/modules/reminders/infrastructure/d1/series-store";
import { lunarCalendar } from "@/modules/conversation/lunar-calendar";
import type { ConversationServiceDependencies } from "@/modules/conversation/service";
import type { SemanticGateway } from "@/modules/intelligence/semantic-gateway";
import { parseOpenRouterRuntimeConfig, parseSemanticRuntimeConfig, SEMANTIC_BUDGET_CEILINGS } from "@/modules/intelligence/infrastructure/openrouter/config";
import { D1SemanticBudgetStore } from "@/modules/semantic/infrastructure/d1/budget-store";
import { D1SemanticContextStore } from "@/modules/semantic/infrastructure/d1/context-store";
import type { SemanticObservation } from "@/modules/semantic/service";
import { PRODUCTION_APP_ORIGIN } from "./origin-policy";

export const CANONICAL_APP_ORIGIN = PRODUCTION_APP_ORIGIN;

/** Runtime telemetry is intentionally a closed allow-list: never serialize inbound or provider payloads. */
function recordSemanticObservation(observation: SemanticObservation): void {
  console.log(JSON.stringify({
    operation: "semantic_interpretation",
    request_dispatched: observation.requestDispatched,
    tier: observation.tier,
    latency_ms: observation.latencyMs,
    result_category: observation.resultCategory,
    schema_valid: observation.schemaValid,
    fallback_used: observation.fallbackUsed,
    ...(observation.costMicrounits === undefined ? {} : { cost_microunits: observation.costMicrounits }),
  }));
}

export class ServiceUnavailableError extends Error {
  constructor() {
    super("Calenote đang tạm thời không sẵn sàng.");
    this.name = "ServiceUnavailableError";
  }
}

function assertRuntimeBindingShapes(env: Env): void {
  if (
    typeof env.DB !== "object" || env.DB === null
    || typeof env.DB.prepare !== "function" || typeof env.DB.batch !== "function"
    || typeof env.JOBS !== "object" || env.JOBS === null
    || typeof env.JOBS.send !== "function"
    || typeof env.ASSETS !== "object" || env.ASSETS === null
    || typeof env.ASSETS.fetch !== "function"
  ) throw new ServiceUnavailableError();
}

export async function assertRuntimeReady(env: Env, appOrigin: string): Promise<void> {
  try {
    assertRuntimeBindingShapes(env);
    if (env.APP_ORIGIN !== appOrigin) throw new ServiceUnavailableError();
    await createKeyring(env.CALENOTE_MASTER_KEY);
  } catch {
    throw new ServiceUnavailableError();
  }
}

async function registerWebhook(provider: BotProvider, token: string, registration: WebhookRegistration): Promise<void> {
  if (provider === "zalo") return setZaloWebhook(token, registration);
  return setTelegramWebhook(token, registration);
}

async function createRouteKeyring(env: Env): Promise<Awaited<ReturnType<typeof createKeyring>>> {
  let keyring: Awaited<ReturnType<typeof createKeyring>>;
  try {
    assertRuntimeBindingShapes(env);
    keyring = await createKeyring(env.CALENOTE_MASTER_KEY);
  } catch {
    throw new ServiceUnavailableError();
  }
  return keyring;
}

export async function createAuthOperations(env: Env): Promise<AuthOperations> {
  const keyring = await createRouteKeyring(env);
  const rateLimitStore = new D1RateLimitStore(env.DB);
  const sessionStore = new D1SessionStore(env.DB);
  const dashboardStore = new D1DashboardStore(env.DB);
  const loginStore = new D1LoginCodeStore(env.DB);
  return {
    requestLoginCode: async ({ email, clientIp }) => {
      await rateLimitStore.cleanupExpired(Date.now(), 100);
      for (const [subject, limit] of [[`rate-limit:login-request:ip:${clientIp}`, 10], [`rate-limit:login-request:email:${email}`, 3]] as const) {
        const subjectDigest = await keyring.digestCode(subject);
        const rate = await consumeRateLimit({ subjectDigest, scope: "login-request", limit, windowMs: 10 * 60_000 }, { store: rateLimitStore });
        if (!rate.allowed) throw new RateLimitExceededError(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1_000)));
      }
      return requestLoginCode(email, { store: loginStore, keyring, enqueue: (job) => env.JOBS.send(job) });
    },
    verifyLoginCode: async ({ email, code, clientIp }) => {
      await rateLimitStore.cleanupExpired(Date.now(), 100);
      for (const [subject, limit] of [[`rate-limit:login-verify:ip:${clientIp}`, 30], [`rate-limit:login-verify:email:${email}`, 10]] as const) {
        const subjectDigest = await keyring.digestCode(subject);
        const rate = await consumeRateLimit({ subjectDigest, scope: "login-verify", limit, windowMs: 10 * 60_000 }, { store: rateLimitStore });
        if (!rate.allowed) throw new RateLimitExceededError(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1_000)));
      }
      return verifyLoginCode(email, code, { store: loginStore, keyring });
    },
    logout: async (credentials) => {
      const result = await revokeSession(credentials, { store: sessionStore, keyring });
      return { clearCookie: result.clearCookie };
    },
    requireUser: async (credentials) => {
      const principal = await requireSession(credentials, { store: sessionStore, keyring });
      return { userId: principal.userId };
    },
    getSessionUser: async (userId) => {
      const user = await dashboardStore.getSessionUser(userId);
      if (!user) throw new SessionAuthError();
      return user;
    },
  };
}

export async function createConnectionsOperations(env: Env): Promise<ConnectionsOperations> {
  const keyring = await createRouteKeyring(env);
  const store = new D1OnboardingStore(env.DB);
  const rateLimitStore = new D1RateLimitStore(env.DB);
  const sessionStore = new D1SessionStore(env.DB);
  const dashboardStore = new D1DashboardStore(env.DB);
  return {
    requireUser: async (credentials) => {
      const principal = await requireSession(credentials, { store: sessionStore, keyring });
      return { userId: principal.userId };
    },
    listConnections: (userId) => dashboardStore.listConnections(userId),
    getPrimaryLogin: userId => new D1PrimaryLoginStore(env.DB).get(userId),
    selectPrimaryLogin: async ({userId,publicId}) => {
      if(!await new D1PrimaryLoginStore(env.DB).select(userId,publicId,Date.now(),randomOpaqueId(cryptoRandomBytes))) throw new PrimaryLoginSelectionError();
      return {publicId};
    },
    addConnection: ({userId,provider,token}) => addConnection(userId,{provider,token},{store,keyring,rateLimitStore,verifyToken:verifyBotToken,registerWebhook,appOrigin:env.APP_ORIGIN}),
    disconnectConnection: async ({userId,publicId}) => {
      const changed = await new D1ConnectionLifecycleStore(env.DB).disconnect(userId,publicId,Date.now(),randomOpaqueId(cryptoRandomBytes));
      if (!changed) throw new ConnectionDisconnectError();
      return {disconnected:true};
    },
    rotateConnectCode: (input) => rotateConnectCode(input, { store, keyring, rateLimitStore }),
    retryWebhook: (input) => retryConnectionWebhook(input, { store, keyring, rateLimitStore, registerWebhook, appOrigin: env.APP_ORIGIN }),
  };
}

export async function createRemindersOperations(env: Env): Promise<RemindersOperations> {
  const keyring = await createRouteKeyring(env);
  const rateLimitStore = new D1RateLimitStore(env.DB);
  const sessionStore = new D1SessionStore(env.DB);
  const reminderStore = new D1ReminderApiStore(env.DB);
  return {
    requireUser: async (credentials) => {
      const principal = await requireSession(credentials, { store: sessionStore, keyring });
      return { userId: principal.userId };
    },
    listReminders: (userId, after) => listPublicReminders(userId, { store: reminderStore, keyring }, { after, limit: 101 }),
    resolveReminderIntent: (input) => resolveManualReminderIntent(input, { store: reminderStore, keyring, rateLimitStore }),
    createReminder: (input) => createManualReminder(input, { store: reminderStore, keyring, rateLimitStore }),
    cancelReminder: ({ userId, publicId }) => cancelPublicReminder(userId, publicId, { store: reminderStore, keyring, rateLimitStore }),
  };
}

export async function createContextApiOperations(env: Env, capabilities: { contextContract?: "calenote-context-2"; sourceSha?: string } = {}): Promise<import("./routes/operations").ContextApiOperations> {
  if (capabilities.contextContract && (!capabilities.sourceSha || !/^[0-9a-f]{40}$/u.test(capabilities.sourceSha))) throw new TypeError("Source SHA required");
  const keyring = await createRouteKeyring(env);
  const sessions = new D1SessionStore(env.DB);
  const reminderStore = new D1ReminderApiStore(env.DB);
  // Explicit offline composition is independent of provider admission. Existing
  // routes remain dormant and never touch successor tables by default.
  const contextStore = capabilities.contextContract ? new D1ContextContractStore(env.DB, keyring, Date.now, CONTEXT_PROTOCOL_V3) : undefined;
  return {
    requireUser: credentials => requireSession(credentials, { store: sessions, keyring }),
    listDetailedReminders: async principal => {
      if (!contextStore) throw new PreviewUnavailableError();
      return listDetailedReminders(principal, { store: reminderStore, contextStore, keyring });
    },
    listPreviews: principal => contextStore ? contextStore.listWebPreviews(principal) : Promise.resolve({ previews: [], hasMore: false }),
    decidePreview: async (principal, request) => {
      if (!contextStore) throw new PreviewUnavailableError();
      return contextStore.decideWebPreview(principal, request);
    },
  };
}

export async function createSeriesOperations(env: Env, capabilities: { conversationV2?: boolean } = {}): Promise<import("./routes/operations").SeriesOperations> {
  const keyring = await createRouteKeyring(env);
  const sessions = new D1SessionStore(env.DB); const store = new D1SeriesStore(env.DB, keyring);
  return {
    requireUser: credentials => requireSession(credentials, { store: sessions, keyring }),
    listSeries: principal => capabilities.conversationV2 ? store.listWeb(principal, Date.now()) : Promise.resolve([]),
    decideSeries: (principal, decision) => {
      if (!capabilities.conversationV2) throw new ServiceUnavailableError();
      return store.decideWeb(principal, decision, Date.now());
    },
  };
}

export async function createActionsOperations(env: Env): Promise<ActionsOperations> {
  const keyring = await createRouteKeyring(env);
  const sessionStore = new D1SessionStore(env.DB);
  const store = new D1SourceActionStore(env.DB);
  return {
    requireUser: async (credentials) => {
      const principal = await requireSession(credentials, { store: sessionStore, keyring });
      return { userId: principal.userId };
    },
    listPendingActions: (userId) => listOwnedPendingActionCandidates({ userId }, { store, keyring }),
    approveAction: (input) => approveActionCandidate(input, { store, keyring }),
    rejectAction: (input) => rejectActionCandidate(input, { store }),
  };
}

export async function createPreferencesOperations(env: Env): Promise<PreferencesOperations> {
  const keyring = await createRouteKeyring(env);
  const sessionStore = new D1SessionStore(env.DB);
  const preferencesStore = new D1UserPreferencesStore(env.DB);
  return {
    requireUser: async (credentials) => {
      const principal = await requireSession(credentials, { store: sessionStore, keyring });
      return { userId: principal.userId };
    },
    getPreferences: async (userId) => {
      const preferences = await getUserPreferences(userId, preferencesStore);
      return {
        addressStyle: preferences.addressStyle,
        customDisplayName: preferences.customDisplayName,
        tone: preferences.tone,
        reminderConfirmation: preferences.reminderConfirmation ?? "auto",
      };
    },
    savePreferences: async ({ userId, preferences }) => {
      const saved = await saveUserPreferences(userId, preferences, preferencesStore, Date.now());
      return {
        addressStyle: saved.addressStyle,
        customDisplayName: saved.customDisplayName,
        tone: saved.tone,
        reminderConfirmation: saved.reminderConfirmation ?? "auto",
      };
    },
  };
}
export async function createActivityOperations(env: Env): Promise<import("./routes/operations").ActivityOperations> { const keyring=await createRouteKeyring(env); const store=new D1SessionStore(env.DB); const dashboard=new D1DashboardStore(env.DB); return { requireUser:async(credentials)=>{const principal=await requireSession(credentials,{store,keyring});return {userId:principal.userId};}, listActivity:(userId)=>dashboard.listActivity(userId) }; }

export async function createOnboardingOperations(env: Env): Promise<OnboardingOperations> {
  const keyring = await createRouteKeyring(env);
  const store = new D1OnboardingStore(env.DB);
  const rateLimitStore = new D1RateLimitStore(env.DB);
  return {
    digestRateLimitSubject: (value) => keyring.digestCode(value),
    consumeOnboardingRateLimit: (subjectDigest) => consumeRateLimit(
      { subjectDigest, scope: "onboarding", limit: 5, windowMs: 60_000 }, { store: rateLimitStore },
    ),
    onboard: (input) => onboard(input, { store, keyring, verifyToken: verifyBotToken, registerWebhook, appOrigin: env.APP_ORIGIN }),
  };
}

export async function createWebhookOperations(env: Env): Promise<WebhookRouteDependencies> {
  const keyring = await createKeyring(env.CALENOTE_MASTER_KEY);
  const store = new D1InboundWebhookStore(env.DB);
  return {
    findConnection: (provider, publicId) => store.findConnection(provider, publicId),
    webhookSecrets: (publicId) => keyring.webhookSecrets(publicId),
    constantTimeEqual: (left, right) => keyring.constantTimeEqual(left, right),
    recordZaloWebhookDiagnostic: (diagnostic) => console.log(JSON.stringify(diagnostic)),
    accept: ({ connection, message }) => acceptWebhookMessage(message, connection, {
      store,
      dispatchStore: new D1InboundDispatchStore(env.DB),
      keyring,
      enqueue: async (job) => { await env.JOBS.send(job); },
    }),
  };
}

export interface IntelligenceCapability {
  mode: IntelligenceMode;
  gateway: IntelligenceGateway;
}

// Intelligence remains optional: invalid or missing configuration never prevents
// Worker startup and resolves to the null port.
export async function createIntelligenceCapability(env?: Env): Promise<IntelligenceCapability> {
  const policy = parseOpenRouterRuntimeConfig((env ?? {}) as Record<string, string | undefined>);
  return policy.status === "READY"
    ? { mode: policy.config.mode, gateway: createOpenRouterGateway(policy.config) }
    : { mode: "off", gateway: createNullIntelligenceGateway() };
}

export async function createIntelligenceGateway(env?: Env): Promise<IntelligenceGateway> {
  return (await createIntelligenceCapability(env)).gateway;
}

const unavailableSemanticGateway: SemanticGateway = {
  prepare: () => ({ status: "FAILURE", category: "UNAVAILABLE" }),
};

/** Reads at most the reviewed response ceiling, including when the provider omits Content-Length. */
export async function readBoundedSemanticResponse(response: Response, maximumBytes: number): Promise<{ body: string; oversized: boolean }> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number.isSafeInteger(Number(declaredLength)) && Number(declaredLength) > maximumBytes) {
    await response.body?.cancel();
    return { body: "", oversized: true };
  }
  if (response.body === null) return { body: "", oversized: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return { body: "", oversized: true };
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return { body: new TextDecoder().decode(body), oversized: false };
}

/** The sole production Semantic V1 route: pinned Gemini Vertex with no fallback. */
export async function createSemanticCapability(env: Env, suppliedKeyring?: Keyring) {
  const policy = parseSemanticRuntimeConfig(env);
  const keyring = suppliedKeyring ?? await createKeyring(env.CALENOTE_MASTER_KEY);
  const route = policy.status === "READY" ? policy.config.primary! : undefined;
  return {
    mode: policy.status === "READY" ? "privacy" as const : "off" as const,
    gateway: policy.status === "READY" ? createSemanticGateway(policy.config, async (request, options) => {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", signal: options.signal,
        headers: { Authorization: `Bearer ${policy.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      return { status: response.status, ...await readBoundedSemanticResponse(response, policy.config.maxResponseBytes) };
    }) : unavailableSemanticGateway,
    budgetStore: new D1SemanticBudgetStore(env.DB, {
      ...(policy.status === "READY" ? policy.budgetLimits : SEMANTIC_BUDGET_CEILINGS),
      maxInputTokens: policy.status === "READY" ? policy.config.maxInputTokens : 12_000,
      maxOutputTokens: policy.status === "READY" ? policy.config.maxOutputTokens : 256,
      promptPriceMicrounitsPerMillionTokens: route?.promptPriceMicrounitsPerMillionTokens ?? 100_000,
      completionPriceMicrounitsPerMillionTokens: route?.completionPriceMicrounitsPerMillionTokens ?? 400_000,
    }),
    contextStore: new D1SemanticContextStore(env.DB, keyring),
    observe: recordSemanticObservation,
  };
}

export type RuntimeOperations = QueueOperations & ScheduledOperations;

export async function createRuntimeOperations(env: Env, capabilities: { conversationV2?: boolean; contextContract?: "calenote-context-2"; sourceSha?: string } = {}, feedbackLifetime?: import("@/modules/conversation/processing-feedback").FeedbackLifetime): Promise<RuntimeOperations> {
  if (capabilities.contextContract && (!capabilities.sourceSha || !/^[0-9a-f]{40}$/u.test(capabilities.sourceSha))) throw new TypeError("Source SHA required");
  const keyring = await createKeyring(env.CALENOTE_MASTER_KEY);
  const inboundStore = new D1InboundProcessorStore(env.DB, new D1ReminderCommandStore(env.DB));
  const deliveryStore = new D1ReminderDeliveryStore(env.DB);
  const reminderSchedulerStore = new D1ReminderSchedulerStore(env.DB);
  const inboundDispatchStore = new D1InboundDispatchStore(env.DB);
  const loginStore = new D1LoginCodeStore(env.DB);
  const semantic = await createSemanticCapability(env, keyring);
  const contextPolicy = capabilities.contextContract ? parseContextContractRuntimeConfig(env) : undefined;
  const contextContract = capabilities.contextContract ? {
    store: createD1ContextContractStoreV3({ db: env.DB, keyring, protocol: CONTEXT_PROTOCOL_V3 }), runtimeStore: createD1ContextRuntimeStoreV3({ db: env.DB, keyring, protocol: CONTEXT_PROTOCOL_V3 }), calendar: lunarCalendar,
    sourceSha: capabilities.sourceSha!, mode: "LIVE" as const, observe: observeContextEvent,
    // Dormant until the reviewed capability is enabled after full live PASS.
    gateway: contextPolicy?.status === "READY" ? createContextContractGateway({ ...contextPolicy.config, protocol: CONTEXT_PROTOCOL_V3 }, createContextHttpTransport(contextPolicy.apiKey),
      { status: "OBSERVABLE_CANARY", advertisedContextTokens: 1048576 })
      : { prepare: () => ({ status: "FAILURE" as const, category: "UNAVAILABLE" as const }) },
    budgetStore: new D1SemanticBudgetStore(env.DB, { ...(contextPolicy?.status === "READY" ? contextPolicy.budgetLimits : SEMANTIC_BUDGET_CEILINGS),
      maxInputTokens: 12000, maxOutputTokens: 1536, reservationInputTokenExposure: 1048576,
      promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 }),
    list: (input: import("@/modules/conversation/context-contract/query").ContextReminderQuery) => new D1SemanticReminderQueryStore(env.DB).listContext(input),
  } : undefined;
  // A capability is an explicit application composition choice, never an
  // unreviewed environment switch. Existing deployments remain V1 by default.
  const contexts = capabilities.conversationV2 ? new D1ConversationStore(env.DB, keyring) : undefined;
  const policy = capabilities.conversationV2 ? parseSemanticRuntimeConfig(env) : undefined;
  const conversationGateway: ConversationServiceDependencies["gateway"] = policy?.status === "READY"
    ? createConversationGateway(policy.config, async (request, options) => {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", signal: options.signal,
        headers: { Authorization: `Bearer ${policy.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(request),
      });
      return { status: response.status, ...await readBoundedSemanticResponse(response, policy.config.maxResponseBytes) };
    }) : { prepare: () => ({ status: "FAILURE", category: "UNAVAILABLE" }) };
  return {
    processInbound: (inboundId) => processInbound(inboundId, {
      store: inboundStore,
      connectionEgress: new D1ConnectionLifecycleStore(env.DB),
      followThrough: async (message,context) => {
        const memory=await createPersonalMemoryChatHandler(new D1PersonalAssistantStore(env.DB,keyring))(message,context);
        return memory.handled ? memory : createFollowThroughChatHandler(new D1FollowThroughService(env.DB,keyring))(message,context);
      },
      getReminderConfirmation: async userId => (await getUserPreferences(userId,new D1UserPreferencesStore(env.DB))).reminderConfirmation ?? "auto",
      keyring,
      semantic,
      ...(contextContract ? { contextContract } : {}),
      feedbackLifetime,
      observeTiming: timing => console.log(JSON.stringify({ operation: "conversation_timing", ...timing })),
      observeFeedback: (outcome, elapsedMs) => console.log(JSON.stringify({ operation: "processing_feedback", outcome, elapsedMs })),
      ...(contexts ? { conversation: { contextStore: contexts, seriesStore: new D1SeriesStore(env.DB, keyring),
        runtimeStore: new D1ConversationRuntimeStore(env.DB), calendar: lunarCalendar,
        getReminderConfirmation: async userId => (await getUserPreferences(userId,new D1UserPreferencesStore(env.DB))).reminderConfirmation ?? "auto",
        getTone: async (ownerId: string) => {
          const tone = (await new D1UserPreferencesStore(env.DB).get(ownerId))?.tone;
          return tone === "concise" || tone === "professional" ? "concise" as const : "friendly" as const;
        },
        gateway: conversationGateway, budgetStore: semantic.budgetStore, listMonth: input => new D1LocalMonthQueryStore(env.DB).list(input),
        observeFailure: failure => console.log(JSON.stringify({ operation: "conversation_failure",
          sourceInboundId: failure.sourceInboundId, stage: failure.stage, category: failure.category })),
      } } : {}),
      recordDiagnostic: (diagnostic) => console.log(JSON.stringify(diagnostic)),
    }),
    deliverReminder: (reminderId) => deliverReminder(reminderId, { store: deliveryStore, keyring }),
    deliverLoginCode: (loginCodeId) => deliverLoginCode(loginCodeId, { store: loginStore, keyring }),
    purgeEmailRegistrationChallenges: async (now,limit) => {
      if(!await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='email_registration_challenges'").first())return;
      return env.DB.prepare('DELETE FROM email_registration_challenges WHERE email IN (SELECT email FROM email_registration_challenges WHERE expires_at<? ORDER BY expires_at LIMIT ?)').bind(now-86_400_000,Math.min(100,Math.max(1,limit))).run();
    },
    processPersonalAssistant: (now, limit) => new D1PersonalAssistantRuntime(env.DB,keyring).processDue(now,limit),
    processFollowThrough: (now, limit) => new D1FollowThroughService(env.DB,keyring).processDue(now,limit),
    claimDueReminders: (now, limit) => claimDueReminders(now, limit, { store: reminderSchedulerStore, enqueue: (job) => env.JOBS.send(job) }),
    redriveInboundOrphans: (now, limit) => redriveInboundOrphans(now, limit, { store: inboundDispatchStore, enqueue: (job) => env.JOBS.send(job) }),
    redriveLoginCodes: (now, limit) => redriveLoginCodes(now, limit, { store: loginStore, enqueue: (job) => env.JOBS.send(job) }),
    ...(contexts ? { purgeConversationContexts: async (now: number, limit: number) => {
      try {
        const count = await contexts.purgeExpired(now, limit);
        console.log(JSON.stringify({ operation: "conversation_cleanup", outcome: "OK", count }));
        return count;
      } catch {
        console.log(JSON.stringify({ operation: "conversation_cleanup", outcome: "FAILED" }));
        return 0;
      }
    } } : {}),
  };
}

export async function createEmailDiscoveryOperations(env: Env): Promise<EmailDiscoveryOperations> {
  const keyring = await createRouteKeyring(env);
  const store = new D1EmailDiscoveryStore(env.DB);
  const rateLimitStore = new D1RateLimitStore(env.DB);
  return { continueEmail: input => continueWithEmail(input, { store, keyring, rateLimitStore }) };
}
export async function createAccountOperations(env: Env): Promise<AccountOperations> {
  const keyring = await createRouteKeyring(env);
  const sessions = new D1SessionStore(env.DB);
  const account = new D1AccountService(env.DB);
  return {
    requireUser: credentials => requireSession(credentials, { store: sessions, keyring }),
    getProfile: userId => account.getProfile(userId),
    updateProfile: (userId, input) => account.updateProfile(userId, input),
    listSessions: principal => account.listSessions(principal),
    revokeOtherSessions: principal => account.revokeOtherSessions(principal),
  };
}

export async function createFollowThroughOperations(env: Env): Promise<FollowThroughOperations> {
  const keyring = await createRouteKeyring(env);
  const store = new D1SessionStore(env.DB);
  const rateStore = new D1RateLimitStore(env.DB);
  return {
    requireUser: credentials => requireSession(credentials, {store,keyring}),
    service: new D1FollowThroughService(env.DB,keyring),
    consume: async userId => {
      const subjectDigest=await keyring.digestCode(`follow-through:${userId}`);
      const result=await consumeRateLimit({subjectDigest,scope:'follow-through-action',limit:60,windowMs:60_000},{store:rateStore});
      if(!result.allowed) throw new RateLimitExceededError(Math.max(1,Math.ceil((result.resetAt-Date.now())/1000)));
    },
  };
}

export async function createPersonalAssistantOperations(env: Env): Promise<PersonalAssistantOperations> {
 const keyring=await createRouteKeyring(env),sessions=new D1SessionStore(env.DB),rateStore=new D1RateLimitStore(env.DB);
 return {requireUser:credentials=>requireSession(credentials,{store:sessions,keyring}),store:new D1PersonalAssistantStore(env.DB,keyring),getBrief:userId=>personalBrief(env.DB,keyring,userId,Date.now()),consume:async userId=>{
 const subjectDigest=await keyring.digestCode(`personal-assistant:${userId}`);
 const rate=await consumeRateLimit({subjectDigest,scope:'personal-assistant',limit:60,windowMs:60_000},{store:rateStore});
 if(!rate.allowed)throw new RateLimitExceededError(Math.max(1,Math.ceil((rate.resetAt-Date.now())/1000)));
 }};
}

export async function createEmailRegistrationOperations(env:Env):Promise<EmailRegistrationOperations> {
 const keyring=await createRouteKeyring(env),rateLimitStore=new D1RateLimitStore(env.DB);
 const deps={database:env.DB,keyring,rateLimitStore,sender:createRegistrationEmailSender(env.REGISTRATION_EMAIL,env.REGISTRATION_EMAIL_FROM)};
 return {requestEmailRegistration:input=>requestEmailRegistration(input,deps),verifyEmailRegistration:async input=>({cookie:(await verifyEmailRegistration(input,deps)).session.cookie})};
}
