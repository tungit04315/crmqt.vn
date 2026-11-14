import ContractChildLists from '@/components/contracts/ContractChildLists';
export const instant = false;
export default function Page() { return <ContractChildLists kind="requests" type="liquidation" title="Quản lý thanh lý" desc="Yêu cầu thanh lý hợp đồng; khi được duyệt, hợp đồng chuyển sang đã kết thúc." />; }
