// The shortest observation window an annualised figure may be stated from.
//
// Below this span an annualised number is not a projection, it is an artefact of the
// exponent: compounding twenty minutes of drift over a year saturates every loss to
// exactly -100% and blows every gain past 1e100. A sixty-minute NAV series that fell
// 1.2% reports apy = -1 and sharpe = -448 — figures a reader would take for a wiped-out
// vault rather than for a demo that has been running an hour.
//
// So APY and Sharpe stay null until the history is long enough to mean something. Null
// sorts last in the marketplace and renders as "—", which says "not yet known" rather
// than inventing a number. `totalReturn` and `maxDrawdown` annualise nothing and stay
// honest at any span, so they are always reported.
//
// Both metric sources — the vault's settlement log (lib/chain-metrics.ts) and the
// nav_snapshots fallback (routes/dto.ts) — measure against this same floor, so the two
// can never disagree about whether a strategy has enough history to quote.

export const MIN_ANNUALISE_MS = 6 * 60 * 60 * 1000
