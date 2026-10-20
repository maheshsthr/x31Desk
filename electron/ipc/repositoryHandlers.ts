/**
 * x31Desk — the main process's repository IPC handlers.
 * ---------------------------------------------------------------------------
 * One handler per data channel in the shared contract, each a thin wrapper that
 * validates its payload, runs one repository operation against the database and
 * reduces the outcome to the {@link IpcResult} envelope. The raw value, the SQL
 * and the database path never cross the boundary.
 *
 * The handlers are registered whether or not the database is ready. When it is
 * not — the file could not be opened, or it has been closed — every operation
 * answers `unavailable` rather than throwing, so the renderer sees a failure it
 * already knows how to explain instead of a rejected `invoke`. The renderer's
 * startup gate treats that answer as a failure to open, never as an empty
 * workspace, so a closed database cannot masquerade as "no records".
 */

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { DatabaseSync } from 'node:sqlite'

import { IPC_CHANNELS, SHELL_CHANNELS, type IpcChannel, type IpcFailure, type IpcResult } from '@/data/ipc/contract'
import type {
  ArchiveRepository,
  NoteRepository,
  SnippetRepository,
  TaskRepository,
} from '@/data/repositoryTypes'

import { classifyDatabaseError } from '../db/errorKind.ts'
import { createSqliteArchiveRepository } from '../db/repositories/archiveRepository.ts'
import { createSqliteNoteRepository } from '../db/repositories/noteRepository.ts'
import { createSqliteSnippetRepository } from '../db/repositories/snippetRepository.ts'
import { createSqliteTaskRepository } from '../db/repositories/taskRepository.ts'
import {
  parseArchiveAdd,
  parseArchiveRemove,
  parseIdPayload,
  parseNoteInsert,
  parseNoteUpdate,
  parseSnippetCreate,
  parseSnippetInsert,
  parseSnippetUpdate,
  parseTaskCreate,
  parseTaskInsert,
  parseTaskSetCompleted,
  parseTaskUpdate,
} from './validation.ts'

/** Every channel that carries a repository operation (i.e. not a shell channel). */
export type RepositoryChannel = Exclude<IpcChannel, (typeof SHELL_CHANNELS)[number]>

/** A handler for one data channel, taking the raw `invoke` arguments. */
export type RepositoryHandler = (args: readonly unknown[]) => Promise<IpcResult<unknown>>

/** One handler per repository channel, so no operation can be left unhandled. */
export type RepositoryHandlers = Record<RepositoryChannel, RepositoryHandler>

/** The four repositories, bound to one database connection. */
type DataRepositories = {
  readonly notes: NoteRepository
  readonly tasks: TaskRepository
  readonly snippets: SnippetRepository
  readonly archive: ArchiveRepository
}

/** Returns the database to use, or `null` when none is open. */
export type DatabaseProvider = () => DatabaseSync | null

