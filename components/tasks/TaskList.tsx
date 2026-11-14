'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Plus, RefreshCw, Search } from 'lucide-react';
import { api, download } from '@/lib/api';
import { Alert, FormFooter, L, inp } from '@/components/ui/form';
import { Modal } from '@/components/ui/Modal';
import { PRIORITIES, PRIORITY_LABEL, type BulkRes, type TaskDto, type TaskListRes, type TaskMeta, type TaskPriority, type TaskStats, type TaskView } from '@/types/task';
import { OverdueBadge, PriorityBadge, StatusBadge, errMsg, fmtDT, sel, useTaskMeta } from './ui';

const TITLE: Record<TaskView, [string, string]> = {
  all: ['Tất cả công việc', 'Toàn bộ công việc trong phạm vi dữ liệu của bạn.'],
  mine: ['Công việc của tôi', 'Các công việc bạn thực hiện hoặc phối hợp.'],
  assigned: ['Công việc được giao', 'Các công việc bạn đã giao cho người khác.'],
  overdue: ['Công việc quá hạn', 'Việc chưa hoàn thành và đã qua deadline, cũ nhất trước.'],
  done: ['Công việc hoàn thành', 'Các công việc đã hoàn thành và lưu trữ kết quả.'],
  trash: ['Công việc đã xóa', 'Công việc đã xóa mềm. Mở chi tiết để khôi phục.'],
};
const Card = ({ label, v, c }: { label: string; v: number | undefined; c?: string }) => <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className={`text-2xl font-bold ${c ?? 'text-slate-900'}`}>{v ?? '—'}</div></div>;
const PAGE = 20;
const EMPTY = { q: '', status: '', priority: '', ownerUid: '', type: '', from: '', to: '' };
type F = typeof EMPTY;
type Page = { sig: string; items: TaskDto[]; next: string | null; partial: boolean };

