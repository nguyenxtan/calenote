import Link from "next/link";
import { CalenoteMark } from "@/components/brand/CalenoteMark";

export function PlaceholderPage({ title }: { title: string }) {
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px" }}>
    <section aria-labelledby="placeholder-title" style={{ width: "min(480px, 100%)", padding: "28px", border: "1px solid var(--cn-border)", borderRadius: "var(--cn-r-lg)", background: "var(--cn-surface)" }}>
      <CalenoteMark />
      <h1 id="placeholder-title" style={{ marginTop: "24px" }}>{title}</h1>
      <p style={{ color: "var(--cn-text-2)", lineHeight: 1.6 }}>Màn hình này đang được chuẩn bị. Today là phần V2 duy nhất đã sẵn sàng trong giai đoạn này.</p>
      <Link href="/app/today" style={{ color: "var(--cn-brand-700)", fontWeight: 700 }}>Quay lại Today</Link>
    </section>
  </main>;
}
