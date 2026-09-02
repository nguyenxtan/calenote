import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Calenote — Lịch bắt đầu từ một câu chat",
    template: "%s · Calenote",
  },
  description:
    "Kết nối bot Zalo hoặc Telegram của riêng bạn để biến những câu chat thành lịch nhắc.",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f4f1e8",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
