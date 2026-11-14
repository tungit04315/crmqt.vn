'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import QuotationForm from '@/components/quotations/QuotationForm';
import type { QuotationDetail } from '@/types/quotation';

export default function QuotationEditView() {
  const { id } = useParams<{ id: string }>(); const [d, setD] = useState<QuotationDetail | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<QuotationDetail>(`/api/quotations/${id}`).then(setD).catch(e => setErr(e instanceof ApiError ? e.message : 'Không tải được báo giá.')); }, [id]);
  if (err) return <p className="text-sm text-red-500">{err}</p>;
  if (!d) return <p className="text-sm text-slate-500">Đang tải…</p>;
  if (!d.can.edit) return <div className="space-y-2"><p className="text-sm text-slate-500">Chỉ chỉnh sửa được báo giá ở trạng thái bản nháp và khi bạn có quyền.</p><Link href={`/quotations/${id}`} className="text-sm text-blue-600">← Về chi tiết báo giá</Link></div>;
  return <div className="space-y-4"><h1 className="text-2xl font-bold text-slate-900">Chỉnh sửa {d.quotation.code}</h1><QuotationForm initial={d} /></div>;
}
