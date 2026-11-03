import type { ReactNode } from 'react';
import { SessionNavigationProvider } from '@/ui/shell/SessionNavigation';
export default function AppLayout({children}:{children:ReactNode}) {
 return <SessionNavigationProvider>{children}</SessionNavigationProvider>;
}
