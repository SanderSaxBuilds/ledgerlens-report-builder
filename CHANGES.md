# LedgerLens changes, 19 October 2026

Before the change, both existing test files passed: `test-logic.js` printed `result: passed` and `test-second-dataset.js` printed `status: PASS` with 11 checks.

## Bugs found and fixed

Each logic bug has a test in `test-regressions.js`, and each app bug has a check in `test-second-dataset.js`. The tests were run against the old code first and failed, then passed after the fix. The one exception is the column test for item 4, which I added after that first run. The defect itself showed in the old code's error output.

Parser and report, `logic.js`:

1. A space before a quoted field, as in `O1, "Brennan, Ruth"`, rejected the whole file. Test: `parser accepts a space before a quoted field`.
2. A space after a closing quote rejected the whole file. Test: `parser accepts a space after a closing quote`.
3. A whitespace-only line, often left at the end of a hand-edited export, rejected the whole file. Test: `parser ignores a whitespace-only line instead of rejecting the file`.
4. Parser errors reported the character offset in the file as the column, for example column 57 for a quote at column 5. Test: `parser error columns count from the start of the line, not the file`.
5. Headers were checked for duplicates without regard to case, but required headers had to be lowercase, so `Order_ID` was reported missing. Records now use lowercase keys. Test: `required headers match regardless of letter case`.
6. Months with no accepted activity were left out of `byMonth`, so the trend skipped months and month-over-month change compared months that were not next to each other. Test: `monthly trend includes empty months between the first and last month`.
7. A EUR refund on a USD order was reported twice, as unsupported currency and as currency mismatch, which inflated the exception count. Test: `a wrong-currency refund is reported once, not twice`.
8. `averageOrderValue` in the JSON export carried fractional cents, such as 1205.8333333333333. It is now rounded to whole cents. Test: `average order value is rounded to whole cents`.
9. A refund for an order that exists but was excluded, for example a cancelled order, was reported as "No valid order matches", the same as a mistyped ID. It now has its own code, `REFUND_FOR_EXCLUDED_ORDER`, as a warning. Test: `a refund for an excluded order explains that the order was excluded`.

App, `app.js`:

10. Loading your own orders file while the refunds were still the bundled sample produced a report that mixed your orders with fictional refunds, with no warning. The build now stops and asks for the matching file. Check: `own orders file is not mixed with sample refunds`.
11. The file input kept its value, so choosing the same file again after editing it did nothing and the old text stayed in use. Check: `re-selecting the same file triggers a fresh read`.
12. Pagination rebuilt its buttons on every page, so keyboard focus was lost after Next or Previous. The buttons now persist, and focus moves to the other button when one becomes disabled. Check: `pagination keeps its buttons and focus between pages`.

Found during the browser check and fixed without a separate unit test, because the DOM simulation has no layout:

13. The chart was drawn while the report was still hidden, so it measured 0 px, fell back to 720 px and scaled. Text was tiny on phones and oversized on desktop. The report is now shown first, and the chart is redrawn when its tab is shown again.

Checked and found correct: CRLF, BOM, trailing newline, duplicate IDs, cumulative over-refunds, negative and blank amounts, impossible dates such as 2026-02-30 and leap years, month boundaries, integer-cent sums, search, severity filter, stale export guard and formula guarding in the CSV export.

## Design changes

- New masthead in deep green with the product promise, "Revenue you can trace back to the row.", one line on what it does and a line naming the data being shown.
- The import area is a card in the masthead with drop zones that also accept drag and drop, Build report and Use sample data buttons, and a column guide with sample downloads. On phones it collapses to a one-line summary with a Change files button after a successful report.
- KPI row: net revenue leads, then gross sales, refunds with refund share, paid orders and average order. Each shows the change from August to September, colored by whether the change is good or bad.
- Monthly trend chart in inline SVG: gross sales bars above the baseline, refunds below it and net revenue as a line, with labelled axes, light gridlines, an end label, hover and tap tooltips, arrow-key navigation, a live text readout and the full table underneath with a net change column. The chart is replaced by a short note when there is less than two months of data. The colors passed the palette validator for lightness, chroma and color-blind separation.
- Exceptions view: one card per problem with a count, a Needs a fix or Check label, what happened, how to fix it and the affected IDs. Show these rows filters the full exception table, which still has severity filters, search and pagination.
- Accepted rows view now shows the items column when present.
- Tabs follow the ARIA tab pattern with arrow keys and roving focus.
- Removed the full-width demo banner. The footer reads "Sample data is fictional. Files you load stay in your browser." and keeps the author credit.
- Inter Tight, Inter and JetBrains Mono from Google Fonts with system fallbacks, the shared palette, 14 px cards, 10 px buttons, tabular figures in tables, 44 px or larger tap targets, visible focus rings and reduced-motion support.
- Print shows all three views, and adds a warning if the report is out of date.
- Copy rewritten to the voice guide. Exception messages now name the record and the bad value, such as `Order SCS-10126 has the date "2026-02-30"`.

## Data changes

