"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, Bell, CalendarDays, Inbox, Link2, MoreHorizontal, Settings2, Sun } from "lucide-react";
import { CalenoteMark } from "@/components/brand/CalenoteMark";
import type { SessionUser } from "@/contracts/api/session";
import styles from "./AppShell.module.css";

type NavigationItem = { href: string; label: string; icon: typeof Sun };

const primary: readonly NavigationItem[] = [
  { href: "/app/today", label: "Hôm nay", icon: Sun },
  { href: "/app/calendar", label: "Lịch", icon: CalendarDays },
  { href: "/app/inbox", label: "Hộp thư", icon: Inbox },
  { href: "/app/reminders", label: "Lời nhắc", icon: Bell },
];
const secondary: readonly NavigationItem[] = [
  { href: "/app/connections", label: "Kết nối", icon: Link2 },
  { href: "/app/activity", label: "Hoạt động", icon: Activity },
  { href: "/app/settings", label: "Cài đặt", icon: Settings2 },
];

function NavLink({ item, active }: { item: NavigationItem; active: boolean }) {
  const Icon = item.icon;
  return <Link className={active ? styles.active : styles.link} href={item.href} aria-current={active ? "page" : undefined}>
    <Icon aria-hidden="true" size={18} strokeWidth={1.9} /> <span>{item.label}</span>
  </Link>;
}

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const initial = user.displayName.trim().slice(0, 1).toLocaleUpperCase("vi-VN") || "C";
  return <div className={styles.app}>
    <aside className={styles.rail} aria-label="Điều hướng Calenote">
      <Link className={styles.brand} href="/app/today" aria-label="Calenote Hôm nay"><CalenoteMark /></Link>
      <nav className={styles.navigation} aria-label="Điều hướng chính">
        {primary.map((item) => <NavLink item={item} active={item.href === "/app/today"} key={item.href} />)}
        <p className={styles.groupLabel}>Không gian</p>
        {secondary.map((item) => <NavLink item={item} active={false} key={item.href} />)}
      </nav>
      <div className={styles.profile} aria-label={`Tài khoản ${user.displayName}`}>
        <span className={styles.avatar} aria-hidden="true">{initial}</span>
        <span><strong>{user.displayName}</strong><small>GMT+7</small></span>
      </div>
    </aside>
    <div className={styles.main}>{children}</div>
    <nav className={styles.mobileNav} aria-label="Điều hướng chính trên điện thoại">
      {primary.map((item) => <NavLink item={item} active={item.href === "/app/today"} key={item.href} />)}
      <Link className={styles.link} href="/app/settings"><MoreHorizontal aria-hidden="true" size={19} /><span>Thêm</span></Link>
    </nav>
  </div>;
}
