# Voice Billing

Small-shop billing that runs entirely in the browser — no server, no database.
Products come from an Excel sheet; the cashier will speak a product name, the app shows
its price, and a bill is printed on a 58mm thermal printer. Android Chrome is the target.

**Status:** step 5 of 5 — everything is built; it is published with GitHub Pages and ready for a phone test
(see [docs/PHONE-TEST.md](docs/PHONE-TEST.md)).

## Publishing

`.github/workflows/pages.yml` runs the unit tests and then publishes the app files (not `test/` or `tools/`) to
GitHub Pages on every push to the default branch. One-time setup, in the GitHub repo: **Settings → Pages →
Build and deployment → Source: GitHub Actions**. The address is `https://<user>.github.io/voice-billing-app/`.
Pages needs an `https://` address, which the microphone also requires. The app uses only relative URLs, so it
works under that sub-path. Only the app and `sample/products.xlsx` are public; your real product sheet and
bills never leave the phone.

If you rename the default branch, keep it in the workflow's `branches:` list (`main` is already there).

## Bills and backup (step 4)

- **Bills** tab: pick a **From / To** date range (default today; an empty box means no limit). Bills are
  grouped by day, newest first, with each day's count and total and one overall total at the top.
- **Export to Excel** downloads `bills-YYYY-MM-DD.xlsx` (or `bills-FROM_to_TO.xlsx`). Sheet **Bills** has
  exactly `date · bill_no · total`; sheet **Daily totals** has per-day counts and totals and a grand total.
- Bills live only in this browser's storage, so **clearing Chrome's site data deletes them**. Any earlier
  day with bills not yet exported shows a warning, an orange dot on the Bills tab, and an **Export them**
  button. Today never nags. "Exported" means the file was handed to the browser's downloads — the app
  cannot see whether the download was kept, so check the Downloads folder.
- Bill numbers keep a separate counter per day, so a phone clock that jumps back cannot reuse a number.

## Voice (step 3)

- Tap the **mic**, say e.g. *"two kg sugar"*, *"rendu kilo sakkarai"*, *"அரை கிலோ தக்காளி"*. The app shows what it
  heard and up to **3 suggested products** with the quantity it understood. **Nothing is added until the
  cashier taps one.** "See all matches" falls back to the typed list.
- **EN / தமிழ்** button switches the speech language (English-India / Tamil-India) and is remembered.
- Understands digits and number words — English (one…ten, half, quarter, "one and a half", "three quarter")
  and Tamil in English letters (onnu, rendu, moonu, arai, kaal, mukkaal, onnara…) or Tamil script — plus units
  kg / gram / litre / ml / packet / piece. 500 gram of a KG item becomes 0.5.
- If the unit said does not fit how the product is sold (*"2 kg maggi"*, a packet item) the quantity is
  set to **1** with a warning, never carried over.
- Matching: exact / starts-with / word matches first, then fuzzy (Fuse.js) with common spelling variants of
  Tamil-in-English folded together (sakkarai = chakkarai = sakarai, thengai = tengai). **Put the spoken names
  your shop uses in the `aliases` column** — that is what improves matching most.
- Speech recognition is the browser's own (Chrome sends audio to Google's service), so it **needs internet**
  and microphone permission. Typing always works offline. No other AI is involved.

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
node test/catalog.test.js && node test/bill.test.js && node test/voice.test.js && node test/export.test.js
python -m http.server 8000 &                                # then, with playwright installed:
node test/e2e.js && node test/e2e-billing.js && node test/e2e-voice.js && node test/e2e-bills.js   # headless Chrome (voice uses a fake speech engine)
```

`vendor/` holds SheetJS 0.18.5 and Fuse.js 6.6.2 (both Apache-2.0), vendored so the app works offline.
