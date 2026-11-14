import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { stampSignature, sniffImage, sha256Hex } from './pdf-stamp';

// PNG 1x1 trong suốt
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
async function blank(pages = 2) { const d = await PDFDocument.create(); for (let i = 0; i < pages; i++) d.addPage([595.28, 841.89]); return d.save(); }
const info = { signerName: 'Nguyễn Văn An', signedAtText: '12/11/2026 10:30', method: 'Ký bằng ngón tay', verification: 'Xác thực OTP email' };

test('sniffImage theo magic bytes', () => {
  assert.equal(sniffImage(PNG), 'png');
  assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0])), 'jpg');
  assert.equal(sniffImage(Uint8Array.from(Buffer.from('<svg></svg>'))), null);
  assert.equal(sniffImage(new Uint8Array(0)), null);
});
test('đóng dấu: giữ số trang, đổi nội dung, hash khác, PDF gốc không bị sửa', async () => {
  const src = await blank(); const before = sha256Hex(src);
  const out = await stampSignature(src, PNG, { page: 2, x: 100, y: 600, width: 120, height: 50 }, info);
  assert.equal(sha256Hex(src), before);
  assert.notEqual(sha256Hex(out), before);
  const d = await PDFDocument.load(out); assert.equal(d.getPageCount(), 2);
  assert.match(sha256Hex(out), /^[0-9a-f]{64}$/);
});
test('từ chối ảnh giả, trang ngoài phạm vi', async () => {
  const src = await blank(1);
  await assert.rejects(() => stampSignature(src, Uint8Array.from(Buffer.from('not an image at all')), { page: 1, x: 0, y: 0, width: 10, height: 10 }, info), /PNG\/JPG/);
  await assert.rejects(() => stampSignature(src, PNG, { page: 3, x: 0, y: 0, width: 10, height: 10 }, info), /ngoài số trang/);
});
