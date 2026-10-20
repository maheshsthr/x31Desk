/**
 * x31Desk — the backup feature's filesystem port, on `node:fs`.
 * ---------------------------------------------------------------------------
 * `backup.ts` decides *what* a backup file contains and *when* it is written;
 * this module decides *how* bytes reach the disk. Keeping the two apart means
 * the format and the merge logic can be tested against an in-memory stand-in,
 * and the only code that touches a real path is the small surface below.
 *
 * The one property worth stating outright: a reader never sees a half-written
 * backup. {@link nodeBackupFiles.writeAtomic} writes a sibling temporary file
 * and renames it into place, because the rename is the operation the filesystem
 * guarantees to be atomic — not the write. A crash mid-export therefore leaves
 * either no file or a complete one, never a truncated backup that would later
 * be refused as malformed.
 */

import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'

import type { BackupFiles } from './backup.ts'

/** Filesystem access for the backup feature, as the main process provides it. */
export const nodeBackupFiles: BackupFiles = {
  size(path: string): number {
    return statSync(path).size
  },

  read(path: string): string {
    return readFileSync(path, 'utf8')
  },

  writeAtomic(path: string, contents: string): void {
    // The temporary name carries randomness so two concurrent exports to the
    // same directory cannot pick the same staging file and clobber each other.
    const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`

    try {
      writeFileSync(temporary, contents, 'utf8')
      renameSync(temporary, path)
    } catch (error) {
      // A staging file left behind by a failed write is litter, not data: the
      // real path was never created, so remove what was and rethrow.
      try {
        unlinkSync(temporary)
      } catch {
        // Nothing further to do — the original error is the one worth reporting.
      }

      throw error
    }
  },

  remove(path: string): void {
    try {
      unlinkSync(path)
    } catch {
      // Verification failing is reported either way; a file that could not be
      // removed is no reason to replace the real error with a second one.
    }
  },
}
