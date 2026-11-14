'use client';
import { useEffect, useRef, useState } from 'react';

// Trình xem PDF nhiều trang bằng pdf.js: mỗi trang một canvas, hỗ trợ độ phân giải cao (devicePixelRatio), phóng to/thu nhỏ, cuộn mượt, co giãn theo màn hình.
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = { getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: { canvasContext: CanvasRenderingContext2D; canvas?: HTMLCanvasElement; viewport: { width: number; height: number }; transform?: number[] }) => { promise: Promise<void>; cancel: () => void } };
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export default function PdfViewer({ src, onError }: { src: string; onError?: (m: string) => void }) {
  const [pdf, setPdf] = useState<PdfDoc | null>(null); const [zoom, setZoom] = useState(1); const [width, setWidth] = useState(0); const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const wrap = useRef<HTMLDivElement>(null); const canvases = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => { // nạp tài liệu
    let dead = false; setState('loading'); setPdf(null);
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        const res = await fetch(src, { cache: 'no-store' });
        if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.error?.message ?? 'Không tải được hợp đồng.'); }
        const doc = (await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise) as unknown as PdfDoc;
        if (!dead) { setPdf(doc); setState('ready'); }
      } catch (e) { if (!dead) { setState('error'); onError?.(e instanceof Error ? e.message : 'Không hiển thị được hợp đồng.'); } }
    })();
    return () => { dead = true; };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // theo dõi bề rộng khung để vừa khít màn hình (xoay máy, đổi cỡ cửa sổ)
    const el = wrap.current; if (!el) return; const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth))); ro.observe(el); setWidth(Math.floor(el.clientWidth)); return () => ro.disconnect();
  }, []);

  useEffect(() => { // vẽ lại khi đổi tài liệu / zoom / bề rộng
    if (!pdf || !width) return; let dead = false; const tasks: { cancel: () => void }[] = [];
    (async () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      for (let n = 1; n <= pdf.numPages && !dead; n++) {
        const page = await pdf.getPage(n), base = page.getViewport({ scale: 1 }), scale = ((width - 2) / base.width) * zoom, vp = page.getViewport({ scale }), c = canvases.current[n - 1]; if (!c || dead) continue;
        c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr); c.style.width = `${Math.floor(vp.width)}px`; c.style.height = `${Math.floor(vp.height)}px`;
        const ctx = c.getContext('2d'); if (!ctx) continue; const t = page.render({ canvasContext: ctx, canvas: c, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }); tasks.push(t);
        try { await t.promise; } catch { /* bị huỷ khi đổi zoom */ }
      }
    })();
    return () => { dead = true; tasks.forEach(t => t.cancel()); };
  }, [pdf, zoom, width]);

  const step = (d: 1 | -1) => setZoom(z => { const i = ZOOMS.findIndex(x => x >= z - 1e-6); return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? 2 : i) + d))]; });
  return (<div className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-center justify-center gap-2 border-b border-slate-200 bg-white py-2 text-sm">
      <button type="button" onClick={() => step(-1)} disabled={zoom <= ZOOMS[0]} aria-label="Thu nhỏ" className="h-8 w-8 rounded-md border border-slate-200 disabled:opacity-40">−</button>
      <button type="button" onClick={() => setZoom(1)} className="h-8 min-w-16 rounded-md border border-slate-200 px-2" aria-label="Vừa khung">{Math.round(zoom * 100)}%</button>
      <button type="button" onClick={() => step(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} aria-label="Phóng to" className="h-8 w-8 rounded-md border border-slate-200 disabled:opacity-40">+</button>
      {pdf && <span className="ml-2 text-xs text-slate-500">{pdf.numPages} trang</span>}</div>
    <div ref={wrap} className="min-h-0 flex-1 overflow-auto scroll-smooth bg-slate-200 p-2 sm:p-4" style={{ WebkitOverflowScrolling: 'touch' }}>
      {state === 'loading' && <p className="py-10 text-center text-sm text-slate-500">Đang tải hợp đồng…</p>}
      {state === 'error' && <p className="py-10 text-center text-sm text-red-600">Không hiển thị được hợp đồng. Vui lòng tải lại trang.</p>}
      <div className="mx-auto flex w-fit flex-col gap-3">{pdf && Array.from({ length: pdf.numPages }, (_, i) => <canvas key={i} ref={el => { canvases.current[i] = el; }} aria-label={`Trang ${i + 1}`} className="bg-white shadow" />)}</div></div></div>);
}
