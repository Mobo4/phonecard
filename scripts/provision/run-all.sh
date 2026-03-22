#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${DIR}/preflight.sh"
"${DIR}/render-provision.sh"
"${DIR}/telnyx-provision.sh"
"${DIR}/cloudflare-provision.sh"

echo "PROVISIONING: COMPLETE"
