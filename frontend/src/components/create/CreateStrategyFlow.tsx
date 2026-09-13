'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/cn'
import { useAuth } from '@/components/AuthProvider'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { AlertIcon } from '@/components/ui/icons'
import { CodeStep } from '@/components/create/CodeStep'
import { EMPTY_METADATA, validateMetadata } from '@/components/create/ListingMetadataForm'
import { ReviewStep } from '@/components/create/ReviewStep'
import { SecretsStep, newSecretRow, submittableSecrets, validateSecrets } from '@/components/create/SecretsStep'
import { STEPS, StepRail } from '@/components/create/StepRail'
import { allChecksPassed, pendingChecks } from '@/components/create/checks'
import { LOCAL_DEV_SCHEME } from '@/lib/secrets'
import { hasEveryRequiredExport, requiredExportStates } from '@/lib/strategy-source'
import {
	ApiError,
	createSubmission,
	publishSubmission,
	putSubmissionSecrets,
	streamSubmissionChecks,
	updateSubmission,
} from '@/lib/api'
import type { ListingMetadata } from '@/components/create/ListingMetadataForm'
import type { SecretRow } from '@/components/create/SecretsStep'
import type { SourceMode } from '@/components/create/SourceChoice'
import type { StepIndex } from '@/components/create/StepRail'
import type { SanityCheck, SubmissionDraft } from '@/lib/types'

export interface CreateStrategyFlowProps {
	/** Read off disk by the page; null when the template file could not be opened. */
	template: string | null
}

