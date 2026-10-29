import { FinalScreenExperience } from "@/features/final-screens/FinalScreenExperience";
export default function SettingsPage() { return <FinalScreenExperience screen="settings" allowPrimaryLogin={process.env.NEXT_PUBLIC_CALENOTE_PRIMARY_LOGIN === "1"} />; }
