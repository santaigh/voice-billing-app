# Voice Billing

Small-shop billing that runs entirely in the browser — no server, no database.
Products come from an Excel sheet; the cashier will speak a product name, the app shows
its price, and a bill is printed on a 58mm thermal printer. Android Chrome is the target.

**Status:** built and published with GitHub Pages, ready for a phone test (see
[docs/PHONE-TEST.md](docs/PHONE-TEST.md)). Live hands-free voice billing was added after the five planned steps.

## Publishing

`.github/workflows/pages.yml` runs the unit tests and then publishes the app files (not `test/` or `tools/`) to
GitHub Pages on every push to the default branch. One-time setup, in the GitHub repo: **Settings → Pages →
Build and deployment → Source: GitHub Actions**. The address is `https://<user>.github.io/voice-billing-app/`.
The app's service worker is network-first: online, every load gets the newest files; offline (or on a connection
slower than 3 seconds) it uses the saved copy.

Pages needs an `https://` address, which the microphone also requires. The app uses only relative URLs, so it
works under that sub-path. Only the app and `sample/products.xlsx` are public; your real product sheet and
bills never leave the phone.

If you rename the default branch, keep it in the workflow's `branches:` list (`main` is already there).

## Bills and backup (step 4)

- **Dates are always `DD-MM-YYYY`** (07-10-2026): on the Bills screen, the receipt, the products-loaded time, the
  Excel file and its file name. Behind the scenes they are kept as sortable `YYYY-MM-DD`. Bill numbers keep the
  form `20261007-001` (year-month-day first, so they sort in order).
- **Bills** tab: type a **From / To** date range as `DD-MM-YYYY` (digits alone are enough — the dashes are added as you
  type; `7/10/2026` also works) or tap the calendar button. Default is today; an empty box means no limit. Bills are
  grouped by day, newest first, with each day's count and total and one overall total at the top.
- **Export to Excel** downloads `bills-07-10-2026.xlsx` (or `bills-04-10-2026_to_07-10-2026.xlsx`). Sheet **Bills** has
  exactly `date · bill_no · total`, with the date a real Excel date shown as `07-10-2026`; sheet **Daily totals** has per-day counts and totals and a grand total.
- Bills live only in this browser's storage, so **clearing Chrome's site data deletes them**. Any earlier
  day with bills not yet exported shows a warning, an orange dot on the Bills tab, and an **Export them**
  button. Today never nags. "Exported" means the file was handed to the browser's downloads — the app
  cannot see whether the download was kept, so check the Downloads folder.
- Bill numbers keep a separate counter per day, so a phone clock that jumps back cannot reuse a number.

## Live voice billing

Tap the **mic once** and it keeps listening — it does not stop after each phrase. It stops only when you tap the
mic again (or on a fatal error such as a blocked microphone). Chrome ends listening sessions by itself now and
then; the app restarts it quietly, keeps the screen awake while live, and gives up with a message only if the
microphone keeps cutting out. On Android each restart may play Chrome's small listening beep.

- **Say a product and it is added**, e.g. *"Maida 2 kg"* → a row `1 | 42.00 | Maida - மைதா | 2 Kg | 84.00 | 🗑`.
  The bill grows downward; **Grand Total** (the sum of all T. Amounts) is pinned at the bottom. Tap an Amt or Qty
  to correct it; the bin icon deletes a row. Saying the same product again adds to its row.
- **Added only when it is clear.** A phrase is added on its own only if exactly one product *is* what you said
  (its name, Tamil name, code or an alias, spelling variants included — *chakkarai* = *sakkarai*), or, failing
  that, exactly one product starts with it. Anything ambiguous (*"chilli"*, *"powder"*), only fuzzy, or whose unit
  does not fit (*"2 kg maggi"*, a packet item) shows up to 3 suggestions to **tap** instead, and listening
  continues. Background talk that matches nothing is ignored.
  **An alias that is a generic word (*oil*, *rice*) makes that product the automatic choice** — give such
  aliases only to your default item.
- **Undo:** every voice add shows *"Added Maida · 2 Kg — Undo"* for 7 seconds.
- **Numbers Chrome mishears:** *"maida to kg"* / *"too kg"* is read as 2 kg and *"for kg"* as 4 kg (only right
  before a unit). Also understood: digits, English number words (one…ten, half, quarter, "one and a half",
  "three quarter"), Tamil in English letters (onnu, rendu, arai, kaal, mukkaal, onnara…) and Tamil script;
  units kg / gram / litre / ml / packet / piece (500 gram of a KG item becomes 0.5).
- **"Bill confirm"** (both words — *"confirm"* alone does nothing) starts a **3-second countdown**
  ("Saving bill ₹ 132.00 in 3…"). Say **"cancel"**, tap **Cancel**, or change the bill (add, edit, delete) and it
  is cancelled. Otherwise the bill is **saved and closed**, the table is cleared and the mic stays live for the next
  customer. It does **not** print by itself. **Generate Bill** does the same immediately, without the countdown.
- **"Print bill"** (both words) prints the **last confirmed bill** — never the one still being built. A small green
  "Bill 20261007-001 saved … say “print bill”" bar with a **Print** button appears after each confirm (it
  disappears after a minute or once printed; saying "print bill" works as long as the page stays open).
  Only the most recent confirmed bill can be printed: lines are not stored, so confirm the next bill *before*
  printing the previous one and the previous receipt is gone.
- While the receipt screen is open, speech is ignored; it closes when the print dialog closes (or tap **New bill**).
- **EN / தமிழ்** picks the speech language (not changeable while live).
- Speech recognition is the browser's own (Chrome sends audio to Google's service), so it **needs internet** and
  microphone permission. While live it hears everything said near the phone. Typing always works offline.

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
