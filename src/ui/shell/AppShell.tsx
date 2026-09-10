"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
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

export function AppShell({ user, children, activePath = "/app/today" }: { user: SessionUser; children: ReactNode; activePath?: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const firstMoreLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => { if (!moreOpen) return; firstMoreLink.current?.focus(); const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMoreOpen(false); }; const outside = (event: MouseEvent) => { if (moreRef.current && !moreRef.current.contains(event.target as Node)) setMoreOpen(false); }; document.addEventListener("keydown", close); document.addEventListener("mousedown", outside); return () => { document.removeEventListener("keydown", close); document.removeEventListener("mousedown", outside); }; }, [moreOpen]);
  const initial = user.displayName.trim().slice(0, 1).toLocaleUpperCase("vi-VN") || "C";
  return <div className={styles.app}>
    <aside className={styles.rail} aria-label="Điều hướng Calenote">
      <Link className={styles.brand} href="/app/today" aria-label="Calenote Hôm nay"><CalenoteMark /></Link>
      <nav className={styles.navigation} aria-label="Điều hướng chính">
        {primary.map((item) => <NavLink item={item} active={item.href === activePath} key={item.href} />)}
        <p className={styles.groupLabel}>Không gian</p>
        {secondary.map((item) => <NavLink item={item} active={item.href === activePath} key={item.href} />)}
      </nav>
      <div className={styles.profile} aria-label={`Tài khoản ${user.displayName}`}>
        <span className={styles.avatar} aria-hidden="true">{initial}</span>
        <span><strong>{user.displayName}</strong><small>GMT+7</small></span>
      </div>
    </aside>
    <div className={styles.main}>{children}</div>
    <nav className={styles.mobileNav} aria-label="Điều hướng chính trên điện thoại">
      {primary.map((item) => <NavLink item={item} active={item.href === activePath} key={item.href} />)}
      <div className={styles.more} ref={moreRef}><button className={styles.link} type="button" aria-label="Mở thêm điều hướng" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><MoreHorizontal aria-hidden="true" size={19} /><span>Thêm</span></button>{moreOpen && <div className={styles.moreMenu} role="menu" aria-label="Điều hướng thêm"><Link ref={firstMoreLink} role="menuitem" href="/app/connections" onClick={() => setMoreOpen(false)}>Kết nối</Link><Link role="menuitem" href="/app/activity" onClick={() => setMoreOpen(false)}>Hoạt động</Link><Link role="menuitem" href="/app/settings" onClick={() => setMoreOpen(false)}>Cài đặt</Link></div>}</div>
    </nav>
  </div>;
}
