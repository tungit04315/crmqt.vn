'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Alert } from '@/components/ui/form';
import TaskForm from './TaskForm';
import { useTaskMeta } from './ui';

export default function CreateTask() {
  const { meta, err } = useTaskMeta(); const router = useRouter();
  return (<div className="mx-auto max-w-3xl space-y-4">
    <Link href="/tasks" className="flex items-center gap-1 text-sm text-blue-600"><ArrowLeft size={14} />Danh sách công việc</Link>
    <h1 className="text-xl font-bold">Tạo công việc</h1>
    {err && <Alert>{err}</Alert>}{!meta && !err && <p className="text-sm text-slate-500">Đang tải…</p>}
    {meta && <div className="rounded-2xl border border-slate-200 bg-white p-5"><TaskForm meta={meta} onDone={id => router.push(`/tasks/${id}`)} onClose={() => router.push('/tasks')} /></div>}
  </div>);
}
