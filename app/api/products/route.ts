import { route } from '@/lib/server/http';
import { listItems } from '@/lib/server/catalog';
import { TAX_RATES } from '@/lib/quotation-core';
import type { ProductDto } from '@/types/quotation';

/** Cầu nối chỉ đọc: bộ chọn sản phẩm của báo giá lấy dữ liệu từ danh mục Module 10 (catalogItems). Giá = giá bán mặc định. */
export const GET = (req: Request) => route(req, async c => {
  const activeOnly = new URL(req.url).searchParams.get('active') === '1';
  const items: ProductDto[] = []; let cursor: string | undefined;
  for (let i = 0; i < 10; i++) { // tối đa 1.000 mặt hàng
    const r = await listItems(c, { status: activeOnly ? 'active' : undefined, limit: '100', cursor });
    for (const x of r.items) {
      const pct = x.taxRateBp === null ? 0 : Math.round(x.taxRateBp / 100);
      items.push({ id: x.id, code: x.code, name: x.name, type: x.type, unit: x.unitSymbol || x.unitName, unitPrice: x.defaultPrice,
        taxRate: TAX_RATES.includes(pct) ? pct : 0, description: x.shortDescription, active: x.status === 'active', createdAt: x.createdAt, updatedAt: x.updatedAt });
    }
    if (!r.nextCursor) break; cursor = r.nextCursor;
  }
  return { items, can: { manage: false } };
});
