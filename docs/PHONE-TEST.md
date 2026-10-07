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
      is saved, the print dialog opens, and after printing you are back on an empty bill with the mic still live.
- [ ] Switch to **தமிழ்** and repeat with the names your customers use. Put the spoken names that matter into the
      `aliases` column and load the sheet again.

## 5. Print
- [ ] Generate Bill. The print screen opens. First try **Save as PDF** and check the receipt is only the bill.
- [ ] Then print to the real 58mm printer. Many Bluetooth printers need the maker's Android print-service app
      installed before they show up in Chrome's print list. Note the printer **model** if it does not appear.
- [ ] Check: nothing is cut off at the right edge, Tamil/₹ print correctly, the paper feeds enough at the end.

## 6. Bills and backup
- [ ] Bills tab shows today's bills with a total. **Export to Excel** → a file lands in **Downloads**. Open it.
- [ ] Next day: the Bills tab shows an orange dot and a warning until yesterday's bills are exported.

## What to send back
Printer model · anything cut off or garbled on the receipt · voice misses (said vs heard) · anything confusing.
