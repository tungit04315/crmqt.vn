import type { Change } from '@/lib/opportunity-core';
import type { ItemComputed, QEffective, QStatus, Totals } from '@/lib/quotation-core';
import type { Company } from '@/lib/company-core';
import type { CatalogType as ProductType } from '@/types/catalog';

/** Dữ liệu trả về từ API (thời gian dạng chuỗi ISO, ngày dạng YYYY-MM-DD) */
export interface QuotationListDto {
  id: string; code: string; title: string; status: QStatus; effectiveStatus: QEffective; customerId: string; customerCode: string; customerName: string;
  opportunityId: string | null; opportunityCode: string; opportunityTitle: string; issueDate: string; validUntil: string; grandTotal: number; itemCount: number;
  ownerUid: string; ownerName: string; departmentId: string | null; sentAt: string | null; createdAt: string; updatedAt: string; version: number;
}
export interface QuotationDto extends QuotationListDto { contactId: string | null; paymentTerms: string; notes: string; items: ItemComputed[]; totals: Totals }
export interface CustomerInfo { id: string; code: string; name: string; taxCode: string; address: string; phone: string; email: string }
export interface ContactInfo { id: string; name: string; position: string; phone: string; email: string }
export interface QuotationHistoryDto { id: string; type: string; changes: Change[]; note: string; actorName: string; at: string }
export interface QuotationFlags { edit: boolean; send: boolean; accept: boolean; reject: boolean; cancel: boolean; reopen: boolean; remove: boolean }
export interface QuotationDetail {
  quotation: QuotationDto; customer: CustomerInfo | null; contact: ContactInfo | null; opportunity: { id: string; code: string; title: string } | null;
  company: Company | null; history: QuotationHistoryDto[]; can: QuotationFlags;
}
export interface ProductDto { id: string; code: string; name: string; type: ProductType; unit: string; unitPrice: number; taxRate: number; description: string; active: boolean; createdAt: string; updatedAt: string }
