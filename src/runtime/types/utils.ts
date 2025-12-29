import type { Extensions, PGliteOptions, PGliteInterfaceExtensions, PGlite as _PGlite } from '@electric-sql/pglite'
import type { PGliteWorker as _PGliteWorker, PGliteWorkerOptions } from '@electric-sql/pglite/worker'

export type { Extensions, PGliteOptions, PGliteWorkerOptions }

export type PGlite<O extends PGliteOptions = PGliteOptions> = _PGlite & PGliteInterfaceExtensions<O['extensions']>
export type PGliteWorker<O extends PGliteWorkerOptions = PGliteWorkerOptions> = _PGliteWorker & PGliteInterfaceExtensions<O['extensions']>

export interface PGliteClientExtensions extends Extensions {
}
export interface PGliteServerExtensions extends Extensions {
}

export interface PGliteClientOptions<
  E = {},
> extends PGliteWorkerOptions {
  extensions?: E extends Extensions
    ? E & PGliteClientExtensions
    : PGliteClientExtensions
}
export interface PGliteServerOptions<
  E = {},
> extends PGliteOptions {
  extensions?: E extends Extensions
    ? E & PGliteClientExtensions
    : PGliteClientExtensions
}
