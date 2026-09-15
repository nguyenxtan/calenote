import { Suspense } from "react";
import { ConnectionsDiagnosticExperience } from "./ConnectionsDiagnosticExperience";

export default function ConnectionsPage() {
  return <Suspense fallback={null}><ConnectionsDiagnosticExperience /></Suspense>;
}
