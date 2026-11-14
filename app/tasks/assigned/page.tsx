import TaskList from '@/components/tasks/TaskList';

export const instant = false;
export default function Page() { return <TaskList key="assigned" view="assigned" />; }
