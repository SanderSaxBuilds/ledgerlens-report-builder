# LedgerLens Report Builder

LedgerLens is a working portfolio case study for a bounded repeatable-report-builder service. It imports two CSV files, validates the records, calculates five business metrics, produces an exception log, and exports a reusable report.

The demo uses fictional order and refund data. It is not client work.

## Included workflow

- Import orders.csv and refunds.csv
- Validate required fields and numeric values
- Detect duplicate order IDs, impossible calendar dates, unsupported currencies, unmatched refunds, and cumulative refunds above the matching order total
- Calculate gross revenue, net revenue, order count, average order value, and refund rate
- Filter the exception log by severity
- Export a JSON report or CSV exception log
- Print or save the dashboard as PDF

Run `node test-logic.js` and `node test-second-dataset.js` to check the sample and an independent validation dataset.

## Live demo

https://sandersaxbuilds.github.io/ledgerlens-report-builder/

## Commercial boundary

A real engagement would replace the demo schemas with the buyer's two source exports, confirm five metric definitions against known totals, document refresh steps, and include two revision rounds. Hosting, private-system access, and ongoing data operations require separate written scope.
