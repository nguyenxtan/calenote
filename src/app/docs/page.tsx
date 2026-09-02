import type { Metadata } from "next";
import { PipelineGuide } from "@/components/docs/PipelineGuide";

export const metadata: Metadata = {
  title: "Pipeline kết nối bot",
  description: "Luồng kết nối bot Zalo và Telegram vào Calenote.",
};

export default function DocsPage() {
  return <PipelineGuide />;
}
