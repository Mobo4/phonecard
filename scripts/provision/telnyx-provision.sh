#!/usr/bin/env bash
set -euo pipefail

: "${TELNYX_API_KEY:?TELNYX_API_KEY is required}"
: "${TELNYX_VOICE_URL:?TELNYX_VOICE_URL is required}"

TELNYX_APP_NAME="${TELNYX_APP_NAME:-phonecard-texml-app}"
TELNYX_NUMBER="${TELNYX_NUMBER:-}"

api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl --globoff -sS -X "$method" "https://api.telnyx.com/v2${path}" \
      -H "Authorization: Bearer ${TELNYX_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl --globoff -sS -X "$method" "https://api.telnyx.com/v2${path}" \
      -H "Authorization: Bearer ${TELNYX_API_KEY}"
  fi
}

echo "== Telnyx provisioning start =="

auth_check="$(api GET "/texml_applications?page[size]=1")"
if echo "$auth_check" | jq -e '.errors[0]' >/dev/null 2>&1; then
  echo "TELNYX_AUTH_FAILED"
  echo "$auth_check" | jq .
  exit 1
fi

existing_id="$(echo "$auth_check" | jq -r --arg n "$TELNYX_APP_NAME" '.data[]? | select(.friendly_name==$n) | .id' | head -n1)"
if [[ -z "$existing_id" ]]; then
  echo "Creating TeXML application: $TELNYX_APP_NAME"
  create_res="$(api POST "/texml_applications" "$(jq -nc \
    --arg name "$TELNYX_APP_NAME" \
    --arg voiceUrl "$TELNYX_VOICE_URL" \
    '{
      friendly_name:$name,
      voice_url:$voiceUrl,
      voice_method:"post",
      active:true
    }')")"
  texml_id="$(echo "$create_res" | jq -r '.data.id // empty')"
else
  texml_id="$existing_id"
  echo "TeXML application exists: $TELNYX_APP_NAME ($texml_id)"
fi

if [[ -n "$TELNYX_NUMBER" ]]; then
  echo "Resolving number: $TELNYX_NUMBER"
  num_res="$(api GET "/phone_numbers?filter[phone_number]=${TELNYX_NUMBER}")"
  num_id="$(echo "$num_res" | jq -r '.data[0].id // empty')"
  if [[ -z "$num_id" ]]; then
    echo "Number not found in account: $TELNYX_NUMBER"
    exit 1
  fi

  echo "Attaching number to TeXML application"
  patch_res="$(api PATCH "/phone_numbers/${num_id}" "$(jq -nc --arg connectionId "$texml_id" '{connection_id:$connectionId}')")"
  if echo "$patch_res" | jq -e '.errors[0]' >/dev/null 2>&1; then
    echo "Failed to attach number"
    echo "$patch_res" | jq .
    exit 1
  fi
fi

echo ""
echo "TELNYX_RESULT:"
echo "TEXML_APPLICATION_ID=${texml_id:-missing}"
