// Lớp gửi email trừu tượng. Mặc định dùng EmailJS (REST) với MỘT mẫu chung; muốn đổi sang Resend/SMTP chỉ cần thay `deps.mailer` bằng bản cài đặt khác.
// Lưu ý EmailJS: gọi từ máy chủ cần bật "Allow EmailJS API for non-browser applications" và dùng Private Key (accessToken); gói miễn phí giới hạn ~200 email/tháng, không đính kèm tệp.
import { HttpError } from './errors';

export interface MailMessage { to: string; toName?: string; subject: string; html: string; replyTo?: string }
export interface Mailer { send(m: MailMessage): Promise<{ id: string }> }

export class EmailJsMailer implements Mailer {
  constructor(private cfg: { serviceId: string; templateId: string; publicKey: string; privateKey: string }, private fetchFn: typeof fetch = fetch) {}
  static fromEnv(env: Record<string, string | undefined> = process.env, fetchFn?: typeof fetch): EmailJsMailer {
    const c = { serviceId: env.EMAILJS_SERVICE_ID ?? '', templateId: env.EMAILJS_TEMPLATE_ID ?? '', publicKey: env.EMAILJS_PUBLIC_KEY ?? '', privateKey: env.EMAILJS_PRIVATE_KEY ?? '' };
    const missing = (['serviceId', 'templateId', 'publicKey', 'privateKey'] as const).filter(k => !c[k]).map(k => ({ serviceId: 'EMAILJS_SERVICE_ID', templateId: 'EMAILJS_TEMPLATE_ID', publicKey: 'EMAILJS_PUBLIC_KEY', privateKey: 'EMAILJS_PRIVATE_KEY' })[k]);
    if (missing.length) throw new HttpError(503, 'email-not-configured', `Chưa cấu hình gửi email (thiếu: ${missing.join(', ')}). Xem hướng dẫn trong docs/CONTRACT_ESIGN.md.`);
    return new EmailJsMailer(c, fetchFn);
  }
  async send(m: MailMessage): Promise<{ id: string }> {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15_000);
    try {
      const res = await this.fetchFn('https://api.emailjs.com/api/v1.0/email/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ service_id: this.cfg.serviceId, template_id: this.cfg.templateId, user_id: this.cfg.publicKey, accessToken: this.cfg.privateKey,
          template_params: { to_email: m.to, to_name: m.toName ?? '', subject: m.subject, html_body: m.html, reply_to: m.replyTo ?? '' } }) });
      const text = await res.text().catch(() => '');
      if (!res.ok) throw new HttpError(502, 'email-failed', `Nhà cung cấp email từ chối (HTTP ${res.status}): ${text.slice(0, 200) || 'không rõ lý do'}`);
      return { id: text.slice(0, 80) || 'ok' };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, 'email-failed', (e as Error)?.name === 'AbortError' ? 'Gửi email quá thời gian chờ.' : 'Không kết nối được tới dịch vụ gửi email.');
    } finally { clearTimeout(timer); }
  }
}
