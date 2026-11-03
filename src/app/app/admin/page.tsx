import type { Metadata } from 'next';
import { AdminOverview } from '@/features/admin/AdminOverview';
export const metadata:Metadata={title:'Quản trị',robots:{index:false,follow:false}};
export default function AdminPage(){return <AdminOverview/>;}
