import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebDocDefinition, buildSeoDocDefinition, buildTickDocDefinition } from './pdf-defs';
import { soTienBangChu } from './words';
import { calcTickAmounts } from './tick-model';
import type { PartyA, PartyB } from './types';

const A: PartyA = { companyName: 'Công ty A', taxCode: '0101', address: 'HN', representativeTitle: 'Ông', representativeName: 'Nguyễn Văn An', representativePosition: 'Giám đốc', phone: '0900', email: 'a@a.vn' };
const B: PartyB = { companyName: 'Công ty B', taxCode: '0202', address: 'HCM', representativeTitle: 'Bà', representativeName: 'Trần Thị Bình', representativePosition: 'Giám đốc', hotline: '1900', email: 'b@b.vn', bankAccount: '123', bankName: 'VCB' };
const base = { contractNumber: '120126A/HĐTK-WEB/01', signDate: '2026-01-12', signPlace: 'Hà Nội', partyA: A, partyB: B };
const text = (o: unknown): string => JSON.stringify(o);

test('soTienBangChu', () => {
  assert.match(soTienBangChu(1500000), /^Một triệu năm trăm nghìn đồng/i);
});

test('web: VAT gồm trong giá trị, 2 đợt 50/50', () => {
  const d = buildWebDocDefinition({ ...base, kind: 'web', content: { contractValue: 10800000, vatPercent: 8, demoDays: 7, acceptanceDays: 3, domainNote: 'x', hostingNote: 'y', extraServicesNote: 'z' } });
  const s = text(d);
  assert.ok(s.includes('800.000'), 'VAT = 10.8tr*8/108 = 800.000');
  assert.ok(s.includes('5.400.000'));
  assert.ok(s.includes('NGUYỄN VĂN AN') && s.includes('TRẦN THỊ BÌNH'));
  assert.equal((d as { pageSize: string }).pageSize, 'A4');
});

test('web: không tính năng thì đánh số khoản tiếp theo', () => {
  const d = buildWebDocDefinition({ ...base, kind: 'web', features: [{ name: 'Blog' }], content: { contractValue: 1, vatPercent: 8, demoDays: 1, acceptanceDays: 1, domainNote: '', hostingNote: '', extraServicesNote: '' } });
  assert.ok(text(d).includes('Danh mục tính năng website'));
});

test('seo: 3 đợt, đợt 3 là phần còn lại', () => {
  const d = buildSeoDocDefinition({ ...base, kind: 'seo', content: { contractValue: 10000000, vatIncluded: 'included', dot1Percent: 40, dot2Percent: 30, dot2Milestone: 'm', lateInterestPercent: 0.05, acceptanceDays: 5, confidentialityYears: 2, freeRevisions: 2, keywordsScope: 'k', articleCount: 4, reportFrequency: 'tháng', timeline: '3 tháng' } });
  const s = text(d);
  assert.ok(s.includes('4.000.000') && s.includes('3.000.000'));
  assert.ok(s.includes('PHỤ LỤC 01'));
});

test('tick: VAT cộng thêm, tổng = phí + VAT', () => {
  const a = calcTickAmounts({ serviceFee: 10000000, vatPercent: 8 });
  assert.equal(a.total, 10800000);
  const d = buildTickDocDefinition({ ...base, kind: 'tick', content: { serviceFee: 10000000, vatPercent: 8, fanpageName: 'FP' } });
  assert.ok(text(d).includes('10.800.000'));
  assert.ok(Array.isArray((d as { content: unknown[] }).content));
});
