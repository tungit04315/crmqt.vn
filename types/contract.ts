import type { Change } from '@/lib/opportunity-core';
import type { AcceptResult, CEffective, CStatus, ContractType, FileFormat, RecordKind, ReqStatus, ReqType } from '@/lib/contract-core';
import type { ContractDocData, ContractKind } from '@/lib/contract-doc/types';
import type { ContactInfo, CustomerInfo } from '@/types/quotation';

/** Dữ liệu trả về từ API (thời gian dạng chuỗi ISO, ngày dạng YYYY-MM-DD) */
export interface ContractListDto {
  id: string; code: string; title: string; type: ContractType; status: CStatus; effectiveStatus: CEffective; customerId: string; customerCode: string; customerName: string;
  quotationId: string | null; quotationCode: string; value: number; startDate: string | null; endDate: string | null; signedDate: string | null; daysLeft: number | null;
  ownerUid: string; ownerName: string; departmentId: string | null; createdAt: string; updatedAt: string; version: number;
}
export interface ContractDto extends ContractListDto {
  contactId: string | null; representative: string; paymentTerms: string; content: string; opportunityId: string | null; endReason: string; liquidationDate: string | null;
  versionCount: number; appendixCount: number; submittedBy: string | null; approvedByName: string; docKind: ContractKind | null; contractNumber: string;
}
interface ChildBase { id: string; contractId: string; contractCode: string; customerName: string; createdByName: string; createdAt: string }
export interface VersionDto extends ChildBase { versionNo: number; kind: 'draft' | 'signed'; label: string; fileName: string; fileFormat: FileFormat; note: string }
export interface AppendixDto extends ChildBase { appendixNo: number; code: string; title: string; signedDate: string | null; effectiveDate: string | null; description: string }
export interface RecordDto extends ChildBase { kind: RecordKind; title: string; recordDate: string; confirmedBy: string; result: AcceptResult | ''; note: string }
export interface RequestDto extends ChildBase {
  type: ReqType; status: ReqStatus; reason: string; newEndDate: string | null; newValue: number | null; newPaymentTerms: string | null; liquidationDate: string | null; outstandingNote: string; checklist: string[];
  baseEndDate: string | null; baseValue: number; requestedBy: string; decidedByName: string; decisionNote: string; decidedAt: string | null; can: { decide: boolean; cancel: boolean };
}
export interface ContractHistoryDto { id: string; type: string; changes: Change[]; note: string; actorName: string; at: string }
export interface ContractFlags { edit: boolean; submit: boolean; approve: boolean; reject: boolean; sign: boolean; recall: boolean; cancel: boolean; end: boolean; remove: boolean; addVersion: boolean; addAppendix: boolean; addRecord: boolean; requestChange: boolean }
export interface ContractDetail {
  contract: ContractDto; doc: ContractDocData | null; customer: CustomerInfo | null; contact: ContactInfo | null; versions: VersionDto[]; appendices: AppendixDto[]; records: RecordDto[]; requests: RequestDto[];
  history: ContractHistoryDto[]; can: ContractFlags;
}
export type ListKind = 'versions' | 'appendices' | 'acceptances' | 'handovers' | 'requests' | 'renewal-history';
