# LedgerLens reporting workspace

Independent reporting demonstration by Alexandr Khrustalev, using fictional USD order and refund data.

[Open the working demonstration](https://sandersaxbuilds.github.io/ledgerlens-report-builder/)

## What it does

Import two CSV files to see reconciled revenue totals, monthly movements, searchable exceptions and accepted source records. Only paid orders contribute to revenue. Refunds use their own dates and cannot exceed their associated order. Calculations use integer cents.

The overview, exceptions and accepted-row views use the same report. Changing a source disables export until a new report succeeds. Invalid sources clear the previous result. JSON includes all accepted records and totals. The exception CSV guards text cells against spreadsheet formulas. Tables paginate after 100 records. Printing captures the visible report and current table page, use JSON for the full record export.

## Source format

- Orders require `order_id,order_date,currency,amount,status`, with optional `customer`.
- Refunds require `refund_id,order_id,refund_date,currency,amount`, with optional `reason`.
- Dates use `YYYY-MM-DD`, currency is `USD`, and amounts use nonnegative decimal notation with at most two decimal places.
- Use a header-only refunds file when there are no refunds.
- Each source is limited to 5 MB and 100,000 data rows.

## Run and check

Serve this directory with a static web server, then open `index.html`. There is no dependency installation or build step.

Run `node test-logic.js` for parser and reconciliation checks. Run `node test-second-dataset.js` for application interaction checks using a small simulated DOM. The second check exercises the real application code, but does not verify browser layout or completed browser downloads.

The bundled sample reconciles to USD 7,235 gross, USD 700 refunds and USD 6,535 net. Six orders and two refunds are accepted, with seven exceptions reported.

## Boundaries

Entered files are read in the browser and are not uploaded by this application. The bundled demonstration data is fictional. This is a single-currency reporting example, with no currency conversion, bank connection, cloud storage, tax calculation, accounting certification or production access control.
