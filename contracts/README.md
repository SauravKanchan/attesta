# contracts

Foundry project for the on-chain half of attesta. Everything targets a local anvil chain
on `31337` — there is no testnet deployment and no real funds.

| Contract | Instances | Role |
|---|---|---|
| `MockUSDC` | one | 6-decimal ERC20 with an open `mint` faucet. Stands in for USDC on Arc. |
| `StrategyRegistry` | one | Binds a strategy id to its vault, its creator and the hash of the workflow binary that produced its record. |
| `StrategyVault` | one per strategy | Holds investor USDC, issues shares, and settles each tick's result. |

## Setup

Dependencies are not vendored, so install them once after cloning:

```sh
forge install foundry-rs/forge-std
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0
forge build
forge test -vv
```

## Deployed addresses

`script/Deploy.s.sol` deploys the two singletons, mints the deployer float, and writes
the address book to **`contracts/deployments/local.json`**. That file is the single
source of truth for every other package — the backend reads it at boot rather than
carrying hardcoded addresses, and it is gitignored because it describes one particular
anvil session.

```sh
anvil                                     # terminal 1
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast                             # terminal 2
```

```json
{
  "chainId": 31337,
  "deployer": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "registry": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  "usdc": "0x5FbDB2315678afecb367f032d93F642f64180aa3"
}
```

Those values are what a fresh anvil produces from account #0 with a clean nonce, so they
are stable across restarts. `PRIVATE_KEY` overrides the deployer; unset, the script uses
anvil account #0.

**Vault addresses are not in the address book.** A vault is deployed at publish time by
the backend, once the strategy's operator is known, and its address is stored on the
strategy row. `StrategyRegistry.get(strategyId).vault` is the on-chain copy of the same
mapping, for anyone verifying without the backend.

## StrategyVault

### Share math

Identical to `defaultOnDeposit` / `defaultOnWithdraw` in
[`shared/strategy-contract.ts`](../shared/strategy-contract.ts), so a creator's
TypeScript and the chain never disagree:

```
first deposit        shares = assets
later deposits       shares = assets * totalShares / totalManagedAssets
withdrawal           assets = shares * totalManagedAssets / totalShares
navPerShare (6dp)    totalManagedAssets * 1e6 / totalShares, or 1e6 when empty
```

A deposit against a vault whose managed assets have been wiped out also mints 1:1 —
matching the `totalAssets === 0n` branch in the TypeScript.

### Reserve

The vault does not trade, so a reported gain has to be paid out of somewhere. That
somewhere is the **reserve**: USDC held by the vault beyond `totalManagedAssets`,
prefunded via `fundReserve` before the strategy goes live.

```
usdc.balanceOf(vault) == totalManagedAssets + reserve
```

`applyPnl` only moves the boundary between the two — a gain shifts reserve into managed
assets, a loss shifts it back. The token balance is untouched, which keeps the invariant
`usdc.balanceOf(vault) >= totalManagedAssets` true by construction, and every share
redeemable. A gain larger than the reserve reverts rather than promising value the vault
cannot pay.

Two cases `applyPnl` refuses:

- a gain with no shares outstanding — it would have no owner, and the next depositor
  (minting 1:1 against a zero supply) would redeem the whole stranded amount;
- a loss larger than `totalManagedAssets` — there is nothing left to lose.

Size the reserve for the worst cumulative gain a demo can produce. It is not investor
money and is never counted in NAV.

### Operator

`operator` is fixed at construction and is the only address that may call `applyPnl` or
`recordTrade`. Locally that is an anvil EOA driven by the backend scheduler; in
production it is the strategy's Circle Agent Wallet, directed from inside the enclave.

### Events

`recordTrade` is pure record-keeping — the money already moved through `applyPnl` — but
`TradeRecorded` is what the UI's trade table indexes. Every state change emits:
`Deposited`, `Withdrawn`, `PnlApplied`, `TradeRecorded`, `ReserveFunded`.

## Tests

```sh
forge test -vv
```

Unit and fuzz tests cover the share math across interleaved deposits and pnl, the
reserve invariant, operator access control, and every revert path. `StrategyVaultInvariant.t.sol`
additionally drives randomised call sequences through a handler and asserts that the
vault stays solvent, that share supply always equals the sum of investor balances, and
that reserve plus managed assets exactly partition the token balance.
