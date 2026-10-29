import { FinalScreenExperience } from "@/features/final-screens/FinalScreenExperience";

export default function ConnectionsPage() {
  return <FinalScreenExperience screen="connections" allowPrimaryLogin={process.env.NEXT_PUBLIC_CALENOTE_PRIMARY_LOGIN === "1"} allowAddConnection={process.env.NEXT_PUBLIC_CALENOTE_ADD_BOT === "1"} />;
}
