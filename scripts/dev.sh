#!/usr/bin/env bash
# Bring the whole local stack up: anvil, contract deployment, backend, frontend.
# Every process is killed together on exit.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$ROOT/logs"
mkdir -p "$LOGS"

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
pids=()

cleanup() {
	echo
	echo "shutting down…"
	for pid in "${pids[@]}"; do
		kill "$pid" 2>/dev/null
	done
	wait 2>/dev/null
}
trap cleanup EXIT INT TERM

wait_for() {
	local url="$1" name="$2" tries="${3:-60}"
	for ((i = 0; i < tries; i++)); do
		if curl -sf -o /dev/null "$url" 2>/dev/null; then
			echo "  $name up"
			return 0
		fi
		sleep 1
	done
	echo "  $name did not come up — see $LOGS" >&2
	return 1
}

echo "[1/4] anvil"
anvil --host 127.0.0.1 --port 8545 --chain-id 31337 --block-time 2 >"$LOGS/anvil.log" 2>&1 &
pids+=($!)
for ((i = 0; i < 30; i++)); do
	cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1 && break
	sleep 1
done
cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1 || { echo "anvil failed, see $LOGS/anvil.log" >&2; exit 1; }
echo "  anvil up on $RPC_URL"

# contracts/lib holds Foundry dependencies and is gitignored, so a fresh clone has none.
if [ ! -d "$ROOT/contracts/lib/forge-std" ]; then
	echo "[0/4] installing Foundry dependencies"
	(cd "$ROOT/contracts" && forge install >"$LOGS/forge-install.log" 2>&1) || {
		echo "  forge install failed — see $LOGS/forge-install.log" >&2
		exit 1
	}
fi

echo "[2/4] deploying contracts"
if ! (cd "$ROOT/contracts" && ./deploy-local.sh >"$LOGS/deploy.log" 2>&1); then
	echo "  deploy failed — see $LOGS/deploy.log" >&2
	tail -20 "$LOGS/deploy.log" >&2
	exit 1
fi
echo "  contracts deployed"

echo "[3/4] backend"
(cd "$ROOT/backend" && npm run dev >"$LOGS/backend.log" 2>&1) &
pids+=($!)
wait_for "http://localhost:4000/api/health" "backend" || exit 1

echo "[4/4] frontend"
(cd "$ROOT/frontend" && npm run dev >"$LOGS/frontend.log" 2>&1) &
pids+=($!)
wait_for "http://localhost:3000" "frontend" || exit 1

echo
echo "attesta is up:"
echo "  frontend  http://localhost:3000"
echo "  backend   http://localhost:4000"
echo "  chain     $RPC_URL"
echo "  logs      $LOGS"
echo
echo "Ctrl-C to stop everything."
wait
