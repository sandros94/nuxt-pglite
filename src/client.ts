import { relative } from 'pathe'
import { addImports, addPlugin, addTemplate, addTypeTemplate, findPath, useLogger } from '@nuxt/kit'
import type { Resolver } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'

import type { ModuleOptions } from './types'

const CONFIG_ID = '#pglite/client-config'

export async function setupClient(
  options: ModuleOptions['client'],
  nuxt: Nuxt,
  resolver: Resolver,
) {
  const configPath = (await findPath(options.config, { cwd: nuxt.options.rootDir })) ?? undefined
  if (configPath && !options.enabled) {
    useLogger('nuxt-pglite').warn(
      `${relative(nuxt.options.rootDir, configPath)} found, but \`pglite.client\` is disabled: it is not used.`,
    )
  }

  // Declared even while disabled, so the module's own sources type-check.
  addTypeTemplate(
    {
      filename: 'types/nuxt-pglite-client.d.ts',
      getContents: () =>
        [
          `declare module '${CONFIG_ID}' {`,
          `  import type { PGliteClientConfig } from '${resolver.resolve('./runtime/client/config')}'`,
          `  import type { resolveEnvConfig } from '${resolver.resolve('./runtime/core')}'`,
          configPath && options.enabled
            ? `  const config: ReturnType<typeof resolveEnvConfig<typeof import('${configPath}').default>>`
            : `  const config: PGliteClientConfig`,
          `  export default config`,
          `}`,
        ].join('\n'),
    },
    { nuxt: true, nitro: false, node: false },
  )
  if (!options.enabled) {
    return
  }

  // The worker is an ES module and PGlite must not be pre-bundled: its wasm
  // and the worker entry are resolved relative to the package.
  nuxt.options.vite.optimizeDeps ||= {}
  nuxt.options.vite.optimizeDeps.exclude ||= []
  nuxt.options.vite.optimizeDeps.exclude.push('@electric-sql/pglite')
  nuxt.options.vite.worker ||= {}
  nuxt.options.vite.worker.format = 'es'

  // The config is imported by the main thread and by the worker, so it lives
  // in a template both bundles can reach through the alias.
  // The worker bundle is built without Nuxt's auto-import transform, so the
  // config's `definePGliteClientConfig` is provided as a global by a module
  // evaluated before it. The app's own transform is unaffected.
  const shim = addTemplate({
    filename: 'pglite/client-config-shim.mjs',
    write: true,
    getContents: () =>
      [
        `import { definePGliteClientConfig } from ${JSON.stringify(resolver.resolve('./runtime/client/config'))}`,
        `globalThis.definePGliteClientConfig ??= definePGliteClientConfig`,
      ].join('\n'),
  })
  const template = addTemplate({
    filename: 'pglite/client-config.mjs',
    write: true,
    getContents: () =>
      [
        `import ${JSON.stringify(shim.dst)}`,
        `import { assertConfigKind, resolveEnvConfig } from ${JSON.stringify(resolver.resolve('./runtime/core'))}`,
        configPath
          ? `import userConfig from ${JSON.stringify(configPath)}`
          : `const userConfig = {}`,
        `export const defaults = ${JSON.stringify(options.options)}`,
        `assertConfigKind(userConfig, 'client', ${JSON.stringify(options.config)})`,
        `export default resolveEnvConfig({ ...defaults, ...userConfig }, ${JSON.stringify({ dev: nuxt.options.dev, test: nuxt.options.test })})`,
      ].join('\n'),
  })
  nuxt.options.alias[CONFIG_ID] = template.dst

  addImports(
    ['usePGlite', 'useLiveQuery', 'useLiveIncrementalQuery', 'definePGliteClientConfig'].map(
      (name) => ({
        name,
        from: resolver.resolve('./runtime/client'),
      }),
    ),
  )

  if (options.eager) {
    addPlugin({ mode: 'client', src: resolver.resolve('./runtime/client/plugins/eager.client') })
  }
}
