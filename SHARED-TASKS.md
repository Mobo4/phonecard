# SHARED-TASKS

## Governed PRD pipeline
- task: constitutional check in `data/playbook.md` - done
- task: diagnose current state in `governed/Diagnosis.md` - done
- task: create PRD A/B/C in `governed/` - done
- task: synthesize final PRD in `governed/PRD-Synthesized.md` - done
- task: cold review by fresh agent - done
- task: tests before implementation (`scripts/test-*.sh`) - done
- task: initial failing baseline captured - done
- task: per-section QA and corrections - done
- task: verification report written - updated
- task: scaffold runtime codebase (Render-ready TS API) - done
- task: tests-first API implementation with failing baseline then pass - done
- task: final build + governed suite run after code changes - done
- task: continuation hardening (webhook signatures, request-id, error handler, state abstraction) - done
- task: continuation hardening 2 (checkout bearer auth + Supabase JWT verifier wiring) - done
- task: persistence implementation (Postgres + Redis adapter with env-based state factory) - done
- task: live persistent smoke pass executed (local Postgres+Redis) - done
- task: security hardening (bind callSession to token-verified user in rate authorize) - done
- task: security hardening (raw-body webhook signature verification) - done
- task: admin control plane (whitelisted rate upsert/list + audit trail + admin auth gate) - done
- task: telnyx TeXML connect path (announcement + hard `timeLimit` + deny hangup) - done
- task: infra credential audit against fax/telnyx projects - done
- task: governed infra PRD set (A/B/C + synthesis + 3 cold reviews) - done
- task: API provisioning scripts (preflight + render + telnyx + cloudflare) - done
- task: live credential validation against user-provided keys (render/telnyx/stripe/cloudflare/supabase) - done
- task: live infra bootstrap via APIs (render db+kv, telnyx texml app) - done
- task: capture remaining go-live inputs and rotation recommendations - done
