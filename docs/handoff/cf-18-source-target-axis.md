# CF-18 — The source/target axis (inherited-codebase residue)

CF-18 is the dominant carry-forward rule that emerged from the TOODOOH cleanup phase and the P0a/P0b prerequisite work. It earned a standalone document because it is not project-specific schema knowledge — it is *how to inventory an inherited codebase*, and it applies to every future phase.

## 1. The rule

**An inherited codebase carries residue from incomplete prior work. Inventory must surface both the declared state and the actual state, because they routinely disagree.**

A previous developer (or a past version of yourself) starts a migration — a rename, a re-modelling, a schema change — and does not finish it. The old form and the new form then coexist. Whoever reads the codebase next sees *one* of them and assumes it is the whole truth. CF-18 is the discipline of assuming the opposite: that any value, name, type, or structure you find may be one half of an unfinished migration, and that the other half is somewhere you have not looked yet.

The cost of ignoring it is asymmetric. A halt during inventory to chase down a second form is cheap. Shipping a fix that handled only the form you found is expensive — the bug resurfaces through the form you missed.

## 2. The three axes

When inventorying, sweep each item along three axes. A "miss" on any axis is a place residue hides.

- **Axis 1 — Neighbourhood.** Perceptually-near or structurally-related values. A brand colour has near-neighbours (almost-the-same hex); an enum has sibling values; a table has sibling tables. Residue hides in the value next to the one you were looking at.
- **Axis 2 — Representation.** Alternate encodings of the same concept. The same colour as a hex literal, a Tailwind token, and an `@apply` rule. The same campaign-targeting intent as lat/lng columns, a junction table, and an hourly-plan table. Residue hides in the encoding you did not grep for.
- **Axis 3 — Source/Target.** During a migration, *both* the from-value and the to-value are live in the codebase at once. If you only inventory the target, you miss every site still on the source. This is the axis the rule is named for, because it is the one most often forgotten: people inventory where they are going, not where they are leaving.

## 3. The two phases

Both phases sweep all three axes:

- **Inventory** — enumerate every site/value/structure along the three axes *before* classifying or acting. The inventory is where halts happen, and halts here are cheap.
- **Fix** — apply the change. The same three axes apply: a fix that resolves the target representation but not the source representation has not finished the migration; it has just created the next CF-18 instance.

## 4. The nine worked examples

Each instance below is a *distinct layer-axis combination* — a different kind of artifact carrying source/target residue. The diversity is the point: CF-18 is not about colours or about SQL; it is about inherited state.

| # | Phase | Layer | What coexisted |
|---|---|---|---|
| 1 | Cleanup Step 12 | site (CSS) | Canonical-old brand hex and hand-migrated-new hex coexisting at individual style sites |
| 2 | Cleanup Step 14 | `package.json` | Root monorepo tooling vs un-hoisted workspace duplicates |
| 3 | P0a | SQL artifact | The "canonical" `supabase/migrations/` folder vs ~167 ad-hoc root SQL scripts holding real schema |
| 4 | P0a | DB-project naming | Leviosa→Toodooh rename — backup-tree migration corrected, main-tree copy + `config.toml` not |
| 5 | P0a | planning vs reality | Root-script triage estimated 30–60 in-scope; actual 73 — estimate-vs-reality is the same axis at the planning layer |
| 6 | P0b Session 1 | migration tooling | Migration filename timestamps vs true dependency order — Jan-dated files depend on March-dated types |
| 7 | P0b Session 1 | column definition | `business_profiles.verification_status` (enum) and `status` (varchar) — twin validation columns |
| 8 | P0b Session 3 | column set | `campaign_locations` `DROP TABLE … CASCADE` + recreate — old `lat/lng/radius` shape vs new `location_id` shape |
| 9 | P0b Session 4 | record cardinality | `campaign_media` (1:N media per campaign) superseded by `videos` + `campaigns.video_id` (1:1) |

Instance 4 (the Leviosa rebrand) and the enumeration-discipline refinement (§6) originated as P0a/P0b methodology notes and are folded here as CF-18's canonical home.

## 5. What CF-18 catches — use-cases

Apply CF-18 whenever you inventory inherited state. It catches:

- **Partial renames** — a label/identifier/domain changed in some places, not all (instances 1, 4).
- **Partial re-modellings** — a table or relationship reshaped, with the old shape still present (instances 7, 8, 9).
- **Mis-stated provenance** — the "canonical" source is not the complete source; ordering metadata is unreliable (instances 3, 6).
- **Estimate drift** — a forecast made from one representation (filenames, declared counts) diverges from the actual (instance 5).

The trigger thought is: *"I found X."* CF-18 answer: *"Then look for not-quite-X, for X-encoded-differently, and for the X you are migrating away from."*

## 6. Enumeration discipline — instances vs observations

Not every partial-migration coexistence earns a new instance number. The discipline (refined at P0b Session 3):

- **A new instance** = a *distinct layer-axis combination* — a kind of artifact, at a layer, not previously recorded. Instance 8 (column-set replacement) and instance 9 (record-cardinality change) are distinct because the *kind* of change differs, even though both are on the representation axis.
- **A same-axis observation** = an *additional example* of an already-recorded layer-axis combination. It is noted *under* the existing instance, not separately numbered.

Worked example: under instance 8, three same-axis observations were recorded without inflating the count — campaign targeting carries four parallel representations (`location_lat/lng/radius`, `campaign_locations`, `campaign_screens`, `campaign_hourly_location_plan`); `campaigns.category` coexists with the `campaign_categories` junction; `screens.location` text coexists with `screens.location_id`. P0b Session 4 likewise recorded the three coexisting affluence representations as a same-axis observation, adding **0** new instances.

The discipline keeps the instance count meaningful: it measures *distinct kinds* of residue encountered, not raw occurrences. A divergent-table-definition problem (two `CREATE TABLE IF NOT EXISTS` for one table) is a *defect*, not a CF-18 instance — CF-18 is about source/target coexistence, not about duplicated declarations.

## 7. Cross-references

- `docs/handoff/methodology-and-prompt-format.md` — the broader operating methodology; CF-18 is one of its carry-forward rules (CF-1…CF-18).
- `docs/handoff/supabase-schema-inventory.md` §12 — points here; the inventory's per-table sections are themselves a CF-18-disciplined inventory of the legacy schema.
- `docs/audit.md` §7.4 — the cleanup-phase CF-1…CF-18 record.
