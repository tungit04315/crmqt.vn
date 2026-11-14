import { dataUrlBytes, fitWidth, SIG_OUT_MAX } from '@/lib/signature-core';

/** Đọc ảnh tải lên, thu nhỏ (≤ 900px rộng) để nhẹ, giữ PNG (giữ nền trong suốt)/JPEG; báo lỗi nếu vẫn quá lớn. */
export async function prepareUpload(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Không đọc được ảnh. Vui lòng chọn ảnh PNG/JPG khác.')); i.src = url; });
    const { w, h } = fitWidth(img.naturalWidth, img.naturalHeight, 900), c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d')!;
    const png = file.type === 'image/png'; if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); } ctx.drawImage(img, 0, 0, w, h);
    let out = png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9); if (dataUrlBytes(out) > SIG_OUT_MAX) out = c.toDataURL('image/jpeg', 0.7);
    if (dataUrlBytes(out) > SIG_OUT_MAX) throw new Error('Ảnh vẫn quá lớn sau khi thu nhỏ. Vui lòng chọn ảnh nhỏ hơn.'); return out;
  } finally { URL.revokeObjectURL(url); }
}

