import type { Extensions } from '@electric-sql/pglite'

import type { PGliteConfig, PGliteInstanceFor } from './config'

/** What the provider needs from an instance: PGlite and PGliteWorker both qualify. */
export interface Closable {
  readonly closed: boolean
  close(): Promise<void>
}

export interface PGliteProvider<T extends Closable> {
  /**
   * The instance, created on first use. Concurrent callers share the same
   * creation, and a closed instance is replaced on the next use.
   */
  use(): Promise<T>

  /** The instance if it has been created and is still open. */
  readonly instance: T | undefined

  /** Closes the current instance, if any. A later `use()` creates a new one. */
  close(): Promise<void>
}

/** How an instance is created and prepared; the shape a config is turned into. */
export interface PGliteProviderOptions<T extends Closable> {
  /** Creates and readies the instance. */
  create: () => Promise<T>

  /** Runs once per created instance, before it is handed out. */
  init?: (pg: T) => void | Promise<void>

  /** Runs before an instance is closed through the provider. */
  dispose?: (pg: T) => void | Promise<void>

  /**
   * Tracks the asynchronous extent of `init`, so that `use()` called from
   * inside it fails instead of waiting for itself. Needs an async-context
   * primitive, which is why it is supplied by the runtime (`AsyncLocalStorage`
   * on the server) rather than built in.
   */
  initScope?: InitScope
}

export interface InitScope {
  run<R>(fn: () => Promise<R>): Promise<R>
  active(): boolean
}

/**
 * Holds a single lazily created instance: PGlite allows one instance per data
 * directory, so everything in a process has to share it. Takes a config, which
 * creates the instance with `PGlite.create()`, or the lower-level
 * `{ create, init, dispose }` shape for instances created otherwise.
 */
export function createPGliteProvider<E extends Extensions = {}>(
  config: PGliteConfig<E>,
  options?: { initScope?: InitScope },
): PGliteProvider<PGliteInstanceFor<PGliteConfig<E>>>
export function createPGliteProvider<T extends Closable>(
  options: PGliteProviderOptions<T>,
): PGliteProvider<T>
export function createPGliteProvider(
  input: PGliteConfig | PGliteProviderOptions<Closable>,
  options: { initScope?: InitScope } = {},
): PGliteProvider<Closable> {
  return 'create' in input ? createProvider(input) : createProvider(fromConfig(input, options))
}

function fromConfig<E extends Extensions>(
  config: PGliteConfig<E>,
  { initScope }: { initScope?: InitScope },
): PGliteProviderOptions<PGliteInstanceFor<PGliteConfig<E>>> {
  return {
    create: async () => {
      // Deferred so that merely holding a config does not load the engine.
      const { PGlite } = await import('@electric-sql/pglite')
      // `init` and `dispose` ride along unused: PGlite only reads the options it knows.
      return PGlite.create(config)
    },
    init: config.init,
    dispose: config.dispose,
    initScope,
  }
}

function createProvider<T extends Closable>({
  create,
  init,
  dispose,
  initScope,
}: PGliteProviderOptions<T>): PGliteProvider<T> {
  let instance: T | undefined
  let pending: Promise<T> | undefined
  let closing: Promise<void> | undefined

  const open = async (): Promise<T> => {
    const pg = await create()
    try {
      if (init) {
        await (initScope ? initScope.run(() => Promise.resolve(init(pg))) : init(pg))
      }
    } catch (error) {
      await pg.close()
      throw error
    }
    instance = pg
    return pg
  }

  // Synchronous up to the creation, so that a close() issued right after
  // use() sees the creation in flight.
  const acquire = (): Promise<T> => {
    if (instance && !instance.closed) {
      return Promise.resolve(instance)
    }
    // A failed creation must not stick: the next use() retries.
    pending ??= open().finally(() => {
      pending = undefined
    })
    return pending
  }

  const use = (): Promise<T> => {
    if (initScope?.active()) {
      return Promise.reject(
        new Error(
          '[nuxt-pglite] The instance is still initialising: inside init(), use the `pg` it receives instead of calling use().',
        ),
      )
    }
    // A close in progress finishes first, so the caller never gets the
    // instance being closed.
    return closing ? closing.then(acquire) : acquire()
  }

  const close = async (): Promise<void> => {
    const pg = instance ?? (await pending?.catch(() => undefined))
    if (!pg || pg.closed) {
      instance = undefined
      return
    }
    try {
      await dispose?.(pg)
    } finally {
      // The instance goes away whatever dispose did: a failing dispose must
      // not leave it open and unreachable.
      instance = undefined
      await pg.close()
    }
  }

  return {
    get instance() {
      return instance && !instance.closed ? instance : undefined
    },
    use,
    close: () => {
      closing ??= close().finally(() => {
        closing = undefined
      })
      return closing
    },
  }
}
