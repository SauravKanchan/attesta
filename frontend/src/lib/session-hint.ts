/**
 * The session token lives in localStorage, which the server cannot see — so the
 * first paint of `/` would otherwise have to guess whether to show the public
 * landing page or the marketplace, and guess wrong half the time.
 *
 * This cookie is that missing hint and nothing more: it carries no token, grants
 * no access, and the backend never reads it. The server uses it to render the
 * right root immediately; the real session, once restored, always overrides it.
 */

export const SESSION_HINT_COOKIE = 'attesta.session'

export type SessionHint = 'authenticated' | 'anonymous'

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30

export function writeSessionHint(authenticated: boolean): void {
	if (typeof document === 'undefined') return
	document.cookie = authenticated
		? `${SESSION_HINT_COOKIE}=1; path=/; max-age=${THIRTY_DAYS_SECONDS}; samesite=lax`
		: `${SESSION_HINT_COOKIE}=; path=/; max-age=0; samesite=lax`
}
