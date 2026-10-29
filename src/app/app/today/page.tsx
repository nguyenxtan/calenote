import type { Metadata } from "next";
import { TodayExperience } from "@/features/today/TodayExperience";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() { return <TodayExperience allowDeliverySelection={process.env.NEXT_PUBLIC_CALENOTE_ADD_BOT === "1"} />; }
