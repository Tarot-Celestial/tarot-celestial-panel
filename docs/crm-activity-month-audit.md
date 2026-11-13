# CRM activity month audit — 2026-11-13

Read-only evidence from the Tarot Celestial production database. No calls, purchases, benefits or balances were created or changed by this audit.

## Reported case

Turcios Yaneth has the non-month label `cliente us`, the old label `Octubre 2026`, and the ambiguous label `Noviembre` without a year. A call without purchase was recorded on November 5, and a completed promotional web purchase on November 12. Both are valid November activity. The bare November label was assigned before the November 12 purchase.

## Scope before repair

Activity is evaluated in `Europe/Madrid` from November 1 through the audit time.

| Finding | Clients |
| --- | ---: |
| With a call, completed positive purchase, or capture evidence this month | 121 |
| Missing exact `Noviembre 2026` label | 40 |
| With an old monthly label or a month without a year | 31 |
| With multiple monthly labels | 20 |
| Existing clients assigned `Noviembre 2026`, including manually labelled clients | 84 |

All 121 active clients have a registered call; 69 also have a completed purchase. Restricting the repair to purchases would therefore omit clients who used their existing balance or a free consultation.

No November call has an unmatched client UUID. All stored calls have `fecha_hora`. No calls or purchases have future timestamps. Zero-duration purchase records exist and must not be excluded merely because no consultation minutes were consumed yet.

## Month label catalogue

Existing labels include upper/lower-case variants, concatenated years (`Abril2026`, `Septiembre2025`) and months with no year. Detect only complete monthly labels, allowing spacing/case variants; do not remove labels merely because their descriptive text contains a month. The existing `tc_recovery_tag_month` parser is intentionally broader and is unsuitable for deciding which associations to remove.

The catalogue enforces uniqueness on both `nombre` and `lower(nombre)`. Client-label associations enforce `(cliente_id, etiqueta_id)` uniqueness.

No existing database trigger maintains an activity-month label. `sync_call_source_tag_to_client` only adds the call source label and should remain intact.

## Capture event semantics

`register_client_capture_contact` is the canonical capture function. It records `crm_client_capture_audit.action = 'capture_confirmed'` only when the assignment becomes confirmed (`v_confirmed_now`). The event uses a new `created_at` and `client_id`, whether or not the client has a row in `captacion_leads`.

The Captación API first calls this function for `action = 'captado'`, checks that the result is confirmed, and then updates the lead. Thus an `AFTER INSERT` audit trigger restricted to `capture_confirmed` is the narrowest complete live event for newly confirmed captures.

`crm_clientes.captured_at` stores the first completed purchase date and is reset to that historical date by the capture function. It is useful as a historical backfill fallback, but should not be treated as the timestamp of the present capture action. `captacion_state_events` contains fewer capture events than the canonical audit because clients may have no lead.

Exclude `baseline_to_corporate`, responsibility reassignments, and unrelated profile updates. They do not represent fresh client activity. An already-confirmed capture can be invoked again without a new `capture_confirmed` audit event; a newly registered call remains independently qualifying.

## Protected-data fingerprint before migration

Snapshot timestamp: `2026-11-13T22:10:36.403347+00:00`.

| Dataset | Rows | MD5 fingerprint |
| --- | ---: | --- |
| Clients: protected balance fields | 20421 | `2065dd9bb75f81dab5ccd06039833fea` |
| Calls: complete rows ordered by ID | 9030 | `e71a94616037c6e2c106dfd452b2040d` |
| Payments: complete rows ordered by ID | 2103 | `2b7830c04841dbbe3cb9f662b3f9ace9` |

These are point-in-time fingerprints, not locks. Legitimate concurrent business activity can change them; compare changes against newly recorded activity before attributing any difference to the migration. A before/after invariant inside the migration transaction is stronger evidence.

Reproducible read-only query:

```sql
select jsonb_build_object(
  'protected', (
    select jsonb_build_object(
      'clients_count', count(*),
      'balances_hash', md5(string_agg(concat_ws('|',
        id, coalesce(puntos,0), coalesce(minutos_free_pendientes,0),
        coalesce(minutos_normales_pendientes,0), coalesce(deuda_pendiente,0),
        coalesce(minutos_disponibles,0)), E'\n' order by id)))
    from public.crm_clientes
  ),
  'calls', (
    select jsonb_build_object('count',count(*),
      'hash',md5(string_agg(to_jsonb(r)::text,E'\n' order by id)))
    from public.rendimiento_llamadas r
  ),
  'payments', (
    select jsonb_build_object('count',count(*),
      'hash',md5(string_agg(to_jsonb(p)::text,E'\n' order by id)))
    from public.crm_cliente_pagos p
  ),
  'snapshot_at', now()
);
```

## Applied repair and verification

Migration `20261113220847_crm_activity_month.sql` was applied successfully on November 13. The final backfill includes confirmed-capture audit events and closed captured leads, in addition to calls, completed positive purchases and the historical capture-date fallback.

| Production result immediately after repair | Clients |
| --- | ---: |
| With qualifying activity this month across all five sources | 123 |
| Newly assigned the exact current month-year label | 42 |
| With changed monthly label associations | 59 |
| Active clients with an incorrect monthly association | 0 |
| Total assigned `Noviembre 2026`, including pre-existing manual assignments | 126 |

Yaneth now has `cliente us` and `Noviembre 2026`; her recorded balances remain 5 free minutes, 20 normal minutes and 230 Coins. Only monthly tag associations were repaired. The migration checks each locked client's complete row before and after repair and aborts if any client data changes.

One new call and one new payment were recorded concurrently with the audit (post-repair totals: 9,031 calls and 2,104 payments). Therefore aggregate fingerprints changed and must not be described as unchanged. The transaction-level client invariant passed. Supabase security, performance and health advisors reported no new findings.

Local validation: 16 isolated PGlite migration tests, 7 API tests and 11 CRM list/balance tests passed, as did TypeScript checking. These cover promotional activity without benefit changes, login exclusion, calls without purchases, confirmed captures, stale forms, replay/older events, Madrid month boundaries, authorization and stable ID cursor pagination during concurrent activity. An unrelated existing free-pass UI test still expects obsolete rank-guide copy; this change does not alter that benefit policy.

Authenticated browser verification after the database repair: searching Yaneth together with the exact `Noviembre 2026` filter returns her record, `cliente us` and the canonical monthly label, with 5 free and 20 normal minutes. Deployment and final pagination checks are recorded separately after publication. No real calls, purchases or capture events were created for testing.
