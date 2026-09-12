**TOODOOH-AFF1 SHIPPED (PR #154, squash) → toodooh main = 32a2ce5** (CI
verify green; gates re-run on merged main: api 1566+8 · api tc 0 · web 1078
· web tc 14 byte-identical · lint 0 — NEW FLOORS api 1566+8 / web 1078;
next free migration 0065). EXECUTOR LEDGER CORRECTION for the next
paste-back: its deploy-ledger says the pending deploy « carries GREEN2 +
SETTLE2 + CART-V1 + CPM-ADMIN + PERF-QA2 + AFF1 » — WRONG: prod = b4ee359
(2026-08-23) already carries everything through PERF-QA2 (#153); the
pending deploy is #154 ONLY, migration 0064 only, expected journal 65
(the resurrection class again). Deploy pre-flighted; awaits the operator's
"deploy".
