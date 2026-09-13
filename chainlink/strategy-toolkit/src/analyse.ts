// Static analysis of a submitted strategy, over the TypeScript AST.
//
// This runs before anything compiles or evaluates the source, so it is the one
// place where creator code is inspected without being executed. It is therefore
// written against the AST rather than against text: a regex over source cannot
// distinguish `fs` in an import from `fs` in a comment, and it cannot see
// through `import ("f" + "s")` at all.
//
// The denylists themselves live in shared/strategy-contract.ts so the backend,
// the frontend hint text and this analyser cannot disagree about them. A
// denylist is leaky by nature; what actually bounds a malicious submission is
// the sandboxed, network-restricted builder described in
// docs/project-overview.md ("The build is the attack surface, not the run").
// These checks are the first filter, not the containment.

import ts from 'typescript'
import {
	FORBIDDEN_GLOBALS,
	FORBIDDEN_IMPORTS,
	REQUIRED_EXPORTS,
} from '../../../shared/strategy-contract'
import type { SanityCheck } from '../../../shared/types'
import { failed, passed, pending } from './checks'
import { STRATEGY_FILE_NAME } from './paths'

const FORBIDDEN_GLOBAL_SET = new Set<string>(FORBIDDEN_GLOBALS)

/**
 * Forbidden modules reduced to their package root, so `node:fs/promises` and
 * `fs/promises` are rejected by the same rule that rejects `fs`. Subpaths are
 * the obvious way around a literal-match denylist.
 */
const FORBIDDEN_IMPORT_ROOTS = new Set<string>(FORBIDDEN_IMPORTS.map(moduleRoot))

function moduleRoot(specifier: string): string {
	const bare = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier
	const [root] = bare.split('/')
	return root ?? bare
}

// ─── Parsing ────────────────────────────────────────────────────────────────

export interface ParsedStrategy {
	sourceFile: ts.SourceFile
	syntacticErrors: string[]
}

/** Parses without resolving anything — no lib files, no module resolution. */
export function parseStrategy(source: string): ParsedStrategy {
	const sourceFile = ts.createSourceFile(
		STRATEGY_FILE_NAME,
		source,
		ts.ScriptTarget.ESNext,
		true,
		ts.ScriptKind.TS,
	)

	const host: ts.CompilerHost = {
		getSourceFile: (name) => (name === STRATEGY_FILE_NAME ? sourceFile : undefined),
		getDefaultLibFileName: () => 'lib.d.ts',
		writeFile: () => {},
		getCurrentDirectory: () => '/',
		getDirectories: () => [],
		getCanonicalFileName: (name) => name,
		useCaseSensitiveFileNames: () => true,
		getNewLine: () => '\n',
		fileExists: (name) => name === STRATEGY_FILE_NAME,
		readFile: (name) => (name === STRATEGY_FILE_NAME ? source : undefined),
	}

	const program = ts.createProgram([STRATEGY_FILE_NAME], { noLib: true, noResolve: true }, host)

	return {
		sourceFile,
		syntacticErrors: program.getSyntacticDiagnostics(sourceFile).map((d) => describeAt(sourceFile, d.start, flatten(d.messageText))),
	}
}

const flatten = (message: string | ts.DiagnosticMessageChain): string =>
	ts.flattenDiagnosticMessageText(message, ' ')

function describeAt(sourceFile: ts.SourceFile, position: number | undefined, message: string): string {
	if (position === undefined) return message
	const { line, character } = sourceFile.getLineAndCharacterOfPosition(position)
	return `line ${line + 1}:${character + 1} — ${message}`
}

const at = (node: ts.Node, message: string): string =>
	describeAt(node.getSourceFile(), node.getStart(), message)

// ─── Exports ────────────────────────────────────────────────────────────────

interface ExportSurface {
	names: Set<string>
	/** `export * from '...'` — the names it contributes cannot be resolved here. */
	hasStarExport: boolean
}

function collectBindingNames(name: ts.BindingName, into: Set<string>): void {
	if (ts.isIdentifier(name)) {
		into.add(name.text)
		return
	}
	for (const element of name.elements) {
		if (ts.isBindingElement(element)) collectBindingNames(element.name, into)
	}
}

