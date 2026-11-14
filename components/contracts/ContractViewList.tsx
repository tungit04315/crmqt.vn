'use client';
import { useParams } from 'next/navigation';
import { VIEWS } from '@/lib/contract-core';
import ContractList from './ContractList';

/** Chế độ xem lưu sẵn: /contracts/view/<draft|pending_approval|pending_signature|active|expiring|ended> */
export default function ContractViewList() {
  const { view } = useParams<{ view: string }>();
  if (!(VIEWS as readonly string[]).includes(view)) return <p className="text-sm text-slate-500">Chế độ xem không tồn tại.</p>;
  return <ContractList view={view} />;
}
