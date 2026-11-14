'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Alert, FormFooter, L, area, inp } from '@/components/ui/form';
import { Field, Section } from '@/components/ui/Info';
import Timeline from '@/components/ui/HistoryTimeline';
import { Modal } from '@/components/ui/Modal';
import type { ChecklistItem, TaskConfig, TaskDetail, TaskDto } from '@/types/task';
import TaskForm from './TaskForm';
import { OverdueBadge, PriorityBadge, StatusBadge, errMsg, fmtDT, useTaskMeta } from './ui';

const HIST: Record<string, [string, string]> = {
  created: ['Tạo công việc', '#2563eb'], updated: ['Cập nhật thông tin', '#f59e0b'], status: ['Đổi trạng thái', '#8b5cf6'], work: ['Cập nhật tiến độ', '#0ea5e9'],
  assigned: ['Chuyển người thực hiện', '#14b8a6'], reopened: ['Mở lại công việc', '#ef4444'], deleted: ['Xóa công việc', '#64748b'], restored: ['Khôi phục', '#10b981'],
  link_added: ['Thêm liên kết', '#64748b'], link_removed: ['Xóa liên kết', '#64748b'],
};
type Modal_ = 'edit' | 'status' | 'reopen' | 'delete' | null;
const host = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };

export default function TaskDetailView({ id }: { id: string }) {
  const { meta } = useTaskMeta(); const router = useRouter();
  const [d, setD] = useState<TaskDetail | null>(null); const [err, setErr] = useState<string | null>(null); const [tick, setTick] = useState(0); const [modal, setModal] = useState<Modal_>(null);
  useEffect(() => {
    let off = false;
    api<TaskDetail>(`/api/tasks/${id}`).then(r => { if (!off) { setD(r); setErr(null); } }).catch(e => { if (!off) setErr(errMsg(e, 'Không tải được công việc.')); });
    return () => { off = true; };
  }, [id, tick]);
  const reload = () => { setModal(null); setTick(t => t + 1); };

  if (err && !d) return <div className="space-y-3"><Link href="/tasks" className="flex items-center gap-1 text-sm text-blue-600"><ArrowLeft size={14} />Danh sách công việc</Link><Alert>{err}</Alert></div>;
  if (!d || !meta) return <p className="text-sm text-slate-500">Đang tải…</p>;
  const t = d.task, c = d.can, cfg = meta.config;
  return (<div className="space-y-4">
    <Link href="/tasks" className="flex items-center gap-1 text-sm text-blue-600"><ArrowLeft size={14} />Danh sách công việc</Link>
    {t.deleted && <Alert>Công việc này đã bị xóa{c.restore ? '. Bạn có thể khôi phục.' : '.'}</Alert>}
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="text-xs text-slate-500">{t.code} · {t.type}</div><h1 className="text-xl font-bold">{t.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge cfg={cfg} s={t.status} /><PriorityBadge p={t.priority} />{t.overdue && <OverdueBadge days={t.overdueDays} />}{t.reopenCount > 0 && <span className="text-xs text-slate-400">Đã mở lại {t.reopenCount} lần</span>}</div></div>
      <div className="flex flex-wrap gap-2">
        {c.status && <button onClick={() => setModal('status')} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white">Đổi trạng thái</button>}
        {(c.edit || c.reassign) && <button onClick={() => setModal('edit')} className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm"><Pencil size={14} />Sửa</button>}
        {c.reopen && <button onClick={() => setModal('reopen')} className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm"><RotateCcw size={14} />Mở lại</button>}
        {c.restore && <button onClick={() => api(`/api/tasks/${id}/restore`, { method: 'POST' }).then(reload).catch(e => setErr(errMsg(e)))} className="h-9 rounded-lg border border-emerald-300 bg-white px-3 text-sm text-emerald-700">Khôi phục</button>}
        {c.delete && <button onClick={() => setModal('delete')} className="flex h-9 items-center gap-1 rounded-lg border border-red-200 bg-white px-3 text-sm text-red-600"><Trash2 size={14} />Xóa</button>}
      </div></div>
    {err && <Alert>{err}</Alert>}
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Section title="Thông tin">
          {t.description ? <p className="mb-4 whitespace-pre-wrap text-sm text-slate-700">{t.description}</p> : <p className="mb-4 text-sm text-slate-400">Chưa có mô tả.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Người thực hiện chính" value={t.ownerName} /><Field label="Người giao việc" value={t.assignerName} />
            <Field label="Người phối hợp" value={t.collaborators.map(x => x.name).join(', ')} /><Field label="Nhóm / Phòng ban" value={[t.teamName, t.departmentId].filter(Boolean).join(' · ')} />
            <Field label="Ngày bắt đầu" value={t.startAt ? fmtDT(t.startAt) : ''} /><Field label="Deadline" value={t.deadlineAt ? fmtDT(t.deadlineAt) : ''} />
            <Field label="Ngày hoàn thành thực tế" value={t.completedAt ? fmtDT(t.completedAt) : ''} /><Field label="Thời lượng dự kiến" value={t.estimatedMinutes != null ? `${t.estimatedMinutes} phút` : ''} />
            <Field label="Khách hàng" value={t.customerName ? `${t.customerCode} – ${t.customerName}` : ''} href={t.customerId ? `/customers/${t.customerId}` : undefined} />
            <Field label="Hợp đồng / Dự án (tham chiếu)" value={[t.contractId, t.projectId].filter(Boolean).join(' · ')} /></div>
          {t.result && <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm"><div className="text-xs font-semibold text-emerald-700">Kết quả thực hiện</div><p className="mt-1 whitespace-pre-wrap">{t.result}</p></div>}
        </Section>
        <WorkCard key={t.version} t={t} canWork={c.work} onSaved={() => setTick(x => x + 1)} />
        <LinksCard t={t} canLink={c.link} canManage={c.edit || c.reassign} onChanged={() => setTick(x => x + 1)} />
        <CommentsCard d={d} onAdded={() => setTick(x => x + 1)} />
      </div>
      <Section title="Lịch sử hoạt động" className="h-fit"><Timeline items={d.history} meta={HIST} /></Section>
    </div>
    {modal === 'edit' && <Modal title="Sửa công việc" wide onClose={() => setModal(null)}><TaskForm meta={meta} initial={t} onDone={reload} onClose={() => setModal(null)} /></Modal>}
    {modal === 'status' && <StatusDialog t={t} cfg={cfg} canCancel={c.cancel} onClose={() => setModal(null)} onDone={reload} />}
    {modal === 'reopen' && <ReasonDialog title="Mở lại công việc" label="Lý do mở lại *" required url={`/api/tasks/${id}/reopen`} action="Mở lại" onClose={() => setModal(null)} onDone={reload} />}
    {modal === 'delete' && <ReasonDialog title="Xóa công việc" label="Lý do (tùy chọn)" url={`/api/tasks/${id}/delete`} action="Xóa" danger onClose={() => setModal(null)} onDone={() => router.push('/tasks')} />}
  </div>);
}

function WorkCard({ t, canWork, onSaved }: { t: TaskDto; canWork: boolean; onSaved: () => void }) {
  const [progress, setProgress] = useState(t.progress), [delay, setDelay] = useState(t.delayReason), [items, setItems] = useState<ChecklistItem[]>(t.checklist), [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const done = items.filter(i => i.done).length;
  async function save() {
    setBusy(true); setErr('');
    try { await api(`/api/tasks/${t.id}/work`, { method: 'POST', json: { version: t.version, progress, delayReason: delay, checklist: items } }); onSaved(); } catch (e) { setErr(errMsg(e)); setBusy(false); }
  }
  const add = () => { const v = text.trim(); if (!v) return; setItems(l => [...l, { id: Math.random().toString(36).slice(2, 10), text: v, done: false }]); setText(''); };
  return (<Section title={`Tiến độ & checklist${items.length ? ` (${done}/${items.length})` : ''}`}>
    {err && <Alert>{err}</Alert>}
    <div className="mb-3 flex items-center gap-3"><input type="range" min={0} max={100} step={5} disabled={!canWork} value={progress} onChange={e => setProgress(Number(e.target.value))} className="flex-1" aria-label="Tiến độ" /><b className="w-12 text-right text-sm">{progress}%</b></div>
    <ul className="space-y-1">{items.map(i => <li key={i.id} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canWork} checked={i.done} onChange={() => setItems(l => l.map(x => (x.id === i.id ? { ...x, done: !x.done } : x)))} />
      <span className={`flex-1 ${i.done ? 'text-slate-400 line-through' : ''}`}>{i.text}</span>{canWork && <button onClick={() => setItems(l => l.filter(x => x.id !== i.id))} className="text-xs text-red-500">Xóa</button>}</li>)}
      {!items.length && <li className="text-sm text-slate-400">Chưa có checklist.</li>}</ul>
    {canWork && <div className="mt-2 flex gap-2"><input value={text} maxLength={200} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="Thêm mục checklist…" className={inp} /><button type="button" onClick={add} className="h-10 rounded-md border border-slate-200 px-3 text-sm">Thêm</button></div>}
    {(canWork || t.delayReason) && <L t="Lý do chậm tiến độ (nếu có)"><textarea disabled={!canWork} maxLength={500} value={delay} onChange={e => setDelay(e.target.value)} className={area} /></L>}
    {canWork && <div className="mt-3 text-right"><button onClick={save} disabled={busy} className="h-10 rounded-md bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-70">{busy ? 'Đang lưu…' : 'Lưu cập nhật'}</button></div>}
  </Section>);
}

function LinksCard({ t, canLink, canManage, onChanged }: { t: TaskDto; canLink: boolean; canManage: boolean; onChanged: () => void }) {
  const [url, setUrl] = useState(''), [title, setTitle] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api(`/api/tasks/${t.id}/links`, { method: 'POST', json: { url, title } }); setUrl(''); setTitle(''); onChanged(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  async function remove(linkId: string) { setErr(''); try { await api(`/api/tasks/${t.id}/links/${linkId}`, { method: 'DELETE' }); onChanged(); } catch (x) { setErr(errMsg(x)); } }
  return (<Section title="Tài liệu đính kèm (liên kết)">
    {err && <Alert>{err}</Alert>}
    <ul className="space-y-2">{t.links.map(l => <li key={l.id} className="flex items-start gap-2 rounded-lg bg-slate-50 p-2 text-sm">
      <ExternalLink size={14} className="mt-1 shrink-0 text-slate-400" /><div className="min-w-0 flex-1"><a href={l.url} target="_blank" rel="noopener noreferrer" className="break-words font-medium text-blue-700 hover:underline">{l.title}</a>
        <div className="text-xs text-slate-400">{host(l.url)} · {l.addedByName} · {fmtDT(l.addedAt)}</div>{l.note && <div className="text-xs text-slate-500">{l.note}</div>}</div>
      {(canLink || canManage) && <button onClick={() => remove(l.id)} className="text-xs text-red-500">Xóa</button>}</li>)}
      {!t.links.length && <li className="text-sm text-slate-400">Chưa có liên kết. Dán đường dẫn Google Drive, OneDrive… để đính kèm.</li>}</ul>
    {canLink && <form onSubmit={add} className="mt-3 flex flex-wrap gap-2"><input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="Tiêu đề (tùy chọn)" className={`${inp} flex-1`} />
      <input required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" className={`${inp} flex-[2]`} /><button disabled={busy} className="h-10 rounded-md border border-slate-200 px-4 text-sm">Thêm</button></form>}
  </Section>);
}

function CommentsCard({ d, onAdded }: { d: TaskDetail; onAdded: () => void }) {
  const [v, setV] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api(`/api/tasks/${d.task.id}/comments`, { method: 'POST', json: { content: v } }); setV(''); onAdded(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (<Section title={`Bình luận (${d.comments.length})`}>
    <ul className="space-y-3">{d.comments.map(m => <li key={m.id} className="rounded-xl bg-slate-50 p-3 text-sm"><div className="text-xs text-slate-500"><b className="text-slate-700">{m.authorName}</b> · {fmtDT(m.at)}</div><p className="mt-1 whitespace-pre-wrap">{m.content}</p></li>)}
      {!d.comments.length && <li className="text-sm text-slate-400">Chưa có bình luận.</li>}</ul>
    {d.can.comment && <form onSubmit={send} className="mt-3 space-y-2">{err && <Alert>{err}</Alert>}<textarea required maxLength={4000} value={v} onChange={e => setV(e.target.value)} placeholder="Viết bình luận…" className={area} />
      <div className="text-right"><button disabled={busy} className="h-10 rounded-md bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-70">Gửi</button></div></form>}
  </Section>);
}

function StatusDialog({ t, cfg, canCancel, onClose, onDone }: { t: TaskDto; cfg: TaskConfig; canCancel: boolean; onClose: () => void; onDone: () => void }) {
  const opts = cfg.statuses.filter(s => s.active && s.key !== t.status && (canCancel || s.group !== 'cancelled')).sort((a, b) => a.order - b.order);
  const [to, setTo] = useState(opts[0]?.key ?? ''), [result, setResult] = useState(''), [delay, setDelay] = useState(t.delayReason), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const group = cfg.statuses.find(s => s.key === to)?.group;
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api(`/api/tasks/${t.id}/status`, { method: 'POST', json: { to, result, note, delayReason: t.overdue ? delay : '' } }); onDone(); } catch (x) { setErr(errMsg(x)); setBusy(false); }
  }
  return (<Modal title="Đổi trạng thái" onClose={onClose}><form onSubmit={go} className="space-y-3">{err && <Alert>{err}</Alert>}
    <L t="Trạng thái mới"><select value={to} onChange={e => setTo(e.target.value)} className={inp}>{opts.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></L>
    {group === 'done' && <L t="Kết quả thực hiện" hint="Báo cáo ngắn gọn kết quả để người giao việc xem lại."><textarea maxLength={2000} value={result} onChange={e => setResult(e.target.value)} className={area} /></L>}
    {t.overdue && group !== 'cancelled' && <L t="Lý do chậm tiến độ"><textarea maxLength={500} value={delay} onChange={e => setDelay(e.target.value)} className={area} /></L>}
    <L t="Ghi chú (tùy chọn)"><textarea maxLength={500} value={note} onChange={e => setNote(e.target.value)} className={area} /></L>
    <FormFooter busy={busy} label="Cập nhật" onClose={onClose} /></form></Modal>);
}

function ReasonDialog({ title, label, required, url, action, danger, onClose, onDone }: { title: string; label: string; required?: boolean; url: string; action: string; danger?: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  async function go(e: React.FormEvent) { e.preventDefault(); setBusy(true); setErr(''); try { await api(url, { method: 'POST', json: { reason } }); onDone(); } catch (x) { setErr(errMsg(x)); setBusy(false); } }
  return (<Modal title={title} onClose={onClose}><form onSubmit={go} className="space-y-3">{err && <Alert>{err}</Alert>}
    <L t={label}><textarea required={required} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} className={area} /></L>
    <FormFooter busy={busy} label={action} onClose={onClose} danger={danger} /></form></Modal>);
}
