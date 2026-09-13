import type { Locator, Page } from '@playwright/test'

/**
 * Driving the CodeMirror editor on the code step.
 *
 * CodeMirror renders a contenteditable and virtualises long documents, so the DOM is
 * not the document: only the visible lines exist. Everything here therefore goes
 * through real key and pointer events, which is also what makes the assertions
 * meaningful — the checklist has to react to the same input a creator would produce.
 *
 * `insertText` is the paste: it fires one `beforeinput`/`input` pair with the whole
 * string, exactly as a clipboard paste does, rather than a keystroke per character.
 * Typing 111 lines a character at a time would take minutes and prove nothing extra.
 */

export function editor(page: Page): Locator {
	return page.locator('.cm-content')
}

export async function waitForEditor(page: Page): Promise<Locator> {
	const content = editor(page)
	await content.waitFor({ state: 'visible' })
	return content
}

/** Puts the caret in the document without changing it. */
export async function focusEditor(page: Page): Promise<void> {
	const content = await waitForEditor(page)
	await content.click()
}

const selectAll = process.platform === 'darwin' ? 'Meta+a' : 'Control+a'

/** Replaces the whole document, the way an upload or a paste-over does. */
export async function setSource(page: Page, source: string): Promise<void> {
	await focusEditor(page)
	await page.keyboard.press(selectAll)
	await page.keyboard.press('Backspace')
	await page.keyboard.insertText(source)
}

/** Appends at the end of the document, so the checklist can be watched filling in. */
export async function appendSource(page: Page, chunk: string): Promise<void> {
	await focusEditor(page)
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
	await page.keyboard.insertText(chunk)
}

/** Empties the editor. */
export async function clearSource(page: Page): Promise<void> {
	await focusEditor(page)
	await page.keyboard.press(selectAll)
	await page.keyboard.press('Backspace')
}

/**
 * Scrolls the editor until the line containing `fragment` is rendered, and returns it.
 *
 * CodeMirror only keeps the visible lines in the DOM, so a line the viewport has never
 * reached cannot be clicked — and after a paste the caret, and the viewport with it, sits
 * at the end of the document. Scrolling the way a creator would is what brings it back.
 */
export async function revealLineContaining(page: Page, fragment: string): Promise<Locator> {
	const line = page.locator('.cm-line', { hasText: fragment }).first()
	await page.locator('.cm-scroller').first().waitFor({ state: 'visible' })

	// The scrolling element is not always CodeMirror's own scroller — the editor is
	// sized by its container, so the container is what scrolls. Walk up to whichever
	// ancestor actually has overflow and drive that.
	const scrollTo = (offset: number) =>
		page.evaluate((top) => {
			let node = document.querySelector('.cm-scroller') as HTMLElement | null
			while (node !== null && node.scrollHeight <= node.clientHeight + 1) node = node.parentElement
			if (node === null) return { height: 0, total: 0 }
			node.scrollTop = top
			return { height: node.clientHeight, total: node.scrollHeight }
		}, offset)

	let top = 0
	for (;;) {
		const { height, total } = await scrollTo(top)
		await page.waitForTimeout(100)
		if ((await line.count()) > 0) {
			await line.scrollIntoViewIfNeeded()
			return line
		}
		if (height === 0 || top >= total) break
		top += Math.max(1, Math.floor(height * 0.6))
	}
	throw new Error(`no editor line contains ${JSON.stringify(fragment)}`)
}

/**
 * Deletes the whole line containing `fragment`, by triple-clicking it and pressing
 * Backspace — the gesture a creator uses, not a state mutation behind the editor's back.
 */
export async function deleteLineContaining(page: Page, fragment: string): Promise<void> {
	const line = await revealLineContaining(page, fragment)
	await line.click({ clickCount: 3 })
	await page.keyboard.press('Backspace')
}

/** The `n / 6 valid` counter on the required-exports checklist. */
export function exportsCounter(page: Page): Locator {
	return page.getByText(/^\d+ \/ 6 valid$/)
}

/** One checklist row, addressed by the signature it renders. */
export function exportRow(page: Page, signature: string): Locator {
	return page.locator('li').filter({ has: page.getByText(signature, { exact: true }) }).first()
}
