import {
  ArrowRight,
  CalendarClock,
  CircleCheckBig,
  Code,
  History,
  NotebookPen,
  Plus,
  SquareCheckBig,
  SquarePen,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMemo } from 'react'

import { DashboardSection } from '@/components/dashboard/DashboardSection'
import { QuickAction } from '@/components/dashboard/QuickAction'
import { StatCard } from '@/components/dashboard/StatCard'
import { TodayFocus } from '@/components/dashboard/TodayFocus'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { getLastStorageErrorKind, storageErrorMessage } from '@/data/storageError'
import { useNoteCount } from '@/hooks/useNoteCount'
import { useTasks } from '@/hooks/useTasks'
import { useToday } from '@/hooks/useToday'
import { useToast } from '@/hooks/useToast'
import { requestIntent } from '@/navigation/intent'
import type { Task } from '@/types/task'
import type { PageProps } from '@/types/navigation'
import { isDueToday, selectTasks } from '@/utils/task'

type OverviewStat = {
  icon: LucideIcon
  label: string
  value: number
}

/** How many of today's tasks the dashboard lists before deferring to the workspace. */
const FOCUS_LIMIT = 5

/**
 * Home dashboard: welcome header, overview, recent/focus sections, quick actions.
 *
 * Every count is read from the store that owns it — nothing here is sample
 * data. Tasks come from the shared task store, so a task ticked off in this
 * view changes the overview on the same frame, before any navigation.
 */
export function HomePage({ onNavigate }: PageProps) {
  const { notify } = useToast()
  const { greeting, dateLabel, dateValue } = useToday()
  const noteCount = useNoteCount()
  const { tasks, isLoading: tasksLoading, setTaskCompleted } = useTasks()

  const dueTodayCount = useMemo(
    () => tasks.filter((task) => isDueToday(task, dateValue)).length,
    [tasks, dateValue],
  )

  const completedCount = useMemo(() => tasks.filter((task) => task.completed).length, [tasks])

  /**
   * Today's focus includes overdue work as well as today's: a task that slipped
   * past midnight is exactly what today's list is for. The "Tasks due today"
   * stat above stays literal, because that is what its label promises.
   */
  const focusTasks = useMemo(() => selectTasks(tasks, 'today', '', dateValue), [tasks, dateValue])
  const visibleFocus = focusTasks.slice(0, FOCUS_LIMIT)

  const overview: OverviewStat[] = [
    { icon: NotebookPen, label: 'Notes', value: noteCount },
    { icon: CalendarClock, label: 'Tasks due today', value: dueTodayCount },
    { icon: CircleCheckBig, label: 'Completed tasks', value: completedCount },
  ]

  const createNote = () => {
    // The Notes workspace owns note creation, so hand it the intent and go
    // there: the new note opens in place instead of the action dead-ending.
    requestIntent({ type: 'create-note' })
    onNavigate('notes')
  }

  const createTask = () => {
    // Same contract for tasks: the form opens in the tasks workspace.
    requestIntent({ type: 'create-task' })
    onNavigate('tasks')
  }

  const handleToggle = (task: Task, completed: boolean) => {
    void setTaskCompleted(task.id, completed).then((updated) => {
      if (!updated) {
        notify(
          storageErrorMessage(getLastStorageErrorKind(), 'That task could not be updated.'),
        )
      }
    })
  }

  return (
    <div className="@container">
      <PageHeader
        eyebrow={
          <>
            <span className="text-2xs font-semibold tracking-wide text-ink-muted uppercase">
              Your workspace
            </span>
            <span className="font-mono text-2xs text-ink-muted">{dateLabel}</span>
          </>
        }
        title={`${greeting}.`}
        description="A clear space to focus on what matters."
        actions={
          <>
            <Button icon={SquarePen} variant="primary" onClick={createNote}>
              New note
            </Button>
            <Button icon={Plus} onClick={createTask}>
              New task
            </Button>
          </>
        }
      />

      <section aria-label="Workspace overview" className="mt-6">
        <div className="grid gap-3 @min-[22rem]:grid-cols-2 @min-[46rem]:grid-cols-3">
          {overview.map((stat) => (
            <StatCard key={stat.label} icon={stat.icon} label={stat.label} value={stat.value} />
          ))}
        </div>
      </section>

      <div className="mt-4 grid gap-4 @min-[46rem]:grid-cols-2">
        <DashboardSection
          title="Recent activity"
          action={
            <Button variant="ghost" size="sm" onClick={() => onNavigate('notes')}>
              Open notes
              <ArrowRight aria-hidden className="size-3.5" />
            </Button>
          }
        >
          <EmptyState
            variant="inline"
            icon={History}
            title="Your workspace is ready."
            description="Notes and other items you open will appear here."
          />
        </DashboardSection>

        <DashboardSection
          title="Today's focus"
          action={
            <Button variant="ghost" size="sm" onClick={() => onNavigate('tasks')}>
              Open tasks
              <ArrowRight aria-hidden className="size-3.5" />
            </Button>
          }
        >
          <TodayFocus
            tasks={visibleFocus}
            overflow={focusTasks.length - visibleFocus.length}
            today={dateValue}
            isLoading={tasksLoading}
            onToggle={handleToggle}
            onOpenTasks={() => onNavigate('tasks')}
          />
        </DashboardSection>
      </div>

      <DashboardSection title="Quick actions" className="mt-4">
        <div className="flex flex-wrap gap-2">
          <QuickAction icon={SquarePen} label="Create a note" onClick={createNote} />
          <QuickAction icon={SquareCheckBig} label="Add a task" onClick={createTask} />
          <QuickAction
            icon={Code}
            label="Browse snippets"
            onClick={() => onNavigate('snippets')}
          />
        </div>
      </DashboardSection>
    </div>
  )
}
