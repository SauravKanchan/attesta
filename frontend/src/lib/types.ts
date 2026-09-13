/**
 * The wire contract. shared/types.ts is the single source of truth for both the
 * backend and this app; re-exporting it here keeps every frontend import pointing
 * at `@/lib/types` so the path to the contract can move without touching callers.
 */
export type * from '@shared/types'
