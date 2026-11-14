import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import ContractWizard from '@/components/contracts/ContractWizard';
import { CONTRACT_KINDS } from '@/lib/contract-doc/model';
import type { ContractKind } from '@/lib/contract-doc/types';
export const instant = false;
async function Wizard({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ quotationId?: string }> }) {
  const { kind } = await params, { quotationId } = await searchParams;
  if (!CONTRACT_KINDS.includes(kind as ContractKind)) notFound();
  return <ContractWizard mode="create" kind={kind as ContractKind} quotationId={quotationId} />;
}
export default function Page(props: { params: Promise<{ kind: string }>; searchParams: Promise<{ quotationId?: string }> }) { return <Suspense fallback={<p className="text-sm text-slate-500">Đang tải…</p>}><Wizard {...props} /></Suspense>; }
