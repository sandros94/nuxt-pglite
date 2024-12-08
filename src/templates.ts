import type { NuxtServerTemplate } from '@nuxt/schema'
import { addTemplate, useNuxt } from '@nuxt/kit'

import type { ExtensionName } from './runtime/types'
import type { ModuleOptions } from './module'

export async function addTemplates(options: ModuleOptions) {
  const clientExts = getExtensions(options.client?.extensions)
  const serverExts = getExtensions(options.server?.extensions)

  addTemplate({
    write: true,
    filename: 'pglite/extensions.ts',
    async getContents() {
      if (clientExts === undefined) return `export const extensions = undefined

export default { extensions }`
      else return `${clientExts.imports.join('\n')}

export const extensions = {
  ${clientExts.extensions.join('\n  ')}
}

export default { extensions }
`
    },
  })
  addServerTemplate({
    filename: '#nitro-build/pglite-extensions.ts',
    async getContents() {
      if (serverExts === undefined) return `export const extensions = undefined

export default { extensions }`
      else return `${serverExts.imports.join('\n')}

export const extensions = {
  ${serverExts.extensions.join('\n  ')}
}

export default { extensions }
`
    },
  })
}

function getExtensions(extensions: ExtensionName[] = []) {
  if (extensions.length === 0) return undefined
  const imports: string[] = []
  const exts: string[] = []

  extensions.forEach((extension) => {
    imports.push(`import { ${extension} } from '${extensionSource[extension]}'`)
    exts.push(extension)
  })

  return {
    imports,
    extensions: exts,
  }
}

const extensionSource = {
  live: '@electric-sql/pglite/live',
  vector: '@electric-sql/pglite/vector',
  electricSync: '@electric-sql/pglite-sync',
  adminpack: '@electric-sql/pglite/contrib/adminpack',
  amcheck: '@electric-sql/pglite/contrib/amcheck',
  auto_explain: '@electric-sql/pglite/contrib/auto_explain',
  bloom: '@electric-sql/pglite/contrib/bloom',
  btree_gin: '@electric-sql/pglite/contrib/btree_gin',
  btree_gist: '@electric-sql/pglite/contrib/btree_gist',
  citext: '@electric-sql/pglite/contrib/citext',
  cube: '@electric-sql/pglite/contrib/cube',
  earthdistance: '@electric-sql/pglite/contrib/earthdistance',
  fuzzystrmatch: '@electric-sql/pglite/contrib/fuzzystrmatch',
  hstore: '@electric-sql/pglite/contrib/hstore',
  isn: '@electric-sql/pglite/contrib/isn',
  lo: '@electric-sql/pglite/contrib/lo',
  ltree: '@electric-sql/pglite/contrib/ltree',
  pg_trgm: '@electric-sql/pglite/contrib/pg_trgm',
  seg: '@electric-sql/pglite/contrib/seg',
  tablefunc: '@electric-sql/pglite/contrib/tablefunc',
  tcn: '@electric-sql/pglite/contrib/tcn',
  tsm_system_rows: '@electric-sql/pglite/contrib/tsm_system_rows',
  tsm_system_time: '@electric-sql/pglite/contrib/tsm_system_time',
  uuid_ossp: '@electric-sql/pglite/contrib/uuid_ossp',
}

// TODO: fix '@nuxt/kit'
export function addServerTemplate(template: NuxtServerTemplate) {
  const nuxt = useNuxt()

  nuxt.options.nitro.virtual ||= {}
  nuxt.options.nitro.virtual[template.filename] = template.getContents

  return template
}
