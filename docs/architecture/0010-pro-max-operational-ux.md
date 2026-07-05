# Step 10.PRO.MAX — Operational UI integration

## Status

Implemented as a frontend-only integration scope on top of Step 10.PRO. No database migration,
backend business-rule change, authentication change, or deployment change is included.

## Goal

Expose the operational capabilities that already exist in the Step 10.PRO backend and replace the
vertical-slice admin UI with a workflow suitable for daily staff use.

## Included

- Customer current-bill page at `/s/:slug/bill` using the public bill projection.
- Admin service-point and QR management at `/admin/service-points`.
- Visual catalog quick-add with search, category filtering, and quantity controls.
- Separate forms for manual products and manual time charges.
- Editing and voiding custom charges through their dedicated API contracts.
- PAID, WAIVED, and settlement reversal workflows.
- Gross, paid, waived, and outstanding summaries in the admin bill workspace.
- Explicit bill-completion blockers.
- Accessible in-app dialogs for quantity changes, cancellation, void, settlement, reversal, and
  completion instead of browser prompts.
- Navigation from customer menu/order success and admin dashboard to the newly exposed workflows.

## Invariants preserved

- The server remains authoritative for prices, totals, interval billing, settlement amounts, and
  completion eligibility.
- The frontend only displays provisional calculations before submission.
- Existing idempotency, transaction, locking, audit, and terminal-bill rules remain unchanged.
- Custom charges remain order lines with `MANUAL_PRODUCT` or `MANUAL_TIME` kinds.
- No role model, inventory, payment gateway, or deployment scope is introduced.

## Verification strategy

1. Static round: format, migration integrity, lint, typecheck, tests, build, environment validation,
   and Compose configuration through `pnpm check`.
2. Local runtime round: rebuild the Compose stack, verify healthy services, and run the local smoke
   verifier.

Manual product testing is performed only after both rounds pass.
