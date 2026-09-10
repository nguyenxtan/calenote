import type { Metadata } from "next";
import { CoreScreenExperience } from "@/features/core-screens/CoreScreenExperience";
export const metadata: Metadata = { title: "Lịch" };
export default function CalendarPage() { return <CoreScreenExperience screen="calendar" />; }
