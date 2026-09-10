import type { Metadata } from "next";
import { TodayExperience } from "@/features/today/TodayExperience";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() { return <TodayExperience />; }
