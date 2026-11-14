'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, inp } from '@/components/ui/form';
import { COLORS, GROUPS, GROUP_LABEL, type StatusDef, type TaskConfig } from '@/types/task';
import { StatusBadge, errMsg, useTaskMeta } from './ui';

/** Cấu hình trạng thái công việc, loại công việc và mốc nhắc deadline (chỉ Super Admin). Mã và nhóm của trạng thái đã tồn tại không đổi được; trạng thái chỉ tắt, không xóa. */
export default function TaskConfigEditor() {
  const { meta, err: metaErr } = useTaskMeta();
  if (metaErr) return <Alert>{metaErr}</Alert>;
  if (!meta) return <p className="text-sm text-slate-500">Đang tải…</p>;
  if (!meta.can.config) return <Alert>Chỉ Super Admin được thay đổi cấu hình công việc.</Alert>;
  return <Editor initial={meta.config} />;
}

function Editor({ initial }: { initial: TaskConfig }) {
  const [cfg, setCfg] = useState<TaskConfig>(initial);
  const [types, setTypes] = useState(initial.types.join('\n')); const [mins, setMins] = useState(initial.reminderMinutes.join(', '));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState(false);
  const known = new Set(initial.statuses.map(s => s.key));
  useEffect(() => { if (!ok) return; const t = setTimeout(() => setOk(false), 3000); return () => clearTimeout(t); }, [ok]);
  const upd = (i: number, p: Partial<StatusDef>) => setCfg(c => ({ ...c, statuses: c.statuses.map((s, j) => (j === i ? { ...s, ...p } : s)) }));
  const add = () => setCfg(c => ({ ...c, statuses: [...c.statuses, { key: '', label: '', group: 'waiting', color: 'slate', order: c.statuses.length + 1, active: true }] }));

  async function save() {
    setBusy(true); setErr(''); setOk(false);
    try {
      const body = { ...cfg, types: types.split('\n').map(x => x.trim()).filter(Boolean), reminderMinutes: mins.split(',').map(x => x.trim()).filter(Boolean).map(Number) };
      const r = await api<TaskConfig>('/api/tasks/config', { method: 'PUT', json: body });
      setCfg(r); setTypes(r.types.join('\n')); setMins(r.reminderMinutes.join(', ')); setOk(true);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (<div className="space-y-4">
    <div><h1 className="text-xl font-bold">Cấu hình công việc</h1><p className="text-sm text-slate-500">Mọi phép tính (quá hạn, tiến độ, báo cáo) dựa vào <b>nhóm</b> của trạng thái, không dựa vào tên.</p></div>
    {err && <Alert>{err}</Alert>}{ok && <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">Đã lưu cấu hình.</div>}
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="mb-3 text-sm font-semibold">Trạng thái</h2>
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="text-left text-xs text-slate-500"><tr>{['Thứ tự', 'Mã', 'Tên hiển thị', 'Nhóm', 'Màu', 'Đang dùng', 'Xem trước'].map(h => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{cfg.statuses.map((s, i) => { const old = known.has(s.key); return (<tr key={i} className="border-t border-slate-100">
          <td className="p-2"><input type="number" aria-label="Thứ tự" value={s.order} onChange={e => upd(i, { order: Number(e.target.value) })} className={`${inp} w-16`} /></td>
          <td className="p-2"><input aria-label="Mã" disabled={old} value={s.key} onChange={e => upd(i, { key: e.target.value.trim() })} placeholder="vd: review" className={`${inp} w-32`} /></td>
          <td className="p-2"><input aria-label="Tên" maxLength={40} value={s.label} onChange={e => upd(i, { label: e.target.value })} className={inp} /></td>
          <td className="p-2"><select aria-label="Nhóm" disabled={old} value={s.group} onChange={e => upd(i, { group: e.target.value as StatusDef['group'] })} className={inp}>{GROUPS.map(g => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}</select></td>
          <td className="p-2"><select aria-label="Màu" value={s.color} onChange={e => upd(i, { color: e.target.value as StatusDef['color'] })} className={inp}>{COLORS.map(c => <option key={c}>{c}</option>)}</select></td>
          <td className="p-2 text-center"><input type="checkbox" aria-label="Đang dùng" checked={s.active} onChange={e => upd(i, { active: e.target.checked })} /></td>
          <td className="p-2">{s.label && <StatusBadge cfg={cfg} s={s.key} />}</td></tr>); })}</tbody></table></div>
      <button type="button" onClick={add} className="mt-3 h-9 rounded-lg border border-slate-200 px-3 text-sm">+ Thêm trạng thái</button>
      <p className="mt-2 text-xs text-slate-400">Cần ít nhất một trạng thái đang dùng ở mỗi nhóm: Chưa bắt đầu, Đang thực hiện, Hoàn thành. Trạng thái đã tạo không xóa được, chỉ tắt.</p></section>
    <section className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="mb-2 text-sm font-semibold">Loại công việc (mỗi dòng một loại)</h2><textarea value={types} onChange={e => setTypes(e.target.value)} className="min-h-[120px] w-full rounded-md border border-slate-200 p-3 text-sm" /></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="mb-2 text-sm font-semibold">Mốc nhắc deadline qua email (phút trước hạn)</h2><input value={mins} onChange={e => setMins(e.target.value)} placeholder="1440, 120" className={inp} />
        <p className="mt-2 text-xs text-slate-400">Ví dụ 1440, 120 = nhắc trước 24 giờ và 2 giờ; hệ thống nhắc thêm một lần khi quá hạn. Tối đa 5 mốc (5 phút – 30 ngày). Email do Google Apps Script gửi theo lịch.</p></div></section>
    <div className="text-right"><button onClick={save} disabled={busy} className="h-10 rounded-md bg-blue-600 px-6 text-sm font-medium text-white disabled:opacity-70">{busy ? 'Đang lưu…' : 'Lưu cấu hình'}</button></div>
  </div>);
}
