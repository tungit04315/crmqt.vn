// Lõi ký hợp đồng điện tử (thuần, KHÔNG phụ thuộc Node/Firebase nên dùng được cả ở trình duyệt): trạng thái liên kết, kiểm tra điều kiện ký, DTO công khai.
/** JSON ổn định (khoá sắp xếp) để băm nội dung hợp đồng: cùng nội dung ⇒ cùng hash, bất kể thứ tự khoá. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

export type LinkState = 'ready' | 'signed' | 'expired' | 'revoked' | 'cancelled' | 'changed' | 'unavailable';
export const LINK_MESSAGE: Record<Exclude<LinkState, 'ready'>, string> = {
  signed: 'Hợp đồng này đã được ký. Không thể ký lại.',
  expired: 'Liên kết đã hết hạn. Vui lòng liên hệ người gửi để nhận liên kết mới.',
  revoked: 'Liên kết này đã bị thu hồi hoặc đã được thay bằng liên kết mới. Vui lòng dùng email mới nhất hoặc liên hệ người gửi.',
  cancelled: 'Hợp đồng đã bị hủy nên không thể ký.',
  changed: 'Nội dung hợp đồng đã thay đổi sau khi gửi. Vui lòng chờ người gửi gửi lại bản mới để ký.',
  unavailable: 'Hợp đồng hiện không ở trạng thái chờ ký.',
};

export interface LinkInput {
  token: { revokedAt: number | null; usedAt: number | null; expiresAt: number; docHash: string };
  contract: { status: string; deleted: boolean; signingStatus: string | null; docHash: string };
  now: number;
}
/** Thứ tự ưu tiên cố định để thông báo luôn rõ ràng và an toàn: đã ký > thu hồi > hủy > hết hạn > đổi nội dung > sai trạng thái */
export function evaluateLink(i: LinkInput): LinkState {
  if (i.token.usedAt || i.contract.signingStatus === 'signed') return 'signed';
  if (i.token.revokedAt) return 'revoked';
  if (i.contract.deleted || i.contract.status === 'cancelled') return 'cancelled';
  if (i.token.expiresAt <= i.now) return 'expired';
  if (i.contract.docHash !== i.token.docHash) return 'changed';
  if (i.contract.status !== 'pending_signature') return 'unavailable';
  return 'ready';
}

export interface SigningInfo {
  state: LinkState; message: string; canSign: boolean;
  contractNumber: string; title: string; customerName: string; signerName: string; signerEmailMasked: string;
  sender: { name: string; address: string; hotline: string; email: string };
  expiresAt: string; requiresOtp: boolean; otpVerified: boolean;
  signedAt: string | null; signedBy: string | null; canDownload: boolean;
}
export interface SignEventDto { type: string; at: string | null; ip: string; note: string }
export interface EmailLogDto { template: string; to: string; status: 'sent' | 'failed'; error: string; at: string | null }
export interface SigningStatusDto {
  status: 'none' | 'sent' | 'signed' | 'revoked'; sentAt: string | null; expiresAt: string | null; sentCount: number; signerName: string; signerEmail: string; signedAt: string | null; stale: boolean; partyBSignature: boolean;
  can: { send: boolean; revoke: boolean; reopen: boolean }; logs: EmailLogDto[]; events: SignEventDto[];
}
export const maskEmail = (e: string) => { const [u = '', d = ''] = e.split('@'); return u ? `${u.slice(0, Math.min(2, u.length))}${'*'.repeat(Math.max(1, u.length - 2))}@${d}` : ''; };
