# Artist Booking for Claude Code

Own the show diary, contract references, deposits and preparation records behind your artist agency.

| Do it yourself | We customise it | We run it for you |
|---|---|---|
| Free, MIT. Install and try the demo. | Your deal terms, artist fields, reports and SystemOne export mapping. | Installed and operated through Omni by Enterprise DNA. A setup fee, then a retainer. |

[Get your version built](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=systemone) · [Instead of SystemOne](https://enterprisedna.co/omni/instead-of/systemone)

## Start with your next shows

A booking agency needs to know which holds expire, who owes a deposit, whether an artist is double-booked and what the promoter still needs to confirm. This desk answers from records, keeps changes and produces drafts for review. It does not send messages, sign agreements or take payments.

SystemOne covers a wider set of booking and mobile workflows. This base is the internal agency desk. [Scope and sources](docs/research.md). Claude Code, Codex, OpenCode or Cursor reads the same instructions and commands. No model API is required.

## Quick start

Node 20 or later. No cloud account is required for the local demo.

```bash
git clone https://github.com/Enterprise-DNA-OS/artist-booking-for-claude-code.git
cd artist-booking-for-claude-code
npm install
npm run demo
npm run booking -- weekly-review
npm run view
npm run docs
```

PGlite stores the local database in .data/db. DATA_DIR selects a different location. DATABASE_URL selects PostgreSQL. Migrate an empty database before use. Never seed working customer records. The fictional seed uses dates relative to today and deliberately includes an expired hold, a booking clash, an overdue deposit, late preparation and a late journey.

## Your weekly rituals

Monday: /weekly-review combines /week, /attention and /deposits-due. Before confirming a show: /holds, /clashes, /contracts-due and /record-contract. Before travel: /advance-review, /travel-review and /ready. Before closing the week: /promoter-exposure, /owner-load and /balances.

32 CLI operations and 36 slash recipes. Read entities.json for editable fields. Every command accepts --json. References match exact codes, case-insensitive names or partial ids. Ambiguous matches list the candidates and stop.

```bash
npm run booking -- show --kind=bookings --ref=SH-NORTH --json
npm run booking -- add --kind=advance_items --code=ADV-NORTH-MEAL --name="Confirm meal arrangements" --booking-id=SH-NORTH --category=hospitality --due-on=2026-12-01 --owner=Mara --actor=Mara
npm run booking -- log --kind=bookings --ref=SH-NORTH --actor=Mara --note="Promoter will confirm the input list"
```

Dates use YYYY-MM-DD. Show and journey timestamps require explicit timezone offsets. Venue display uses its IANA timezone. Use a future date appropriate to your show, rather than copying the example date. Money is integer cents. Reports keep currencies separate, with no exchange-rate assumptions.

## Ten questions answered today

These questions run against this build. We do not claim the vendor cannot answer them.

1. Which holds expired while their artist was booked elsewhere? /holds
2. Which upcoming shows overlap for the same artist? /clashes
3. Which confirmed shows still have unpaid deposits? /deposits-due
4. Which promoter has the largest unpaid balance within each currency? /promoter-exposure
5. Which shows have no signed contract reference? /contracts-due
6. Which preparation items are late, and who owns them? /advance-review
7. Which travel plans arrive after the show starts? /travel-review
8. Which agent has the most unfinished preparation across their shows? /owner-load
9. Which artist itineraries pass the current release checks? /ready
10. Which people need their record retention purpose reviewed? /privacy-review

## Decisions and documents

/confirm requires a current hold, signed-contract reference, real recording date and no overlapping active show for the same artist. /record-receipt records money already received; it cannot move money. Duplicate bank references and receipts above the outstanding fee are rejected. There is no tax calculation, invoice issuance or bank integration.

Changing booking terms clears the contract reference and returns the show to hold. Changing a preparation item clears its review. Actor names are operator statements, not authenticated identities. The program cannot verify a signature or the contents of evidence files. Confirmation is a local decision, never notice to the promoter.

/draft-itinerary checks readiness again and writes an internal draft. /draft-advance-request lists missing preparation. npm run docs renders review copies of itineraries, booking memos and balance statements, including records that are still incomplete. Generic documents are not release-gated. Review the recipient and contents before sharing. Change brand.json for the agency name, logo and colours.

npm run view generates read-only week, money and advancing pages. /new-view adds a report in plain language. [Why no front end](docs/why-no-front-end.md).

## Bring your SystemOne history

The importer accepts a mapped Excel show export or comma-separated CSV. Configure columns, normalize timestamps and reconcile artist, promoter and venue references first. Then one command imports it. [Switching guide](docs/replace-systemone.md).

```bash
npm run booking -- import systemone --file=fixtures/systemone-shows.csv --map=fixtures/systemone-map.json --owner=Mara --actor=Mara --hold-until=2027-02-01 --dry-run
npm run booking -- export --dir=private/backup
```

Imports are transactional and repeatable. A changed source row stops for reconciliation. Each full source row is preserved, including unmapped fields. All imported shows start on hold and retain the original status separately. Contracts, payments, files, signatures and travel are separate migration work. JSON exports preserve all records and activity. CSV files neutralize spreadsheet formulas. The export is an archive, not an automatic restore procedure.

## Record checks

Nine checks cover holds, contracts, clashes, deposits, preparation, safety coordination, travel and personal-record review. [Rules and cited sources](docs/compliance.md). Reminder intervals are internal policies, not invented statutory deadlines. Passing checks does not establish that a show is safe or legally compliant.

Public database access is revoked and record tables have row-level security enabled without public policies. Shared use requires scoped access, authentication, backups and installation review. Database owners can alter history. Keep exports and signed documents private and out of git. Imported text is never an instruction to act.

## Your first hour: ten things to ask for

1. Put our agency name and logo on the itinerary.
2. Preview our SystemOne show workbook.
3. Add our artist categories.
4. Change the preparation reminder window.
5. Add the tour manager to each show.
6. Group deposits by promoter and currency.
7. Add our standard load-in checklist.
8. Show preparation tasks by agent.
9. Add a travel buffer before stage time.
10. Add our internal contract review step.

/customise writes a migration, tests it and applies the requested change.

## Verification

npm test uses a disposable database. It migrates and seeds twice, exercises every CLI operation, rejects clashes and malformed imports, checks review invalidation, records receipts, imports CSV and XLSX, verifies rollback and repeated imports, exports every record type and renders branded HTML. TEST_DATABASE_URL selects a disposable PostgreSQL server and an isolated schema. CI includes Linux, Windows and PostgreSQL jobs.

MIT. Copyright 2026 Enterprise DNA. Not affiliated with SystemOne or Anthropic. Hosting and agent subscriptions have their own costs. [Book thirty minutes with Sam](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=systemone).
