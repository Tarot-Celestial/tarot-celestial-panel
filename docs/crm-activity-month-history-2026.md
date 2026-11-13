# CRM activity-month history: 2026

The customer's clarification extends the November repair to every identifiable
client with qualifying 2026 activity. Each client has one monthly segment based
on their latest recorded business activity in Europe/Madrid. A later November
call replaces an October segment; an April-only client stays in April.

## Scope

- Calls with or without a purchase, including free/gift consultations.
- Completed positive purchases, including web promotions. Activity tagging does
  not change whether a purchase earns benefits.
- Paid web Oracle products also qualify: completed payment attempts cover
  Mollie/Redsys, and verified Stripe purchase references cover the legacy Oracle
  ledgers. Rank rewards and daily gifts must never be treated as paid purchases.
- Confirmed capture audit events and captured leads with their recorded close
  date. The client's original capture date is a historical fallback.
- Exclude login, ordinary profile edits, failed/pending payments, corporate import
  baselines, future events and records without a valid client relationship.

The already deployed live triggers continue to handle new events. This migration
only extends historical reconciliation; it does not hard-code the live system to
November or to 2026.

## Preflight

The production audit found 482 identifiable clients with qualifying 2026 history.
Of these, 124 already had November activity under the live automation; 358 had
their latest event in an earlier month. There were 83 differing monthly
association sets plus 26 clients already assigned to the case-only variant
`MAYO 2026`. The catalog name is normalized to `Mayo 2026` without replacing its
ID. April's `Abril2026` variant is reconciled to the standard `Abril 2026` label.

| Latest activity | Clients |
| --- | ---: |
| March 2026 | 4 |
| April 2026 | 53 |
| May 2026 | 33 |
| June 2026 | 54 |
| July 2026 | 98 |
| August 2026 | 33 |
| September 2026 | 21 |
| October 2026 | 62 |
| November 2026 | 124 |

Counts are a point-in-time audit and may increase with legitimate activity.
The capture-date fallback adds no extra client or latest month beyond the
verified calls, payments and capture events in this production snapshot.
The additional August client comes from a verified legacy Stripe Oracle purchase.

The historic call audit also found 114 records without a reliable CRM link:
113 imported calls have an empty client ID and one has an orphan UUID. They
have no linked payment and no stored phone field that can resolve the client.
Their history is preserved; names are not used to guess ownership.

Two latest calls cross the April/May boundary: their timestamp is April 30 UTC
but May 1 in Madrid. They correctly belong to May, even if the legacy `fecha`
column says April 30.

## Preservation and validation

`20261113225107_crm_activity_month_history_2026.sql` reuses
`tc_crm_record_activity`: it locks each client, retains a newer existing event,
repairs only monthly associations and records changed associations in the
existing audit. It checks the complete client row and every non-month tag ID
before and after each repair, aborting the transaction if either changes.
Replaying it must not add duplicate assignments or audit entries.

The dedicated PGlite integration suite exercises the actual two migration files
with isolated historical fixtures. No customer calls, purchases, captures or
benefit consumption are generated in production for testing.

18 historical integration tests passed, together with the 39 existing targeted
CRM/month/rank checks. These include live fixture triggers for completed web
payments and Oracle purchases, negative cases for gifts and malformed receipts,
and a retry that rewrites a payment timestamp without advancing its activity.

The migration also restricts the existing server-only Oracle-question grant RPC
to `service_role`. All current legitimate callers are server payment handlers;
direct `anon`/`authenticated` execution would otherwise permit forged receipt
metadata. Production application is gated on explicit approval of that permission
restriction. Tests use a documented return-only stand-in to verify the ACL;
they do not replace or claim to revalidate the unchanged grant implementation.
