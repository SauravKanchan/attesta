'use client'

import { useEffect, useRef } from 'react'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import {
	EditorView,
	drawSelection,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'

/**
 * The editor itself. Loaded through `CodeEditor`, which defers this whole module —
 * CodeMirror and the TypeScript grammar are the largest thing in the app and only the
 * create flow needs them.
 *
 * Colours are the design tokens by CSS variable rather than by hex, so the editor
 * cannot drift from the rest of the terminal. The palette has no violet, so keywords
 * take telemetry cyan and literals take verified green — the same split the rest of
 * the product uses for "control" and "value".
 */

const theme = EditorView.theme(
	{
		'&': {
			backgroundColor: 'var(--color-surface-1)',
			color: 'var(--color-fg)',
			fontSize: '12px',
			height: '100%',
		},
		'.cm-scroller': {
			fontFamily: 'var(--font-mono)',
			fontFeatureSettings: '"tnum" on, "zero" on',
			lineHeight: '20px',
		},
		'.cm-content': { padding: '12px 0', caretColor: 'var(--color-verified)' },
		'.cm-gutters': {
			backgroundColor: 'var(--color-canvas)',
			color: 'var(--color-fg-muted)',
			border: 'none',
			borderRight: '1px solid var(--color-hairline)',
			paddingRight: '4px',
		},
		'.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '36px' },
		'.cm-activeLineGutter': { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-fg-secondary)' },
		'.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--color-interact) 45%, transparent)' },
		'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-verified)', borderLeftWidth: '2px' },
		'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
			backgroundColor: 'color-mix(in oklab, var(--color-verified) 26%, transparent)',
		},
		'.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
			backgroundColor: 'color-mix(in oklab, var(--color-telemetry) 30%, transparent)',
			outline: 'none',
		},
		'&.cm-focused': { outline: 'none' },
	},
	{ dark: true },
)

const highlight = HighlightStyle.define([
	{ tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.operatorKeyword], color: 'var(--color-telemetry-hover)' },
	{ tag: [tags.definitionKeyword, tags.moduleKeyword], color: 'var(--color-telemetry-hover)' },
	{ tag: [tags.string, tags.special(tags.string)], color: 'var(--color-verified)' },
	{ tag: [tags.number, tags.bool, tags.null], color: 'var(--color-warning-light)' },
	{ tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--color-fg-muted)', fontStyle: 'italic' },
	{ tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--color-fg)' },
	{ tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)], color: 'var(--color-fg)' },
	{ tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--color-warning-light)' },
	{ tag: [tags.propertyName, tags.attributeName], color: 'var(--color-fg-secondary)' },
	{ tag: [tags.variableName, tags.labelName], color: 'var(--color-fg-secondary)' },
	{ tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: 'var(--color-fg-muted)' },
	{ tag: [tags.invalid], color: 'var(--color-risk-light)' },
])

export interface CursorPosition {
	line: number
	column: number
}

export interface CodeMirrorEditorProps {
	value: string
	onChange: (next: string) => void
	onCursorChange?: (position: CursorPosition) => void
	readOnly?: boolean
	className?: string
}

export default function CodeMirrorEditor({
	value,
	onChange,
	onCursorChange,
	readOnly = false,
	className,
}: CodeMirrorEditorProps) {
	const host = useRef<HTMLDivElement>(null)
	const view = useRef<EditorView | null>(null)
	// Held in refs so a new callback identity never tears down the editor mid-keystroke.
	const onChangeRef = useRef(onChange)
	const onCursorChangeRef = useRef(onCursorChange)
	onChangeRef.current = onChange
	onCursorChangeRef.current = onCursorChange

	useEffect(() => {
		const parent = host.current
		if (parent === null) return

		const instance = new EditorView({
			parent,
			state: EditorState.create({
				doc: value,
				extensions: [
					lineNumbers(),
					highlightActiveLine(),
					highlightActiveLineGutter(),
					drawSelection(),
					history(),
					bracketMatching(),
					indentOnInput(),
					indentUnit.of('\t'),
					javascript({ typescript: true }),
					syntaxHighlighting(highlight),
					keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
					EditorView.lineWrapping,
					EditorState.readOnly.of(readOnly),
					theme,
					EditorView.updateListener.of((update) => {
						if (update.docChanged) onChangeRef.current(update.state.doc.toString())
						if (update.selectionSet || update.docChanged) {
							const head = update.state.selection.main.head
							const line = update.state.doc.lineAt(head)
							onCursorChangeRef.current?.({
								line: line.number,
								column: head - line.from + 1,
							})
						}
					}),
				],
			}),
		})
		view.current = instance

		return () => {
			instance.destroy()
			view.current = null
		}
		// The document is seeded once; later changes flow through the sync effect below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [readOnly])

	// Reset-to-template and file upload replace the document from outside the editor.
	useEffect(() => {
		const instance = view.current
		if (instance === null) return
		const current = instance.state.doc.toString()
		if (current === value) return
		instance.dispatch({ changes: { from: 0, to: current.length, insert: value } })
	}, [value])

	return <div ref={host} className={className} />
}
