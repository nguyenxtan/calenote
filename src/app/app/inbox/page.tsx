import type { Metadata } from "next";
import { CoreScreenExperience } from "@/features/core-screens/CoreScreenExperience";
export const metadata: Metadata = { title: "Hộp thư" };
export default function InboxPage() { return <CoreScreenExperience screen="inbox" />; }
