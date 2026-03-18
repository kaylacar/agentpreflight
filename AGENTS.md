# AGENTS.md

## Release Gate Contract (Required)

These rules apply to any agent claiming a production site is fixed, live, or done.

1. No completion claim without UX proof.
2. Status codes, health checks, and version endpoints are supporting evidence only.
3. Browser-level flow checks are required for acceptance.
4. One mutation at a time; verify after each mutation.
5. Any blocker failure triggers rollback to last known good state.

## Required Acceptance Checks

Run and report all of the following on the live domain:

- Homepage loads.
- Every visible nav link works.
- Every visible CTA/button works.
- Every intended form submits successfully.
- One full end-to-end user journey completes.
- Canonical host behavior is correct (for example `www -> apex`).

## Required Evidence Table

Any completion message must include this table:

| URL | Action | Expected | Actual | Pass/Fail |
|---|---|---|---|---|

If this table is missing, the task is not complete.

## Forbidden Completion Phrases Without Proof

Do not use: `done`, `fixed`, `live`, `resolved`, `working` unless the required evidence table is present and all blocker checks pass.

