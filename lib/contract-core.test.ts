// Kiểm thử logic thuần của phân hệ Hợp đồng: trạng thái, phân quyền, kiểm tra dữ liệu, yêu cầu gia hạn/điều chỉnh/thanh lý, mẫu, CSV.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRequest, ccan, checkRequest, checkTransition, contractsCsv, daysLeft, diffContract, effectiveStatus, matchView, parseAction, parseAppendix, parseContract, parseRecord, parseRequest, parseVersion, scopeOf,
  type ActionInput, type CStatus, type COwned,
} from './contract-core';

const act = (action: ActionInput['action'], extra: Partial<ActionInput> = {}): ActionInput => ({ action, note: '', ...extra });
const base = { status: 'draft' as CStatus, value: 1000, startDate: '2026-01-01', endDate: '2026-12-31' };
const valid = { customerId: 'c1', title: 'HĐ dịch vụ', type: 'service', value: 5_000_000, startDate: '2026-01-01', endDate: '2026-12-31' };
const A = (uid: string, role: string, departmentId: string | null = null) => ({ uid, role, departmentId });
const own = (ownerUid: string, status: CStatus, extra: Partial<COwned> = {}): COwned => ({ ownerUid, departmentId: 'dA', status, ...extra });

describe('trạng thái hiển thị và chế độ xem', () => {
  it('sắp hết hạn tính theo ngày kết thúc (ngưỡng 30 ngày); quá hạn là hết hạn', () => {
    assert.equal(effectiveStatus('active', '2026-12-31', '2026-06-01'), 'active');
    assert.equal(effectiveStatus('active', '2026-07-01', '2026-06-01'), 'expiring');
    assert.equal(effectiveStatus('active', '2026-07-02', '2026-06-01'), 'active');
    assert.equal(effectiveStatus('active', '2026-05-31', '2026-06-01'), 'expired');
    assert.equal(effectiveStatus('active', '2026-06-01', '2026-06-01'), 'expiring');
    assert.equal(effectiveStatus('draft', '2020-01-01', '2026-06-01'), 'draft'); // chỉ hợp đồng đang hiệu lực mới bị tính hạn
    assert.equal(daysLeft('active', '2026-06-11', '2026-06-01'), 10);
    assert.equal(daysLeft('ended', '2026-06-11', '2026-06-01'), null);
  });
  it('chế độ xem lưu sẵn: “đang hiệu lực” gồm sắp hết hạn; “đã kết thúc” gồm hết hạn', () => {
    assert.ok(matchView('active', 'expiring') && matchView('active', 'active') && !matchView('active', 'expired'));
    assert.ok(matchView('ended', 'expired') && matchView('ended', 'ended') && !matchView('ended', 'cancelled'));
    assert.ok(matchView('expiring', 'expiring') && !matchView('expiring', 'active'));
    assert.ok(matchView(undefined, 'cancelled') && matchView('all', 'draft'));
  });
});

describe('kiểm tra dữ liệu hợp đồng', () => {
  it('hợp lệ: chuẩn hóa chuỗi, mặc định giá trị 0 và loại dịch vụ', () => {
    const r = parseContract({ customerId: ' c1 ', title: '  HĐ A ' }); assert.ok(r.ok);
    if (r.ok) assert.deepEqual([r.value.customerId, r.value.title, r.value.value, r.value.type, r.value.startDate], ['c1', 'HĐ A', 0, 'service', null]);
  });
  it('từ chối: thiếu khách hàng/tên, loại lạ, giá trị âm hoặc lẻ, ngày sai, kết thúc trước bắt đầu', () => {
    for (const bad of [{ ...valid, customerId: '' }, { ...valid, title: ' ' }, { ...valid, type: 'x' }, { ...valid, value: -1 }, { ...valid, value: 1.5 }, { ...valid, value: 1e15 },
      { ...valid, startDate: '2026-02-30' }, { ...valid, startDate: '2026-12-31', endDate: '2026-01-01' }, { ...valid, title: 'a'.repeat(201) }, { ...valid, paymentTerms: 'a'.repeat(1001) }])
      assert.equal(parseContract(bad).ok, false, JSON.stringify(bad).slice(0, 60));
  });
  it('giá trị dạng chuỗi có dấu phân cách được chấp nhận', () => { const r = parseContract({ ...valid, value: '5.000.000' }); assert.ok(r.ok && r.value.value === 5_000_000); });
  it('diff chỉ liệt kê trường thay đổi, hiển thị tiền và ngày theo định dạng Việt Nam', () => {
    const a = parseContract(valid), b = parseContract({ ...valid, value: 6_000_000, endDate: '2027-01-31' }); assert.ok(a.ok && b.ok);
    if (a.ok && b.ok) { const d = diffContract(a.value, b.value, { customer: ['A', 'A'], contact: ['', ''] }); assert.deepEqual(d.map(x => x.field).sort(), ['endDate', 'value']); assert.equal(d.find(x => x.field === 'endDate')!.to, '31/01/2027'); }
  });
});

