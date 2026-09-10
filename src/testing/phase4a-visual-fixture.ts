import { ActionsResponseSchema } from "@/contracts/api/actions";
import { RemindersResponseSchema } from "@/contracts/api/reminders";
import { SessionResponseSchema } from "@/contracts/api/session";

export type Phase4aVisualScenario = "populated" | "action-candidate" | "empty" | "partial-failure";

const session = SessionResponseSchema.parse({
  data: { user: { displayName: "Mai", email: "mai.fixture@example.test", timezone: "Asia/Ho_Chi_Minh" } },
});

const reminders = RemindersResponseSchema.parse({
  data: { reminders: [
    { publicId: "populated-reminder-0001", title: "Gọi khách hàng ABC", scheduledAt: 1_800_025_200_000, timezone: "Asia/Ho_Chi_Minh", status: "PENDING" },
    { publicId: "populated-reminder-0002", title: "Gửi báo giá", scheduledAt: 1_800_034_200_000, timezone: "Asia/Ho_Chi_Minh", status: "PENDING" },
    { publicId: "populated-reminder-0003", title: "Uống thuốc", scheduledAt: 1_800_043_200_000, timezone: "Asia/Ho_Chi_Minh", status: "PENDING" },
  ] },
});

const action = ActionsResponseSchema.parse({
  data: { actions: [{
    id: "fixtureactioncandidate",
    title: "Họp với team vận hành",
    scheduledAt: 1_800_079_200_000,
    timezone: "Asia/Ho_Chi_Minh",
    status: "PENDING",
  }] },
});

const emptyReminders = RemindersResponseSchema.parse({ data: { reminders: [] } });
const emptyActions = ActionsResponseSchema.parse({ data: { actions: [] } });

export function phase4aVisualFixture(scenario: Phase4aVisualScenario) {
  switch (scenario) {
    case "populated": return { session, reminders, actions: emptyActions };
    case "action-candidate": return { session, reminders: emptyReminders, actions: action };
    case "empty": return { session, reminders: emptyReminders, actions: emptyActions };
    case "partial-failure": return {
      session,
      reminders,
      actions: emptyActions,
      actionsFailure: { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "Không thể tải đề xuất." } } },
    };
  }
}