- `tools/make-sample.mjs` generates the sample from seed 20261019. `--check` confirms the files on disk match.
- Saltmarsh Coffee Supply, a fictional coffee gear shop, October 2025 to September 2026: 308 orders plus one duplicate row, a December peak and quiet January and February, three wholesale cafés and a pool of returning customers, 15 pending or cancelled orders, 23 refunds with reasons and 12 planted problems.
- Totals: $32,663.05 gross, $1,278.90 refunded, $31,384.15 net, 288 orders and 23 refunds accepted, 27 exceptions.
- `test-logic.js` no longer copies totals from the app. It compares the report, month by month and code by code, with ground truth the generator computes from its own model. A short pin of the headline figures keeps the README honest.

## Verification

- `node test-logic.js`: passed.
- `node test-regressions.js`: 9 of 9 passed.
- `node test-second-dataset.js`: 20 of 20 passed.
- `node tools/make-sample.mjs --check`: files match.
- Headless Brave at 320, 390, 768, 1024 and 1440 px: scroll width equals client width at every size. Wide tables scroll inside labelled regions. No interactive element under 44 px at 390 or 1440. Tab order runs skip link, brand, import controls, the selected tab, chart, table region and exports, all with focus rings. The chart tooltip stays inside the viewport and the live region reads the month.
- Screenshots are in `WORK/CURRENT/portfolio-quality-20261019/shots/ledgerlens/`.

## Left open

- Tap and drag-and-drop were not tested on a real phone. Touch was checked in headless Brave with a phone viewport only.
- Contrast was checked by design tokens and the palette validator, not with a full automated audit. The light series colors fall below 3:1 against white, so values are also given in the tooltip and the table.
- Print was checked with print-media emulation, not on paper.
- Breaking change for anyone reading the JSON: record keys are now lowercase, issues have a `ref` field, `averageOrderValue` is rounded to cents and wrong-currency refunds no longer also produce `CURRENCY_MISMATCH`. The exceptions CSV columns are unchanged.
- A duplicated full refund would still be reported as both a duplicate and an over-refund. The sample avoids this case and I left it as is.
- The live demo link in the README points at the published site, which still runs the old version until the lead publishes.

## Restyle, 19 October 2026

LedgerLens now has its own look instead of the shared green and amber portfolio theme: an accounting ledger in paper and navy ink. Source Serif 4 for headings, Source Sans 3 for text and Source Code Pro for every figure. Ruled lines and a red double margin rule in the header, square corners, borders instead of shadows, index tabs, a totals strip with the net figure double underlined, ruled tables with red money-column rules, and chart series in slate blue, refund red and navy. Only `style.css` and the font link and brand mark in `index.html` changed. No behaviour, IDs or ARIA changed. The gross bar colour now has 3.75:1 contrast against the panel. All three test files and the sample check still pass.

## Report builder, 24 October 2026

LedgerLens was a fixed twelve-month report. It is now a report builder for any period and any grouping, and exceptions can be fixed where they are listed.

Features:

- Period. Pick the first and last month, drag across the chart, or focus the chart and use Shift and the arrow keys. Enter picks one month. Months outside the period stay on the chart, dimmed, so the period is always seen in context. The KPI row compares the period with the one before it when the data reaches that far, and otherwise the last month with the one before.
- Grouping. Month, quarter, customer, product and order size. Customer, product and size views draw ranked bars, ranked by net, gross, refunds or paid orders. Product rows overlap because an order can hold several products, so the table total says it counts each order once. Month and quarter views can show bars or a running total.
- Rows. Every bar and every table row opens the accepted rows behind it, with a search box and a line that totals what is shown.
- Fix in place. Each exception has a Fix button. The dialog shows the row, flags the field at fault and checks the row live as you type. Save rebuilds the report, Remove drops the row, and both can be undone. After a fix, the corrected orders or refunds file can be downloaded with the original columns.
- Import. Drop files anywhere on the page, or paste the CSV text. The header row decides whether text is orders or refunds, and a file dropped on the wrong slot is moved to the right one.
- Views. Undo and redo for every change, seven ready-made views, views saved in this browser, and a link that reopens the same view. Local storage is optional and the page works without it.
- Export. This view as CSV, guarded against spreadsheet formulas, next to the existing JSON, exceptions CSV and print.
- Keyboard. Number keys switch tabs, letters set the grouping, brackets move the period, Ctrl+Z and Ctrl+Shift+Z undo and redo, and ? lists every shortcut.

Design: removed the ruled-line pattern behind the masthead and the red square marker, added a sticky builder bar on wide screens, segmented controls, a toast with Undo, and a drop overlay. Reduced motion turns off the count-up and the bar animation. Print hides the builder and the Fix controls.

Bugs fixed on the way: the favicon request returned 404, and visually hidden labels inside the new table headers widened the page on phones until the table scroller became their positioning box.

Verification:

- `node test-logic.js`: passed, with new checks that every grouping reconciles to the headline figures, product overlap, quarter labels, size bands, period filtering, the view CSV, the corrected-file round trip and header detection.
- `node test-regressions.js`: 9 of 9 passed.
- `node test-second-dataset.js`: 26 of 26 passed, 6 of them new.
- `node tools/make-sample.mjs --check`: files match.
- Headless Edge with real mouse and keyboard input at 320, 360, 390, 768, 1024, 1280, 1440, 1920 and 2560 px wide: dragging a period, undo and redo, every shortcut, drilling into rows, fixing and removing a row, saving and reopening a view, the share link, pasting, print media and reduced motion. No horizontal overflow and no page errors.
- Not tested: a real drag from the file manager, the system clipboard outside headless Edge, and finished downloads.