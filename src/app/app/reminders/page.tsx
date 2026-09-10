import type { Metadata } from "next";
import { CoreScreenExperience } from "@/features/core-screens/CoreScreenExperience";
export const metadata: Metadata = { title: "Lời nhắc" };
export default function RemindersPage() { return <CoreScreenExperience screen="reminders" />; }
