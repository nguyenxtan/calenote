"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, Bell, CalendarDays, Inbox, Link2, LogOut, MoreHorizontal, Settings2, Sun } from "lucide-react";
import { CalenoteMark } from "@/components/brand/CalenoteMark";
import type { SessionUser } from "@/contracts/api/session";
import { AmbiguousMutationError, ApiResponseError, apiRequest } from "@/lib/client-api";
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
  const { replace } = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const firstMoreLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => { if (!moreOpen) return; firstMoreLink.current?.focus(); const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMoreOpen(false); }; const outside = (event: MouseEvent) => { if (moreRef.current && !moreRef.current.contains(event.target as Node)) setMoreOpen(false); }; document.addEventListener("keydown", close); document.addEventListener("mousedown", outside); return () => { document.removeEventListener("keydown", close); document.removeEventListener("mousedown", outside); }; }, [moreOpen]);
  const closeAccount = useCallback((restoreFocus = false) => {
    setAccountOpen(false);
    if (restoreFocus) queueMicrotask(() => accountTriggerRef.current?.focus());
  }, []);
  useEffect(() => {
    if (!accountOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") closeAccount(true); };
    const outside = (event: MouseEvent) => { if (accountRef.current && !accountRef.current.contains(event.target as Node)) closeAccount(); };
    document.addEventListener("keydown", close);
    document.addEventListener("mousedown", outside);
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("mousedown", outside); };
  }, [accountOpen, closeAccount]);
  const initial = user.displayName.trim().slice(0, 1).toLocaleUpperCase("vi-VN") || "C";

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setAccountError(null);
    try {
      await apiRequest("/api/auth/logout", {
        method: "POST",
        body: {},
        authenticated: true,
        onUnauthorized: () => {
          closeAccount();
          replace("/login");
        },
      });
      closeAccount();
      replace("/login");
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 401) return;
      setAccountError(error instanceof ApiResponseError
        ? error.message
        : error instanceof AmbiguousMutationError
          ? "Kết quả đăng xuất chưa xác định. Hãy tải lại trang để kiểm tra phiên."
          : "Chưa thể đăng xuất. Vui lòng thử lại.");
    } finally {
      setLoggingOut(false);
    }
  }

  return <div className={styles.app}>
    <aside className={styles.rail} aria-label="Điều hướng Calenote">
      <Link className={styles.brand} href="/app/today" aria-label="Calenote Hôm nay"><CalenoteMark /></Link>
      <nav className={styles.navigation} aria-label="Điều hướng chính">
        {primary.map((item) => <NavLink item={item} active={item.href === activePath} key={item.href} />)}
        <p className={styles.groupLabel}>Không gian</p>
        {secondary.map((item) => <NavLink item={item} active={item.href === activePath} key={item.href} />)}
      </nav>
      <div className={styles.account} ref={accountRef}>
        <button ref={accountTriggerRef} className={styles.profile} type="button" aria-label={`Tài khoản ${user.displayName}`} aria-controls="account-actions" aria-expanded={accountOpen} onClick={() => { setAccountError(null); setAccountOpen((open) => !open); }}>
          <span className={styles.avatar} aria-hidden="true">{initial}</span>
          <span><strong>{user.displayName}</strong><small>{user.timezone}</small></span>
        </button>
        {accountOpen && <div className={styles.accountMenu} id="account-actions" role="group" aria-label="Tài khoản">
          <Link href="/app/settings" onClick={() => closeAccount()}>Cài đặt</Link>
          <button type="button" disabled={loggingOut} onClick={() => void logout()}><LogOut size={16} aria-hidden="true" />{loggingOut ? "Đang đăng xuất…" : "Đăng xuất"}</button>
          {accountError && <p role="alert">{accountError}</p>}
        </div>}
      </div>
    </aside>
    <div className={styles.main}>{children}</div>
    <nav className={styles.mobileNav} aria-label="Điều hướng chính trên điện thoại">
      {primary.map((item) => <NavLink item={item} active={item.href === activePath} key={item.href} />)}
      <div className={styles.more} ref={moreRef}><button className={styles.link} type="button" aria-label="Mở thêm điều hướng" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><MoreHorizontal aria-hidden="true" size={19} /><span>Thêm</span></button>{moreOpen && <div className={styles.moreMenu} role="menu" aria-label="Điều hướng thêm"><Link ref={firstMoreLink} role="menuitem" href="/app/connections" onClick={() => setMoreOpen(false)}>Kết nối</Link><Link role="menuitem" href="/app/activity" onClick={() => setMoreOpen(false)}>Hoạt động</Link><Link role="menuitem" href="/app/settings" onClick={() => setMoreOpen(false)}>Cài đặt</Link><button role="menuitem" type="button" disabled={loggingOut} onClick={() => void logout()}><LogOut size={16} aria-hidden="true" />{loggingOut ? "Đang đăng xuất…" : "Đăng xuất"}</button>{accountError && <p role="alert">{accountError}</p>}</div>}</div>
    </nav>
  </div>;
}