describe('chuyển trạng thái', () => {
  it('đường đi chuẩn: gửi duyệt → duyệt → ký → kết thúc', () => {
    assert.deepEqual(checkTransition(base, act('submit'), '2026-06-01'), { ok: true, to: 'pending_approval' });
    assert.deepEqual(checkTransition({ ...base, status: 'pending_approval' }, act('approve'), '2026-06-01'), { ok: true, to: 'pending_signature' });
    assert.deepEqual(checkTransition({ ...base, status: 'pending_signature' }, act('sign', { signedDate: '2026-06-01' }), '2026-06-01'), { ok: true, to: 'active' });
    assert.deepEqual(checkTransition({ ...base, status: 'active' }, act('end', { note: 'Khách chấm dứt' }), '2026-06-01'), { ok: true, to: 'ended' });
  });
  it('không gửi duyệt khi giá trị bằng 0 hoặc thiếu ngày', () => {
    const t1 = checkTransition({ ...base, value: 0 }, act('submit'), '2026-06-01'), t2 = checkTransition({ ...base, endDate: null }, act('submit'), '2026-06-01');
    assert.ok(!t1.ok && t1.code === 'zero-value' && !t2.ok && t2.code === 'no-dates');
  });
  it('từ chối / thu hồi / hủy / chấm dứt bắt buộc có lý do', () => {
    for (const [status, action] of [['pending_approval', 'reject'], ['pending_signature', 'recall'], ['draft', 'cancel'], ['active', 'end']] as const) {
      const t = checkTransition({ ...base, status }, act(action), '2026-06-01'); assert.ok(!t.ok && t.code === 'needs-note', action);
      assert.ok(checkTransition({ ...base, status }, act(action, { note: 'lý do' }), '2026-06-01').ok);
    }
  });
  it('ký cần ngày ký hợp lệ và không ở tương lai', () => {
    const c = { ...base, status: 'pending_signature' as CStatus };
    assert.ok(!checkTransition(c, act('sign'), '2026-06-01').ok);
    const f = checkTransition(c, act('sign', { signedDate: '2026-06-02' }), '2026-06-01'); assert.ok(!f.ok && f.code === 'future-date');
  });
  it('sai trạng thái trả 409; hợp đồng đã ký/kết thúc/hủy không thể gửi duyệt, duyệt hay hủy lại', () => {
    for (const status of ['active', 'ended', 'cancelled'] as CStatus[]) {
      for (const action of ['submit', 'approve'] as const) { const t = checkTransition({ ...base, status }, act(action), '2026-06-01'); assert.ok(!t.ok && t.status === 409); }
      const t = checkTransition({ ...base, status }, act('cancel', { note: 'x' }), '2026-06-01'); assert.ok(!t.ok && t.status === 409, `hủy khi ${status}`);
    }
    assert.ok(!checkTransition({ ...base, status: 'cancelled' }, act('submit'), '2026-06-01').ok);
  });
  it('parseAction từ chối hành động lạ, ngày ký sai, ghi chú quá dài', () => {
    assert.ok(!parseAction({ action: 'hack' }).ok); assert.ok(!parseAction({ action: 'sign', signedDate: '2026-13-01' }).ok); assert.ok(!parseAction({ action: 'reject', note: 'a'.repeat(501) }).ok);
    assert.ok(parseAction({ action: 'sign', signedDate: '2026-01-05', version: 3 }).ok);
  });
});

