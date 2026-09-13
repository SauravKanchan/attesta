#!/usr/bin/env bash
# Puts this agent's stack back to the seeded state: a fresh copy of the seed template
# behind the backend on 4185, and the investor account's shares redeemed on chain so the
# database and the vault agree that it holds nothing.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
rpc="${RPC_URL:-http://127.0.0.1:8545}"
key="${INVESTOR_KEY:-0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba}"
vault="${VAULT:-0xf32d39ff9f6aa7a7a64d7a4f00a54826ef791a55}"
db="${DB:-./data/e2e-money-ui.db}"

address="$(cast wallet address "$key")"
shares="$(cast call "$vault" 'sharesOf(address)(uint256)' "$address" --rpc-url "$rpc" | awk '{print $1}')"
if [ "$shares" != "0" ]; then
	echo "redeeming $shares shares held by $address"
	cast send "$vault" 'withdraw(uint256)' "$shares" --private-key "$key" --rpc-url "$rpc" >/dev/null
fi

pkill -f 'DATABASE_URL=./data/e2e-money-ui.db' 2>/dev/null || true
lsof -nP -iTCP:4185 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill 2>/dev/null || true
sleep 2

cd "$root/backend"
rm -f data/e2e-money-ui.db data/e2e-money-ui.db-wal data/e2e-money-ui.db-shm
cp data/seed-template.db data/e2e-money-ui.db

PORT=4185 HOST=127.0.0.1 DATABASE_URL="$db" CORS_ORIGIN=http://localhost:3185 \
	SCHEDULER_ENABLED=false ORACLE_URL=http://127.0.0.1:4185/api/oracle/prices LOG_LEVEL=warn \
	nohup node --import tsx src/index.ts > "$root/logs/e2e-money/backend-4185.log" 2>&1 &

for _ in $(seq 1 30); do
	if curl -fsS http://127.0.0.1:4185/api/health >/dev/null 2>&1; then echo "backend 4185 ready"; exit 0; fi
	sleep 1
done
echo "backend 4185 did not come up" >&2
exit 1