function isExported(statement: ts.Statement): boolean {
	const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
	return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

export function collectExports(sourceFile: ts.SourceFile): ExportSurface {
	const names = new Set<string>()
	let hasStarExport = false

	for (const statement of sourceFile.statements) {
		if (ts.isVariableStatement(statement)) {
			if (!isExported(statement)) continue
			for (const declaration of statement.declarationList.declarations) {
				collectBindingNames(declaration.name, names)
			}
			continue
		}

		if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
			if (isExported(statement) && statement.name) names.add(statement.name.text)
			continue
		}

		if (ts.isExportDeclaration(statement)) {
			// `export type { ... }` contributes no runtime value.
			if (statement.isTypeOnly) continue
			if (!statement.exportClause) {
				hasStarExport = true
				continue
			}
			if (ts.isNamespaceExport(statement.exportClause)) {
				names.add(statement.exportClause.name.text)
				continue
			}
			for (const element of statement.exportClause.elements) {
				if (!element.isTypeOnly) names.add(element.name.text)
			}
		}
	}

	return { names, hasStarExport }
}

// ─── Imports ────────────────────────────────────────────────────────────────

function importViolations(sourceFile: ts.SourceFile): string[] {
	const violations: string[] = []

	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			const specifier = node.moduleSpecifier
			if (specifier && ts.isStringLiteralLike(specifier)) {
				checkSpecifier(specifier.text, node)
			}
		} else if (ts.isImportEqualsDeclaration(node)) {
			// `import x = require('fs')` — the CommonJS spelling of the same thing.
			if (ts.isExternalModuleReference(node.moduleReference)) {
				const expression = node.moduleReference.expression
				if (ts.isStringLiteralLike(expression)) checkSpecifier(expression.text, node)
				else violations.push(at(node, 'import = require(...) with a computed module reference'))
			}
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			// Dynamic import defeats the whole denylist: the specifier can be built
			// at runtime, so there is nothing to check. Rejected outright.
			violations.push(at(node, 'dynamic import() is not allowed in a strategy'))
		} else if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
			violations.push(at(node, 'import.meta is not allowed in a strategy'))
		}
		ts.forEachChild(node, visit)
	}

	function checkSpecifier(specifier: string, node: ts.Node): void {
		if (FORBIDDEN_IMPORT_ROOTS.has(moduleRoot(specifier))) {
			violations.push(at(node, `import of "${specifier}" is forbidden`))
		}
	}

	visit(sourceFile)
	return violations
}

// ─── Side effects ───────────────────────────────────────────────────────────

const ALLOWED_TOP_LEVEL = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.ImportDeclaration,
	ts.SyntaxKind.ImportEqualsDeclaration,
	ts.SyntaxKind.ExportDeclaration,
	ts.SyntaxKind.ExportAssignment,
	ts.SyntaxKind.FunctionDeclaration,
	ts.SyntaxKind.ClassDeclaration,
	ts.SyntaxKind.InterfaceDeclaration,
	ts.SyntaxKind.TypeAliasDeclaration,
	ts.SyntaxKind.EnumDeclaration,
	ts.SyntaxKind.ModuleDeclaration,
	ts.SyntaxKind.VariableStatement,
	ts.SyntaxKind.EmptyStatement,
])

const ASSIGNMENT_OPERATORS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.EqualsToken,
	ts.SyntaxKind.PlusEqualsToken,
	ts.SyntaxKind.MinusEqualsToken,
	ts.SyntaxKind.AsteriskEqualsToken,
	ts.SyntaxKind.AsteriskAsteriskEqualsToken,
	ts.SyntaxKind.SlashEqualsToken,
	ts.SyntaxKind.PercentEqualsToken,
	ts.SyntaxKind.AmpersandEqualsToken,
	ts.SyntaxKind.BarEqualsToken,
	ts.SyntaxKind.CaretEqualsToken,
	ts.SyntaxKind.LessThanLessThanEqualsToken,
	ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
	ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
	ts.SyntaxKind.AmpersandAmpersandEqualsToken,
	ts.SyntaxKind.BarBarEqualsToken,
	ts.SyntaxKind.QuestionQuestionEqualsToken,
])

const isFunctionBoundary = (node: ts.Node): boolean =>
	ts.isFunctionDeclaration(node) ||
	ts.isFunctionExpression(node) ||
	ts.isArrowFunction(node) ||
	ts.isMethodDeclaration(node) ||
	ts.isConstructorDeclaration(node) ||
	ts.isGetAccessorDeclaration(node) ||
	ts.isSetAccessorDeclaration(node)

/**
 * Expressions that would run the moment the module is imported. Function bodies
 * are skipped: code inside one runs when the platform calls it, under a context
 * the platform built, which is the whole point of the contract.
 */
