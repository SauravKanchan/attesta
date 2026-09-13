#!/usr/bin/env bash
# Deploy the singletons to the local chain and write contracts/deployments/local.json,
# the address book every other package reads at boot. Invoked by scripts/dev.sh once
# anvil is accepting connections.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"

if ! cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1; then
	echo "no chain reachable at $RPC_URL — start anvil first" >&2
	exit 1
fi

forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast

echo
echo "address book: $(pwd)/deployments/local.json"
cat deployments/local.json
