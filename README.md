# FunnelFlow

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
| **Email** | Broadcasts to everyone or to a tag, `{{first_name}}` merge fields, an automatic signed unsubscribe link, and an Outbox log. SMTP delivery, or a dev mode that logs without sending. |
| **Dashboard** | Contacts, views, opt-ins, conversion, a 14-day signup chart, a get-started checklist and recent contacts. |
| **Accounts** | Email and password sign-up (scrypt hashing), cookie sessions and workspace-scoped data. |

## Run it

Requires Node.js 22.5+ (it uses the built-in `node:sqlite`, so there's no native build step).

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # auto-restart on file changes
npm test           # end-to-end API tests
```

Data is stored in `data/app.db` (SQLite).

### Configuration (environment variables)

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default 3000) |
| `PUBLIC_URL` | Public base URL used in links/emails, e.g. `https://app.yourdomain.com` |
| `APP_SECRET` | Signs unsubscribe links (auto-generated and stored if unset) |
| `DB_PATH` | SQLite file location |
| `NODE_ENV=production` | Marks session cookies `Secure` (use behind HTTPS) |
| `STRIPE_API_BASE` | Override the Stripe API URL (tests only) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `SMTP_FROM` | Real email delivery (Postmark, SES, Mailgun, Brevo, etc.). Without `SMTP_HOST`, emails only go to the Outbox. |

### Taking payments

Each workspace connects its own Stripe account under **Settings → Payments**, by pasting a secret key
(`sk_test_…` to try it, `sk_live_…` for real money). For reliability, also add a webhook in
Stripe for `checkout.session.completed` that points to the URL shown there, then paste its
`whsec_…` signing secret. Keys are write-only in the UI, but they're stored unencrypted in SQLite,
so protect the database file (see roadmap).

## Project layout

```
server.js            entry point
src/app.js           API routes + public funnel/unsubscribe routes
src/db.js            SQLite schema (every table is scoped by account_id)
src/auth.js          password hashing, sessions
src/render.js        block → HTML renderer (shared by live pages and the preview)
src/templates.js     starter funnels
src/mailer.js        SMTP / dev-mode email
src/stripe.js        Stripe Checkout client + webhook signature check
public/              dashboard single-page app (vanilla JS, no build step)
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
- Opportunity pipelines (Kanban deal stages)
- Visual workflow builder (triggers, waits, if/else, actions)
- SMS and two-way conversations inbox (Twilio)
- Calendars and booking pages
- Agency mode: one agency account managing many client sub-accounts (the `accounts`/`memberships` tables are already shaped for this), white-label, SaaS re-billing
- Reputation management, forms/surveys, reporting

When it outgrows SQLite, swap `src/db.js` for Postgres (e.g. Supabase). The SQL is mostly standard.
