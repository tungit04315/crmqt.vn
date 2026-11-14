'use client';
import { useCallback, useEffect, useRef } from 'react';
import { inkBounds, mid, type Pt, type Stroke } from '@/lib/signature-core';

const INK = '#0b1b4d', EXPORT_BASE = 1000; // 1 đơn vị chuẩn hoá = bề rộng khung; ảnh xuất rộng tối đa ~1000px
function paint(ctx: CanvasRenderingContext2D, strokes: Stroke[], scale: number) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = INK; ctx.fillStyle = INK;
  for (const s of strokes) {
    const p = s.pts, lw = Math.max(1, s.w * scale); ctx.lineWidth = lw; ctx.beginPath();
    if (p.length === 1) { ctx.arc(p[0].x * scale, p[0].y * scale, lw / 2, 0, Math.PI * 2); ctx.fill(); continue; }
    ctx.moveTo(p[0].x * scale, p[0].y * scale);
    for (let i = 1; i < p.length - 1; i++) { const m = mid(p[i], p[i + 1]); ctx.quadraticCurveTo(p[i].x * scale, p[i].y * scale, m.x * scale, m.y * scale); } // đường cong qua điểm giữa → nét mượt
    const last = p[p.length - 1]; ctx.lineTo(last.x * scale, last.y * scale); ctx.stroke();
  }
}
/** Xuất PNG NỀN TRONG SUỐT, cắt sát nét vẽ (có lề). Trả null nếu chưa có nét. */
export function exportSignature(strokes: Stroke[]): string | null {
  const b = inkBounds(strokes); if (!b) return null; const pad = 0.015, x0 = Math.max(0, b.x0 - pad), y0 = b.y0 - pad, w = b.x1 + pad - x0, h = b.y1 + pad - y0;
  const c = document.createElement('canvas'); c.width = Math.max(8, Math.ceil(w * EXPORT_BASE)); c.height = Math.max(8, Math.ceil(h * EXPORT_BASE)); const ctx = c.getContext('2d'); if (!ctx) return null;
  ctx.translate(-x0 * EXPORT_BASE, -y0 * EXPORT_BASE); paint(ctx, strokes, EXPORT_BASE); return c.toDataURL('image/png'); // không tô nền ⇒ alpha = 0 ngoài nét
}

/** Khung ký tay: Pointer Events (pointerdown/move/up/cancel) + setPointerCapture, touch-action:none, hỗ trợ màn hình DPR cao và đổi cỡ. Trạng thái nét do component cha giữ. */
export default function SignaturePad({ strokes, onStrokes, width }: { strokes: Stroke[]; onStrokes: (s: Stroke[]) => void; width: number }) {
  const cv = useRef<HTMLCanvasElement>(null); const live = useRef<Stroke | null>(null); const all = useRef<Stroke[]>(strokes); all.current = strokes;
  const redraw = useCallback((extra?: Stroke | null) => {
    const c = cv.current; if (!c) return; const ctx = c.getContext('2d'); if (!ctx) return; const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); paint(ctx, extra ? [...all.current, extra] : all.current, c.clientWidth);
  }, []);
  useEffect(() => { // đổi cỡ / xoay màn hình: đặt lại độ phân giải thật và vẽ lại từ nét chuẩn hoá
    const c = cv.current; if (!c) return; const fit = () => { const dpr = window.devicePixelRatio || 1; c.width = Math.max(1, Math.floor(c.clientWidth * dpr)); c.height = Math.max(1, Math.floor(c.clientHeight * dpr)); redraw(live.current); };
    const ro = new ResizeObserver(fit); ro.observe(c); fit(); return () => ro.disconnect();
  }, [redraw]);
  useEffect(() => { redraw(); }, [strokes, redraw]);
  const pt = (e: { clientX: number; clientY: number }): Pt => { const r = cv.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.width }; };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => { if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); live.current = { w: width / e.currentTarget.getBoundingClientRect().width, pts: [pt(e)] }; redraw(live.current); };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => { const s = live.current; if (!s) return; e.preventDefault(); const evs = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : []; for (const ev of evs.length ? evs : [e.nativeEvent]) s.pts.push(pt(ev)); redraw(s); };
  const end = (e: React.PointerEvent<HTMLCanvasElement>) => { const s = live.current; if (!s) return; live.current = null; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* đã nhả */ } onStrokes([...all.current, s]); };
  return <canvas ref={cv} role="img" aria-label="Khung ký tay" onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onContextMenu={e => e.preventDefault()}
    className="block h-44 w-full cursor-crosshair rounded-lg border-2 border-dashed border-slate-300 bg-white sm:h-56" style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }} />;
}
