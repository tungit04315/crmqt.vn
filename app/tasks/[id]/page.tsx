import TaskDetailView from '@/components/tasks/TaskDetailView';

export const instant = false;
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <TaskDetailView key={id} id={id} />; }
