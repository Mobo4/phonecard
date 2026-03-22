#!/usr/bin/env bash
set -euo pipefail

: "${RENDER_API_KEY:?RENDER_API_KEY is required}"
: "${RENDER_OWNER_ID:?RENDER_OWNER_ID is required}"

APP_NAME="${APP_NAME:-phonecard-api}"
REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-main}"
REGION="${RENDER_REGION:-oregon}"
POSTGRES_NAME="${POSTGRES_NAME:-phonecard-db}"
POSTGRES_PLAN="${POSTGRES_PLAN:-free}"
POSTGRES_VERSION="${POSTGRES_VERSION:-16}"
KV_NAME="${KV_NAME:-phonecard-kv}"
KV_PLAN="${KV_PLAN:-free}"
SERVICE_PLAN="${SERVICE_PLAN:-free}"
RUNTIME="${RUNTIME:-node}"
BUILD_COMMAND="${BUILD_COMMAND:-npm ci && npm run build}"
START_COMMAND="${START_COMMAND:-npm start}"
HEALTH_PATH="${HEALTH_PATH:-/health}"
ROOT_DIR="${ROOT_DIR:-.}"
SKIP_SERVICE="${SKIP_SERVICE:-0}"

if [[ "$SKIP_SERVICE" != "1" && -z "$REPO_URL" ]]; then
  echo "REPO_URL is required for service creation."
  exit 1
fi

api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "https://api.render.com/v1${path}" \
      -H "Authorization: Bearer ${RENDER_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -sS -X "$method" "https://api.render.com/v1${path}" \
      -H "Authorization: Bearer ${RENDER_API_KEY}"
  fi
}

extract_id_by_name() {
  local json="$1"
  local name="$2"
  echo "$json" | jq -r --arg n "$name" '
    .[]?
    | (
        if .service then .service
        elif .postgres then .postgres
        elif .keyValue then .keyValue
        else .
        end
      )
    | select(.name==$n)
    | .id' | head -n 1
}

echo "== Render provisioning start =="

postgres_list="$(api GET "/postgres?ownerId=${RENDER_OWNER_ID}&limit=100")"
postgres_id="$(extract_id_by_name "$postgres_list" "$POSTGRES_NAME")"
if [[ -z "$postgres_id" ]]; then
  echo "Creating Postgres: $POSTGRES_NAME"
  postgres_create="$(api POST "/postgres" "$(jq -nc \
    --arg name "$POSTGRES_NAME" \
    --arg owner "$RENDER_OWNER_ID" \
    --arg plan "$POSTGRES_PLAN" \
    --arg version "$POSTGRES_VERSION" \
    --arg region "$REGION" \
    '{name:$name, ownerId:$owner, plan:$plan, version:$version, region:$region}')")"
  postgres_id="$(echo "$postgres_create" | jq -r '.id // .postgres.id // empty')"
  if [[ -z "$postgres_id" ]]; then
    postgres_list="$(api GET "/postgres?ownerId=${RENDER_OWNER_ID}&limit=100")"
    postgres_id="$(extract_id_by_name "$postgres_list" "$POSTGRES_NAME")"
  fi
else
  echo "Postgres exists: $POSTGRES_NAME ($postgres_id)"
fi

kv_list="$(api GET "/key-value?ownerId=${RENDER_OWNER_ID}&limit=100")"
kv_id="$(extract_id_by_name "$kv_list" "$KV_NAME")"
if [[ -z "$kv_id" ]]; then
  echo "Creating Key Value: $KV_NAME"
  kv_create="$(api POST "/key-value" "$(jq -nc \
    --arg name "$KV_NAME" \
    --arg owner "$RENDER_OWNER_ID" \
    --arg plan "$KV_PLAN" \
    --arg region "$REGION" \
    '{name:$name, ownerId:$owner, plan:$plan, region:$region}')")"
  kv_id="$(echo "$kv_create" | jq -r '.id // .keyValue.id // empty')"
  if [[ -z "$kv_id" ]]; then
    kv_list="$(api GET "/key-value?ownerId=${RENDER_OWNER_ID}&limit=100")"
    kv_id="$(extract_id_by_name "$kv_list" "$KV_NAME")"
  fi
else
  echo "Key Value exists: $KV_NAME ($kv_id)"
fi

service_id=""
if [[ "$SKIP_SERVICE" == "1" ]]; then
  echo "Skipping service creation (SKIP_SERVICE=1)."
else
  svc_list="$(api GET "/services?ownerId=${RENDER_OWNER_ID}&limit=100")"
  service_id="$(extract_id_by_name "$svc_list" "$APP_NAME")"
  if [[ -z "$service_id" ]]; then
    echo "Creating Web Service: $APP_NAME"
    svc_create="$(api POST "/services" "$(jq -nc \
      --arg name "$APP_NAME" \
      --arg owner "$RENDER_OWNER_ID" \
      --arg repo "$REPO_URL" \
      --arg branch "$BRANCH" \
      --arg runtime "$RUNTIME" \
      --arg plan "$SERVICE_PLAN" \
      --arg region "$REGION" \
      --arg build "$BUILD_COMMAND" \
      --arg start "$START_COMMAND" \
      --arg health "$HEALTH_PATH" \
      --arg root "$ROOT_DIR" \
      '{
        type:"web_service",
        name:$name,
        ownerId:$owner,
        repo:$repo,
        branch:$branch,
        rootDir:$root,
        serviceDetails:{
          runtime:$runtime,
          plan:$plan,
          region:$region,
          healthCheckPath:$health,
          envSpecificDetails:{
            buildCommand:$build,
            startCommand:$start
          }
        }
      }')")"
    service_id="$(echo "$svc_create" | jq -r '.service.id // .id // empty')"
  else
    echo "Service exists: $APP_NAME ($service_id)"
  fi
fi

echo ""
echo "RENDER_RESULT:"
echo "POSTGRES_ID=${postgres_id:-missing}"
echo "KEY_VALUE_ID=${kv_id:-missing}"
echo "SERVICE_ID=${service_id:-missing}"
