#!/usr/bin/env bash
set -euo pipefail

echo "== Phonecard Provisioning Preflight =="

require_nonempty() {
  local key="$1"
  local value="${!key:-}"
  if [[ -z "$value" ]]; then
    echo "MISSING: $key"
    return 1
  fi
  echo "OK: $key"
  return 0
}

warn_if_placeholder() {
  local key="$1"
  local value="${!key:-}"
  if [[ -z "$value" ]]; then
    return 0
  fi
  if [[ "$value" =~ ^KEYx+$ ]] || [[ "$value" =~ your_ ]] || [[ "$value" =~ placeholder ]]; then
    echo "INVALID_PLACEHOLDER: $key"
    return 1
  fi
  return 0
}

status=0

echo ""
echo "-- Render requirements --"
require_nonempty "RENDER_API_KEY" || status=1
require_nonempty "RENDER_OWNER_ID" || status=1

echo ""
echo "-- Telnyx requirements --"
require_nonempty "TELNYX_API_KEY" || status=1
warn_if_placeholder "TELNYX_API_KEY" || status=1
require_nonempty "TELNYX_FROM_NUMBER" || status=1

echo ""
echo "-- Supabase requirements --"
require_nonempty "SUPABASE_URL" || status=1
require_nonempty "SUPABASE_JWKS_URL" || status=1
require_nonempty "SUPABASE_JWT_ISSUER" || status=1

echo ""
echo "-- Stripe requirements --"
require_nonempty "STRIPE_SECRET_KEY" || status=1
require_nonempty "STRIPE_WEBHOOK_SECRET" || status=1

echo ""
echo "-- Google OAuth requirements --"
require_nonempty "GOOGLE_CLIENT_ID" || status=1
require_nonempty "GOOGLE_CLIENT_SECRET" || status=1

echo ""
echo "-- Cloudflare requirements --"
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "OK: CLOUDFLARE_API_TOKEN"
elif [[ -n "${CLOUDFLARE_API_KEY:-}" && -n "${CLOUDFLARE_EMAIL:-}" ]]; then
  echo "OK: CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL"
else
  echo "MISSING: CLOUDFLARE_API_TOKEN or (CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL)"
  status=1
fi

if [[ "$status" -eq 0 ]]; then
  echo ""
  echo "PRECHECK: PASS"
else
  echo ""
  echo "PRECHECK: FAIL"
  exit 1
fi
