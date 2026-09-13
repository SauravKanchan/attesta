/**
 * Reads the export surface of a strategy out of its source, in the browser.
 *
 * The authoritative answer is `required-exports` in the sanity pipeline, which walks a
 * real TypeScript AST on the server. This is the editor's companion to it: the creator
 * needs the checklist to tick over as they type, and a round trip per keystroke is the
 * wrong way to get that. So this is a scanner, not a compiler — it strips comments and
 * string bodies first so that `fs` in a comment or `export` inside a template literal
 * cannot fake a match, then reads the export forms off what is left.
 *
 * Where the two can disagree it defers: `export * from '...'` contributes names this
 * scanner cannot resolve, so the affected entries report `unresolved` rather than
 * present or missing, and the server has the last word.
 */

import type { StrategyModule } from '@shared/strategy-contract'

export type RequiredExportName = keyof StrategyModule

interface RequiredExportSpec {
	signature: string
	purpose: string
}

/**
 * Keyed by `keyof StrategyModule`, so a change to the strategy interface fails this
 * file to compile rather than quietly leaving the checklist a member short.
 */
const REQUIRED_EXPORT_SPECS: Record<RequiredExportName, RequiredExportSpec> = {
	describe: { signature: 'describe()', purpose: 'Name, ticker, declared assets and summary.' },
	onTick: { signature: 'onTick()', purpose: 'The decision. Runs in the enclave once per tick.' },
	balanceOf: { signature: 'balanceOf()', purpose: "An investor's claim in USDC." },
	totalAssets: { signature: 'totalAssets()', purpose: 'USDC the strategy is accountable for.' },
	onDeposit: { signature: 'onDeposit()', purpose: 'Shares minted for an allocation.' },
	onWithdraw: { signature: 'onWithdraw()', purpose: 'USDC released for shares burned.' },
}

/** Declaration order, which is also the order the checklist renders in. */
export const REQUIRED_EXPORT_NAMES: readonly RequiredExportName[] = Object.keys(
	REQUIRED_EXPORT_SPECS,
) as RequiredExportName[]

/* ── Blanking comments and literals ──────────────────────── */

/**
 * Replaces the body of every comment, string and template literal with spaces of the
 * same length. Offsets and line breaks survive, so anything derived from the result
 * still lines up with the original source.
 */
export function blankCommentsAndLiterals(source: string): string {
	const out = source.split('')
	const length = source.length
	let index = 0

	const blank = (from: number, to: number) => {
		for (let i = from; i < to && i < length; i += 1) {
			if (out[i] !== '\n') out[i] = ' '
		}
	}

	while (index < length) {
		const char = source[index]
		const next = source[index + 1]

		if (char === '/' && next === '/') {
			const end = source.indexOf('\n', index)
			blank(index, end === -1 ? length : end)
			index = end === -1 ? length : end
			continue
		}

		if (char === '/' && next === '*') {
			const end = source.indexOf('*/', index + 2)
			const stop = end === -1 ? length : end + 2
			blank(index, stop)
			index = stop
			continue
		}

		if (char === '"' || char === "'" || char === '`') {
			const quote = char
			let cursor = index + 1
			while (cursor < length) {
				const current = source[cursor]
				if (current === '\\') {
					cursor += 2
					continue
				}
				if (current === quote) break
				cursor += 1
			}
			// Leave the quotes in place so `export {x} from 'y'` still reads as a string.
			blank(index + 1, Math.min(cursor, length))
			index = Math.min(cursor + 1, length)
			continue
		}

		index += 1
	}

	return out.join('')
}

/* ── Export surface ──────────────────────────────────────── */

export interface ExportSurface {
	names: Set<string>
	/** `export * from '...'` — the names it contributes cannot be resolved here. */
	hasStarExport: boolean
}

const DECLARATION_EXPORT =
	/\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g
const NAMED_EXPORT_BLOCK = /\bexport\s+(type\s+)?\{([^}]*)\}/g
const STAR_EXPORT = /\bexport\s+\*(?:\s+as\s+([A-Za-z_$][\w$]*))?\s+from\b/g

export function collectExports(source: string): ExportSurface {
	const scanned = blankCommentsAndLiterals(source)
	const names = new Set<string>()
	let hasStarExport = false

	for (const match of scanned.matchAll(DECLARATION_EXPORT)) {
		const name = match[1]
		if (name !== undefined) names.add(name)
	}

	for (const match of scanned.matchAll(NAMED_EXPORT_BLOCK)) {
		// `export type { ... }` contributes no runtime value.
		if (match[1] !== undefined) continue
		for (const rawEntry of (match[2] ?? '').split(',')) {
			const entry = rawEntry.trim()
			if (entry.length === 0) continue
			// Per-specifier `type` markers are type-only in an otherwise value export.
			if (/^type\s+/.test(entry)) continue
			const aliased = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(entry)
			if (aliased?.[2] !== undefined) {
				names.add(aliased[2])
				continue
			}
			if (/^[A-Za-z_$][\w$]*$/.test(entry)) names.add(entry)
		}
	}

	for (const match of scanned.matchAll(STAR_EXPORT)) {
		// `export * as ns from '...'` exports one resolvable name; a bare star does not.
		const namespace = match[1]
		if (namespace !== undefined) names.add(namespace)
		else hasStarExport = true
	}

	return { names, hasStarExport }
}

/* ── The checklist ───────────────────────────────────────── */

export interface RequiredExportState {
	name: RequiredExportName
	signature: string
	purpose: string
	present: boolean
	/** A bare `export *` could supply it; only the server-side check can say. */
	unresolved: boolean
}

export function requiredExportStates(source: string): RequiredExportState[] {
	const surface = collectExports(source)
	return REQUIRED_EXPORT_NAMES.map((name) => {
		const present = surface.names.has(name)
		return {
			name,
			signature: REQUIRED_EXPORT_SPECS[name].signature,
			purpose: REQUIRED_EXPORT_SPECS[name].purpose,
			present,
			unresolved: !present && surface.hasStarExport,
		}
	})
}

/** True only when every required export is resolvable right here in the browser. */
export function hasEveryRequiredExport(states: readonly RequiredExportState[]): boolean {
	return states.every((state) => state.present)
}
