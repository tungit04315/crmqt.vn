import { Suspense } from 'react';
import ContractTypeMenu from '@/components/contracts/ContractTypeMenu';
export const instant = false;
// ?quotationId=... được chuyển tiếp sang wizard để tạo hợp đồng từ báo giá "Khách chấp nhận". searchParams là dữ liệu runtime nên đọc trong Suspense (cacheComponents)
async function Menu({ searchParams }: { searchParams: Promise<{ quotationId?: string }> }) { const { quotationId } = await searchParams; return <ContractTypeMenu quotationId={quotationId} />; }
export default function Page(props: { searchParams: Promise<{ quotationId?: string }> }) { return <Suspense fallback={<p className="text-sm text-slate-500">Đang tải…</p>}><Menu searchParams={props.searchParams} /></Suspense>; }
