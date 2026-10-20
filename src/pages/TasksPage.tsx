import { CalendarCheck, CalendarClock, CircleCheckBig, ListTodo, Plus, SearchX } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { TaskDialog } from '@/components/tasks/TaskDialog'
import { TaskFilters } from '@/components/tasks/TaskFilters'
import { TaskList } from '@/components/tasks/TaskList'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { getLastStorageErrorKind, storageErrorMessage } from '@/data/storageError'
import { useTasks } from '@/hooks/useTasks'
import { useToday } from '@/hooks/useToday'
import { useToast } from '@/hooks/useToast'
import { useViewIntent } from '@/hooks/useViewIntent'
import { peekIntent } from '@/navigation/intent'
import { EMPTY_TASK_DRAFT, type Task, type TaskDraft } from '@/types/task'
import { selectTasks, taskViewCounts, type TaskView } from '@/utils/task'
import { truncate } from '@/utils/text'

/** Which task the form dialog is open for. */
type EditorTarget = {
  mode: 'create' | 'edit'
  task: Task | null
}

type EmptyStateCopy = {
  icon: LucideIcon
  title: string
  description: string
}

/** What to say when a filter has nothing in it, per filter. */
const VIEW_EMPTY_STATES: Record<TaskView, EmptyStateCopy> = {
  all: {
    icon: ListTodo,
    title: 'No open tasks',
    description: 'Add a task to start tracking what needs doing.',
  },
  today: {
    icon: CalendarCheck,
    title: 'Nothing due today',
    description: 'Tasks due today or earlier will show up here.',
  },
  upcoming: {
    icon: CalendarClock,
    title: 'Nothing coming up',
    description: 'Tasks with a future due date will show up here.',
  },
  completed: {
    icon: CircleCheckBig,
    title: 'Nothing completed yet',
    description: 'Tick a task off and it moves here.',
  },
}

/**
 * The tasks workspace: a filtered, searchable list with a form dialog for
 * creating and editing.
 *
 * The list and the dialog are presentational; every task lives in the shared
 * store (`useTasks`), so the dashboard reflects a change as soon as it lands
 * here rather than on the next visit.
 */
