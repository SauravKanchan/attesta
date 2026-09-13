'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/cn'
import { TOKEN_CLASS, toLines, tokenize } from '@/components/strategy/syntax'

export interface SourceCodeProps {
	source: string
	className?: string
}

/** The published TypeScript, with a gutter that stays put while long lines scroll. */
export function SourceCode({ source, className }: SourceCodeProps) {
	const lines = useMemo(() => toLines(tokenize(source)), [source])

	return (
		<div className={cn('overflow-x-auto bg-surface-1', className)}>
			<pre className="w-max min-w-full type-code-md">
				<code>
					{lines.map((tokens, index) => (
						<span key={index} className="flex hover:bg-interact/40">
							<span className="sticky left-0 w-12 shrink-0 select-none border-r border-hairline bg-surface-1 pr-3 text-right type-code-sm text-fg-muted">
								{index + 1}
							</span>
							<span className="grow whitespace-pre pl-3">
								{tokens.map((token, tokenIndex) => (
									<span key={tokenIndex} className={TOKEN_CLASS[token.kind]}>
										{token.text}
									</span>
								))}
							</span>
						</span>
					))}
				</code>
			</pre>
		</div>
	)
}
