# Outreach deliverability

This document is an operational guide for MDF staff sending real buyer
outreach through MDF Outreach. It has two parts:

1. **Domain authentication** — the DNS records that make our mail land
   in an importer's inbox instead of spam. (No DNS is changed by the app.
   This is a checklist for IT.)
2. **Operational best practice** — how to keep our sending reputation
   healthy without going near legal jurisdictional claims.

Nothing here is legal advice. Compliance obligations depend on the
buyer's jurisdiction — consult a professional when in doubt.

---

## Part 1 — Domain authentication (SPF / DKIM / DMARC)

Because MDF Outreach uses the connected **Google Workspace** account
(`contact@mdfexport.com`) to send mail via Gmail, deliverability depends
on the DNS records under **mdfexport.com**. The app never modifies DNS.

Verify all three records are present and healthy before the first live
outreach batch. Google's admin console publishes the exact values;
whatever we paste here would go stale.

### SPF (Sender Policy Framework)

> Which mail systems are allowed to send **as** `@mdfexport.com`.

- Confirm the domain has an SPF `TXT` record at the apex.
- It must include Google Workspace's sending servers: typically
  `v=spf1 include:_spf.google.com ~all`.
- If a third-party newsletter/CRM tool is also authorized to send, its
  include block is added — not a second `TXT` record. Only one SPF
  record per domain.
- `~all` (soft fail) is acceptable while migrating; `-all` (hard fail)
  is stricter and preferred once we're sure the include list is
  complete.

### DKIM (DomainKeys Identified Mail)

> Cryptographically signs outgoing mail so receiving mail servers can
> verify the message really came from `mdfexport.com` and wasn't
> altered in transit.

- In Google Admin → Apps → Google Workspace → Gmail → Authenticate email,
  generate a **2048-bit DKIM key** for the domain.
- Publish the `TXT` record it prints at
  `google._domainkey.mdfexport.com`.
- After DNS propagates, click **Start authentication** in the same
  screen so Google begins signing outgoing mail.
- Re-verify signing is active BEFORE the first live buyer batch.

### DMARC (Domain-based Message Authentication, Reporting & Conformance)

> Policy layer on top of SPF + DKIM. Tells receiving servers what to
> do when authentication fails, and lets us receive aggregated reports.

- Publish a `TXT` record at `_dmarc.mdfexport.com`.
- Start with a permissive policy while we validate everything:
  `v=DMARC1; p=none; rua=mailto:dmarc-reports@mdfexport.com; adkim=s; aspf=s`.
- After a couple of weeks of clean aggregate reports, tighten to
  `p=quarantine`, and eventually `p=reject`.
- `adkim=s; aspf=s` means "strict alignment" — the domain in the
  From: header must match the signing domain exactly.

### Verification checklist

- [ ] `dig TXT mdfexport.com +short` shows one SPF `TXT` including
      `_spf.google.com`.
- [ ] `dig TXT google._domainkey.mdfexport.com +short` returns a
      non-empty key.
- [ ] Google Admin → Authenticate email says **Authenticating email**
      (not "Not authenticating").
- [ ] `dig TXT _dmarc.mdfexport.com +short` returns a DMARC record.
- [ ] Send yourself a test message via **Real Gmail Test** and inspect
      the received headers for `spf=pass`, `dkim=pass`,
      `dmarc=pass`.

The app cannot automate any of the above. If a check fails, fix DNS in
Google Domains / Cloudflare / wherever the zone is hosted, wait for
propagation, and re-verify.

---

## Part 2 — Operational best practice

Deliverability is 80% domain reputation, 20% content. Reputation is
built slowly and destroyed quickly. Follow this checklist on every
campaign.

### Recipient quality

- **Use accurate business recipient data.** Every buyer should have
  been added by MDF staff based on a real business relationship or
  research — never a purchased list, never a random scrape.
- **Never email suppressed contacts.** The app enforces this
  server-side, but the operator must not attempt workarounds.
- **Honor opt-out requests immediately.** When a recipient asks to be
  removed, mark them "Do not contact" in Buyer Detail. Do not wait for
  a "next batch".
- **Avoid purchased/random email dumps.** Aggressive volume to
  low-quality addresses is the fastest way to get `mdfexport.com` into
  spam folders for every legitimate buyer.

### Content

- **Keep outreach relevant to the buyer's business.** A Thai chilli
  importer should receive Guntur chilli campaigns, not Alphonso mango.
  Use campaign country + product theme to target correctly.
- **Use clear MDF sender identity.** Sender name is `MDF Exports &
  Imports` from `contact@mdfexport.com`. Do not spoof individual staff
  or pretend to be a different business.
- **Avoid deceptive subjects.** "Re:" / "Fwd:" prefixes on a first
  contact, ALL CAPS, or clickbait ("URGENT!!!") trigger spam filters
  and destroy trust.
- **Personalize meaningfully.** `{{greeting}}`, `{{first_name}}`,
  `{{company}}`, `{{country}}`, `{{product}}` are already wired. Use
  them.

### Volume + cadence

- **Start with small batches.** The current production safety cap is
  **10 buyers per batch**. Do not remove or raise this cap. Even at
  the cap, the first several batches should stay well below it while
  we monitor deliverability.
- **Do not send repeated campaigns to unresponsive contacts
  aggressively.** Two or three thoughtful sends over a season is
  outreach; ten sends in a month is spam.
- **Space campaigns out.** Multiple batches in quick succession to
  overlapping recipient sets look like a spam attack to Google.
- **Prefer weekdays, business hours** in the recipient's local time
  zone.

### Monitoring

- Watch the campaign **Send history** filter for a rising failure rate.
- Watch DMARC aggregate reports (if `rua=` is set) for a rising
  `spf=fail` / `dkim=fail` percentage.
- If a specific recipient's delivery fails, mark them
  `invalid_email` in Buyer Detail — that prevents a second attempt
  and protects our sending reputation.

### What NOT to do

- Do not send to more than 10 buyers per batch even if the code appears
  to allow it — the cap is enforced server-side and a bypass attempt is
  auditable.
- Do not attach `.zip` / `.exe` / large binaries. If a buyer needs a
  catalogue, send a link to a hosted PDF.
- Do not embed images as inline Base64 — the app blocks this server-side
  anyway, but the same principle applies to any manual outreach: hosted
  URLs only.
- Do not use tracking pixels or click-tracking redirects — none exist in
  this app today, and they will not be added in this phase.
- Do not use the same subject line for every campaign. Filters cluster
  identical mail as bulk.

If you are unsure whether an outreach is appropriate, ask MDF leadership
before sending.
