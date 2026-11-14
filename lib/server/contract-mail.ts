// Nội dung email ký hợp đồng (HTML dựng bằng hàm thuần; mọi dữ liệu động đều được escape). Mẫu EmailJS chỉ cần: To={{to_email}}, Subject={{subject}}, Content={{{html_body}}}.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const fmtDeadline = (ms: number) => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
export interface Sender { name: string; address: string; hotline: string; email: string }
const shell = (title: string, body: string) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a"><h2 style="margin:0 0 16px;font-size:20px">${esc(title)}</h2>${body}</div>`;
const row = (k: string, v: string) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`;
const senderBlock = (s: Sender) => `<p style="margin:20px 0 0;padding-top:12px;border-top:1px solid #e2e8f0;font-size:13px;color:#475569"><b>${esc(s.name)}</b><br>${esc(s.address)}<br>Hotline: ${esc(s.hotline)} · Email: ${esc(s.email)}</p>`;

export function inviteEmail(p: { signerName: string; contractNumber: string; title: string; sender: Sender; deadline: number; url: string }) {
  return { subject: 'Mời quý khách xem và ký hợp đồng', html: shell('Mời quý khách xem và ký hợp đồng',
    `<p>Kính gửi <b>${esc(p.signerName)}</b>,</p><p>${esc(p.sender.name)} trân trọng mời quý khách xem và ký hợp đồng điện tử dưới đây.</p>
<table style="font-size:14px;border-collapse:collapse">${row('Mã hợp đồng', p.contractNumber)}${row('Tên hợp đồng', p.title)}${row('Hạn ký', fmtDeadline(p.deadline))}</table>
<p style="margin:24px 0"><a href="${esc(p.url)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold;display:inline-block">ĐỌC HỢP ĐỒNG</a></p>
<p style="font-size:12px;color:#64748b">Nếu nút không hoạt động, hãy sao chép liên kết sau vào trình duyệt:<br>${esc(p.url)}<br>Liên kết dành riêng cho quý khách, vui lòng không chuyển tiếp.</p>${senderBlock(p.sender)}`) };
}
export function otpEmail(p: { signerName: string; contractNumber: string; code: string; ttlMin: number; sender: Sender }) {
  return { subject: 'Mã xác thực ký hợp đồng', html: shell('Mã xác thực ký hợp đồng',
    `<p>Kính gửi <b>${esc(p.signerName)}</b>,</p><p>Mã xác thực để ký hợp đồng <b>${esc(p.contractNumber)}</b>:</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:16px 0">${esc(p.code)}</p><p style="font-size:13px;color:#64748b">Mã có hiệu lực trong ${p.ttlMin} phút. Không chia sẻ mã này cho bất kỳ ai. Nếu quý khách không yêu cầu, hãy bỏ qua email này.</p>${senderBlock(p.sender)}`) };
}
export function signedEmail(p: { toName: string; contractNumber: string; title: string; signerName: string; signedAt: number; sender: Sender; url?: string }) {
  return { subject: `Hợp đồng ${p.contractNumber} đã được ký thành công`, html: shell('Ký hợp đồng thành công',
    `<p>Kính gửi <b>${esc(p.toName)}</b>,</p><p>Hợp đồng dưới đây đã được ký thành công.</p><table style="font-size:14px;border-collapse:collapse">${row('Mã hợp đồng', p.contractNumber)}${row('Tên hợp đồng', p.title)}${row('Người ký', p.signerName)}${row('Thời gian ký', fmtDeadline(p.signedAt))}</table>
${p.url ? `<p style="margin:24px 0"><a href="${esc(p.url)}" style="background:#059669;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold;display:inline-block">TẢI HỢP ĐỒNG</a></p>` : ''}${senderBlock(p.sender)}`) };
}
