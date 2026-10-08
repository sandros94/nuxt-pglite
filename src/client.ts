import { relative } from 'pathe'
import { addImports, addPlugin, addTemplate, addTypeTemplate, findPath, useLogger } from '@nuxt/kit'
import type { Resolver } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'

import type { ClientOptions } from './types'
import { corePathForTypes, importedPackages, withoutExtension } from './utils/imports'

const CONFIG_ID = '#pglite/client-config'

export async function setupClient(options: ClientOptions, nuxt: Nuxt, resolver: Resolver) {
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
          // No import statements: inside an ambient module declaration they may
          // not name a path, but `import()` types may.
          `declare module '${CONFIG_ID}' {`,
          configPath && options.enabled
            ? `  const config: ReturnType<typeof import('${corePathForTypes(resolver, './runtime/core/kind')}').resolveEnvConfig<typeof import('${withoutExtension(configPath)}').default>>`
            : `  const config: import('${corePathForTypes(resolver, './runtime/client/config')}').PGliteClientConfig`,
          `  export default config`,
          `}`,
        ].join('\n'),
    },
    { nuxt: true, nitro: false, node: false },
  )
  if (!options.enabled) {
    return
  }
  // The worker, its wasm and its data file are wired for Vite; under webpack
  // PGlite's filesystem bundle comes out resized and fails at startup.
  if (nuxt.options.builder !== '@nuxt/vite-builder') {
    throw new Error(
      `[nuxt-pglite] \`pglite.client\` needs the Vite builder; got \`${typeof nuxt.options.builder === 'string' ? nuxt.options.builder : 'a custom builder'}\`. Disable the client side or switch builder.`,
    )
  }

  // The worker is an ES module and PGlite must not be pre-bundled: its wasm
  // and the worker entry are resolved relative to the package. Nor may the
  // packages the config imports be, since the optimizer would inline PGlite
  // into their chunk and lose those references again.
  nuxt.options.vite.optimizeDeps ||= {}
  nuxt.options.vite.optimizeDeps.exclude ||= []
  nuxt.options.vite.optimizeDeps.exclude.push(
    '@electric-sql/pglite',
    ...(configPath ? await importedPackages(configPath) : []),
  )
  nuxt.options.vite.worker ||= {}
  nuxt.options.vite.worker.format = 'es'

  // The config is imported by the main thread and by the worker, so it lives
  // in a template both bundles can reach through the alias.
  // Full file paths: a generated module's imports are resolved by whichever
  // bundler builds it, and not all of them resolve a bare directory.
  const [kindPath, clientConfigPath] = await Promise.all([
    resolver.resolvePath('./runtime/core/kind'),
    resolver.resolvePath('./runtime/client/config'),
  ])

  // The worker bundle is built without Nuxt's auto-import transform, so the
  // config's `definePGliteClientConfig` is provided as a global by a module
  // evaluated before it. The app's own transform is unaffected.
  const shim = addTemplate({
    filename: 'pglite/client-config-shim.mjs',
    write: true,
    getContents: () =>
      [
        `import { definePGliteClientConfig } from ${JSON.stringify(clientConfigPath)}`,
        `globalThis.definePGliteClientConfig ??= definePGliteClientConfig`,
      ].join('\n'),
  })
  const template = addTemplate({
    filename: 'pglite/client-config.mjs',
    write: true,
    getContents: () =>
      [
        `import ${JSON.stringify(shim.dst)}`,
        `import { assertConfigKind, resolveEnvConfig } from ${JSON.stringify(kindPath)}`,
        configPath
          ? `import userConfig from ${JSON.stringify(configPath)}`
          : `const userConfig = {}`,
        `export const defaults = ${JSON.stringify(options.options)}`,
        `assertConfigKind(userConfig, 'client', ${JSON.stringify(options.config)})`,
        `export default resolveEnvConfig({ ...defaults, ...userConfig }, ${JSON.stringify({ dev: nuxt.options.dev, test: nuxt.options.test })})`,
      ].join('\n'),
  })
  // A bundler alias only: through `nuxt.options.alias` TypeScript would map
  // the specifier to the untyped template and lose the declaration above.
  nuxt.options.vite.resolve ||= {}
  const { alias } = nuxt.options.vite.resolve
  nuxt.options.vite.resolve.alias = isAliasMap(alias)
    ? { ...alias, [CONFIG_ID]: template.dst }
    : [...(alias ?? []), { find: CONFIG_ID, replacement: template.dst }]

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

function isAliasMap(alias: unknown): alias is Record<string, string> {
  return typeof alias === 'object' && alias !== null && !Array.isArray(alias)
}