export function CreateStrategyFlow({ template }: CreateStrategyFlowProps) {
	const router = useRouter()
	const { user } = useAuth()
	const { toast } = useToast()

	const [step, setStep] = useState<StepIndex>(1)
	const [reached, setReached] = useState<StepIndex>(1)

	const [source, setSource] = useState(template ?? '')
	const [mode, setMode] = useState<SourceMode>('write')
	const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)

	const [metadata, setMetadata] = useState<ListingMetadata>(EMPTY_METADATA)
	const [metadataErrors, setMetadataErrors] = useState<Partial<Record<keyof ListingMetadata, string>>>({})

	const [draft, setDraft] = useState<SubmissionDraft | null>(null)
	const [secrets, setSecrets] = useState<SecretRow[]>([newSecretRow()])

	const [checks, setChecks] = useState<SanityCheck[]>(pendingChecks())
	const [simulationLog, setSimulationLog] = useState<string[]>([])
	const [streaming, setStreaming] = useState(false)
	const [runError, setRunError] = useState<string | null>(null)
	/** The source the current check results describe, so an edit can invalidate them. */
	const [checkedSource, setCheckedSource] = useState<string | null>(null)

	const [busy, setBusy] = useState(false)
	const [saving, setSaving] = useState(false)
	const [stepError, setStepError] = useState<string | null>(null)

	const streamAbort = useRef<AbortController | null>(null)
	useEffect(() => () => streamAbort.current?.abort(), [])

	const exportStates = useMemo(() => requiredExportStates(source), [source])
	const exportsComplete = hasEveryRequiredExport(exportStates)
	const missingExports = exportStates.filter((state) => !state.present)

	const checksPassed = allChecksPassed(checks)
	const checksStale = checkedSource !== null && checkedSource !== source

	function advance(next: StepIndex) {
		setStep(next)
		setReached((previous) => (next > previous ? next : previous))
		setStepError(null)
	}

	/** Creates the submission on first save and patches it thereafter. */
	const persistDraft = useCallback(async (): Promise<SubmissionDraft> => {
		const input = { ...metadata, sourceCode: source }
		if (draft === null) {
			const created = await createSubmission(input)
			setDraft(created)
			return created
		}
		const updated = await updateSubmission(draft.id, input)
		setDraft(updated)
		return updated
	}, [draft, metadata, source])

	async function saveDraft() {
		setSaving(true)
		setStepError(null)
		try {
			await persistDraft()
			toast({ tone: 'success', title: 'Draft saved' })
		} catch (caught) {
			console.error('attesta: saving the submission draft failed', caught)
			const message = caught instanceof ApiError ? caught.message : 'The draft could not be saved'
			setStepError(message)
			toast({ tone: 'error', title: 'Draft not saved', description: message })
		} finally {
			setSaving(false)
		}
	}

	async function continueFromCode() {
		const errors = validateMetadata(metadata)
		setMetadataErrors(errors)
		// Every blocker at once. Reporting the first one and stopping tells a creator
		// whose code and listing are both incomplete to fix the listing, while the
		// checklist beside them is red about an export the message never mentions.
		const blockers: string[] = []
		if (!exportsComplete) {
			blockers.push(
				`still missing ${missingExports.map((state) => state.signature).join(', ')} from the strategy interface`,
			)
		}
		if (Object.keys(errors).length > 0) blockers.push('the listing details are incomplete')
		if (blockers.length > 0) {
			const [first, ...rest] = blockers
			const message = [(first as string).charAt(0).toUpperCase() + (first as string).slice(1), ...rest].join(', and ')
			setStepError(message)
			return
		}
		setBusy(true)
		setStepError(null)
		try {
			await persistDraft()
			advance(2)
		} catch (caught) {
			console.error('attesta: creating the submission failed', caught)
			setStepError(caught instanceof ApiError ? caught.message : 'The submission could not be created')
		} finally {
			setBusy(false)
		}
	}

	async function continueFromSecrets() {
		if (draft === null) {
			setStepError('The submission has not been created yet')
			return
		}
		const invalid = validateSecrets(secrets)
		if (invalid !== null) {
			setStepError(invalid)
			return
		}
		setBusy(true)
		setStepError(null)
		try {
			// Only the envelope is sent. `row.value` never appears in this payload.
			const payload = submittableSecrets(secrets).map((row) => ({
				key: row.key.trim(),
				ciphertext: row.ciphertext as string,
				scheme: LOCAL_DEV_SCHEME,
			}))
			const updated = await putSubmissionSecrets(draft.id, payload)
			setDraft(updated)
			advance(3)
		} catch (caught) {
			console.error('attesta: storing the encrypted parameters failed', caught)
			setStepError(caught instanceof ApiError ? caught.message : 'The parameters could not be stored')
		} finally {
			setBusy(false)
		}
	}

	async function runChecks() {
		if (draft === null) {
			setRunError('The submission has not been created yet')
			return
		}
		streamAbort.current?.abort()
		const controller = new AbortController()
		streamAbort.current = controller

		setStreaming(true)
		setRunError(null)
		setChecks(pendingChecks())
		setSimulationLog([])
		const submitted = source

		try {
			// The source on the server is whatever was last saved, so save before running.
			const saved = await updateSubmission(draft.id, { ...metadata, sourceCode: submitted })
			setDraft(saved)

			for await (const update of streamSubmissionChecks(draft.id, controller.signal)) {
				setDraft(update)
				setChecks(update.checks)
				setSimulationLog(update.simulationLog)
			}
			setCheckedSource(submitted)
		} catch (caught) {
			// A rerun or an unmount aborts the stream deliberately; that is not a failure,
			// but it is still worth a line so a truncated run is never a mystery.
			if (controller.signal.aborted) {
				console.info('attesta: the sanity pipeline stream was cancelled', caught)
				return
			}
			console.error('attesta: the sanity pipeline could not be run', caught)
			setRunError(caught instanceof ApiError ? caught.message : 'The sanity pipeline could not be run')
		} finally {
			if (!controller.signal.aborted) setStreaming(false)
		}
	}

	async function publish() {
		if (draft === null) return
		setBusy(true)
		setStepError(null)
		try {
			const published = await publishSubmission(draft.id)
			toast({
				tone: 'success',
				title: `${published.name} is live`,
				description: 'The vault is deployed and the workflow is registered on-chain.',
			})
			router.push(`/strategy/${published.slug}`)
		} catch (caught) {
			console.error('attesta: publishing the strategy failed', caught)
			const message = caught instanceof ApiError ? caught.message : 'The strategy could not be published'
			setStepError(message)
			toast({ tone: 'error', title: 'Publish failed', description: message })
		} finally {
			setBusy(false)
		}
	}

	function resetToTemplate() {
		if (template === null) return
		setSource(template)
		setUploadedFileName(null)
		setMode('write')
	}

	function onFileLoaded(fileName: string, text: string) {
		setSource(text)
		setUploadedFileName(fileName)
	}

	const footer = (() => {
		if (step === 1) {
			return {
				label: 'Continue',
				action: continueFromCode,
				disabled: false,
				hint: exportsComplete
					? null
					: `${missingExports.length} required ${missingExports.length === 1 ? 'export' : 'exports'} missing`,
			}
		}
		if (step === 2) {
			return { label: 'Encrypt and continue', action: continueFromSecrets, disabled: false, hint: null }
		}
		return {
			label: 'Publish strategy',
			action: publish,
			disabled: !checksPassed || checksStale,
			hint: checksStale
				? 'The source changed after the last run — run the checks again'
				: checksPassed
				  ? null
				  : 'Publishing unlocks when all nine checks pass',
		}
	})()

	return (
		<div className="flex flex-col gap-4">
			<StepRail current={step} reached={reached} onNavigate={setStep} />

			{step === 1 ? (
				<CodeStep
					source={source}
					onSourceChange={setSource}
					mode={mode}
					onModeChange={setMode}
					uploadedFileName={uploadedFileName}
					onFileLoaded={onFileLoaded}
					onResetToTemplate={resetToTemplate}
					templateAvailable={template !== null}
					metadata={metadata}
					onMetadataChange={setMetadata}
					metadataErrors={metadataErrors}
				/>
			) : null}

			{step === 2 && draft !== null ? (
				<SecretsStep submissionId={draft.id} rows={secrets} onChange={setSecrets} />
			) : null}

			{step === 3 ? (
				<ReviewStep
					metadata={metadata}
					draft={draft}
					creator={user}
					checks={checks}
					simulationLog={simulationLog}
					streaming={streaming}
					runError={runError}
					onRunChecks={() => void runChecks()}
				/>
			) : null}

			<div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-hairline bg-canvas/95 py-3 backdrop-blur">
				<div className="flex items-center gap-2">
					<Button onClick={() => void saveDraft()} loading={saving} disabled={busy || streaming}>
						Save draft
					</Button>
					{step > 1 ? (
						<Button variant="ghost" onClick={() => setStep((step - 1) as StepIndex)}>
							Back to {STEPS[step - 2]?.title.toLowerCase()}
						</Button>
					) : null}
				</div>

				<div className="flex items-center gap-3">
					{stepError !== null ? (
						<span className="flex items-center gap-1.5 type-body-sm text-risk-light">
							<AlertIcon className="size-3.5" />
							{stepError}
						</span>
					) : footer.hint !== null ? (
						<span
							className={cn(
								'flex items-center gap-1.5 type-body-sm',
								step === 3 && checksStale ? 'text-warning-light' : 'text-fg-muted',
							)}
						>
							<AlertIcon className="size-3.5" />
							{footer.hint}
						</span>
					) : null}
					<Button
						variant="primary"
						onClick={() => void footer.action()}
						loading={busy}
						disabled={footer.disabled || streaming}
					>
						{footer.label}
					</Button>
				</div>
			</div>
		</div>
	)
}
