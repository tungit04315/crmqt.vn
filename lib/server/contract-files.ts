// Lưu tệp (PDF gốc, PDF đã ký, ảnh chữ ký) trong Firestore dưới dạng Bytes, chia khúc ≤ 900KB (giới hạn tài liệu Firestore là 1MiB).
// contractFiles/{fileId} = metadata; contractFiles/{fileId}/chunks/{000..} = dữ liệu. Chỉ máy chủ đọc/ghi (rules `if false`).
import { createHash } from 'node:crypto';
import { adminDb } from './firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export const CHUNK = 900_000;
export interface FileMeta { organizationId: string; contractId: string; kind: 'original' | 'signed' | 'signature'; mime: string; size: number; sha256: string; chunks: number; docHash?: string; version?: number; sigPos?: { page: number; x: number; y: number; width: number; height: number }; sigPosB?: { page: number; x: number; y: number; width: number; height: number }; partyBSignatureSha256?: string }

/** Ghi tệp bên trong một transaction đang mở (nguyên tử cùng các thay đổi khác). Gọi SAU khi mọi lệnh đọc của transaction đã xong. */
export function putFile(tx: { set: (ref: never, data: never) => unknown }, fileId: string, bytes: Uint8Array, meta: Omit<FileMeta, 'size' | 'sha256' | 'chunks'>): FileMeta {
  const ref = adminDb().doc(`contractFiles/${fileId}`), n = Math.max(1, Math.ceil(bytes.length / CHUNK));
  const full: FileMeta = { ...meta, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), chunks: n };
  tx.set(ref as never, { ...full, createdAt: FieldValue.serverTimestamp() } as never);
  for (let i = 0; i < n; i++) tx.set(ref.collection('chunks').doc(String(i).padStart(3, '0')) as never, { data: Buffer.from(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)) } as never);
  return full;
}
export async function saveFile(fileId: string, bytes: Uint8Array, meta: Omit<FileMeta, 'size' | 'sha256' | 'chunks'>): Promise<FileMeta> {
  const db = adminDb(), ref = db.doc(`contractFiles/${fileId}`), n = Math.max(1, Math.ceil(bytes.length / CHUNK));
  const full: FileMeta = { ...meta, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), chunks: n };
  await db.runTransaction(async tx => {
    const cur = await tx.get(ref); if (cur.exists) throw new Error(`Tệp ${fileId} đã tồn tại (tệp là bất biến).`);
    tx.set(ref, { ...full, createdAt: FieldValue.serverTimestamp() });
    for (let i = 0; i < n; i++) tx.set(ref.collection('chunks').doc(String(i).padStart(3, '0')), { data: Buffer.from(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)) });
  });
  return full;
}
export async function fileMeta(fileId: string): Promise<FileMeta | null> { const d = (await adminDb().doc(`contractFiles/${fileId}`).get()).data(); return (d as FileMeta | undefined) ?? null; }
/** Đọc lại và kiểm tra SHA-256 để phát hiện dữ liệu hỏng/bị sửa. */
export async function loadFile(fileId: string): Promise<{ bytes: Uint8Array; meta: FileMeta } | null> {
  const meta = await fileMeta(fileId); if (!meta) return null;
  const snap = await adminDb().doc(`contractFiles/${fileId}`).collection('chunks').orderBy('__name__').get();
  const parts = snap.docs.map(d => { const v = d.data().data as { toUint8Array?: () => Uint8Array } | Uint8Array; return v instanceof Uint8Array ? v : v.toUint8Array!(); });
  const bytes = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
  if (parts.length !== meta.chunks || bytes.length !== meta.size || createHash('sha256').update(bytes).digest('hex') !== meta.sha256) throw new Error(`Tệp ${fileId} bị hỏng hoặc thiếu dữ liệu.`);
  return { bytes, meta };
}
