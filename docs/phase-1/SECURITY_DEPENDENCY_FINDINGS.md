# Phase 1 Security and Dependency Findings

Date: 2026-08-25

Project: `fhoxaogfjszftoqtnbav`

Status: inventory complete; Migration 2 live and verified.

## Verified findings

| Area | Live result | Decision |
|---|---:|---|
| Public functions reviewed | 7 | Harden grants and search paths |
| Security-definer functions | 7 | Anonymous execution prohibited |
| Event triggers | 9 | Preserve platform triggers; retain reviewed RLS trigger |
| Public-table grants | 2,100 | Remove 700 anonymous grants and elevated authenticated privileges |
| Storage policies | 6 | Replace three open deliverable policies |
| `sphere-deliverables` objects | 7 | Preserve objects in place |
| Migration ledger versions | 1 | Reconcile manual migrations before CLI deployment |

## Function boundary

The live public schema contains seven security-definer functions. Four legacy functions were created without fixed search paths:

- `can_access_task(uuid)`
- `handle_new_user()`
- `update_project_progress()`
- `rls_auto_enable()` already uses `pg_catalog`, but still grants API execution

All seven explicitly grant execution to `anon`, including the three Migration 1 authorization helpers. Migration 2 removes anonymous execution, applies fixed search paths, and retains authenticated execution only where RLS or application authorization requires it.

## Table-grant boundary

Each of the 100 public tables grants seven privileges to each API role. RLS limits row operations, but anonymous `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER` grants are unnecessary for this authenticated product. Authenticated users also do not require `TRUNCATE`, `REFERENCES`, or `TRIGGER`.

Migration 2 removes these grants while preserving authenticated `SELECT`, `INSERT`, `UPDATE`, and `DELETE`, which remain governed by RLS.

## Storage boundary

The `sphere-deliverables` bucket is marked private and contains seven objects. However, a separate storage RLS policy still allows public reads, and another allows uploads by every authenticated user without confirming internal team membership.

Migration 2 removes the open read/upload/delete policies and creates internal-team policies for select, insert, update, and delete. Client storage reads remain disabled until a canonical deliverable version has passed internal review and a controlled release mechanism is implemented.

## Migration ledger

The Supabase migration ledger records only `20260319124658`. Manual SQL Editor execution did not register Migration 1. Repository migration files remain the implementation source, but the ledger must be repaired through the Supabase migration workflow before CLI-based deployment or environment cloning.

No direct write to the internal migration ledger is included in Migration 2.

## Migration 2 verification

Live verification passed every expected condition:

- anonymous public-table grant count is zero;
- authenticated elevated table grant count is zero;
- anonymous execution is false for all seven reviewed functions;
- authenticated execution remains available only to `can_access_task` and the three organization authorization helpers;
- all reviewed functions have explicit safe search paths;
- old public-read and open-upload deliverable policies are absent;
- four internal-team deliverable policies exist;
- `sphere-deliverables` remains private;
- all seven pre-migration storage objects remain present.
