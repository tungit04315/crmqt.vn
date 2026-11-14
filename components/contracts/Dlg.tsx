'use client';
import { useState, type ReactNode } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Alert, area, FormFooter, inp, L } from '@/components/ui/form';
import { errMsg } from './ui';

export interface FieldDef { key: string; label: string; type: 'text' | 'textarea' | 'date' | 'select' | 'number' | 'lines'; required?: boolean; options?: [string, string][]; hint?: string; init?: string; wide?: boolean }
/** Hộp thoại biểu mẫu cấu hình được: dùng cho mọi thao tác nhập liệu nhỏ của phân hệ Hợp đồng (ghi chú, ngày ký, phiên bản, phụ lục, yêu cầu…) */
export default function Dlg({ title, fields, submitLabel, danger, intro, onClose, onSubmit }: {
  title: string; fields: FieldDef[]; submitLabel: string; danger?: boolean; intro?: ReactNode; onClose: () => void; onSubmit: (v: Record<string, unknown>) => Promise<void>;
}) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.key, f.init ?? ''])));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const set = (k: string, x: string) => setV(s => ({ ...s, [k]: x }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    const miss = fields.find(f => f.required && !v[f.key].trim()); if (miss) { setErr(`Vui lòng nhập: ${miss.label}.`); return; }
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const s = v[f.key];
      if (f.type === 'number') { if (s.trim()) out[f.key] = Number(s.replace(/\D/g, '')); }
      else if (f.type === 'lines') out[f.key] = s.split('\n').map(x => x.trim()).filter(Boolean);
      else if (s.trim()) out[f.key] = s.trim(); // ô trống = không gửi (nghĩa là "không đổi"/"không có"), tránh ghi đè bằng chuỗi rỗng
    }
    setBusy(true); setErr(null);
    try { await onSubmit(out); } catch (x) { setErr(errMsg(x)); setBusy(false); }
  }
  return (<Modal title={title} onClose={onClose} wide={fields.some(f => f.wide)}><form onSubmit={submit} className="space-y-3">
    {intro && <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{intro}</div>}
    {fields.map(f => (<L key={f.key} t={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint}>
      {f.type === 'textarea' || f.type === 'lines' ? <textarea className={`${area} ${f.wide ? 'min-h-[280px]' : ''}`} value={v[f.key]} onChange={e => set(f.key, e.target.value)} />
        : f.type === 'select' ? <select className={inp} value={v[f.key]} onChange={e => set(f.key, e.target.value)}>{f.options?.map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}</select>
        : f.type === 'number' ? <input className={inp} inputMode="numeric" value={v[f.key] ? Number(v[f.key].replace(/\D/g, '')).toLocaleString('vi-VN') : ''} onChange={e => set(f.key, e.target.value.replace(/\D/g, ''))} />
        : <input className={inp} type={f.type === 'date' ? 'date' : 'text'} value={v[f.key]} onChange={e => set(f.key, e.target.value)} />}</L>))}
    {err && <Alert>{err}</Alert>}
    <FormFooter busy={busy} label={submitLabel} onClose={onClose} danger={danger} /></form></Modal>);
}
