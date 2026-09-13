'use client'

import { CodeEditor } from '@/components/create/CodeEditor'
import { ListingMetadataForm } from '@/components/create/ListingMetadataForm'
import { RequiredExportsChecklist } from '@/components/create/RequiredExportsChecklist'
import { SourceChoice } from '@/components/create/SourceChoice'
import { AlertIcon } from '@/components/ui/icons'
import type { ListingMetadata } from '@/components/create/ListingMetadataForm'
import type { SourceMode } from '@/components/create/SourceChoice'

export interface CodeStepProps {
	source: string
	onSourceChange: (next: string) => void
	mode: SourceMode
	onModeChange: (mode: SourceMode) => void
	uploadedFileName: string | null
	onFileLoaded: (fileName: string, source: string) => void
	onResetToTemplate: () => void
	/** Null when the template could not be read off disk; reset then has nothing to do. */
	templateAvailable: boolean
	metadata: ListingMetadata
	onMetadataChange: (next: ListingMetadata) => void
	metadataErrors: Partial<Record<keyof ListingMetadata, string>>
}

export function CodeStep({
	source,
	onSourceChange,
	mode,
	onModeChange,
	uploadedFileName,
	onFileLoaded,
	onResetToTemplate,
	templateAvailable,
	metadata,
	onMetadataChange,
	metadataErrors,
}: CodeStepProps) {
	return (
		<div className="flex flex-col gap-4">
			<SourceChoice
				mode={mode}
				onModeChange={onModeChange}
				onFileLoaded={onFileLoaded}
				uploadedFileName={uploadedFileName}
			/>

			{templateAvailable ? null : (
				<div className="flex items-start gap-3 rounded-sm border border-warning/40 bg-warning/8 p-3">
					<AlertIcon className="mt-0.5 size-4 shrink-0 text-warning-light" />
					<p className="type-body-sm text-fg-secondary">
						The strategy template could not be read from
						<span className="type-code-sm"> chainlink/templates/strategy.template.ts</span>, so the
						editor started empty and reset-to-template is unavailable. Write or upload a strategy to
						continue.
					</p>
				</div>
			)}

			<ListingMetadataForm value={metadata} onChange={onMetadataChange} errors={metadataErrors} />

			<div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
				<CodeEditor
					value={source}
					onChange={onSourceChange}
					fileName={uploadedFileName ?? 'strategy.ts'}
					onReset={templateAvailable ? onResetToTemplate : undefined}
					className="h-140"
				/>
				<RequiredExportsChecklist source={source} className="h-fit" />
			</div>
		</div>
	)
}
