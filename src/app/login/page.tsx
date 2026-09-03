import type { Metadata } from "next";
import { LoginPanel } from "@/components/auth/LoginPanel";

export const metadata: Metadata = {
  title: "Đăng nhập",
  description: "Đăng nhập Calenote bằng mã dùng một lần được gửi qua bot của bạn.",
};

export default function LoginPage() {
  return <LoginPanel />;
}
