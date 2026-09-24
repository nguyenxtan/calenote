import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "@fontsource/be-vietnam-pro/latin-400.css";
import "@fontsource/be-vietnam-pro/vietnamese-400.css";
import "@fontsource/be-vietnam-pro/latin-500.css";
import "@fontsource/be-vietnam-pro/vietnamese-500.css";
import "@fontsource/be-vietnam-pro/latin-600.css";
import "@fontsource/be-vietnam-pro/vietnamese-600.css";
import "@fontsource/be-vietnam-pro/latin-700.css";
import "@fontsource/be-vietnam-pro/vietnamese-700.css";

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
  themeColor: "#fcfaf8",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
