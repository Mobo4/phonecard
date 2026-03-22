#!/usr/bin/env bash
set -euo pipefail

: "${CLOUDFLARE_ZONE_ID:?CLOUDFLARE_ZONE_ID is required}"
: "${DNS_RECORD_NAME:?DNS_RECORD_NAME is required}"
: "${DNS_RECORD_TARGET:?DNS_RECORD_TARGET is required}"

CF_API_BASE="https://api.cloudflare.com/client/v4"

cf_curl() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  local auth_args=()
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    auth_args=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")
  elif [[ -n "${CLOUDFLARE_API_KEY:-}" && -n "${CLOUDFLARE_EMAIL:-}" ]]; then
    auth_args=(-H "X-Auth-Key: ${CLOUDFLARE_API_KEY}" -H "X-Auth-Email: ${CLOUDFLARE_EMAIL}")
  else
    echo "Missing Cloudflare auth. Set CLOUDFLARE_API_TOKEN or API key+email."
    exit 1
  fi

  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "${CF_API_BASE}${path}" \
      "${auth_args[@]}" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -sS -X "$method" "${CF_API_BASE}${path}" \
      "${auth_args[@]}" \
      -H "Content-Type: application/json"
  fi
}

echo "== Cloudflare DNS provisioning start =="

existing="$(cf_curl GET "/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=CNAME&name=${DNS_RECORD_NAME}")"
record_id="$(echo "$existing" | jq -r '.result[0].id // empty')"

if [[ -n "$record_id" ]]; then
  echo "Updating existing DNS record: ${DNS_RECORD_NAME}"
  result="$(cf_curl PUT "/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${record_id}" "$(jq -nc \
    --arg n "$DNS_RECORD_NAME" \
    --arg c "$DNS_RECORD_TARGET" \
    '{type:"CNAME",name:$n,content:$c,proxied:true,ttl:1}')")"
else
  echo "Creating DNS record: ${DNS_RECORD_NAME}"
  result="$(cf_curl POST "/zones/${CLOUDFLARE_ZONE_ID}/dns_records" "$(jq -nc \
    --arg n "$DNS_RECORD_NAME" \
    --arg c "$DNS_RECORD_TARGET" \
    '{type:"CNAME",name:$n,content:$c,proxied:true,ttl:1}')")"
fi

echo "$result" | jq '{success, errors, result:{id,name,type,content,proxied}}'
