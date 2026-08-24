# MDF Outreach

Local-first buyer outreach & email campaign application for **MDF Exports & Imports** — designed for international agricultural export outreach, starting with Guntur Dry Red Chilli exports to Thailand.

## Setup

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

No external accounts, databases, or API keys are required for Phase 1. All data is stored locally in the browser's IndexedDB.

## Phase 1 (this build)

- Local IndexedDB storage (Dexie)
- Buyer database (add / edit / import CSV / export CSV)
- Campaigns (recipients, personalization, preview)
- Email composer with 3-panel layout
- Email-safe HTML + plain-text renderer (Gmail / Outlook / Apple Mail compatible)
- Desktop + mobile email preview
- Preview-as-buyer (see exactly what each importer will receive)
- Simulation Mode for test sends (no real email is sent)
- Full local workspace backup / restore (JSON)
- Activity log
- Settings for company, brand, email defaults
- Demo workspace bundled for immediate exploration

## Phase 2 (future)

The data-access layer uses a repository interface. To connect a real database, swap the `IndexedDB*Repository` implementations for `Supabase*Repository` — no UI changes needed.

The send path uses an `EmailProvider` interface. Phase 1 ships `SimulationEmailProvider`; Phase 2 will add `GmailEmailProvider`.

## Data safety

Because everything is local, **export a workspace backup regularly** (Settings → Data → Export Workspace Backup).