export function TasksPage() {
  const { notify } = useToast()
  const { tasks, isLoading, createTask, updateTask, setTaskCompleted, deleteTask, archiveTask } =
    useTasks()
  const { dateValue: today } = useToday()

  const [view, setView] = useState<TaskView>('all')
  const [query, setQuery] = useState('')

  // "Add a task" on the dashboard arrives with a request to open the form. It is
  // read during the first render (a read, not a claim) so the dialog is part of
  // the very first commit rather than appearing a commit later, and released
  // below so a later visit starts on the list.
  const [editor, setEditor] = useState<EditorTarget | null>(() =>
    peekIntent()?.type === 'create-task' ? { mode: 'create', task: null } : null,
  )

  const [pendingDelete, setPendingDelete] = useState<Task | null>(null)

  // Id of a task a search result asked to open, until the store has loaded it.
  const pendingTaskId = useRef<string | null>(null)

  const counts = useMemo(() => taskViewCounts(tasks, today), [tasks, today])
  const visibleTasks = useMemo(
    () => selectTasks(tasks, view, query, today),
    [tasks, view, query, today],
  )

  const openCreate = useCallback(() => {
    setEditor({ mode: 'create', task: null })
  }, [])

  const openEdit = useCallback((task: Task) => {
    setEditor({ mode: 'edit', task })
  }, [])

  const requestDelete = useCallback((task: Task) => {
    setPendingDelete(task)
  }, [])

  const handleArchive = useCallback(
    (task: Task) => {
      void archiveTask(task).then((archived) => {
        notify(
          archived
            ? 'Task archived.'
            : storageErrorMessage(getLastStorageErrorKind(), 'That task could not be archived.'),
        )
      })
    },
    [archiveTask, notify],
  )

  // "Add a task" on the dashboard arrives with a request to open the form. The
  // request read during the first render above gets the dialog into the very
  // first commit; the intent hook below releases it and also handles a search
  // result that asks for one specific task — whether the user is arriving from
  // another view or already sitting in the tasks workspace.
  useViewIntent((intent) => {
    if (intent.type === 'create-task') {
      setEditor((current) => current ?? { mode: 'create', task: null })
      return true
    }

    if (intent.type === 'open-task') {
      const task = tasks.find((candidate) => candidate.id === intent.id)

      if (task) {
        setEditor({ mode: 'edit', task })
      } else {
        // Tasks load asynchronously; hold the id until the store has it.
        pendingTaskId.current = intent.id
      }
      return true
    }

    return false
  })

  // Opens the task a search result asked for, once the store has it. Tasks load
  // asynchronously, so this waits rather than dropping the request on arrival.
  useEffect(() => {
    const id = pendingTaskId.current

    if (id === null) {
      return
    }

    const task = tasks.find((candidate) => candidate.id === id)

    if (!task) {
      return
    }

    pendingTaskId.current = null
    setEditor({ mode: 'edit', task })
  }, [tasks])

  // Stable while the dialog is open, which is what lets the dialog seed its
  // fields exactly once per open rather than on every render.
  const dialogInitial = useMemo<TaskDraft>(
    () =>
      editor?.task
        ? {
            title: editor.task.title,
            description: editor.task.description,
            dueDate: editor.task.dueDate,
            priority: editor.task.priority,
          }
        : EMPTY_TASK_DRAFT,
    [editor],
  )

  const handleSubmit = (draft: TaskDraft) => {
    const target = editor

    setEditor(null)

    if (!target) {
      return
    }

    if (target.mode === 'create') {
      void createTask(draft).then((task) => {
        notify(
          task
            ? 'Task created.'
            : storageErrorMessage(getLastStorageErrorKind(), 'That task could not be saved.'),
        )
      })
      return
    }

    if (target.task) {
      void updateTask(target.task.id, draft).then((task) => {
        if (!task) {
          notify(
            storageErrorMessage(getLastStorageErrorKind(), 'That task could not be saved.'),
          )
        }
      })
    }
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

  const handleDelete = () => {
    const task = pendingDelete

    setPendingDelete(null)

    if (task) {
      void deleteTask(task.id).then((deleted) => {
        notify(
          deleted
            ? 'Task deleted.'
            : storageErrorMessage(getLastStorageErrorKind(), 'That task could not be deleted.'),
        )
      })
    }
  }

  const isFiltering = query.trim() !== ''
  const emptyCopy = VIEW_EMPTY_STATES[view]
  const quotedTitle = pendingDelete ? truncate(pendingDelete.title) : ''

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Everything on your plate, ordered by what is due and how urgent it is."
        actions={
          <Button variant="primary" icon={Plus} onClick={openCreate}>
            New task
          </Button>
        }
      />

      {isLoading ? (
        <p className="mt-5 text-sm text-ink-muted">Loading tasks…</p>
      ) : tasks.length === 0 ? (
        <EmptyState
          className="mt-5 flex-1 justify-center"
          icon={ListTodo}
          title="No tasks yet"
          description="Create your first task — it is saved on this device and never leaves it."
          action={
            <Button variant="primary" icon={Plus} onClick={openCreate}>
              New task
            </Button>
          }
        />
      ) : (
        <div className="mt-5 flex min-h-[24rem] flex-1 flex-col gap-4">
          <TaskFilters
            view={view}
            onViewChange={setView}
            query={query}
            onQueryChange={setQuery}
            visibleCount={visibleTasks.length}
            viewCount={counts[view]}
          />

          <TaskList
            tasks={visibleTasks}
            today={today}
            empty={
              isFiltering ? (
                <EmptyState
                  variant="inline"
                  icon={SearchX}
                  title="No matching tasks"
                  description="Try a different title."
                />
              ) : (
                <EmptyState
                  variant="inline"
                  icon={emptyCopy.icon}
                  title={emptyCopy.title}
                  description={emptyCopy.description}
                  action={
                    // Only the unfiltered list can end up empty while the page
                    // still has tasks (every one completed). Offering to add
                    // another is the obvious next step there; on the date-based
                    // views it would mean creating a task that does not belong
                    // to what the user is looking at.
                    view === 'all' ? (
                      <Button variant="primary" size="sm" icon={Plus} onClick={openCreate}>
                        New task
                      </Button>
                    ) : undefined
                  }
                />
              )
            }
            onToggle={handleToggle}
            onEdit={openEdit}
            onArchive={handleArchive}
            onDelete={requestDelete}
          />
        </div>
      )}

      <TaskDialog
        open={editor !== null}
        mode={editor?.mode ?? 'create'}
        initial={dialogInitial}
        onSubmit={handleSubmit}
        onCancel={() => setEditor(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this task?"
        description={
          quotedTitle
            ? `“${quotedTitle}” will be deleted from this device. This cannot be undone.`
            : 'This task will be deleted from this device. This cannot be undone.'
        }
        confirmLabel="Delete task"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />
    </>
  )
}
