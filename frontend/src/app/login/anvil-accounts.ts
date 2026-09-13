/**
 * anvil's pre-funded test accounts, so a local demo does not start with a key hunt.
 * These are the keys anvil prints on startup from its published default mnemonic — they
 * are public, worthless, and only ever exist on a throwaway local chain.
 *
 * Account 0 is deliberately absent: the backend deploys contracts, funds vault reserves
 * and runs the faucet from it, so signing investor transactions with it too would race
 * its nonce.
 */

export interface AnvilAccount {
	/** Its index in anvil's own listing, which is how anvil's startup banner names it. */
	index: number
	privateKey: string
}

export const ANVIL_ACCOUNTS: readonly AnvilAccount[] = [
	{ index: 1, privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' },
	{ index: 2, privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' },
	{ index: 3, privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' },
	{ index: 4, privateKey: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a' },
	{ index: 5, privateKey: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' },
]
