'use client';
import { useMemo, useState } from 'react';
import { Package, Search } from 'lucide-react';
import { formatVnd } from '@/lib/opportunity-core';
import type { ProductDto } from '@/types/quotation';

export default function ProductPicker({ products, onPick }: { products: ProductDto[] | null; onPick: (p: ProductDto) => void }) {
  const [open, setOpen] = useState(false); const [q, setQ] = useState('');
  const list = useMemo(() => (products ?? []).filter(p => !q || [p.name, p.code].some(x => x.toLowerCase().includes(q.toLowerCase()))).slice(0, 8), [products, q]);
  return (<div className="relative"><button type="button" onClick={() => setOpen(o => !o)} className="flex h-9 items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100"><Package size={14} />Chọn từ danh mục</button>
    {open && <div className="absolute right-0 z-30 mt-1 w-80 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"><div className="relative"><Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm sản phẩm / dịch vụ…" className="h-9 w-full rounded-md bg-slate-100 pl-8 text-sm outline-none" /></div>
      <div className="mt-1 max-h-60 overflow-auto">{products === null && <p className="p-3 text-xs text-slate-500">Đang tải…</p>}
        {list.map(p => <button type="button" key={p.id} onClick={() => { onPick(p); setOpen(false); setQ(''); }} className="flex w-full items-start gap-2 border-b p-2 text-left text-sm last:border-0 hover:bg-slate-50">
          <span className="flex-1"><b className="block text-xs text-slate-400">{p.code}</b>{p.name}</span><span className="whitespace-nowrap text-xs font-semibold text-slate-600">{formatVnd(p.unitPrice)}/{p.unit}</span></button>)}
        {products && !list.length && <p className="p-3 text-xs text-slate-500">Không có sản phẩm phù hợp. Bạn vẫn có thể nhập dòng hàng thủ công.</p>}</div></div>}</div>);
}