/** Builds the handlers for every repository channel against a database provider. */
export function createRepositoryHandlers(getDatabase: DatabaseProvider): RepositoryHandlers {
  let cachedConnection: DatabaseSync | null = null
  let cachedRepositories: DataRepositories | null = null

  /**
   * Binds the repositories once per connection. Statements are prepared in the
   * factories, so reusing them avoids re-parsing on every call; a new connection
   * (the database is opened once, but may be reopened) rebuilds them.
   */
  function repositoriesFor(database: DatabaseSync): DataRepositories {
    if (cachedRepositories === null || cachedConnection !== database) {
      cachedConnection = database
      cachedRepositories = {
        notes: createSqliteNoteRepository(database),
        tasks: createSqliteTaskRepository(database),
        snippets: createSqliteSnippetRepository(database),
        archive: createSqliteArchiveRepository(database),
      }
    }

    return cachedRepositories
  }

  /** Runs one operation, mapping an unavailable database or a failure to an envelope. */
  async function run(
    operation: (repositories: DataRepositories) => unknown,
  ): Promise<IpcResult<unknown>> {
    const database = getDatabase()

    if (database === null) {
      return { ok: false, kind: 'unavailable' }
    }

    try {
      return { ok: true, value: await operation(repositoriesFor(database)) }
    } catch (error) {
      console.error('[x31desk] repository operation failed:', error)

      return { ok: false, kind: classifyDatabaseError(error) }
    }
  }

  /** Rejects a malformed call, logging the reason for the developer. */
  function reject(channel: string, reason: string): IpcFailure {
    console.error(`[x31desk] rejected ${channel}: ${reason}`)

    return { ok: false, kind: 'unknown' }
  }

  /** A channel that takes no arguments and returns a value. */
  function emptyHandler(
    channel: string,
    operation: (repositories: DataRepositories) => unknown,
  ): RepositoryHandler {
    return async (args) => {
      if (args.length !== 0) {
        return reject(channel, `expected no arguments, received ${args.length}`)
      }

      return run(operation)
    }
  }

  /** A channel that takes exactly one validated payload object. */
  function payloadHandler<T>(
    channel: string,
    parse: (value: unknown) => T | null,
    operation: (repositories: DataRepositories, input: T) => unknown,
  ): RepositoryHandler {
    return async (args) => {
      if (args.length !== 1) {
        return reject(channel, `expected one argument, received ${args.length}`)
      }

      const input = parse(args[0])

      if (input === null) {
        return reject(channel, 'payload failed validation')
      }

      return run((repositories) => operation(repositories, input))
    }
  }

  return {
    [IPC_CHANNELS.notesList]: emptyHandler(IPC_CHANNELS.notesList, (data) => data.notes.list()),
    [IPC_CHANNELS.notesCreate]: emptyHandler(IPC_CHANNELS.notesCreate, (data) => data.notes.create()),
    [IPC_CHANNELS.notesUpdate]: payloadHandler(
      IPC_CHANNELS.notesUpdate,
      parseNoteUpdate,
      (data, input) => data.notes.update(input.id, input.draft),
    ),
    [IPC_CHANNELS.notesInsert]: payloadHandler(
      IPC_CHANNELS.notesInsert,
      parseNoteInsert,
      (data, input) => data.notes.insert(input.note),
    ),
    [IPC_CHANNELS.notesRemove]: payloadHandler(
      IPC_CHANNELS.notesRemove,
      parseIdPayload,
      (data, input) => data.notes.remove(input.id),
    ),
    [IPC_CHANNELS.notesClear]: emptyHandler(IPC_CHANNELS.notesClear, (data) => data.notes.clear()),

    [IPC_CHANNELS.tasksList]: emptyHandler(IPC_CHANNELS.tasksList, (data) => data.tasks.list()),
    [IPC_CHANNELS.tasksCreate]: payloadHandler(
      IPC_CHANNELS.tasksCreate,
      parseTaskCreate,
      (data, input) => data.tasks.create(input.draft),
    ),
    [IPC_CHANNELS.tasksUpdate]: payloadHandler(
      IPC_CHANNELS.tasksUpdate,
      parseTaskUpdate,
      (data, input) => data.tasks.update(input.id, input.draft),
    ),
    [IPC_CHANNELS.tasksSetCompleted]: payloadHandler(
      IPC_CHANNELS.tasksSetCompleted,
      parseTaskSetCompleted,
      (data, input) => data.tasks.setCompleted(input.id, input.completed),
    ),
    [IPC_CHANNELS.tasksInsert]: payloadHandler(
      IPC_CHANNELS.tasksInsert,
      parseTaskInsert,
      (data, input) => data.tasks.insert(input.task),
    ),
    [IPC_CHANNELS.tasksRemove]: payloadHandler(
      IPC_CHANNELS.tasksRemove,
      parseIdPayload,
      (data, input) => data.tasks.remove(input.id),
    ),
    [IPC_CHANNELS.tasksClear]: emptyHandler(IPC_CHANNELS.tasksClear, (data) => data.tasks.clear()),

    [IPC_CHANNELS.snippetsList]: emptyHandler(
      IPC_CHANNELS.snippetsList,
      (data) => data.snippets.list(),
    ),
    [IPC_CHANNELS.snippetsCreate]: payloadHandler(
      IPC_CHANNELS.snippetsCreate,
      parseSnippetCreate,
      (data, input) => data.snippets.create(input.draft),
    ),
    [IPC_CHANNELS.snippetsUpdate]: payloadHandler(
      IPC_CHANNELS.snippetsUpdate,
      parseSnippetUpdate,
      (data, input) => data.snippets.update(input.id, input.draft),
    ),
    [IPC_CHANNELS.snippetsInsert]: payloadHandler(
      IPC_CHANNELS.snippetsInsert,
      parseSnippetInsert,
      (data, input) => data.snippets.insert(input.snippet),
    ),
    [IPC_CHANNELS.snippetsRemove]: payloadHandler(
      IPC_CHANNELS.snippetsRemove,
      parseIdPayload,
      (data, input) => data.snippets.remove(input.id),
    ),
    [IPC_CHANNELS.snippetsClear]: emptyHandler(
      IPC_CHANNELS.snippetsClear,
      (data) => data.snippets.clear(),
    ),

    [IPC_CHANNELS.archiveList]: emptyHandler(IPC_CHANNELS.archiveList, (data) => data.archive.list()),
    [IPC_CHANNELS.archiveAdd]: payloadHandler(
      IPC_CHANNELS.archiveAdd,
      parseArchiveAdd,
      (data, input) => data.archive.add(input.entry),
    ),
    [IPC_CHANNELS.archiveRemove]: payloadHandler(
      IPC_CHANNELS.archiveRemove,
      parseArchiveRemove,
      (data, input) => data.archive.remove(input.type, input.id),
    ),
    [IPC_CHANNELS.archiveClear]: emptyHandler(
      IPC_CHANNELS.archiveClear,
      (data) => data.archive.clear(),
    ),
  }
}

/**
 * Registers every repository handler on the given `ipcMain`, reading the current
 * database through `getDatabase` on each call. Safe to call before the database
 * is open: an operation then answers `unavailable` rather than throwing.
 */
export function registerRepositoryHandlers(
  ipcMain: IpcMain,
  getDatabase: DatabaseProvider,
): void {
  const handlers = createRepositoryHandlers(getDatabase)

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event: IpcMainInvokeEvent, ...args: unknown[]) => handler(args))
  }
}
