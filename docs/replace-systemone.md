# Bring your SystemOne show history

SystemOne documents [Excel exports](https://www.systemonesoftware.com/support-center/articles/exporting-to-excel) and [configurable Excel templates](https://www.systemonesoftware.com/support-center/articles/excel-templates). The template chooses columns and language. There is no universal workbook header set, and the fixture here is synthetic. Sources checked 9 November 2026.

1. In SystemOne, open the show list, remove filters that exclude wanted history, select the date range and export to Excel. Use an export template with a stable show identifier, title, artist, promoter, venue, start, end, currency, fee and source status. Turn off duplicate-row removal if it would collapse distinct shows.
2. Keep the original export privately. Check every sheet and row count. Set a map from the destination keys in fixtures/systemone-map.json to the actual headers. Use explicit ISO timestamps with timezone offsets, such as 2027-02-12T19:00:00+13:00. Excel serial dates do not carry a timezone and are refused. Fees must be plain decimal amounts without thousands separators. Export formula cells as values.
3. Reconcile artists, promoters and venues first using add. Matches accept exact codes or names, then partial ids and names. Ambiguous references stop the whole import. Venue timezones must be IANA names. The supplied demo already has the fixture's three related records.
4. Preview and then import:

```bash
npm run booking -- import systemone --file=fixtures/systemone-shows.csv --map=fixtures/systemone-map.json --owner="Mara" --actor="Mara" --hold-until=2027-02-01 --dry-run
npm run booking -- import systemone --file=fixtures/systemone-shows.csv --map=fixtures/systemone-map.json --owner="Mara" --actor="Mara" --hold-until=2027-02-01
npm run booking -- import systemone --file=private/shows.xlsx --sheet=Shows --map=private/map.json --owner="Mara" --actor="Mara" --hold-until=2027-02-01
```

The final command imports an Excel workbook directly. UTF-8 comma-separated CSV is also accepted. XLS files must first be saved as XLSX or CSV. Column mapping and time normalization happen once per export template; the importer does not infer a date format or a timezone. The dry run rolls back all writes. Any invalid row rolls back the whole file. Repeating the same source rows adds nothing; changed source rows stop for manual reconciliation. Changed local fields are not overwritten by a repeated import.

| Export field | Destination |
|---|---|
| Stable show identifier | Unique booking code, letters/numbers/hyphens/underscores |
| Artist, promoter, venue | Existing records matched by code or name |
| Start and end | Timestamp with explicit offset, displayed in the venue timezone |
| Fee and currency | Integer cents and three-letter currency |
| Original status | source_status, preserved without confirming the booking |
| Other columns | Complete source row retained privately |

All imports start on hold. Reconcile cancelled and completed history separately before using the operational reports. Confirm live shows only after reviewing the contract, dates and possible clashes. Deposits, receipts, signed documents, signature audit trails, task discussions, email, permissions, artist app accounts and travel files are not imported by this show importer. Archive originals and migrate those records separately. A source row is evidence of what was exported, not proof of a signed contract or payment.

Compare show counts and fee totals by currency with the original selection. Check at least one artist, promoter, venue and timestamp from each timezone. Compare upcoming shows, holds and receipts while both systems are available. Do not close the old account until the team has checked its required history and workflows.

```bash
npm run booking -- export --dir=private/backup
```

The export contains all domain records, receipts and activity in JSON plus CSV per record type. JSON is the lossless archive; CSV neutralizes spreadsheet formulas. It is not an automated restore command. Keep backups private and test a restore procedure during setup.
