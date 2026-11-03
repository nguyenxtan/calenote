import type { Metadata } from "next";
import { RegistrationPanel } from "@/components/auth/RegistrationPanel";

export const metadata: Metadata = {
  title: "Đăng ký",
  description: "Xác minh email để tạo tài khoản Calenote, rồi kết nối bot khi bạn sẵn sàng.",
};

export default function RegistrationPage() {
  return <RegistrationPanel />;
}
