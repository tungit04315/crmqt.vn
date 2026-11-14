import { Q_STATUS_COLOR, Q_STATUS_LABEL, type QEffective } from '@/lib/quotation-core';
export const QStatusBadge = ({ s }: { s: QEffective }) => <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${Q_STATUS_COLOR[s]}`}>{Q_STATUS_LABEL[s]}</span>;
