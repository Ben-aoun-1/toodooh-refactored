# TOODOOH — Detailed Progress Summary for Stakeholders

*A plain-language, in-depth, day-by-day account of what has been built so far.*
*Period covered: 11 May 2026 → 14 June 2026.*
*Based on the project's complete development history (349 recorded changes).*
*Last updated: 17 June 2026.*

> **How to read this document.** Sections 1–3 give the big picture. Section 4
> onward is a detailed, dated walkthrough — close to a blow-by-blow account —
> translated out of engineering language. A glossary of unavoidable terms is at
> the very end (Section 13).

---

## 1. What this project is

TOODOOH is a Tunisian marketplace for **digital outdoor advertising** — the
advertising screens you see in cafés, shops, pharmacies, and public venues. It
serves four kinds of users:

- **Advertisers** — businesses that buy and run ad campaigns on the screens.
- **Screen hosts** (also called "owners") — venue owners who host the screens
  and earn money by displaying ads.
- **Agents** — field representatives who recruit and support screen hosts, and
  earn from the hosts they bring in.
- **Administrators** — the TOODOOH team, who approve accounts, review documents,
  and oversee the platform.

## 2. The big picture

When this work began, the platform already existed but suffered from two serious
problems:

1. It ran on **rented third-party infrastructure** (a service called Supabase),
   so TOODOOH did not fully own or control its data and login system.
2. Its code had become **fragile and disorganised** — duplicated files, dead
   code, oversized pages, scattered quick-fixes — making every change slow and
   risky.

