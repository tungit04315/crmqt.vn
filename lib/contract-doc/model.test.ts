import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocContract, suggestContractNumber, initialsOf, webAmounts, seoAmounts } from './model';

const A = { companyName: 'CT A', taxCode: '01', address: 'HN', representativeName: 'Nguyễn Xuân Đàm', representativePosition: 'GĐ', phone: '09', email: 'a@a.vn' };
const B = { companyName: 'CT B', taxCode: '02', address: 'HCM', representativeName: 'Lê B', representativePosition: 'GĐ', hotline: '19', email: 'b@b.vn', bankAccount: '1', bankName: 'VCB', bankHolder: 'CT B' };
const common = { contractNumber: '120126NXĐ/HĐTK-WEB/01', signDate: '2026-01-12', signPlace: 'HN', partyA: A, partyB: B };
const web = { ...common, features: [{ name: 'Blog', description: 'x' }], content: { contractValue: '10.800.000', vatPercent: 8, demoDays: 7, acceptanceDays: 3, domainNote: 'a', hostingNote: 'b', extraServicesNote: '' } };
const seo = { ...common, content: { contractValue: 10000000, vatIncluded: 'excluded', dot1Percent: 40, dot2Percent: 30, dot2Milestone: 'm', lateInterestPercent: 0.05, acceptanceDays: 5, confidentialityYears: 2, freeRevisions: 2, keywordsScope: 'k', articleCount: 4, reportFrequency: 'tháng', timeline: 't' } };
const tick = { ...common, content: { fanpageName: 'FP', fanpageUrl: 'facebook.com/fp', serviceFee: 10000000 } };

test('số hợp đồng gợi ý', () => {
  assert.equal(initialsOf('Nguyễn Xuân Đàm'), 'NXĐ');
  assert.equal(suggestContractNumber('web', '2026-03-20', 'Nguyễn Xuân Đàm'), '200326NXĐ/HĐTK-WEB/....');
  assert.equal(suggestContractNumber('tick', '2026-03-20', '', 3), '200326KH/HĐDV-FB/03');
  assert.equal(suggestContractNumber('seo', 'bad', 'A'), '');
});
test('tính tiền', () => {
  assert.deepEqual(webAmounts(10800000, 8), { vat: 800000, dot1: 5400000, dot2: 5400000 });
  assert.deepEqual(seoAmounts(10000000, 40, 30), { dot1: 4000000, dot2: 3000000, dot3: 3000000, dot3Percent: 30 });
});
test('web hợp lệ + giá trị nhập dạng chuỗi có dấu chấm', () => {
  const r = parseDocContract('web', web); assert.ok(r.ok); if (r.ok) { assert.equal(r.value.value, 10800000); assert.equal(r.value.endDate, '2026-02-11'); }
});
test('web thiếu tính năng / mô tả -> lỗi ở bước features', () => {
  const r1 = parseDocContract('web', { ...web, features: [] }); assert.ok(!r1.ok && r1.step === 'features');
  const r2 = parseDocContract('web', { ...web, features: [{ name: 'x', description: '' }] }); assert.ok(!r2.ok && r2.step === 'features');
});
test('web: email Bên A sai, giá trị 0, VAT ngoài khoảng', () => {
  assert.ok(!parseDocContract('web', { ...web, partyA: { ...A, email: 'x' } }).ok);
  assert.ok(!parseDocContract('web', { ...web, content: { ...web.content, contractValue: 0 } }).ok);
  assert.ok(!parseDocContract('web', { ...web, content: { ...web.content, vatPercent: 101 } }).ok);
});
test('seo: tổng đợt > 100% bị từ chối, thiếu nơi ký bị từ chối', () => {
  assert.ok(parseDocContract('seo', seo).ok);
  assert.ok(!parseDocContract('seo', { ...seo, content: { ...seo.content, dot1Percent: 70, dot2Percent: 40 } }).ok);
  assert.ok(!parseDocContract('seo', { ...seo, signPlace: '' }).ok);
});
test('tick: mặc định, tổng = phí + VAT, link Fanpage', () => {
  const r = parseDocContract('tick', tick); assert.ok(r.ok); if (r.ok) assert.equal(r.value.value, 10800000);
  assert.ok(!parseDocContract('tick', { ...tick, content: { ...tick.content, fanpageUrl: 'google.com/x' } }).ok);
  assert.ok(!parseDocContract('tick', { ...tick, partyB: { ...B, bankHolder: '' } }).ok);
  assert.ok(parseDocContract('tick', { ...tick, partyA: { ...A, email: '' } }).ok); // email Bên A tuỳ chọn ở Tích xanh
});
test('loại không hợp lệ / dữ liệu rác', () => {
  assert.ok(!parseDocContract('x', web).ok); assert.ok(!parseDocContract('web', null).ok);
});

test('dữ liệu lưu không chứa undefined ở bất kỳ độ sâu nào (Firestore sẽ từ chối → lỗi 500)', () => {
  const has = (v: unknown): boolean => v === undefined || (Array.isArray(v) ? v.some(has) : !!v && typeof v === 'object' && Object.values(v).some(has));
  for (const [k, raw] of [['web', web], ['seo', seo], ['tick', tick]] as const) { const r = parseDocContract(k, raw); assert.ok(r.ok, k); if (r.ok) assert.equal(has(r.value.data), false, k); }
});

import { seoEndDate } from './model';
import { addMonths } from './dates';
test('endDate suy ra cho SEO/Tích xanh để gửi duyệt được', () => {
  assert.equal(seoEndDate('2026-11-14', 'Triển khai trong 6 tháng'), '2027-05-14');
  assert.equal(seoEndDate('2026-11-14', '12 tuần'), '2027-02-06');
  assert.equal(seoEndDate('2026-11-14', 'Theo lộ trình'), '2027-11-14');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
});