function loadTimeSideEffects(statement: ts.Statement): string[] {
	const violations: string[] = []

	const visit = (node: ts.Node): void => {
		if (isFunctionBoundary(node)) return
		if (ts.isTypeNode(node)) return
		// Instance fields initialise on construction, not on import.
		if (ts.isPropertyDeclaration(node) && !hasStaticModifier(node)) return

		if (ts.isCallExpression(node)) {
			violations.push(at(node, 'function call at module load'))
		} else if (ts.isNewExpression(node)) {
			violations.push(at(node, 'construction at module load'))
		} else if (ts.isTaggedTemplateExpression(node)) {
			violations.push(at(node, 'tagged template at module load'))
		} else if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) {
			violations.push(at(node, 'await/yield at module load'))
		} else if (ts.isDeleteExpression(node)) {
			violations.push(at(node, 'delete at module load'))
		} else if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)) {
			violations.push(at(node, 'assignment at module load'))
		} else if (
			(ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
			(node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
		) {
			violations.push(at(node, 'mutation at module load'))
		} else if (ts.isClassStaticBlockDeclaration(node)) {
			violations.push(at(node, 'static initialisation block runs at module load'))
		}

		ts.forEachChild(node, visit)
	}

	visit(statement)
	return violations
}

function hasStaticModifier(node: ts.PropertyDeclaration): boolean {
	return (
		ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ?? false
	)
}

/**
 * Forbidden identifiers, flagged wherever they appear. The contract's wording is
 * "may not appear anywhere in submitted source", so a property named `eval` or a
 * computed access spelled `x['Function']` counts too — the point is to leave no
 * comfortable spelling, not to prove reachability.
 */
function forbiddenGlobals(sourceFile: ts.SourceFile): string[] {
	const violations: string[] = []

	const visit = (node: ts.Node): void => {
		if (ts.isIdentifier(node) && FORBIDDEN_GLOBAL_SET.has(node.text)) {
			violations.push(at(node, `"${node.text}" is not allowed in a strategy`))
		} else if (
			ts.isElementAccessExpression(node) &&
			ts.isStringLiteralLike(node.argumentExpression) &&
			FORBIDDEN_GLOBAL_SET.has(node.argumentExpression.text)
		) {
			violations.push(
				at(node, `"${node.argumentExpression.text}" is not allowed in a strategy`),
			)
		}
		ts.forEachChild(node, visit)
	}

	visit(sourceFile)
	return violations
}

function sideEffectViolations(sourceFile: ts.SourceFile): string[] {
	const violations = forbiddenGlobals(sourceFile)

	for (const statement of sourceFile.statements) {
		if (!ALLOWED_TOP_LEVEL.has(statement.kind)) {
			violations.push(
				at(statement, `top-level ${ts.SyntaxKind[statement.kind]} — only imports, declarations and exports are allowed`),
			)
			continue
		}
		violations.push(...loadTimeSideEffects(statement))
	}

	return violations
}

// ─── Entry point ────────────────────────────────────────────────────────────

const MAX_REPORTED = 5

const summarise = (violations: readonly string[]): string => {
	const shown = violations.slice(0, MAX_REPORTED).join('; ')
	const rest = violations.length - MAX_REPORTED
	return rest > 0 ? `${shown} (and ${rest} more)` : shown
}

/**
 * The four static checks, in pipeline order. When parsing fails the rest cannot
 * be evaluated, so they come back `pending` rather than passed or failed.
 */
export function analyse(source: string): SanityCheck[] {
	const { sourceFile, syntacticErrors } = parseStrategy(source)

	if (syntacticErrors.length > 0) {
		return [
			failed('parses', summarise(syntacticErrors)),
			pending('required-exports'),
			pending('forbidden-imports'),
			pending('no-side-effects'),
		]
	}

	const exports = collectExports(sourceFile)
	const missing = REQUIRED_EXPORTS.filter((name) => !exports.names.has(name))
	const exportsCheck =
		missing.length === 0
			? passed('required-exports', `exports ${REQUIRED_EXPORTS.join(', ')}`)
			: failed(
					'required-exports',
					exports.hasStarExport
						? `missing ${missing.join(', ')} — "export * from" cannot be verified statically, name each export explicitly`
						: `missing ${missing.join(', ')}`,
				)

	const imports = importViolations(sourceFile)
	const importsCheck =
		imports.length === 0
			? passed('forbidden-imports', 'no forbidden modules and no dynamic import')
			: failed('forbidden-imports', summarise(imports))

	const effects = sideEffectViolations(sourceFile)
	const effectsCheck =
		effects.length === 0
			? passed('no-side-effects', 'module body only declares')
			: failed('no-side-effects', summarise(effects))

	return [passed('parses', 'parsed as TypeScript'), exportsCheck, importsCheck, effectsCheck]
}
