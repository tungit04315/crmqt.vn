import QuotationForm from '@/components/quotations/QuotationForm';

export const instant = false;
export default async function NewQuotation({ searchParams }: { searchParams: Promise<{ customerId?: string; opportunityId?: string }> }) {
  const { customerId, opportunityId } = await searchParams;
  return <div className="space-y-4"><h1 className="text-2xl font-bold text-slate-900">Tạo báo giá</h1><QuotationForm defaultCustomerId={customerId} defaultOpportunityId={opportunityId} /></div>;
}
