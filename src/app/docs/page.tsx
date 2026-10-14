import type { Metadata } from "next";
import { PipelineGuide } from "@/components/docs/PipelineGuide";

export const metadata: Metadata = {
  title: "Hướng dẫn sử dụng",
  description: "Hướng dẫn từng bước: kết nối bot, tạo lời nhắc, duyệt đề xuất và quản lý lịch trong Calenote.",
};

export default function DocsPage() {
  return <PipelineGuide />;
}
