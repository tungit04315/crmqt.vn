// Firestore giả trong bộ nhớ, CHỈ dùng cho kiểm thử logic giao dịch phía máy chủ (không phải thay thế Emulator).
// Mô phỏng: collection/doc/subcollection, where (== , array-contains), orderBy(ID hoặc trường), limit, startAfter, count(), getAll, transaction.
// Giữ đúng hai ràng buộc quan trọng của Firestore thật: giao dịch phải ĐỌC hết trước khi GHI; `create` lỗi nếu tài liệu đã tồn tại.
import { Timestamp, type DocumentData } from 'firebase-admin/firestore';

type Filter = { field: string; op: '==' | 'array-contains' | '<' | '<=' | '>' | '>='; value: unknown };
type Sentinel = { methodName: string; operand?: number };
const isSentinel = (v: unknown): v is Sentinel => !!v && typeof v === 'object' && 'methodName' in v;
const idOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const sortKey = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : (v as number | string));

export class FakeDb {
  data = new Map<string, DocumentData>();
  private clock = 0;
  private auto = 0;
  now() { return Timestamp.fromMillis(1_700_000_000_000 + this.clock++); }
  newId() { return `auto${String(++this.auto).padStart(4, '0')}`; }
  collection(path: string) { return new FakeQuery(this, path); }
  doc(path: string) { return new FakeDoc(this, path); }
  getAll(...refs: FakeDoc[]) {
    if (!refs.length) throw new Error("Function 'Firestore.getAll()' requires at least 1 argument."); // giống Firestore thật
    return Promise.all(refs.map(r => r.get()));
  }
  private txChain: Promise<unknown> = Promise.resolve();
  /** Các transaction chạy NỐI TIẾP (mô phỏng tính tuần tự hoá của Firestore: transaction xung đột sẽ chạy lại và thấy kết quả của transaction trước) */
  runTransaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
    const run = async () => { const tx = new FakeTx(this), out = await fn(tx); tx.commit(); return out; };
    const p = this.txChain.then(run, run); this.txChain = p.catch(() => undefined); return p;
  }
  /** Firestore thật (không bật ignoreUndefinedProperties) từ chối giá trị undefined ở MỌI độ sâu → mô phỏng để test bắt được lỗi 500 kiểu này */
  private assertNoUndefined(v: unknown, path: string) {
    if (v === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (field "${path}"). Dùng null hoặc bỏ trường.`);
    if (Array.isArray(v)) v.forEach((x, i) => this.assertNoUndefined(x, `${path}[${i}]`));
    else if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype && !isSentinel(v)) for (const [k, x] of Object.entries(v)) this.assertNoUndefined(x, `${path}.${k}`);
  }
  resolve(incoming: DocumentData, existing: DocumentData = {}): DocumentData {
    const out: DocumentData = {};
    for (const [k, v] of Object.entries(incoming)) {
      this.assertNoUndefined(v, k);
      if (!isSentinel(v)) out[k] = v;
      else if (v.methodName === 'FieldValue.serverTimestamp') out[k] = this.now();
      else if (v.methodName === 'FieldValue.increment') out[k] = ((existing[k] as number | undefined) ?? 0) + (v.operand ?? 0);
      else throw new Error(`Sentinel chưa hỗ trợ: ${v.methodName}`);
    }
    return out;
  }
  /** Tài liệu con trực tiếp của một collection */
  docsIn(path: string) {
    const prefix = path + '/';
    return [...this.data.keys()].filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).sort();
  }
}

export class FakeDoc {
  constructor(public db: FakeDb, public path: string) {}
  get id() { return idOf(this.path); }
  collection(name: string) { return new FakeQuery(this.db, `${this.path}/${name}`); }
  async get() { const d = this.db.data.get(this.path); return { id: this.id, ref: this, exists: !!d, data: () => (d ? { ...d } : undefined) }; }
  /** Ghi ngoài transaction (giống DocumentReference.set/update/delete của Firestore thật) */
  async set(data: DocumentData, opts?: { merge?: boolean }) { const cur = this.db.data.get(this.path); this.db.data.set(this.path, opts?.merge && cur ? { ...cur, ...this.db.resolve(data, cur) } : this.db.resolve(data)); }
  async update(data: DocumentData) { const cur = this.db.data.get(this.path); if (!cur) throw new Error(`NOT_FOUND: ${this.path}`); this.db.data.set(this.path, { ...cur, ...this.db.resolve(data, cur) }); }
  async delete() { this.db.data.delete(this.path); }
}

type Ord = { field: unknown; dir: 'asc' | 'desc' };
const cmp = (x: unknown, y: unknown) => (x === null || x === undefined ? (y === null || y === undefined ? 0 : -1) : y === null || y === undefined ? 1 : x < y ? -1 : x > y ? 1 : 0);
export class FakeQuery {
  constructor(public db: FakeDb, public path: string, private filters: Filter[] = [], private orders: Ord[] = [], private lim: number | null = null, private after: unknown[] | null = null) {}
  private with(p: Partial<{ filters: Filter[]; orders: Ord[]; lim: number; after: unknown[] }>) {
    return new FakeQuery(this.db, this.path, p.filters ?? this.filters, p.orders ?? this.orders, p.lim ?? this.lim, p.after ?? this.after);
  }
  doc(id?: string) { return new FakeDoc(this.db, `${this.path}/${id ?? this.db.newId()}`); }
  where(field: string, op: Filter['op'], value: unknown) { return this.with({ filters: [...this.filters, { field, op, value }] }); }
  orderBy(field: unknown, dir: 'asc' | 'desc' = 'asc') { return this.with({ orders: [...this.orders, { field, dir }] }); }
  limit(n: number) { return this.with({ lim: n }); }
  /** startAfter(id) (cách cũ, theo ID), startAfter(giá trị, ..., id) theo thứ tự orderBy, hoặc startAfter(bản_ghi) */
  startAfter(...args: unknown[]) {
    const a0 = args[0] as { id?: string; data?: () => Record<string, unknown> } | undefined;
    if (args.length === 1 && a0 && typeof a0 === 'object' && typeof a0.data === 'function') {
      const d = a0.data(); return this.with({ after: [...this.orders.map(o => (typeof o.field === 'string' ? d[o.field] : a0.id))] });
    }
    return this.with({ after: args });
  }
  private run() {
    let rows = this.db.docsIn(this.path).map(p => ({ id: idOf(p), ref: new FakeDoc(this.db, p), d: this.db.data.get(p)! }));
    for (const f of this.filters) rows = rows.filter(r => {
      const v = r.d[f.field];
      if (f.op === '==') return v === f.value;
      if (f.op === 'array-contains') return Array.isArray(v) && (v as unknown[]).includes(f.value);
      if (v === null || v === undefined) return false; // toán tử khoảng không khớp trường rỗng (giống Firestore)
      const c = cmp(sortKey(v), sortKey(f.value));
      return f.op === '<' ? c < 0 : f.op === '<=' ? c <= 0 : f.op === '>' ? c > 0 : c >= 0;
    });
    const ords: Ord[] = this.orders.length ? this.orders : [{ field: '__name__', dir: 'asc' }];
    const key = (r: { id: string; d: Record<string, unknown> }, o: Ord) => (typeof o.field === 'string' && o.field !== '__name__' ? sortKey(r.d[o.field]) : r.id);
    rows.sort((x, y) => { for (const o of ords) { const c = cmp(key(x, o), key(y, o)) * (o.dir === 'desc' ? -1 : 1); if (c) return c; } return 0; });
    if (this.after !== null) {
      const after = this.after;
      if (after.length === 1 && typeof after[0] === 'string' && this.orders.length <= 1) { const dir = ords[0].dir === 'desc' ? -1 : 1; rows = rows.filter(r => (dir === 1 ? r.id > (after[0] as string) : r.id < (after[0] as string))); } // cách cũ: theo ID
      else rows = rows.filter(r => { for (let i = 0; i < ords.length && i < after.length; i++) { const c = cmp(key(r, ords[i]), sortKey(after[i] as never)) * (ords[i].dir === 'desc' ? -1 : 1); if (c) return c > 0; } return false; });
    }
    return this.lim === null ? rows : rows.slice(0, this.lim);
  }
  async get() {
    const docs = this.run().map(r => ({ id: r.id, ref: r.ref, exists: true, data: () => ({ ...r.d }), get: (f: string) => r.d[f] }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
  count() { return { get: async () => ({ data: () => ({ count: this.run().length }) }) }; }
}

type Op = { kind: 'set' | 'create' | 'update' | 'delete'; ref: FakeDoc; data?: DocumentData; merge?: boolean };
export class FakeTx {
  private ops: Op[] = [];
  constructor(private db: FakeDb) {}
  private guard() { if (this.ops.length) throw new Error('Firestore transactions require all reads to be executed before all writes.'); }
  get(x: FakeDoc): ReturnType<FakeDoc['get']>;
  get(x: FakeQuery): ReturnType<FakeQuery['get']>;
  get(x: FakeDoc | FakeQuery) { this.guard(); return x instanceof FakeDoc ? x.get() : x.get(); }
  set(ref: FakeDoc, data: DocumentData, opts?: { merge?: boolean }) { this.ops.push({ kind: 'set', ref, data, merge: !!opts?.merge }); return this; }
  create(ref: FakeDoc, data: DocumentData) { this.ops.push({ kind: 'create', ref, data }); return this; }
  update(ref: FakeDoc, data: DocumentData) { this.ops.push({ kind: 'update', ref, data }); return this; }
  delete(ref: FakeDoc) { this.ops.push({ kind: 'delete', ref }); return this; }
  commit() {
    const view = new Map(this.db.data); // kiểm tra trên bản sao: có lỗi thì không ghi gì (nguyên tử)
    for (const o of this.ops) {
      const p = o.ref.path, cur = view.get(p);
      if (o.kind === 'create') { if (cur) throw new Error(`ALREADY_EXISTS: ${p}`); view.set(p, this.db.resolve(o.data!)); }
      else if (o.kind === 'set') view.set(p, o.merge && cur ? { ...cur, ...this.db.resolve(o.data!, cur) } : this.db.resolve(o.data!));
      else if (o.kind === 'update') { if (!cur) throw new Error(`NOT_FOUND: ${p}`); view.set(p, { ...cur, ...this.db.resolve(o.data!, cur) }); }
      else view.delete(p);
    }
    this.db.data = view;
  }
}
