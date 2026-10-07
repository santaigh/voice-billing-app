# Phone test checklist (Android + Chrome)

The app is published at **https://santaigh.github.io/voice-billing-app/** once GitHub Pages is switched on
(Settings → Pages → Source: **GitHub Actions**). Do these in order; each step says what "good" looks like.
Write down anything that does not match and send it back.

## 1. Install
- [ ] Open the address in **Chrome** on the phone. The page loads with three tabs at the bottom.
- [ ] Chrome menu (⋮) → **Add to Home screen** / **Install app**. An icon appears and the app opens full screen.
- [ ] Turn on airplane mode, close the app, open it again. It still opens (typing, not voice, works offline).

## 2. Products
- [ ] Get an Excel file onto the phone. For a first try, open `…/voice-billing-app/sample/products.xlsx` in Chrome to
      download the 103-item sample. For your own list, send your `products.xlsx` by WhatsApp / Drive / USB.
- [ ] Products tab → **Load products.xlsx** → pick the file. Good: "Loaded N products", Tamil names show correctly.
- [ ] Close and reopen the app. The list is still there.
- [ ] Type your shop name in the Shop name box.

## 3. Billing by typing
- [ ] Billing tab → type "suga" → Sugar appears → tap it. Quantity 1, total correct.
- [ ] Set quantity 0.25 on a KG item, and 0.5 on a packet item (should turn red and block Generate Bill).

## 4. Live voice
- [ ] Tap the mic. Chrome asks for **microphone permission** → Allow. A red **LIVE** bar appears.
- [ ] Say "Maida 2 kg". Good: a row appears by itself — `1 | 42.00 | Maida - மைதா | 2 Kg | 84.00` — with a 7-second Undo.
- [ ] Say 3–4 more items one after another, without touching the phone. Good: rows grow downward and
      **Grand Total** at the bottom adds them up. Note any item that was missed or wrong (what you said vs "Heard").
- [ ] Say an ambiguous word such as "chilli". Good: it asks you to tap, and does not add anything by itself.
- [ ] **Leave it live for 5+ minutes** with some quiet gaps and shop noise. Note: does it keep listening? how often
      does Chrome beep / restart? does the screen stay on? does it add things from background talk?
- [ ] Say "bill confirm". Good: "Saving bill ₹ … in 3…"; say "cancel" and it stops. Say it again and wait: the bill
      is saved and the table clears (no printing yet), with the mic still live for the next customer.
- [ ] Now say "print bill". Good: the print dialog opens for the bill you just confirmed. (The green **Print**
      button does the same if the voice command is missed.)
- [ ] Switch to **தமிழ்** and repeat with the names your customers use. Put the spoken names that matter into the
      `aliases` column and load the sheet again.

## 5. Print
- [ ] Generate Bill. The print screen opens. First try **Save as PDF** and check the receipt is only the bill.
- [ ] Then print to the real 58mm printer. Many Bluetooth printers need the maker's Android print-service app
      installed before they show up in Chrome's print list. Note the printer **model** if it does not appear.
- [ ] Check: nothing is cut off at the right edge, Tamil/₹ print correctly, the paper feeds enough at the end.

## 6. Bills, View / Print and backup
- [ ] Bills tab shows today's bills as a table **SNo | Bill No | Grand Total | Ops**, with the headline
      `DD-MM-YYYY - N bills · ₹ total`.
- [ ] Tap **View** on a bill: the items appear as a table with the Grand Total. Tap **Print** (on the row or in the View) and check the receipt.
- [ ] Tap **Export to Excel (N bills)** (small link under the list). A file lands in **Downloads**. Open it: sheet **Bills** has
      the bill numbers and totals, sheet **Bill items** has every item. Dates read `07-10-2026`.
- [ ] Next day: the Bills tab shows an orange dot and a warning until yesterday's bills are exported.

## 7. Google Sheet
- [ ] Follow `cloud/SETUP.md` (once, ideally on the PC). Products tab → Google Sheet → **Save & test** shows **✓ Connected**
      (note whether it says *normal* or *blind mode*) → **Send all existing bills**.
- [ ] Confirm a bill on the phone. Within a few seconds a row appears in the sheet's **Bills** tab, and the Bills tab in the app says
      `✓ Google Sheet is up to date`.
- [ ] In the sheet, click the **Bill ID**: you land on that bill's rows in **Bill items**; click **↑ Bills** to come back.
- [ ] Turn on **airplane mode**, confirm a bill: billing works as normal and the Bills tab shows `⏳ 1 bill waiting`. Turn it off:
      the bill appears in the sheet by itself, **once**.
- [ ] Note anything odd: a wrong date or number format, a missing row, a duplicate, a message you did not understand.

## 8. Fresh start (only when you want to wipe your test bills)
- [ ] Bills tab → **Delete all bills…**. Read what it says; tap **Export to Excel first** if you want a copy.
- [ ] Leave **Also clear the rows in the Google Sheet** ticked, type `DELETE`, tap **Delete all bills**.
- [ ] Both tabs of the Google Sheet are empty except their headings; the Bills tab says "No bills in this period".
- [ ] Confirm a new bill: it is numbered `…-001` and appears as the first row in the sheet.

## What to send back
Printer model · normal or blind mode · anything cut off or garbled on the receipt · voice misses (said vs heard) · anything confusing.
