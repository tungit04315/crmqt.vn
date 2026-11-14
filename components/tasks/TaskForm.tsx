'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import CustomerPicker from '@/components/opportunities/CustomerPicker';
import { Alert, FormFooter, Group, L, area, inp, newRequestId } from '@/components/ui/form';
import { PRIORITIES, PRIORITY_LABEL, type TaskDto, type TaskMeta, type TaskPriority } from '@/types/task';
import { errMsg, fromLocalInput, toLocalInput } from './ui';

/** Form tạo / sửa thông tin công việc. Tiến độ, trạng thái, checklist, liên kết khi sửa thực hiện ở trang chi tiết. */
export default function TaskForm({ meta, initial, onDone, onClose }: { meta: TaskMeta; initial?: TaskDto; onDone: (id: string) => void; onClose: () => void }) {
  const edit = !!initial, assignOthers = meta.can.assignOthers;
  const [requestId] = useState(newRequestId);
  const [title, setTitle] = useState(initial?.title ?? ''); const [description, setDescription] = useState(initial?.description ?? '');
  const [type, setType] = useState(initial?.type ?? meta.config.types[0]); const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? 'medium');
  const [ownerUid, setOwnerUid] = useState(initial?.ownerUid ?? meta.me.uid);
  const [collab, setCollab] = useState<string[]>(initial?.collaborators.map(c => c.uid) ?? []); const [teamId, setTeamId] = useState(initial?.teamId ?? '');
  const [startAt, setStartAt] = useState(toLocalInput(initial?.startAt ?? null)); const [deadlineAt, setDeadlineAt] = useState(toLocalInput(initial?.deadlineAt ?? null));
  const [est, setEst] = useState(initial?.estimatedMinutes != null ? String(initial.estimatedMinutes) : '');
  const [customerId, setCustomerId] = useState(initial?.customerId ?? ''); const [contractId, setContractId] = useState(initial?.contractId ?? ''); const [projectId, setProjectId] = useState(initial?.projectId ?? '');
  const [status, setStatus] = useState(meta.config.statuses.filter(s => s.active && s.group !== 'done' && s.group !== 'cancelled').sort((a, b) => a.order - b.order)[0]?.key ?? '');
  const [checklist, setChecklist] = useState(''); const [links, setLinks] = useState<{ title: string; url: string }[]>([]); const [lk, setLk] = useState({ title: '', url: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const staff = meta.staff, nameOf = (u: string) => staff.find(s => s.uid === u)?.displayName ?? initial?.collaborators.find(c => c.uid === u)?.name ?? u;
  const startable = meta.config.statuses.filter(s => s.active && s.group !== 'done' && s.group !== 'cancelled').sort((a, b) => a.order - b.order);

  const pickTeam = (id: string) => {
    setTeamId(id); const t = meta.teams.find(x => x.id === id); if (!t) return;
    const ok = (u: string) => staff.some(s => s.uid === u);
    const owner = ownerUid && ok(ownerUid) ? ownerUid : (t.leaderUid && ok(t.leaderUid) ? t.leaderUid : ownerUid);
    setOwnerUid(owner); setCollab(t.memberUids.filter(u => ok(u) && u !== owner));
  };
  const toggle = (u: string) => setCollab(c => (c.includes(u) ? c.filter(x => x !== u) : [...c, u]));
  const addLink = () => { if (!lk.url.trim()) return; setLinks(l => [...l, { title: lk.title.trim(), url: lk.url.trim() }]); setLk({ title: '', url: '' }); };

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const payload = {
      title, description, type, priority, ownerUid, collaboratorUids: collab.filter(u => u !== ownerUid), teamId: teamId || null, customerId: customerId || null,
      contractId: contractId || null, projectId: projectId || null, startAt: fromLocalInput(startAt), deadlineAt: fromLocalInput(deadlineAt), estimatedMinutes: est === '' ? null : Number(est),
    };
    try {
      if (edit) { await api(`/api/tasks/${initial!.id}`, { method: 'PATCH', json: { ...payload, version: initial!.version } }); onDone(initial!.id); }
      else {
        const r = await api<{ id: string }>('/api/tasks', { method: 'POST', json: { ...payload, requestId, status, checklist: checklist.split('\n').map(x => x.trim()).filter(Boolean), links } });
        onDone(r.id);
      }
    } catch (x) { setErr(errMsg(x)); setBusy(false); }
  }

  return (<form onSubmit={submit} className="space-y-4">
    {err && <Alert>{err}</Alert>}
    <Group title="Thông tin chung">
      <L t="Tên công việc *" wide><input required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} className={inp} /></L>
      <L t="Loại công việc"><select value={type} onChange={e => setType(e.target.value)} className={inp}>{meta.config.types.map(t => <option key={t}>{t}</option>)}</select></L>
      <L t="Mức độ ưu tiên"><select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)} className={inp}>{PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></L>
      <L t="Mô tả" wide><textarea maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} className={area} /></L>
    </Group>
    <Group title="Phân công">
      {assignOthers ? (<>
        <L t="Người thực hiện chính *" hint="Chịu trách nhiệm cuối cùng về kết quả."><select required value={ownerUid} onChange={e => { setOwnerUid(e.target.value); setCollab(c => c.filter(x => x !== e.target.value)); }} className={inp}>
          {!staff.some(s => s.uid === ownerUid) && <option value={ownerUid}>{initial?.ownerName ?? ownerUid}</option>}
          {staff.map(s => <option key={s.uid} value={s.uid}>{s.displayName}</option>)}</select></L>
        <L t="Nhóm" hint="Chọn nhóm để điền nhanh người phối hợp."><select value={teamId} onChange={e => pickTeam(e.target.value)} className={inp}><option value="">— Không —</option>{meta.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></L>
        <L t="Người phối hợp" wide><div className="max-h-36 overflow-auto rounded-md border border-slate-200 p-2 text-sm">
          {staff.filter(s => s.uid !== ownerUid).map(s => <label key={s.uid} className="flex items-center gap-2 py-0.5"><input type="checkbox" checked={collab.includes(s.uid)} onChange={() => toggle(s.uid)} />{s.displayName}</label>)}
          {collab.filter(u => !staff.some(s => s.uid === u)).map(u => <label key={u} className="flex items-center gap-2 py-0.5"><input type="checkbox" checked onChange={() => toggle(u)} />{nameOf(u)}</label>)}
          {!staff.length && <span className="text-slate-400">Không có người dùng khả dụng.</span>}</div></L>
      </>) : <p className="text-sm text-slate-500 md:col-span-2">Công việc sẽ được giao cho chính bạn. Để giao cho người khác, hãy nhờ trưởng phòng.</p>}
    </Group>
    <Group title="Thời gian">
      <L t="Ngày bắt đầu"><input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)} className={inp} /></L>
      <L t="Deadline" hint="Hệ thống gửi email nhắc trước hạn theo mốc đã cấu hình."><input type="datetime-local" value={deadlineAt} min={startAt || undefined} onChange={e => setDeadlineAt(e.target.value)} className={inp} /></L>
      <L t="Thời lượng dự kiến (phút)"><input type="number" min={0} max={100000} value={est} onChange={e => setEst(e.target.value)} className={inp} /></L>
      {!edit && <L t="Trạng thái ban đầu"><select value={status} onChange={e => setStatus(e.target.value)} className={inp}>{startable.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></L>}
    </Group>
    <Group title="Liên quan">
      <L t="Khách hàng" wide><div className="flex gap-2"><div className="flex-1"><CustomerPicker value={customerId} onChange={setCustomerId} fallbackLabel={initial ? `${initial.customerCode} – ${initial.customerName}` : undefined} /></div>
        {customerId && <button type="button" onClick={() => setCustomerId('')} className="h-10 rounded-md border border-slate-200 px-3 text-xs">Bỏ chọn</button>}</div></L>
      <L t="Hợp đồng (mã tham chiếu)" hint="Tạm lưu dạng tham chiếu; sẽ liên kết thật khi có phân hệ Hợp đồng."><input maxLength={64} value={contractId} onChange={e => setContractId(e.target.value)} className={inp} /></L>
      <L t="Dự án (mã tham chiếu)"><input maxLength={64} value={projectId} onChange={e => setProjectId(e.target.value)} className={inp} /></L>
    </Group>
    {!edit && <Group title="Checklist và liên kết đính kèm">
      <L t="Checklist (mỗi dòng một mục)" wide><textarea value={checklist} onChange={e => setChecklist(e.target.value)} className={area} placeholder={'Gọi xác nhận khách\nGửi báo giá'} /></L>
      <div className="md:col-span-2"><div className="text-xs font-medium text-slate-600">Liên kết tài liệu (Google Drive, OneDrive…)</div>
        {links.map((l, i) => <div key={i} className="mt-1 flex items-center gap-2 text-xs"><span className="flex-1 truncate">{l.title || l.url}</span><button type="button" onClick={() => setLinks(x => x.filter((_, j) => j !== i))} className="text-red-500">Xóa</button></div>)}
        <div className="mt-1 flex flex-wrap gap-2"><input placeholder="Tiêu đề (tùy chọn)" value={lk.title} onChange={e => setLk({ ...lk, title: e.target.value })} className={`${inp} flex-1`} />
          <input placeholder="https://…" value={lk.url} onChange={e => setLk({ ...lk, url: e.target.value })} className={`${inp} flex-[2]`} />
          <button type="button" onClick={addLink} className="h-10 rounded-md border border-slate-200 px-3 text-sm">Thêm</button></div></div>
    </Group>}
    <FormFooter busy={busy} label={edit ? 'Lưu thay đổi' : 'Tạo công việc'} onClose={onClose} />
  </form>);
}
