'use client';
import Link from 'next/link';
import { FileText, Globe, BadgeCheck, Search } from 'lucide-react';
import { KIND_LABEL } from '@/lib/contract-doc/model';
import type { ContractKind } from '@/lib/contract-doc/types';

const ITEMS: { kind: ContractKind; icon: typeof Globe; desc: string }[] = [
  { kind: 'web', icon: Globe, desc: 'Thiết kế website: danh mục tính năng, VAT đã gồm trong giá trị, thanh toán 2 đợt 50/50.' },
  { kind: 'seo', icon: Search, desc: 'Dịch vụ SEO: phạm vi từ khóa, KPI, thanh toán theo đợt (% tuỳ chỉnh), Phụ lục 01.' },
  { kind: 'tick', icon: BadgeCheck, desc: 'Tư vấn đăng ký Tích xanh Meta (Facebook): phí dịch vụ + VAT, bảo hành, hoàn tiền.' },
];
export default function ContractTypeMenu({ quotationId }: { quotationId?: string }) {
  const q = quotationId ? `?quotationId=${encodeURIComponent(quotationId)}` : '';
  return (<div className="space-y-4"><div><h1 className="text-2xl font-bold text-slate-900">Tạo hợp đồng</h1><p className="text-sm text-slate-500">Chọn loại hợp đồng. Nội dung PDF được tạo từ thông tin bạn nhập qua từng bước.</p></div>
    <div className="grid gap-4 md:grid-cols-3">{ITEMS.map(({ kind, icon: I, desc }) => (
      <Link key={kind} href={`/contracts/new/${kind}${q}`} className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-400 hover:shadow">
        <I size={28} className="text-blue-600" /><h2 className="mt-3 font-semibold text-slate-900">{KIND_LABEL[kind]}</h2><p className="mt-1 text-sm text-slate-500">{desc}</p><span className="mt-3 inline-block text-sm font-medium text-blue-600 group-hover:underline">Bắt đầu →</span></Link>))}</div>
    <p className="flex items-center gap-2 text-xs text-slate-400"><FileText size={14} />Hợp đồng cũ nhập tay vẫn xem được trong danh sách hợp đồng.</p></div>);
}
