// Kiểu dữ liệu dùng chung cho 3 loại hợp đồng (Web, SEO, Tích xanh Meta). Tên trường giữ nguyên như dự án hợp đồng mẫu.
export type ContractKind = 'web' | 'seo' | 'tick';

export interface PartyA {
  companyName: string; taxCode: string; address: string; representativeTitle: string; representativeName: string; representativePosition: string;
  phone: string; email: string; authorizationNumber?: string;
}
export interface PartyB {
  companyName: string; taxCode: string; address: string; representativeTitle: string; representativeName: string; representativePosition: string;
  hotline: string; email: string; bankAccount: string; bankName: string; bankHolder?: string;
}
export interface Feature { name: string; description?: string }

export interface WebContent {
  contractValue: number; vatPercent: number; demoDays: number; acceptanceDays: number;
  domainNote: string; hostingNote: string; extraServicesNote: string; effectiveDate?: string; liquidationDate?: string;
}
export interface SeoContent {
  contractValue: number; vatIncluded: 'included' | 'excluded'; dot1Percent: number; dot2Percent: number; dot2Milestone: string;
  lateInterestPercent: number; acceptanceDays: number; confidentialityYears: number; freeRevisions: number;
  keywordsScope: string; articleCount: string | number; reportFrequency: string; timeline: string; specialRequirements?: string; effectiveDate?: string;
}
export interface TickContent {
  fanpageName?: string; fanpageUrl?: string; serviceFee: number; vatPercent?: number; minCardBalance?: number; viaDays?: number;
  warrantyMonths?: number; validityMonths?: number; refundWeeks?: number; additionalAgreement?: string;
}

interface Base { contractNumber: string; signDate: string; signPlace?: string; partyA: PartyA; partyB: PartyB }
export interface WebData extends Base { kind: 'web'; content: WebContent; features?: Feature[] }
export interface SeoData extends Base { kind: 'seo'; content: SeoContent }
export interface TickData extends Base { kind: 'tick'; content: TickContent }
export type ContractDocData = WebData | SeoData | TickData;

/** Định nghĩa tài liệu pdfmake (hàm dựng thuần, không phụ thuộc pdfmake) */
export type DocDef = Record<string, unknown>;
