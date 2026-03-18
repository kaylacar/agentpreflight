# Failure Mode Ticket Template

Use this template for every new guardrail addition. If a change does not map to a concrete failure mode, do not merge it.

## 1) Incident
- `id`:
- `date`:
- `owner`:
- `severity`: (`low` | `medium` | `high`)

## 2) Repro
- `command`:
- `input`:
- `environment`:
- `observed_output`:
- `expected_output`:

## 3) Root Cause
- `layer`: (`adapter` | `rule` | `policy-pack` | `executor` | `telemetry`)
- `analysis`:

## 4) Fix Mapping
- `code_paths`:
- `policy_fields`:
- `new_or_updated_rules`:
- `why_this_blocks_recurrence`:

## 5) Verification
- `typecheck`: pass/fail + command output summary
- `build`: pass/fail + command output summary
- `test`: pass/fail + command output summary
- `contract_checks`: pass/fail + `preflight:exec` / template checks summary

## 6) Regression Guard
- `added_tests`:
- `negative_test`:
- `merge_gate_updated`:
