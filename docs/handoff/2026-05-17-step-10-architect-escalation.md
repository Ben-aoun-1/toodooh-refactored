# Step 10 — architect-level escalation

> Two findings surfaced during the Step 10 React Query migration (roadmap
> #6) that need CEO/CTO attention **before Phase 1 architecture decisions
> lock**. Neither was introduced by Step 10 — the migration surfaced them.
> Step 10 was behaviour-preserving by design and did not fix them.

---

## 1. Simulated revenue data on the screen-host financial dashboard (TBD-R, issue #37)

**Severity: elevated — production data-integrity / customer-trust.**

The owner-facing financial dashboard shows revenue figures that are not real:

- `revenueService.getRevenueByPeriod` synthesizes its series with `Math.random()`.
- `revenueService.getRevenueStats` returns a hardcoded `growthRate` of `12.5`.

These render on the screen-host financial dashboard as though they were
actual earnings and growth. Screen-host partners are a paying/earning side
of the marketplace — showing them fabricated revenue is a trust problem and
potentially a contractual one, not a cosmetic defect.

**Why it matters now:** Phase 1 designs the backend data model. The real
revenue computation (impressions served × rate, owner share, period
bucketing) must be designed deliberately against that model — it is not a
"wire up the query later" detail. Until real figures exist, a decision is
needed on whether the dashboard should show an explicit *preview /
non-final* treatment instead of presenting simulated numbers as real.

**Ask:** treat TBD-R as a Phase 1 work item with executive visibility, not
a buried cleanup ticket.

---

## 2. Cross-session freshness gap (CF-14 (b)-class invalidations)

**Severity: architectural — informs the Phase 1 API/realtime decision.**

Step 10's mutations each declare an invalidation graph, with every target
key classified **(a) within-session** or **(b) cross-session cross-role**
(see the CF-14 entry in `docs/superpowers/plans/2026-05-15-step-8-notes.md`).

The (b)-class invalidations are **no-ops in practice**: when an admin
approves a recharge, or an advertiser activates a campaign, the mutating
session calls `invalidateQueries` against keys that *another user's*
session never cached. The call is kept for intent and hybrid-session
defence, but it delivers nothing cross-session. Today, cross-session
freshness rides entirely on the consumer's `staleTime` (30 s) — i.e. the
other party sees the change only on their next refetch.

This is acceptable for a single-phase cleanup, but it is a **real
architectural gap**: admin → advertiser, admin → owner, and advertiser →
owner data changes have no push channel. Phase 1 must choose one:

- websockets / SSE push,
- Supabase realtime subscriptions,
- aggressive `staleTime` tuning, or
- targeted polling for sensitive paths (e.g. wallet balance).

**Companion constraint (D1 firewall):** auth/session/identity state
propagates through the auth store's Supabase listener, *not* query
invalidation. So Phase 1's realtime layer needs **two channels** — React
Query refetch for query-cache data, auth-store mechanisms for identity.

**Highest-fan-out surface:** campaigns. A single campaign
creation/activation reaches the advertiser dashboard, the advertiser cart,
admin monitoring, the admin video queue, owner approvals, owner dashboard
notifications, and the screen-host campaign overview. The CF-14 graphs in
Commits 7a/7b document this fan-out explicitly — it is the surface that
most stresses whichever cross-session mechanism Phase 1 picks.

**Ask:** make the cross-session freshness mechanism an explicit Phase 1
architecture decision, evaluated against the campaign fan-out above.

---

_Filed at the Step 10 audit refresh (Commit 9). Cross-references: issue #6
(Step 10), issue #37 (TBD-R), audit.md §4 "Step 10"._
