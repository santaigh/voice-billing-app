# Voice Billing

Small-shop billing that runs entirely in the browser — no server, no database.
Products come from an Excel sheet; the cashier will speak a product name, the app shows
its price, and a bill is printed on a 58mm thermal printer. Android Chrome is the target.

**Status:** step 2 of 5 — load `products.xlsx`; bill by typing; print a receipt.
Voice (3), bills list + Excel export (4) and deployment (5) are still to come.

## Billing (step 2)

- **Billing** tab: type part of a product's name, Tamil name, code or alias, tap a result (or press Enter
  for the top one). Adding the same product again adds one to its quantity.
- Quantity and price are editable per line. KG and LTR items accept decimals (0.25); everything else
  needs whole numbers. A bad value is highlighted and **Generate Bill** stays disabled until it is fixed.
- **Generate Bill** saves `{billNo, date, total}` on the device, shows the receipt and opens the print dialog.
  Bill numbers are `YYYYMMDD-001` and restart each day. The number and the saved bill are written in one
  transaction. If saving fails nothing is printed and the cart is kept.
- Line items are **not** stored — only date, bill number and total. Totals are exact (computed in paise).
- The shop name printed on receipts is set on the **Products** tab.
- The receipt shows English product names. It is laid out for a 58mm roll and fills the paper width the
  printer driver provides.

## Run it

Chrome blocks parts of the app on `file://` pages, so serve the folder:

```
python -m http.server 8000
```

then open <http://localhost:8000>. (The microphone later needs `https://` or `localhost`.)

## Product sheet

First sheet of the workbook, header in row 1:

| code | name_en | name_ta | unit | price | aliases |
|---|---|---|---|---|---|
| P001 | Sugar | சர்க்கரை | KG | 48 | sakkarai, chakkarai, cheeni |

- `code`, `name_en`, `price` are required. `name_ta`, `unit` (blank → `PCS`) and `aliases` are optional.
- `aliases` — comma-separated spoken names. These are what make voice matching work.
- A row with a missing field, a non-numeric or zero price, or a repeated `code` is **skipped and
  listed** with its Excel row number; the rest still load. A repeated code keeps the first row.
- A file with no valid rows, or one that is not an Excel sheet, leaves the previous list untouched.
- `sample/products.xlsx` has 103 grocery items with made-up prices (rebuild: `python tools/make_sample.py`).

## Tests

```
node test/catalog.test.js && node test/bill.test.js         # row checks, bill math, search
python -m http.server 8000 &                                # then, with playwright installed:
node test/e2e.js && node test/e2e-billing.js                # headless Chrome
```

`vendor/xlsx.full.min.js` is SheetJS 0.18.5 (Apache-2.0), vendored so the app works offline.
