import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'pathe'
import { resolvePath } from '@nuxt/kit'
import { findDynamicImports, findStaticImports, parseStaticImport } from 'mlly'

/**
 * Packages the config file imports, following its relative imports, so that the
 * extension packages it loads can be traced into the output. Aliased imports
 * are left to the bundler, which resolves them itself.
 */
export async function importedPackages(file: string, seen = new Set<string>()): Promise<string[]> {
  const resolved = (await resolvePath(file)) || file
  if (seen.has(resolved)) {
    return []
  }
  seen.add(resolved)

  const source = await readFile(resolved, 'utf8').catch(() => '')
  const specifiers = [
    ...findStaticImports(source).map((i) => parseStaticImport(i).specifier),
    ...findDynamicImports(source)
      .map((i) => /^["'`]([^"'`]+)["'`]$/.exec(i.expression.trim())?.[1])
      .filter((specifier) => specifier !== undefined),
  ]

  const packages: string[] = []
  for (const specifier of specifiers) {
    if (specifier.startsWith('.')) {
      packages.push(...(await importedPackages(resolve(dirname(resolved), specifier), seen)))
    } else if (!/^[#~@]\/|^[a-z]+:/.test(specifier)) {
      const name = /^(@[^/]+\/[^/]+|[^/]+)/.exec(specifier)?.[1]
      if (name && name !== 'nuxt-pglite') {
        packages.push(name)
      }
    }
  }
  return [...new Set(packages)]
}

/** `typeof import('…')` in a declaration must not name a `.ts` file. */
export function withoutExtension(file: string): string {
  return file.replace(/\.[cm]?[jt]sx?$/, '')
}

/** A module path usable in a generated declaration (directory or file, no extension). */
export function corePathForTypes(
  resolver: { resolve: (...path: string[]) => string },
  path: string,
): string {
  return withoutExtension(resolver.resolve(path))
}
