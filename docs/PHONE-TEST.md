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

## 4. Voice
- [ ] Tap the mic. Chrome asks for **microphone permission** → Allow.
- [ ] Say "two kg sugar". Good: it shows what it heard and suggests Sugar with 2 KG. Tap to add.
- [ ] Switch to **தமிழ்** and say a product the way your customers do (try 5 items, in a normal shop noise level).
- [ ] Note every item it got wrong: what you said, what it heard (shown on screen). Put the spoken names that
      matter into the `aliases` column of the sheet and load the sheet again.

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
