# TOODOOH — Progress Summary for Stakeholders

*Plain-language overview of what has been built so far.*
*Period covered: 11 May 2026 → 14 June 2026. Last updated: 17 June 2026.*

---

## 1. What this project is

TOODOOH is a Tunisian marketplace for **digital outdoor advertising** (the
advertising screens you see in cafés, shops, and public places). The platform
connects three kinds of users:

- **Advertisers** — businesses that want to run ad campaigns on the screens.
- **Screen hosts** — owners of the venues/screens who earn money by displaying ads.
- **Agents** — field representatives who sign up and support screen hosts.
- **Administrators** — the TOODOOH team, who approve accounts and oversee the platform.

## 2. The big picture of this work

The platform already existed, but it was built on rented third-party
infrastructure (Supabase) and had accumulated a lot of messy, fragile code.
The work in this period had two major thrusts:

1. **Clean up and modernise the existing app** so it's stable and maintainable.
2. **Build a brand-new, self-owned engine underneath it** — our own servers,
   our own database, our own login system — so TOODOOH no longer depends on
   rented infrastructure and controls its own data.

Think of it like renovating a house *and* replacing its foundations and
plumbing at the same time — while keeping the lights on.

---

## 3. Timeline at a glance

| Period | Focus | Outcome |
|--------|-------|---------|
| **11–19 May** | Cleaning up the existing app | A tidy, reliable, well-organised codebase |
| **12–16 May** | Pricing engine | New advertising price-calculation logic (v3.0) |
| **20–29 May** | Building our own back-end | Accounts, login, profiles, file storage — all self-owned |
| **25–28 May** | Reconnecting the app | The app now talks to our own system instead of the rented one |
| **28–31 May** | Going live | First deployment onto our own servers; marketing landing page |
| **31 May–4 Jun** | Feature consolidation & fixes | Simpler screens, bug fixes from quality review |
| **5–14 Jun** | Agents, screens & partner sync | Agent referrals, screen pairing, Wi-Fi management, data sharing with partner network |

---

## 4. What has been accomplished, in plain terms

### A. A cleaner, more reliable application (11–19 May)

The existing app was made far more solid and easier to work on:

- **Removed dead and duplicated code** — thousands of lines of unused or
  redundant material were deleted, reducing confusion and risk.
- **Closed a security gap** — a leftover reference to an outside developer's
  web address was removed from the login flow.
- **Cleaned up nearly 900 stray debugging messages** and replaced them with a
  proper, professional logging system.
- **Broke up oversized, tangled screens** (notably the main dashboard and the
  campaign-creation flow) into smaller, manageable pieces.
- **Reorganised the whole project** by business area (advertisers, screen
  hosts, admin, campaigns, etc.) so the team can find things quickly.
- **Improved accessibility** so the app works better with assistive technology
  (e.g. screen readers, keyboard navigation).
- **Standardised the brand look** — the TOODOOH brand colour and styling are
  now applied consistently from a single source.
- **Set up automated quality checks** so broken code can't slip in unnoticed.

### B. The advertising pricing engine (12–16 May)

A new, version-3.0 pricing model was built. It can calculate the cost of:

- **Standard campaigns** (ongoing advertising over a period),
- **Event campaigns** (short, time-boxed bursts around a specific event), and
- **Mixed campaigns** that combine both in a single order.

This is the commercial "brain" that turns a campaign request into a price.

### C. Our own back-end system (20–29 May)

This is the biggest structural achievement: TOODOOH now has its **own engine**
rather than relying on rented infrastructure. What was built:

- **A new server and database** that we control, with built-in health
  monitoring.
- **A full account & login system** — sign up, email verification, sign in,
  sign out, password reset and change — all owned by TOODOOH.
- **Automatic verification emails** sent through TOODOOH's own mail service.
- **Secure file storage** for documents and images.
- **Profile management** — contact details, address, business information,
  notification preferences, bank details.
- **Document handling** — uploading and storing official documents (e.g.
  business registration and ID).
- **Reference data** — Tunisian regions (governorates), business sectors, and
  predefined advertising zones.

### D. Reconnecting the app to the new engine (25–28 May)

The existing app was carefully re-wired, piece by piece, to use the new
self-owned system instead of the old rented one — covering sign-up, login,
email verification, profile editing, document upload, and password management.
Once complete, leftover ties to the old system were removed.

### E. Going live & the marketing landing page (28–31 May)

- The platform was **deployed onto TOODOOH's own servers** for the first time,
  with secure, production-grade setup.
- The **public marketing landing page** was rebuilt and integrated into the
  platform.

### F. Administrator tools (28–29 May)

- A dedicated, secure **admin login**.
- **Account approval workflow** — administrators can review the queue of new
  sign-ups, approve or reject them, and review uploaded documents.
- **User management** screens connected to the new system.

### G. Simplifying the experience & fixing quality issues (31 May–5 June)

- Several rarely-used or unfinished screens were removed or merged to simplify
  the product.
- Screen-host campaign approval was streamlined, including capturing a reason
  when a campaign is rejected.
- A round of **quality-assurance fixes** (from a reviewer named Kais's QA list)
  was completed, including login/verification fixes so newly verified users
  land directly in their dashboard.

### H. Agents, screens, and partner integration (5–14 June)

This recent period added the operational backbone for the screen network:

- **Agents and referral codes** — agents now receive a unique code, and when a
  new screen host signs up under an agent, that relationship is recorded.
  Agents get a dashboard showing the clients they referred.
- **Screen hosts and their locations** — venue locations are captured at
  sign-up.
- **Screen pairing** — physical advertising screens (Android TV devices) can
  now be securely paired and linked to a location.
- **Wi-Fi management** — venues' Wi-Fi credentials are stored **securely
  encrypted**, and both screen hosts and administrators can update them; changes
  are pushed out to the screen network automatically.
- **Multi-document upload** — users can now upload several supporting documents,
  and admins have a grouped view to review them.
- **Smarter sign-up** — step-by-step validation, Tunisian bank-format checks,
  and live checks that an email or tax number isn't already in use.
- **Bank details** are now captured and visible to admins (important for paying
  screen hosts).
- **Integration with the partner screen network ("wedooh")** — approved screen
  hosts, locations, and footfall/affluence data are now shared automatically
  with the companion system that runs the physical screens.

---

## 5. Where things stand now

- The platform is **running on TOODOOH's own infrastructure**, no longer
  dependent on rented third-party services for its core functions.
- **Advertisers, screen hosts, agents, and administrators** all have working
  sign-up, login, and core workflows.
- The **physical screen network is connected**: screens can be paired, Wi-Fi
  managed, and data shared with the partner system.
- The codebase is **clean, organised, and protected by automated checks**,
  putting the team in a strong position for the next phases.

## 6. What's still ahead (not yet done)

Based on the planned roadmap, the natural next steps include deepening the
campaign-ordering and payment/recharge flows on the new system, expanding the
screen-network and footfall features, and continued hardening ahead of wider
rollout. (These have not yet been built in the period covered above.)

---

*This summary was generated from the project's full development history
(349 recorded changes between 11 May and 14 June 2026). It is intentionally
non-technical; the engineering team can provide deeper detail on any item.*
