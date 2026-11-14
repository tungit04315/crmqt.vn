import test from 'node:test';
import assert from 'node:assert/strict';
import { dataUrlBytes, fitWidth, hasInk, inkBounds, mid, pathLength, validateUpload } from './signature-core';

test('canvas trống / chỉ chấm nhỏ bị từ chối, nét thật được chấp nhận', () => {
  assert.equal(hasInk([]), false);
  assert.equal(hasInk([{ w: 0.01, pts: [{ x: 0.5, y: 0.5 }] }]), false);
  assert.equal(hasInk([{ w: 0.01, pts: [{ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.5 }] }]), false);
  assert.equal(hasInk([{ w: 0.01, pts: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.2 }] }]), true);
});
test('độ dài, khung cắt (có tính bề dày nét), điểm giữa', () => {
  assert.equal(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }]), 5);
  assert.deepEqual(inkBounds([{ w: 0.2, pts: [{ x: 1, y: 1 }, { x: 2, y: 3 }] }]), { x0: 0.9, y0: 0.9, x1: 2.1, y1: 3.1 });
  assert.equal(inkBounds([]), null); assert.deepEqual(mid({ x: 0, y: 0 }, { x: 2, y: 4 }), { x: 1, y: 2 });
});
test('kiểm tra tệp ảnh tải lên: loại, đuôi, kích thước', () => {
  assert.equal(validateUpload({ name: 'a.png', type: 'image/png', size: 1000 }), null);
  assert.equal(validateUpload({ name: 'a.JPG', type: 'image/jpeg', size: 1000 }), null);
  assert.equal(validateUpload({ name: 'a.jpeg', type: 'image/jpeg', size: 1000 }), null);
  assert.match(validateUpload({ name: 'a.gif', type: 'image/gif', size: 1000 })!, /PNG/);
  assert.match(validateUpload({ name: 'a.svg', type: 'image/svg+xml', size: 1000 })!, /PNG/);
  assert.match(validateUpload({ name: 'a.png.exe', type: 'image/png', size: 1000 })!, /PNG/);
  assert.match(validateUpload({ name: 'a.png', type: 'image/png', size: 6 * 1024 * 1024 })!, /5MB/);
  assert.match(validateUpload({ name: 'a.png', type: 'image/png', size: 0 })!, /trống/);
});
test('thu nhỏ giữ tỉ lệ, đo dung lượng data URL', () => {
  assert.deepEqual(fitWidth(2000, 1000, 800), { w: 800, h: 400 }); assert.deepEqual(fitWidth(500, 100, 800), { w: 500, h: 100 });
  assert.equal(dataUrlBytes('data:image/png;base64,QUJD'), 3); assert.equal(dataUrlBytes('data:image/png;base64,QUI='), 2);
});
