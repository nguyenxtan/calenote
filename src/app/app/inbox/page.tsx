import type { Metadata } from "next";
import { CoreScreenExperience } from "@/features/core-screens/CoreScreenExperience";
export const metadata: Metadata = { title: "Hộp thư" };
export default function InboxPage() { return <CoreScreenExperience screen="inbox" allowDeliverySelection={process.env.NEXT_PUBLIC_CALENOTE_ADD_BOT === "1"} />; }