The work pursued two goals in parallel: **renovate the existing app** so it is
clean and reliable, and **build a brand-new, fully-owned engine beneath it**
(TOODOOH's own servers, database, login, file storage, and email) and migrate
the app onto it.

The analogy: we renovated the house *and* replaced its foundations, plumbing,
and electrics — while the household kept living in it.

## 3. Timeline at a glance

| Period | Theme | Headline outcome |
|--------|-------|------------------|
| **11–13 May** | Foundation & cleanup begins | App reorganised; dead code removed; pricing engine started |
| **13–16 May** | Deep code overhaul | Logging fixed, code made type-safe, giant pages broken up |
| **15–19 May** | Structure & polish | Feature-based organisation, accessibility, branding, automated checks |
| **20–25 May** | Building our own engine | Own database, accounts, login, email, file storage, profiles |
| **25–28 May** | Reconnecting the app | The app re-wired onto the new engine, piece by piece |
| **28–31 May** | Admin tools & going live | Admin approvals; first deployment to our own servers |
| **31 May–5 Jun** | Simplification & quality fixes | Screens merged/simplified; QA issues fixed |
| **5–14 Jun** | Network operations | Agents, screen pairing, Wi-Fi, documents, partner-network sync |

The pace was steady throughout: roughly 350 individual, reviewed changes across
five weeks — an average of well over a dozen per active working day.

---

## 4. Phase One — Renovating the existing app (11–19 May)

A disciplined, step-by-step clean-up. Each step was planned, executed, and
verified before the next began.

### 11 May — Setting up the workspace and first fixes
- **Modern workspace created.** The project was rebuilt into a clean, modern
  structure that cleanly separates its different parts and supports adding new
  components later.
- **Existing app imported** into its proper home within that structure.
- **A bug in the campaign-monitoring screen** (where the screen could behave
  inconsistently under certain conditions) was fixed.
- **Faster start-up.** Every page was set to **load only when needed** rather
  than all at once, so the app feels faster.
- **A shared "loading…" indicator** was introduced for a consistent feel while
  pages load.
- **Security fix.** A hard-coded link to an **outside developer's web address**
  was discovered in the login flow and removed, replaced by a proper
  TOODOOH-controlled setting. This eliminated a genuine security and branding
  risk.
- **Uniform formatting** was applied across the entire codebase, and unused
  leftover code was stripped out, so everything is consistent and readable.
- **A written audit and roadmap** of the clean-up work was produced to guide the
  weeks ahead.

### 12 May — Dead code, login state, and the pricing groundwork
- **Project context documented.** A "handoff" set of reference documents was
  imported and reconciled so future work has full context (user journeys for
  advertisers, screen hosts, and admins; a design-vs-code map; etc.).
- **Dead pages and duplicate files deleted** — for example an abandoned
  shopping-cart page, a duplicate admin dashboard, and two redundant data-service
  files. This removes clutter and reduces the chance of bugs hiding in unused
  code.
- **Login "memory" rebuilt.** How the app remembers who is logged in was
  previously hand-rolled and fragile. It was rebuilt onto **one single, reliable
  mechanism**; the scattered, ad-hoc storage code and a leftover debug tool were
  removed. A trustworthy "who is logged in" layer underpins everything else.
- **Pricing engine groundwork.** The configuration and core building blocks of a
  new pricing model (version 3.0) were laid down, and the date-handling and
  configuration pieces were moved into a dedicated, well-organised home.
- **Version pinning.** The exact technical toolset version was fixed so every
  developer and server behaves identically.

### 13 May — The pricing engine and a logging clean-up
- **Pricing engine, version 3.0 — the commercial "brain".** Built the logic
  that turns a campaign request into a price, covering three campaign types:
  - **Standard campaigns** — ongoing advertising over a chosen period, with the
    budget intelligently split across the relevant factors.
  - **Event campaigns** — short, time-boxed bursts around a specific event, with
    their own eligibility and pricing rules.
  - **Mixed orders** — a single basket combining standard and event campaigns.
  This was rebuilt cleanly and documented.
- **Professional logging — ~900 stray messages cleaned up.** The old code was
  littered with informal debugging print-outs. In three sweeps the team
  **removed ~447 debug messages**, **removed ~199 redundant error messages**,
  and **upgraded ~256** to a proper, controllable logging system. A rule was
  then switched on to **stop stray messages creeping back in**.

### 14 May — Bug-proofing the code, and breaking up the dashboard
- **Type-safety overhaul.** A large effort hardened the code against a whole
  class of mistakes by making it **type-safe** — meaning the computer now catches
  many errors before users ever see them. This touched **hundreds of locations**.
- **Real bugs fixed along the way**, including error-handling gaps in **user
  deletion**, **document upload**, and the **campaign cart/draft** flows —
  places where a failure could previously have gone unnoticed.
- **The giant dashboard broken up.** The main dashboard (an oversized, tangled
  screen) was split into a clean layout plus **focused, reusable pieces** — a
  shared layout, page headers, navigation items, the advertiser dashboard
  itself, and several supporting building blocks — making it far safer to
  change.

### 15 May — Breaking up the campaign-creation flow, and organising by area
- **Campaign-creation flow rebuilt step-by-step.** The lengthy "new campaign"
  process was reorganised so each of its **six steps** became its own
  self-contained piece:
  1. Name & campaign type
  2. Category & choice of screen "park"
  3. Period / dates
  4. Geographic zones
  5. Media content (video upload)
  6. Final validation
  A reusable "wizard" controller now coordinates them, and obsolete leftover
  screens were deleted.
- **Organised by business area.** The app began being reorganised into clear
  business areas — authentication, events, performance reports, wallet/payments,
  and screens — so everything for a given area lives together.

### 16 May — Finishing the reorganisation, removing reloads, tightening admin security
- **Reorganisation completed** across the remaining areas: advertiser tools,
  admin tools, screen-host tools, and campaigns.
- **More dead code removed** — a dedicated audit deleted **7 more unused files,
  about 1,385 lines**, that nothing in the app referenced.
- **Forced page reloads eliminated.** Jarring full-page reloads were replaced
  with smooth, modern in-app navigation.
- **Admin security tightened.** A bug in how **administrator permissions** were
  checked was fixed and a proper role check enforced, so admin-only screens are
  genuinely protected.
- **Internal tidy-up.** About **517 internal cross-file links** were rewired to
  a cleaner, consistent style, making the code easier to navigate.

### 17 May — Modernising data-fetching and starting accessibility
- **Data-fetching modernised.** The app's entire **data-loading layer** was
  migrated to a modern, industry-standard approach with automatic caching,
  background refreshing, and consistent loading/error behaviour. This was rolled
  out across advertiser pages, profile, events, wallet, screen-host pages,
  financial views, settings, admin pages (money, approvals, users, catalogue),
  the campaign flow, and notification alerts. For users this means **fewer
  spinners, fresher data, and fewer glitches**.
- **Accessibility begun.** Form fields were properly **labelled** and videos
  given **caption tracks**.

### 18 May — Finishing accessibility and starting the branding pass
- **Keyboard accessibility.** Click-only buttons were made **keyboard-operable**,
  helping people who rely on assistive technology.
- **Simplification.** Over **70 pointless code wrappers** were removed, and a
  handful of subtle data-refresh timing issues were fixed.
- **Branding pass started.** The TOODOOH brand colour was turned into a single,
  named brand palette instead of being scattered as raw colour codes.

### 19 May — Finishing branding, automated checks, and closing the phase
- **Branding finished.** Remaining brand shades were consolidated and a
  **contrast pass** improved text legibility on brand-coloured backgrounds —
  a consistent, on-brand look that's easy to adjust centrally.
- **Automated quality gates** were put in place so broken or sub-standard code
  is caught automatically before release; duplicate technical dependencies were
  consolidated.
- **Data inventory documented.** A thorough inventory of the old system's data
  (business profiles, campaigns, geography, finance, video, notifications,
  events, storage, and more) was written up to guide the back-end build.
- This **formally closed the renovation phase.**

---

## 5. Phase Two — Building TOODOOH's own engine (20–25 May)

The single biggest structural achievement: TOODOOH now has its **own back-end**
— servers, database, login, email, and file storage — instead of renting these.

### 20 May — The foundation
- A new server application and **TOODOOH-owned database** were created.
- **Health monitoring** was added (the system can report whether it and its
  database are alive), along with configuration safety-checks and professional
  logging.
- Everything was **packaged to run reliably and identically** on any machine,
  with a safe process for evolving the database over time.
- The **users table** — the central record of accounts — was created.

### 21 May — Accounts and sign-up
- A full, self-owned **account and login system** was built, including the
  underlying records for accounts, active sessions, and email verifications.
- The **sign-up process** was built with abuse protections — for example it
  won't reveal whether an email already exists (a standard anti-fraud safeguard)
  and it checks for duplicate tax numbers. It was tested against a real database.

### 22 May — Email, storage, and reference data
- **Automatic emails** (such as verification emails) now go out through
  TOODOOH's own mail service, with a branded template, designed never to crash
  the system if the mail service hiccups.
- **Secure file storage** was set up for documents and images.
- Core **Tunisian reference data** was loaded: governorates (regions), business
  sectors, and predefined advertising zones — plus the extra profile fields the
  sign-up flow needs.
- A **session guard** was added so private actions require being logged in, and
  the first profile-update capability (business details) was built.

### 24 May — Profiles, documents, and sign-in
- **Profile management** expanded so users can maintain contact details,
  address, and notification preferences.
- **Document upload and retrieval** was added for official paperwork (business
  registration "RNE" and ID "CIN").
- **Sign-in and sign-out** flows were completed, returning the right
  information to route each user to the correct place.

### 25 May — Passwords, browser access, and "grown-up" sign-up
- A full **password-management** suite: request a reset, reset via emailed link,
  and change password while logged in — with proper security (e.g. logging out
  other sessions when a password changes).
- The engine was made **safely reachable from the browser**, and a "who am I"
  capability added so the app always knows the current user.
- The sign-up process grew to capture the **full multi-step wizard profile**,
  correctly assigning each user their role (advertiser, screen host, etc.), with
  tax details optional where appropriate.
- **Public reference-data** (regions and business sectors) was made available to
  the app.

---

## 6. Phase Three — Reconnecting the app to the new engine (25–28 May)

With the engine built, the existing app was **re-wired onto it, feature by
feature**, so it no longer depended on the old rented service. Each piece was
migrated and verified in turn:

- **25 May** — the core connection layer and login state (the "keystone"), then
  reference-data reads (regions, sectors, zones).
- **26 May** — the full **sign-up wizard**; the **email-verification landing
  experience**; **profile editing** for both advertisers and screen-host owners;
  **document upload and viewing**; and the complete **password flow** (request,
  reset, change).
- **26 May (cleanup)** — once each piece was switched over, the **leftover ties
  to the old system were removed** and obsolete internal plumbing deleted.
- **28 May (follow-up)** — a fix ensured **dashboards load cleanly** after login
  and that any stale old-system data was swept away.

The practical result: the app now talks to TOODOOH's own engine, not the rented
service, for all of these core journeys.

---

## 7. Phase Four — Admin tools and going live (28–31 May)

### 28 May — Administrator login and the landing page
- A dedicated, secure **administrator login** was created and unified onto the
  same reliable login system as everyone else; a non-admin who tries the admin
  login is safely redirected to their own dashboard.
- A safe way to **create the very first administrator account** was added.
- The **public marketing landing page** was rebuilt and integrated, with its
  calls-to-action pointing to the right places.
- A reliability fix made the **admin dashboard render instantly** even if some
  statistics are slow to load.

### 29 May — Approvals and user management
- The **account-approval workflow** was built end-to-end: administrators can see
  the queue of pending sign-ups, **approve or reject** them, and **review
  uploaded documents** — all protected by an admin-only guard.
- The **user-management** screens were connected to these new capabilities, and
  any actions that didn't yet have back-end support were cleanly disabled rather
  than left misleading.

### 29–31 May — First deployment to our own servers
- Production-grade setup was prepared: secure web serving, packaging, and an
  **automated release process**.
- A **server (VPS) was provisioned** following a documented runbook.
- TOODOOH was then **deployed onto its own server for the first time**, with an
  automatic **health check** after each release (retrying for up to a minute to
  confirm success).
- Milestone: the platform now **runs on infrastructure TOODOOH controls.**

---

## 8. Phase Five — Simplifying the product & fixing quality issues (31 May–5 June)

### 31 May–1 June — Streamlining screens
- Several rarely-used or unfinished screens were **removed or merged** — for
  example removing a gift-catalogue section, and **merging the screen-host's
  separate campaign-approval page into the main campaigns page**.
- A reusable **side-drawer** component was introduced for a consistent feel.
- When a screen host **rejects a campaign, they now record a reason**.
- **Shared profile-settings** were unified so advertisers and screen hosts reuse
  the same consistent screens (with a bank-details slot for owners).

### 3 June — Login fixes and moving zones onto the new system
- **Smoother verification:** verified users are now **logged in automatically**
  and land straight in their dashboard.
- A clearer **post-sign-up confirmation screen with a "resend" option** was
  added.
- The **predefined advertising zones** were moved onto the new system —
  including the ability to **upload zone images securely** (publicly viewable but
  safely controlled).

### 4–5 June — Quality-assurance round
- A reviewer's **QA list (six items)** was worked through.
- A batch of important fixes was **carried forward into the main version**:
  storage handling, a stronger **10-character minimum password**, document
  save-state handling, dashboard category display, and tax-number validation at
  sign-up.
- **Terms & conditions documents** are now shown in the sign-up dialog.

---

## 9. Phase Six — Network operations: agents, screens & partner sync (5–14 June)

The most recent stretch built the operational backbone connecting the platform
to the **physical screen network**.

### 5–6 June — Agents and the screen-host model
- **Agent roles** were introduced, and administrators can **create internal
  accounts** (e.g. agents).
- An early "establishments" concept for venues was trialled, then deliberately
  **replaced by a cleaner "screen hosts" model** (and the agent workspace made
  read-only) once the right design became clear — a healthy course-correction.

### 7–8 June — Referral codes, locations, and Wi-Fi capture
- **Agents and their referrals** were modelled, and each agent is issued a
  **unique referral code** when created.
- When a new screen host signs up under an agent, that **referral link is
  resolved and recorded** automatically.
- **Wi-Fi credentials are protected** by encryption (so they can't simply be
  read out of the database), and **venue locations are captured at sign-up**.
- The sign-up wizard now captures **location and Wi-Fi** details.

### 8–10 June — Agent dashboard and sign-up polish
- Agents get a **dashboard listing the clients they referred**.
- **Bank details** were moved onto the new system (important for paying screen
  hosts).
- A **live email-availability check** was added at sign-up, along with
  **per-step validation** and **Tunisian bank-format** checks.
- Advertising zones were simplified to the **"Grand Tunis"** area for now.
- Following a ruling about where location data should come from, coordinate
  capture at sign-up was first removed, then **restored as optional** (with the
  TV device as a second source).

### 10 June — Physical screen pairing
- Support was added for **securely pairing physical advertising screens**
  (Android TV devices) using secure device credentials, and **linking each
  screen to a venue location**.

### 10–11 June — Admin visibility and document handling
- Administrators can now see a user's **bank details** in the user view.
- **Multiple supporting documents** can be uploaded (at sign-up and from the
  profile), replacing the older single-document approach.
- Several smaller fixes improved the owner performance page layout, the
  "getting started" prompt, and how numeric agent codes are accepted.

### 13 June — Document review and tax-number checks
- Administrators got a **grouped document-review screen** to assess a user's
  documents efficiently, with automated tests pinning the expected behaviour.
- A **live tax-number (matricule fiscal) availability check** was added at the
  relevant sign-up step, catching duplicates before the user finishes.

### 14 June — Partner-network sync ("wedooh") and Wi-Fi editing
- An automatic **data-sharing bridge** was built to the companion system
  (**"wedooh"**) that runs the physical screens. **Approved screen hosts, venue
  locations, footfall/affluence data, and agents** are now shared automatically,
  with a **safety sweep** that re-sends anything that didn't get through the
  first time.
- Both **screen hosts and administrators can now edit Wi-Fi details**, and
  changes are **re-pushed to the screen network** automatically.
- The companion system was also moved onto a proper secure web address to match
  production.

---

## 10. Cross-cutting themes worth highlighting

Beyond individual features, several disciplines ran throughout and are worth
flagging to stakeholders:

- **Quality is enforced automatically.** Every change must pass automated checks
  before it can be released, which is why the codebase has stayed healthy even
  while changing rapidly.
- **Security was treated seriously, repeatedly** — removing the outside
  developer's link, hardening admin permissions, encrypting Wi-Fi credentials,
  anti-enumeration on sign-up, and stronger password rules.
- **Course-corrections were made deliberately**, not papered over — e.g.
  replacing the "establishments" model with "screen hosts", and revisiting how
  location data is captured. This reflects careful design rather than churn.
- **Everything is documented.** Each phase produced written plans, audits, and
  hand-off notes, so the project does not depend on any single person's memory.

---

## 11. Where things stand today

- TOODOOH **runs on its own infrastructure** — no longer dependent on rented
  third-party services for its core functions (login, data, files, email).
- **All four user types** — advertisers, screen hosts, agents, and
  administrators — have working sign-up, login, and core workflows.
- The **physical screen network is connected**: screens can be paired, Wi-Fi
  managed, and data is shared automatically with the partner system.
- The codebase is **clean, well-organised, type-safe, and protected by automated
  checks**, giving the team a strong, low-risk foundation for the next phases.

## 12. What's still ahead (not yet built in this period)

Based on the planned roadmap, the natural next steps include deepening the
**campaign-ordering, payment, and account-recharge flows** on the new system,
expanding the **screen-network and footfall** features, and continued hardening
ahead of a wider public rollout. *These items had not yet been built in the
period covered above and are noted here for context, not as completed work —
they should be confirmed with the engineering team before any external
communication.*

---

## 13. Glossary (for unavoidable terms)

- **Back-end / engine** — the behind-the-scenes server, database, and logic the
  user-facing app talks to.
- **Front-end / app** — the part users actually see and click.
- **Supabase** — the rented third-party service the platform is moving *away*
  from.
- **VPS** — a server (virtual private server) that TOODOOH now controls.
- **wedooh** — the companion system that operates the physical advertising
  screens; TOODOOH now shares data with it automatically.
- **Type-safe** — code written so that many mistakes are caught automatically
  before users ever encounter them.
- **Matricule fiscal** — a Tunisian business tax-registration number.
- **RNE / CIN** — official Tunisian documents: business registration (RNE) and
  national ID card (CIN).
- **Park ("parc")** — a grouping of advertising screens an advertiser can choose
  to target.
- **Affluence / footfall** — how many people pass a screen, used to value
  advertising.

---

*This summary was generated from the project's complete development history
(349 recorded changes between 11 May and 14 June 2026). It is intentionally
non-technical; the engineering team can provide deeper detail on any item on
request.*
