import type { Metadata } from 'next';
import { Suspense } from 'react';
import SignPage from '@/components/sign/SignPage';

export const metadata: Metadata = { title: 'Xem và ký hợp đồng', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const instant = false;
async function Inner({ params }: { params: Promise<{ token: string }> }) { return <SignPage token={(await params).token} />; }
// Trang công khai: không bọc AppShell, không yêu cầu đăng nhập. Token chỉ đọc bên trong Suspense (dữ liệu runtime, tương thích cacheComponents).
export default function Page(props: { params: Promise<{ token: string }> }) { return <Suspense fallback={<p className="p-6 text-sm text-slate-500">Đang tải…</p>}><Inner params={props.params} /></Suspense>; }
