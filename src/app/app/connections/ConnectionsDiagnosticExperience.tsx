"use client";

import { useSearchParams } from "next/navigation";
import { FinalScreenExperience } from "@/features/final-screens/FinalScreenExperience";

export function ConnectionsDiagnosticExperience() {
  const searchParams = useSearchParams();
  return <FinalScreenExperience screen="connections" diagnosticZaloPoll={searchParams.get("diagnostic") === "zalo-poll"} />;
}
