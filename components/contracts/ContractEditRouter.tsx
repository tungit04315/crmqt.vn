'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { ContractDetail } from '@/types/contract';
import ContractForm from './ContractForm';
import ContractWizard from './ContractWizard';
import { errMsg } from './ui';

/** Hợp đồng tạo theo loại (Web/SEO/Tích xanh) sửa bằng wizard; hợp đồng cũ nhập tay vẫn dùng biểu mẫu cũ. */
export default function ContractEditRouter() {
  const { id } = useParams<{ id: string }>(); const [kind, setKind] = useState<'doc' | 'legacy' | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<ContractDetail>(`/api/contracts/${id}`).then(d => setKind(d.contract.docKind ? 'doc' : 'legacy')).catch(e => setErr(errMsg(e, 'Không tải được hợp đồng.'))); }, [id]);
  if (err) return <p className="text-sm text-red-500">{err}</p>;
  if (!kind) return <p className="text-sm text-slate-500">Đang tải…</p>;
  return kind === 'doc' ? <ContractWizard mode="edit" /> : <ContractForm mode="edit" />;
}
