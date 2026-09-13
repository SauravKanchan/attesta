// The chain surface, namespaced so callers read as `vault.applyPnl(...)` and
// `usdc.balanceOf(...)` rather than importing a flat list of similar-sounding verbs.

export * as registry from './registry.js'
export * as usdc from './usdc.js'
export * as vault from './vault.js'
export * as wallets from './wallets.js'

export {
	ANVIL_DEPLOYER_KEY,
	deployerAccount,
	deployerWallet,
	isChainUp,
	isContractDeployed,
	localChain,
	publicClient,
	walletFor,
	sendAndWait,
} from './client.js'
export type { LocalWalletClient, WriteOutcome } from './client.js'

export {
	ADDRESS_BOOK_PATH,
	CHAIN_ID_KEY,
	DEPLOYER_KEY,
	DeploymentError,
	REGISTRY_KEY,
	USDC_KEY,
	allDeployments,
	deployedChainId,
	deployerAddress,
	deleteDeployment,
	getDeployment,
	getVaultAddress,
	readAddressBook,
	refreshDeployments,
	registryAddress,
	requireDeployment,
	requireVaultAddress,
	setDeployment,
	setVaultAddress,
	syncAddressBook,
	usdcAddress,
	vaultKey,
} from './deployments.js'
export type { AddressBook } from './deployments.js'

export { ChainError, onChain, revertReason } from './errors.js'
