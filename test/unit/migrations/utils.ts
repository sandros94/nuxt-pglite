import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach } from 'vitest'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** A temporary migrations folder, removed after the test. */
export async function createMigrationsDir(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nuxt-pglite-migrations-'))

  dirs.push(dir)
  await writeFiles(dir, files)

  return dir
}

/** Writes `files`, keyed by their path relative to `dir`. */
export async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const file = join(dir, path)

      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, content)
    }),
  )
}
