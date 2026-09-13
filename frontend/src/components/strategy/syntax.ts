/**
 * A small TypeScript tokenizer for the source viewer.
 *
 * Highlighting is presentation only, so it stays deliberately shallow rather than
 * pulling a parser into the bundle: comments, strings, numbers, keywords and call
 * sites. It never rewrites the text it is given — the reader has to be able to hash
 * what they see and get the published binary hash back.
 */

export type TokenKind =
	| 'comment'
	| 'string'
	| 'number'
	| 'keyword'
	| 'literal'
	| 'type'
	| 'call'
	| 'identifier'
	| 'punctuation'
	| 'plain'

export interface Token {
	kind: TokenKind
	text: string
}

const KEYWORDS = new Set([
	'abstract', 'as', 'asserts', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
	'continue', 'declare', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends',
	'finally', 'for', 'from', 'function', 'get', 'if', 'implements', 'import', 'in', 'infer',
	'instanceof', 'interface', 'is', 'keyof', 'let', 'namespace', 'new', 'of', 'private',
	'protected', 'public', 'readonly', 'return', 'satisfies', 'set', 'static', 'switch',
	'this', 'throw', 'try', 'type', 'typeof', 'var', 'void', 'while', 'yield',
])

const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'])

const PRIMITIVES = new Set(['string', 'number', 'boolean', 'bigint', 'symbol', 'object', 'any', 'unknown', 'never'])

const TOKEN =
	/(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|(`(?:\\[\s\S]|[^`\\])*`)|('(?:\\[\s\S]|[^'\\\n])*')|("(?:\\[\s\S]|[^"\\\n])*")|(\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?n?)|([A-Za-z_$][\w$]*)|(\s+)|([^\s\w$])/g

function classifyWord(word: string, rest: string): TokenKind {
	if (KEYWORDS.has(word)) return 'keyword'
	if (LITERALS.has(word)) return 'literal'
	if (PRIMITIVES.has(word)) return 'type'
	if (/^\s*\(/.test(rest)) return 'call'
	if (/^[A-Z]/.test(word)) return 'type'
	return 'identifier'
}

export function tokenize(source: string): Token[] {
	const tokens: Token[] = []
	TOKEN.lastIndex = 0
	let cursor = 0

	for (let match = TOKEN.exec(source); match !== null; match = TOKEN.exec(source)) {
		if (match.index > cursor) tokens.push({ kind: 'plain', text: source.slice(cursor, match.index) })
		cursor = match.index + match[0].length

		const [text, lineComment, blockComment, template, single, double, numeric, word, space] = match
		if (lineComment !== undefined || blockComment !== undefined) tokens.push({ kind: 'comment', text })
		else if (template !== undefined || single !== undefined || double !== undefined) {
			tokens.push({ kind: 'string', text })
		} else if (numeric !== undefined) tokens.push({ kind: 'number', text })
		else if (word !== undefined) tokens.push({ kind: classifyWord(word, source.slice(cursor)), text })
		else if (space !== undefined) tokens.push({ kind: 'plain', text })
		else tokens.push({ kind: 'punctuation', text })
	}

	if (cursor < source.length) tokens.push({ kind: 'plain', text: source.slice(cursor) })
	return tokens
}

/** Splits tokens across physical lines so a gutter can be drawn beside them. */
export function toLines(tokens: readonly Token[]): Token[][] {
	const lines: Token[][] = [[]]
	for (const token of tokens) {
		const parts = token.text.split('\n')
		parts.forEach((part, index) => {
			if (index > 0) lines.push([])
			if (part === '') return
			const line = lines[lines.length - 1]
			if (line) line.push({ kind: token.kind, text: part })
		})
	}
	return lines
}

export const TOKEN_CLASS: Record<TokenKind, string> = {
	comment: 'text-fg-muted italic',
	string: 'text-verified',
	number: 'text-warning-light',
	keyword: 'text-telemetry-hover',
	literal: 'text-warning-light',
	type: 'text-fg',
	call: 'text-fg',
	identifier: 'text-fg-secondary',
	punctuation: 'text-fg-muted',
	plain: 'text-fg-secondary',
}