export default function TaskList({ view }: { view: TaskView }) {
  const { meta } = useTaskMeta();
  const [f, setF] = useState<F>(EMPTY); const [qInput, setQInput] = useState(''); const [tick, setTick] = useState(0);
  const [page, setPage] = useState<Page | null>(null); const [fail, setFail] = useState<{ sig: string; message: string } | null>(null); const [stats, setStats] = useState<TaskStats | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set()); const [bulk, setBulk] = useState<'assign' | 'priority' | 'status' | null>(null);
  const [moreBusy, setMoreBusy] = useState(false); const [exporting, setExporting] = useState(false);

  const qs = useMemo(() => { const sp = new URLSearchParams({ view, limit: String(PAGE) }); (Object.entries(f) as [string, string][]).forEach(([k, v]) => v && sp.set(k, v)); return sp.toString(); }, [view, f]);
  const sig = `${qs}#${tick}`;
  useEffect(() => { const t = setTimeout(() => setF(x => (x.q === qInput.trim() ? x : { ...x, q: qInput.trim() })), 400); return () => clearTimeout(t); }, [qInput]);
  useEffect(() => {
    let off = false;
    api<TaskListRes>(`/api/tasks?${qs}`).then(r => { if (!off) { setPage({ sig, items: r.items, next: r.nextCursor, partial: r.partial }); setFail(null); setPicked(new Set()); } })
      .catch(e => { if (!off) setFail({ sig, message: errMsg(e, 'Không tải được dữ liệu.') }); });
    return () => { off = true; };
  }, [qs, sig]);
  useEffect(() => {
    let off = false;
    api<TaskStats>(`/api/tasks/stats?view=${view === 'mine' || view === 'assigned' ? view : 'all'}`).then(s => { if (!off) setStats(s); }).catch(() => { if (!off) setStats(null); });
    return () => { off = true; };
  }, [view, tick]);

  const loading = !fail && (!page || page.sig !== sig), err = fail && fail.sig === sig ? fail.message : null;
  const rows = page && page.sig === sig ? page.items : [], active = (Object.values(f) as string[]).some(Boolean);
  const set = (p: Partial<F>) => setF(x => ({ ...x, ...p }));
  const canBulk = !!meta?.can.bulk, allChecked = rows.length > 0 && rows.every(r => picked.has(r.id));

  async function more() {
    if (!page?.next) return; setMoreBusy(true);
    try { const r = await api<TaskListRes>(`/api/tasks?${qs}&cursor=${encodeURIComponent(page.next)}`); setPage(p => p && ({ ...p, items: [...p.items, ...r.items], next: r.nextCursor, partial: r.partial })); }
    catch (e) { setFail({ sig, message: errMsg(e) }); } finally { setMoreBusy(false); }
  }
  async function exportCsv() { setExporting(true); try { await download(`/api/tasks/export?${qs}`, 'cong-viec.csv'); } catch (e) { setFail({ sig, message: errMsg(e) }); } finally { setExporting(false); } }

  return (<div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-bold">{TITLE[view][0]}</h1><p className="text-sm text-slate-500">{TITLE[view][1]}</p></div>
      <div className="flex gap-2">
        <button onClick={() => setTick(t => t + 1)} className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm" aria-label="Tải lại"><RefreshCw size={14} /></button>
        {meta?.can.export && <button onClick={exportCsv} disabled={exporting} className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm"><Download size={14} />Xuất Excel</button>}
        <Link href="/tasks/create" className="flex h-9 items-center gap-1 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white"><Plus size={14} />Tạo công việc</Link>
      </div>
    </div>
    {view !== 'trash' && <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
      <Card label="Tổng công việc" v={stats?.total} /><Card label="Chưa bắt đầu" v={stats?.todo} /><Card label="Đang thực hiện" v={stats?.doing} c="text-blue-600" />
      <Card label="Chờ xử lý" v={stats?.waiting} c="text-amber-600" /><Card label="Đã hoàn thành" v={stats?.done} c="text-emerald-600" /><Card label={stats?.overdueCapped ? 'Quá hạn (500+)' : 'Quá hạn'} v={stats?.overdue} c="text-red-600" /></div>}
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <div className="relative"><Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" /><input value={qInput} onChange={e => setQInput(e.target.value)} placeholder="Tìm mã, tên, người thực hiện, khách hàng…" className="h-9 w-64 rounded-lg border border-slate-200 pl-8 text-xs" /></div>
      {meta && view !== 'done' && view !== 'overdue' && view !== 'trash' && <select value={f.status} onChange={e => set({ status: e.target.value })} className={sel}><option value="">Mọi trạng thái</option>{meta.config.statuses.filter(s => s.active).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>}
      <select value={f.priority} onChange={e => set({ priority: e.target.value })} className={sel}><option value="">Mọi mức ưu tiên</option>{PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
      {meta && view !== 'mine' && meta.staff.length > 1 && <select value={f.ownerUid} onChange={e => set({ ownerUid: e.target.value })} className={sel}><option value="">Mọi người thực hiện</option>{meta.staff.map(s => <option key={s.uid} value={s.uid}>{s.displayName}</option>)}</select>}
      {meta && <select value={f.type} onChange={e => set({ type: e.target.value })} className={sel}><option value="">Mọi loại</option>{meta.config.types.map(t => <option key={t}>{t}</option>)}</select>}
      <label className="flex items-center gap-1 text-xs text-slate-500">Deadline từ<input type="date" value={f.from} onChange={e => set({ from: e.target.value })} className={sel} /></label>
      <label className="flex items-center gap-1 text-xs text-slate-500">đến<input type="date" value={f.to} onChange={e => set({ to: e.target.value })} className={sel} /></label>
      {active && <button onClick={() => { setF(EMPTY); setQInput(''); }} className="text-xs text-blue-600">Xóa bộ lọc</button>}
    </div>
    {canBulk && picked.size > 0 && <div className="flex items-center gap-2 rounded-xl bg-blue-50 p-3 text-sm"><b>{picked.size}</b> đã chọn
      <button onClick={() => setBulk('assign')} className="rounded-lg bg-white px-3 py-1 text-xs">Chuyển người thực hiện</button>
      <button onClick={() => setBulk('priority')} className="rounded-lg bg-white px-3 py-1 text-xs">Đổi mức ưu tiên</button>
      <button onClick={() => setBulk('status')} className="rounded-lg bg-white px-3 py-1 text-xs">Cập nhật trạng thái</button></div>}
    {err && <Alert>{err}</Alert>}
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500"><tr>
          {canBulk && <th className="w-8 p-3"><input type="checkbox" aria-label="Chọn tất cả" checked={allChecked} onChange={() => setPicked(allChecked ? new Set() : new Set(rows.map(r => r.id)))} /></th>}
          {['Mã', 'Tên công việc', 'Người thực hiện', 'Người giao', 'Phòng ban', 'Dự án', 'Ưu tiên', 'Trạng thái', 'Tiến độ', 'Deadline', ''].map(h => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {loading && <tr><td colSpan={12} className="p-6 text-center text-slate-500">Đang tải…</td></tr>}
          {!loading && !rows.length && !err && <tr><td colSpan={12} className="p-6 text-center text-slate-500">{active ? 'Không có công việc khớp bộ lọc.' : 'Chưa có công việc nào.'}</td></tr>}
          {rows.map(t => <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50/60">
            {canBulk && <td className="p-3"><input type="checkbox" aria-label={`Chọn ${t.code}`} checked={picked.has(t.id)} onChange={() => setPicked(p => { const n = new Set(p); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} /></td>}
            <td className="whitespace-nowrap p-3 font-medium">{t.code}</td>
            <td className="max-w-[260px] p-3"><Link href={`/tasks/${t.id}`} className="font-medium text-blue-700 hover:underline">{t.title}</Link>{t.customerName && <div className="truncate text-xs text-slate-400">{t.customerName}</div>}</td>
            <td className="p-3">{t.ownerName}</td><td className="p-3 text-slate-500">{t.assignerName}</td><td className="p-3 text-slate-500">{t.departmentId ?? '—'}</td><td className="p-3 text-slate-500">{t.projectId ?? '—'}</td>
            <td className="p-3"><PriorityBadge p={t.priority} /></td><td className="p-3"><StatusBadge cfg={meta?.config} s={t.status} /></td>
            <td className="p-3"><div className="h-1.5 w-20 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${t.progress}%` }} /></div><div className="mt-0.5 text-xs text-slate-500">{t.progress}%</div></td>
            <td className="whitespace-nowrap p-3 text-xs">{fmtDT(t.deadlineAt)}{t.overdue && <div className="mt-0.5"><OverdueBadge days={t.overdueDays} /></div>}</td>
            <td className="p-3"><Link href={`/tasks/${t.id}`} className="text-xs text-blue-600">Xem</Link></td></tr>)}
        </tbody></table></div>
    {page?.next && page.sig === sig && <div className="text-center"><button onClick={more} disabled={moreBusy} className="h-9 rounded-lg border border-slate-200 bg-white px-5 text-sm">{moreBusy ? 'Đang tải…' : page.partial ? 'Tìm tiếp trong dữ liệu cũ hơn' : 'Tải thêm'}</button></div>}
    {bulk && meta && <BulkDialog kind={bulk} meta={meta} ids={[...picked]} onClose={() => setBulk(null)} onDone={() => { setBulk(null); setTick(t => t + 1); }} />}
  </div>);
}

function BulkDialog({ kind, meta, ids, onClose, onDone }: { kind: 'assign' | 'priority' | 'status'; meta: TaskMeta; ids: string[]; onClose: () => void; onDone: () => void }) {
  const [ownerUid, setOwnerUid] = useState(''); const [priority, setPriority] = useState<TaskPriority>('medium');
  const open = meta.config.statuses.filter(s => s.active && s.group !== 'done' && s.group !== 'cancelled');
  const [status, setStatus] = useState(open[0]?.key ?? ''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [res, setRes] = useState<BulkRes | null>(null);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { setRes(await api<BulkRes>('/api/tasks/bulk', { method: 'POST', json: { ids, action: kind, ownerUid, priority, status } })); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  const title = kind === 'assign' ? 'Chuyển người thực hiện' : kind === 'priority' ? 'Đổi mức độ ưu tiên' : 'Cập nhật trạng thái';
  return (<Modal title={`${title} (${ids.length} công việc)`} onClose={res ? onDone : onClose}>
    {res ? (<div className="space-y-3 text-sm"><p>Thành công <b>{res.succeeded}</b> · Không thực hiện được <b>{res.failed}</b></p>
      {res.results.filter(r => !r.ok).map(r => <p key={r.id} className="rounded-lg bg-red-50 p-2 text-xs text-red-600">{r.id}: {r.error}</p>)}
      <div className="text-right"><button onClick={onDone} className="h-10 rounded-md bg-blue-600 px-5 text-sm text-white">Đóng</button></div></div>)
    : (<form onSubmit={go} className="space-y-3">{err && <Alert>{err}</Alert>}
      {kind === 'assign' && <L t="Người thực hiện mới *"><select required value={ownerUid} onChange={e => setOwnerUid(e.target.value)} className={inp}><option value="">— Chọn —</option>{meta.staff.map(s => <option key={s.uid} value={s.uid}>{s.displayName}</option>)}</select></L>}
      {kind === 'priority' && <L t="Mức độ ưu tiên"><select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)} className={inp}>{PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></L>}
      {kind === 'status' && <L t="Trạng thái mới" hint="Chỉ cập nhật sang trạng thái chưa kết thúc. Hoàn thành / hủy hãy thao tác từng công việc."><select value={status} onChange={e => setStatus(e.target.value)} className={inp}>{open.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></L>}
      <FormFooter busy={busy} label="Áp dụng" onClose={onClose} /></form>)}
  </Modal>);
}
