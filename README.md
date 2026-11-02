# Fourfold

A simple, all-in-one marketing platform for small businesses. It starts with the core of
**systeme.io** (funnels, contacts, email) and is built to grow toward **GoHighLevel**
(pipelines, automations, SMS, calendars, agency sub-accounts).

## What works today (v0.1)

| Area | Features |
| --- | --- |
| **Funnels** | Templates: lead magnet, sales page, pricing page, upsell/downsell, blank. Public links at `/f/<funnel>/<page>`, with per-page views, opt-ins and sales. |
| **Visual funnel tree** | Each funnel is a canvas of page cards. Every page has a **✓ Yes / Next** exit (form submitted, purchase, `#next` button) and a **✕ No thanks** exit (`#no` button). Drag cards around, drag from an exit onto a card to link them, or into empty space to create the next page there. Pick any page as the start page; **Tidy up** auto-arranges the tree. You can pan, zoom and fit to screen. |
| **Page builder** | Block editor with live desktop/mobile preview and autosave. Blocks: hero banner, pricing card, heading, text, image, YouTube video, button (`#next` → next page), opt-in form, spacer, divider. Also page colors, width and SEO title/description. |
| **Products & checkout** | Products with one-time, monthly or yearly pricing. A pricing card block sells a product through Stripe Checkout. Payment is confirmed server-side (on the success redirect and via a signed webhook), and buyers become contacts tagged `customer` plus a product tag. There's an orders list and a revenue stat. Without Stripe connected, a **test-mode checkout** lets you run the whole flow without charging anyone. |
| **Contacts (CRM)** | Opt-in forms create or merge contacts and apply tags. Search, tag filter, add/edit/delete, CSV import (dedupes by email) and CSV export, plus a bot honeypot on forms. |
| **Pipelines** | Kanban boards of deal stages (default: New lead → Contacted → Proposal sent → Negotiation). Drag deals between stages and up/down to prioritise; each column shows its count and total value. Deals have a value, currency, contact (pick one, or type a new email to add them to contacts), and notes, and are marked won or lost (with Won/Lost lists and Reopen). Rename, reorder, add or remove stages; run several pipelines. A contact's deals show on their record, and the dashboard shows open pipeline value. |
| **Weekly move** | Each week the dashboard proposes one move for the focus lever (pinned, or the lowest health score): it checks that lever's candidates (stale inquiries, new leads who haven't bought, recent buyers to ask for referrals or add-ons, one-time buyers, quiet customers, buyers not on the newsletter), and picks the one with the most people × average order value. People emailed in the last 14 days are left out. "Draft it" writes the email in the owner's voice (voice profile in Settings: 3-5 writing samples plus tone notes); nothing is sent until Approve & send. Results show sent, opened, clicked and purchases within 14 days. |
| **Print & QR** | The print newsletter's mailing list as CSV and as a PDF of mailing labels for 30-per-sheet US Letter stock (Avery 5160), skipping anyone without a complete address. Short links with QR codes for postcards and inserts: every scan (QR) and visit (typed link) is logged as an event, optionally tied to a campaign. |
| **Repurpose** | Paste one essay or episode transcript and get drafts for an email (one click to a broadcast draft), a product listing, two social posts and show notes, in the owner's voice. |
| **Weekly digest** | The only alert: on the chosen day, one email to the owner with lever health, this week's move and inquiries older than 14 days. Preview or send one now from Settings. |
| **Funnel builder extras** | New funnels start as drafts (the owner can preview them; visitors can't). Publishing runs a pre-flight check that blocks on missing products, buttons that lead nowhere or have broken links, empty pages, images without a picture and non-YouTube videos, each with a fix button (warnings for test-mode payments, missing image descriptions, long headlines/buttons on phones). Version history per page (a checkpoint every few minutes while editing, a snapshot on each publish) with one-click restore, plus undo/redo in the editor. Page cards are colored by growth lever, arrows show plain-language rates ("3 of every 10 go on"), and the leakiest step is flagged with one suggested fix. Testimonial block, product photos on buy buttons, and an order bump (a checkbox that adds a one-time add-on to the same payment). |
| **Workflows** | One drag-and-drop map per workflow: a trigger (signs up, buys, gets a tag, subscribes, sends an inquiry, goes quiet, or added by hand), then waits, emails, yes/no splits, tags, newsletter subscriptions, owner reminders and pipeline deals. Email sequences are just steps on the map. Live counts on every step, plain-language checks before going live, test emails, and templates (welcome series, care tips, review request, referral ask, win-back, inquiry follow-up, newsletter welcome). Every workspace starts with care tips, review request, referral ask and win-back switched off. Events older than 2 days (e.g. imported history) never start a workflow. Opens and clicks are tracked. |
| **Email** | Broadcasts to everyone or to a tag, `{{first_name}}` merge fields, an automatic signed unsubscribe link, and an Outbox log. SMTP delivery, or a dev mode that logs without sending. |
| **Dashboard** | Contacts, views, opt-ins, conversion, a 14-day signup chart, a get-started checklist and recent contacts. |
| **Accounts** | Email and password sign-up (scrypt hashing), cookie sessions and workspace-scoped data. |

## Run it

Requires Node.js 22+.

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # auto-restart on file changes
npm test           # end-to-end API tests
```

Locally, data is stored in `data/pglite/` using [PGlite](https://pglite.dev): real Postgres compiled to
WebAssembly, so local runs and tests use the same SQL as production with nothing to install.

## Production: Netlify + Supabase

- **Supabase Postgres** holds the data, in a private `app` schema that Supabase's Data API can't reach.
  The server connects as a dedicated `app_server` role through the transaction pooler (port 6543).
  `src/schema.js` is the schema; on Supabase it's applied as a migration.
- **Netlify** serves `public/` from its CDN. The server routes (`/api`, `/f`, `/checkout`, `/stripe`,
  `/unsubscribe`) run as one function, `netlify/functions/app.mjs`, which hosts the Express app.
- Environment variables on Netlify (Functions scope): `DATABASE_URL`, `APP_SECRET`, `PUBLIC_URL`.
- `GET /api/health` checks the database connection.

To run the tests through the production Postgres driver, point `DATABASE_URL` at any Postgres and set
`TEST_DATABASE_URL=1` (use a throwaway database).

### Configuration (environment variables)

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default 3000) |
| `PUBLIC_URL` | Public base URL used in links/emails, e.g. `https://app.yourdomain.com` |
| `APP_SECRET` | Signs unsubscribe links (auto-generated and stored if unset) |
| `DATABASE_URL` | Postgres connection string (production). Without it, local PGlite is used |
| `DB_PATH` | Local PGlite data directory (default `data/pglite`) |
| `NODE_ENV=production` | Marks session cookies `Secure` (use behind HTTPS) |
| `ANTHROPIC_API_KEY` | Turns on AI drafting (weekly moves, repurposing) in the owner's voice, using Claude. Without it, drafts are fill-in-the-blank templates |
| `AI_MODEL` | Claude model for drafts (default `claude-opus-5-5`) |
| `ALLOW_SIGNUPS` | `1` lets anyone create a workspace. By default the first sign-up owns the app and sign-up closes |
| `STRIPE_API_BASE` | Override the Stripe API URL (tests only) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `SMTP_FROM` | Real email delivery (Postmark, SES, Mailgun, Brevo, etc.). Without `SMTP_HOST`, emails only go to the Outbox. |

### Taking payments

Each workspace connects its own Stripe account under **Settings → Payments**, by pasting a secret key
(`sk_test_…` to try it, `sk_live_…` for real money). For reliability, also add a webhook in
Stripe for `checkout.session.completed` that points to the URL shown there, then paste its
`whsec_…` signing secret. Keys are write-only in the UI, but they're stored unencrypted in the database (see roadmap).

## Project layout

```
server.js            entry point
src/app.js           API routes + public funnel/unsubscribe routes
src/schema.js        Postgres schema (every table is scoped by account_id)
src/db.js            database access: Supabase via DATABASE_URL, or local PGlite
src/auth.js          password hashing, sessions
src/render.js        block → HTML renderer (shared by live pages and the preview)
src/templates.js     starter funnels
src/mailer.js        SMTP / dev-mode email
src/stripe.js        Stripe Checkout client + webhook signature check
src/people.js        people, events, stages, CSV import (people/orders/subscribers/listens), export
src/levers.js        growth-lever metrics and health scores, computed from events
src/dashboard.js     dashboard tiles (one contract per tile) and per-lever layouts
src/brand.js         product name (server side)
src/accounts.js      sub-accounts: create, switch, delete
src/workflows.js     workflow maps, templates, enrolment and the runner
src/messaging.js     email to a person: merge fields, unsubscribe link, open/click tracking
src/moves.js         the weekly move and campaign approve/send/results
src/print.js         print mailing list, label PDF writer, short links and QR codes
src/digest.js        weekly digest and the repurpose endpoint
src/funnelkit.js     pre-flight checks, publish/draft, version history, map metrics and leak flag
src/ai.js            drafting with Claude in the owner's voice (template fallback without a key)
public/js/           dashboard single-page app, one file per feature (vanilla JS, no build step):
                     core (helpers, auth, shell), dashboard, funnels, editor, people,
                     pipelines, products, email, settings, router
netlify/functions/   Netlify Functions: app.mjs hosts the server; jobs.mjs runs workflows and digests every 5 minutes
netlify.toml         Netlify build + function settings
test/                node:test end-to-end tests
```

## Roadmap

**Phase 2: finish the systeme.io core**
- ~~Products and checkout with Stripe~~ ✅. Next: order bumps, one-click upsells, coupons, Stripe Connect (OAuth instead of pasted keys), encrypting stored keys
- Email sequences/autoresponders (send email N days after a tag is added)
- Simple automation rules: "when form submitted → add tag → start sequence"
- Online courses / members area
- Custom domains for funnels, more templates, image uploads
- Password reset, team members, login rate limiting, background job queue for large sends

**Phase 3: GoHighLevel territory**
- ~~Opportunity pipelines (Kanban deal stages)~~ ✅. Next: automations that create or move deals (e.g. form submitted → new deal), deal activity history, touch drag on phones
- Visual workflow builder (triggers, waits, if/else, actions)
- SMS and two-way conversations inbox (Twilio)
- Calendars and booking pages
- Agency mode: one agency account managing many client sub-accounts (the `accounts`/`memberships` tables are already shaped for this), white-label, SaaS re-billing
- Reputation management, forms/surveys, reporting

