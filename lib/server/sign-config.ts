// Cấu hình ký điện tử đọc từ biến môi trường (đọc tại thời điểm gọi để test/đổi cấu hình không cần khởi động lại).
export interface SignConfig { baseUrl: string; linkTtlDays: number; otpRequired: boolean; otpTtlMin: number; notifyOwner: boolean; maxPdfBytes: number }
const int = (v: string | undefined, d: number, min: number, max: number) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : d; };
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : !['0', 'false', 'no', 'off'].includes(v.toLowerCase()));
export function signConfig(env: Record<string, string | undefined> = process.env): SignConfig {
  return {
    baseUrl: (env.APP_BASE_URL ?? '').trim().replace(/\/+$/, ''),
    linkTtlDays: int(env.SIGN_LINK_TTL_DAYS, 7, 1, 90),
    otpRequired: bool(env.SIGN_OTP_REQUIRED, true),
    otpTtlMin: int(env.SIGN_OTP_TTL_MIN, 10, 2, 60),
    notifyOwner: bool(env.SIGN_NOTIFY_OWNER, true),
    maxPdfBytes: 8_000_000,
  };
}