describe('phạm vi và phân quyền', () => {
  it('phạm vi: giám đốc/kế toán toàn công ty; quản lý/vận hành theo phòng ban; sales cá nhân; vai trò khác không có', () => {
    assert.equal(scopeOf(A('d', 'director')).kind, 'company'); assert.equal(scopeOf(A('k', 'accountant')).kind, 'company');
    assert.equal(scopeOf(A('m', 'manager', 'dA')).kind, 'department'); assert.equal(scopeOf(A('o', 'operations', 'dA')).kind, 'department');
    assert.equal(scopeOf(A('s', 'sales', 'dA')).kind, 'own');
    assert.equal(scopeOf(A('m', 'manager')).kind, 'none'); assert.equal(scopeOf(A('c', 'customer_service', 'dA')).kind, 'none');
  });
  it('kế toán và vận hành chỉ xem, không tạo/sửa/yêu cầu', () => {
    for (const r of ['accountant', 'operations']) { const a = A('u', r, 'dA'); assert.ok(ccan.view(a)); assert.ok(!ccan.create(a)); assert.ok(!ccan.requestChange(a, own('x', 'active'))); assert.ok(!ccan.act(a, own('u', 'draft'), 'submit')); }
  });
  it('sales chỉ thao tác hợp đồng của mình, và chỉ sửa khi còn dự thảo', () => {
    const s = A('s', 'sales', 'dA');
    assert.ok(ccan.edit(s, own('s', 'draft'))); assert.ok(!ccan.edit(s, own('x', 'draft'))); assert.ok(!ccan.edit(s, own('s', 'pending_approval')));
    assert.ok(ccan.requestChange(s, own('s', 'active'))); assert.ok(!ccan.requestChange(s, own('x', 'active')));
  });
  it('chỉ giám đốc/quản trị duyệt; quản lý thì không; người gửi duyệt không tự duyệt (trừ quản trị)', () => {
    const o = own('s', 'pending_approval', { submittedBy: 'dir' });
    assert.ok(!ccan.act(A('dir', 'director'), o, 'approve')); assert.ok(ccan.act(A('dir2', 'director'), o, 'approve'));
    assert.ok(ccan.act(A('sa', 'super_admin'), { ...o, submittedBy: 'sa' }, 'approve')); assert.ok(!ccan.act(A('m', 'manager', 'dA'), o, 'approve'));
  });
  it('chỉ quản lý trở lên xác nhận ký / thu hồi; hủy bản chờ duyệt cần quản lý; xóa chỉ khi dự thảo hoặc đã hủy', () => {
    const m = A('m', 'manager', 'dA'), s = A('s', 'sales', 'dA');
    assert.ok(ccan.act(m, own('s', 'pending_signature'), 'sign')); assert.ok(!ccan.act(s, own('s', 'pending_signature'), 'sign'));
    assert.ok(ccan.act(s, own('s', 'draft'), 'cancel')); assert.ok(!ccan.act(s, own('s', 'pending_approval'), 'cancel')); assert.ok(ccan.act(m, own('s', 'pending_approval'), 'cancel'));
    assert.ok(ccan.remove(m, own('s', 'draft')) && ccan.remove(m, own('s', 'cancelled'))); assert.ok(!ccan.remove(m, own('s', 'active'))); assert.ok(!ccan.remove(s, own('s', 'draft')));
  });
  it('phiên bản chỉ thêm khi chưa hiệu lực; phụ lục và hồ sơ chỉ khi đang hiệu lực', () => {
    const s = A('s', 'sales', 'dA');
    assert.ok(ccan.addVersion(s, own('s', 'draft')) && ccan.addVersion(s, own('s', 'pending_signature'))); assert.ok(!ccan.addVersion(s, own('s', 'active')));
    assert.ok(ccan.addAppendix(s, own('s', 'active')) && !ccan.addAppendix(s, own('s', 'draft')));
    assert.ok(ccan.addRecord(s, own('s', 'active')) && !ccan.addRecord(s, own('s', 'ended')));
  });
  it('quyền duyệt yêu cầu: giám đốc không tự duyệt yêu cầu của mình; chỉ người tạo được hủy', () => {
    assert.ok(!ccan.decide(A('dir', 'director'), { requestedBy: 'dir' })); assert.ok(ccan.decide(A('dir', 'director'), { requestedBy: 's' })); assert.ok(!ccan.decide(A('m', 'manager', 'dA'), { requestedBy: 's' }));
    assert.ok(ccan.cancelRequest(A('s', 'sales'), { requestedBy: 's' }) && !ccan.cancelRequest(A('x', 'sales'), { requestedBy: 's' }));
  });
});

