# Voice Billing

Small-shop billing that runs entirely in the browser — no server, no database.
Products come from an Excel sheet; the cashier will speak a product name, the app shows
its price, and a bill is printed on a 58mm thermal printer. Android Chrome is the target.

**Status:** step 1 of 5 — load `products.xlsx`, check every row, keep it on the device.
Billing (2), voice (3), bills list + Excel export (4) and deployment (5) are still to come.

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
node test/catalog.test.js                                   # row checks
python -m http.server 8000 &  node test/e2e.js              # headless Chrome (needs playwright)
```

`vendor/xlsx.full.min.js` is SheetJS 0.18.5 (Apache-2.0), vendored so the app works offline.
