# Voice Billing

Small-shop billing that runs entirely in the browser — no server, no database.
Products come from an Excel sheet; the cashier will speak a product name, the app shows
its price, and a bill is printed on a 58mm thermal printer. Android Chrome is the target.

**Status:** built and published with GitHub Pages, ready for a phone test (see
[docs/PHONE-TEST.md](docs/PHONE-TEST.md)). Live hands-free voice billing was added after the five planned steps.

## Google Sheet sync

Every confirmed bill is also written, in the background, into **one Google Sheet in your own Drive folder**:
tab **Bills** (`Sl No · Date · Bill ID · Grand Total`; click a Bill ID to jump to its rows) and tab **Bill items**
(every item of every bill, a Grand Total row per bill, a "↑ Bills" link back).
Set it up once with [cloud/SETUP.md](cloud/SETUP.md) (about 10 minutes), then on each phone/PC: **Products tab → Google Sheet
box → paste the Web app URL and the KEY → Save & test → Send all existing bills**.

- **Billing never waits for Google and never fails because of it.** A bill is saved on the device first and put on a
  "to send" list in the same transaction. The list is emptied whenever Google can be reached: right after the bill, when the
  phone comes back online, when the app is opened, with back-off retries (30 s, 2 min, 10 min, then every 15 min), or with
  **Send now**. A bill sent twice appears once (the script ignores a Bill ID it already has).
- The **Bills tab** shows a status line: `✓ Google Sheet is up to date` · `⏳ 2 bills waiting to send` ·
  `⚠ <what is wrong>` (e.g. the key is wrong — no endless retrying) · plus **Open Google Sheet**.
- **Normal vs blind mode.** Save & test first tries a normal request and reads Google's reply. If the browser refuses to
  let the page read the reply, the app switches to *blind mode* (POST without reading, then confirm with a read-only request
  loaded as a script tag) and tells you. Blind mode works the same, but a refusal shows as a generic "the sheet did not accept
  this bill", and the key travels in the web address of those confirmation requests.
- **Send all existing bills** adds every bill saved on this device (also the ones from before you connected); the sheet skips
  any it already has. Bills saved before items were kept appear on the Bills tab only.
- The URL and the KEY are stored on the device only — never in this repo. Your Drive folder ID is typed into the script by you.
- The app's own **Export to Excel** (two sheets, works offline) stays as a second backup.
- **If the sheet does not take a bill, the app says why.** The script records its last error (Apps Script → **Executions** shows it too)
  and the status line quotes it — in blind mode as `The script reported: …`.

## Delete all bills (fresh start)

Bills tab → small red **Delete all bills…** link. The dialog says how many bills go and where the numbering restarts, offers
**Export to Excel first**, and — when the Google Sheet is connected — a ticked box **Also clear the rows in the Google Sheet**.
The red button stays disabled until you type `DELETE`. The sheet is cleared **first**: if that fails (for example the script is an
older version without `clear`), nothing is deleted anywhere and the dialog says what to do. Deleted: every bill on this device,
the to-send list, the bill-number counters and the "exported" marks. **Kept:** products, shop name, the Google Sheet connection.
Leave the sheet box un-ticked only if you also clear its rows yourself: old rows left in the sheet make a new bill with the same
number look like a duplicate, so it would be skipped and never written. **This cannot be undone.**

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
  Excel file and its file name. Behind the scenes they are kept as sortable `YYYY-MM-DD`.
- **Bill numbers are `DDMMYYYY-NNN`** (`07102026-003`; NNN restarts each day). Bills saved by earlier versions
  (stored as `20261007-003`) are shown in the same style.
- **Bills** tab: type a **From / To** date range as `DD-MM-YYYY` (digits alone are enough — the dashes are added as you
  type; `7/10/2026` also works) or tap the calendar button. Default is today; an empty box means no limit.
  The headline reads `07-10-2026 - 3 bills · ₹ 1,604.00` for one day and `04-10-2026 - 07-10-2026 - 7 bills · ₹ 220.80`
  for a range.
- Bills are listed per day, newest first, as a table **SNo | Bill No | Grand Total | Ops**.
  **View** opens the bill as a read-only table (SNo | Amt | Product name | Qty | T. Amount, Grand Total) with Print and
  Close; **Print** prints that bill's receipt straight away.
- **Each bill is saved with its items** (name, quantity, price, amount) on the phone, which is what makes View and
  Print possible. Bills saved before this was added have no items: View shows only their number, date and total, and
  Print is disabled for them.
- **Export to Excel** is a small link under the list (`Export to Excel (3 bills)`). It downloads
  `bills-07-10-2026.xlsx` (or `bills-04-10-2026_to_07-10-2026.xlsx`) with two sheets: **Bills** (`date · bill_no ·
  total`, the date a real Excel date shown as `07-10-2026`) and **Bill items** (`date · bill_no · sno · product_name ·
  qty · unit · amt · t_amount`, one row per item of every bill; bills without saved items have no rows there).
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
  "Bill 07102026-001 saved … say “print bill”" bar with a **Print** button appears after each confirm (it
  disappears after a minute or once printed; saying "print bill" works as long as the page stays open).
  "Print bill" always means the last confirmed bill; any earlier bill can be reprinted from the Bills tab (View / Print).
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

## Master price list (Google Sheet)

One Google Sheet holds the shop's products and prices; every phone follows it, so nobody has to send or load an Excel file.

- **Set up once:** upload `products.xlsx` to Google Drive and open it with **File -> Save as Google Sheets**. Keep row 1 as
  `code - name_en - name_ta - unit - price - aliases` (the rules are in "Product sheet" below). Then **File -> Share -> Publish to web**,
  pick the **first sheet** (not "Entire document"), change the format to **Comma-separated values (.csv)**, **Publish**, and copy the link.
- **Connect the app:** paste that link as `MASTER_URL` in `js/config.js`, commit and push. The link shows only names and
  prices. Never put the Apps Script KEY or Web app URL in that file: it is public. Leave `MASTER_URL` empty to switch automatic
  updates off (the app is then Excel-file-only, as before).
- **What phones do:** each time the app opens, and when the phone comes back online, it fetches the CSV and replaces the saved
  list. The Products tab says `Prices from the shop list - updated DD-MM-YYYY hh:mm`, has **Refresh now**, and lists any
  skipped rows. Edit prices in the Google Sheet from then on; a change reaches a phone the next time it opens online (Google can
  take a few minutes to publish an edit).
- **A bad reply never wipes the list.** If the phone is offline, the link answers with an error, the reply is a web page
  (the sheet is not published) or has no valid products or a missing column, the last saved list stays and the Products tab says why.
- **Bills are not touched.** Saved bills, and items already in the open bill, keep the names and prices they had.
- **Excel still works** under **Use an Excel file instead**, but while a link is set the shop list replaces a loaded file the
  next time the app opens online, so the app asks you to confirm first.

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
- `sample/products.xlsx` has 103 grocery items with made-up prices (rebuild: `python tools/make_sample.py`). It is only an example to copy
  into your own Google Sheet; the app does not load it by itself.

## Tests

```
node test/catalog.test.js && node test/master.test.js && node test/bill.test.js && node test/voice.test.js && node test/export.test.js && node test/cloud-script.test.js && node test/cloud-preflight.test.js
python -m http.server 8000 &                                # then, with playwright installed:
node test/e2e.js && node test/e2e-billing.js && node test/e2e-voice.js && node test/e2e-bills.js   # headless Chrome (voice uses a fake speech engine)
```

`vendor/` holds SheetJS 0.18.5 and Fuse.js 6.6.2 (both Apache-2.0), vendored so the app works offline.