describe('yêu cầu gia hạn / điều chỉnh / thanh lý', () => {
  const c = { value: 10_000_000, startDate: '2026-01-01', endDate: '2026-12-31', paymentTerms: '30 ngày' };
  it('gia hạn: cần ngày kết thúc mới, phải sau ngày hiện tại; giá trị mới tùy chọn', () => {
    assert.ok(!parseRequest({ type: 'renewal', reason: 'x' }).ok);
    const p = parseRequest({ type: 'renewal', reason: 'Khách muốn tiếp tục', newEndDate: '2027-12-31', newValue: 12_000_000 }); assert.ok(p.ok);
    if (p.ok) { assert.equal(checkRequest(c, p.value), null); assert.equal(checkRequest(c, { ...p.value, newEndDate: '2026-12-31' }) !== null, true);
      const a = applyRequest(c, p.value); assert.deepEqual(a.update, { endDate: '2027-12-31', value: 12_000_000 }); assert.equal(a.changes.length, 2); }
  });
  it('điều chỉnh: cần ít nhất một thay đổi thật sự khác hợp đồng hiện tại', () => {
    assert.ok(!parseRequest({ type: 'adjustment', reason: 'x' }).ok);
    assert.ok(!parseRequest({ type: 'adjustment', reason: 'x', newPaymentTerms: '   ' }).ok, 'điều khoản trống không được coi là một thay đổi');
    const keep = parseRequest({ type: 'adjustment', reason: 'x', newValue: 11_000_000, newPaymentTerms: '' }); assert.ok(keep.ok && keep.value.newPaymentTerms === null);
    const same = parseRequest({ type: 'adjustment', reason: 'x', newValue: 10_000_000 }); assert.ok(same.ok && same.value && checkRequest(c, same.value) !== null);
    const p = parseRequest({ type: 'adjustment', reason: 'Đổi điều khoản', newPaymentTerms: '45 ngày' }); assert.ok(p.ok);
    if (p.ok) { assert.equal(checkRequest(c, p.value), null); assert.deepEqual(applyRequest(c, p.value).update, { paymentTerms: '45 ngày' }); }
  });
  it('thanh lý: cần ngày; danh sách hồ sơ giới hạn; áp dụng đặt trạng thái kết thúc lý do “thanh lý”', () => {
    assert.ok(!parseRequest({ type: 'liquidation', reason: 'x', liquidationDate: 'abc' }).ok);
    assert.ok(!parseRequest({ type: 'liquidation', reason: 'x', liquidationDate: '2026-10-01', checklist: Array(21).fill('a') }).ok);
    const p = parseRequest({ type: 'liquidation', reason: 'Hoàn tất', liquidationDate: '2026-10-01', checklist: ['Biên bản', ' ', 'Quyết toán'] }); assert.ok(p.ok);
    if (p.ok) { assert.deepEqual(p.value.checklist, ['Biên bản', 'Quyết toán']); assert.equal(checkRequest(c, { ...p.value, liquidationDate: '2025-12-31' }) !== null, true);
      assert.deepEqual(applyRequest(c, p.value).update, { status: 'ended', endReason: 'liquidated', liquidationDate: '2026-10-01' }); }
  });
  it('luôn yêu cầu lý do', () => { assert.ok(!parseRequest({ type: 'liquidation', liquidationDate: '2026-10-01' }).ok); assert.ok(!parseRequest({ type: 'x', reason: 'a' }).ok); });
});

describe('phiên bản, phụ lục, hồ sơ', () => {
  it('phiên bản: mặc định Word, chỉ nhận định dạng hợp lệ', () => { const v = parseVersion({}); assert.ok(v.ok && v.value.fileFormat === 'word'); assert.ok(!parseVersion({ fileFormat: 'exe' }).ok); });
  it('phụ lục cần tên; hồ sơ nghiệm thu cần kết quả, bàn giao thì không', () => {
    assert.ok(!parseAppendix({ title: ' ' }).ok); assert.ok(parseAppendix({ title: 'PL1', effectiveDate: '2026-02-01' }).ok); assert.ok(!parseAppendix({ title: 'PL1', effectiveDate: 'x' }).ok);
    assert.ok(!parseRecord({ kind: 'acceptance', title: 'BB', recordDate: '2026-03-01' }).ok); assert.ok(parseRecord({ kind: 'acceptance', title: 'BB', recordDate: '2026-03-01', result: 'accepted' }).ok);
    const h = parseRecord({ kind: 'handover', title: 'BG', recordDate: '2026-03-01', result: 'accepted' }); assert.ok(h.ok && h.value.result === '');
    assert.ok(!parseRecord({ kind: 'other', title: 'BB', recordDate: '2026-03-01' }).ok);
  });
  it('xuất CSV chống chèn công thức', () => {
    const csv = contractsCsv([{ code: 'HD00001', title: '=HYPERLINK("x")', type: 'service', customerCode: 'KH1', customerName: 'A', value: 1000, startDate: '2026-01-01', endDate: null, signedDate: null, effective: 'active', ownerName: 'B', createdAt: '2026-01-01T00:00:00.000Z' }]);
    assert.ok(csv.includes('HD00001')); assert.ok(!/(^|,)"?=HYPERLINK/.test(csv.split('\n')[1]));
  });
});
