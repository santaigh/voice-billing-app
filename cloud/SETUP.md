# Google Sheet setup (one time, about 10 minutes — best done on the PC)

This creates **one Google Sheet, "Shop Billing", inside your Drive folder**, and a small Google script that writes every
confirmed bill into it:

| Tab | Columns |
|---|---|
| **Bills** | `Sl No · Date · Bill ID · Grand Total` — click a **Bill ID** to jump to that bill's items |
| **Bill items** | `Bill ID · SNo · Amt · Product name · Qty · T. Amount · Back` — every item of every bill, with a Grand Total row per bill and a **↑ Bills** link back |

> The app side (sending each bill automatically) is the next build step. This guide gets the sheet and the script ready,
> and lets you check that they work, before that.

## 1. Find your folder's ID
Open the Drive folder in the browser. Its address looks like
`https://drive.google.com/drive/folders/`**`<THE-FOLDER-ID>`** — the folder ID is the last part.
Do **not** put it in GitHub or share it publicly; it only goes into the script in step 2.

## 2. Create the script
1. Go to **<https://script.google.com>** (signed in to the Google account that owns the folder) → **New project**.
2. Rename the project to **Shop Billing Sync** (top left).
3. Delete the sample code, open `cloud/Code.gs` from this repo, copy **all** of it and paste it into the editor.
4. Near the top, replace `PASTE_FOLDER_ID_HERE` with your folder ID (keep the quotes). Click **Save** (💾).

## 3. Run `setup` once — this creates the file in your folder
1. In the toolbar's function dropdown pick **`setup`**, then click **Run**.
2. Google asks for permission ("Authorization required") → **Review permissions** → choose your account.
   Because it is your own new script, Google says **"Google hasn't verified this app"** → **Advanced →
   Go to Shop Billing Sync (unsafe) → Allow**.
   It asks for **Google Drive and Google Sheets access**. That is needed to create the sheet in your folder and to write to it.
   The script only touches the "Shop Billing" sheet; you are the only one who can run it.
3. When the run finishes, open **Execution log** (bottom of the editor). You will see two lines:
   - `SHEET ADDRESS: https://docs.google.com/spreadsheets/d/…` — open it: this is your sheet.
   - `KEY (paste into the app): …` — a long random password. **Copy it somewhere safe.** You can read it again any time by
     running `setup` again (it never creates a second sheet or changes the key).
4. Check your Drive folder: **"Shop Billing"** is there, with tabs **Bills** and **Bill items** and their headings.

## 4. Deploy it as a web address
1. Top right: **Deploy → New deployment**. Click the gear next to "Select type" → **Web app**.
2. **Execute as: Me** · **Who has access: Anyone** → **Deploy** (authorize again if asked).
3. Copy the **Web app URL** (it ends in `/exec`).
4. **Check it:** paste the URL into a new browser tab. You should see `{"ok":true,"service":"shop-billing-sync"}`.
   That only proves it is deployed; it shows none of your data.

## 5. Keep these two things private
- the **Web app URL** and the **KEY**. "Anyone" access is what lets the app post bills without a Google login, so the long
  KEY is the lock. Without the right KEY every request is refused. Anyone holding **both** could add rows to your sheet
  (they still could not read it). If they leak, run a fresh deployment and change the key (see below).

## 6. Put them in the app (next build step)
Products tab → **Google Sheet** box → paste the URL and the KEY → **Save & test** → **Send all existing bills**.
Do the same on every phone or PC that bills — they all write into the same sheet.

## Troubleshooting
| You see | Do this |
|---|---|
| `Put your Drive folder ID in FOLDER_ID…` | Step 2.4 — replace the placeholder, Save, run `setup` again |
| `Folder not found` / `No item with the given ID` | The folder ID is wrong, or you are signed in to a different Google account |
| Authorization screen keeps appearing | Finish **Advanced → Go to … (unsafe) → Allow** |
| Opening the URL shows a Google sign-in / "page not found" | In **Deploy → Manage deployments**, edit the deployment: *Execute as* **Me**, *Who has access* **Anyone** |
| You changed the script and nothing changed | **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy** (the URL stays the same) |
| Wrong or leaked KEY | Project Settings (⚙) → **Script properties** → delete `KEY` → run `setup` (a new key is printed), then paste it into the app on every device |

## What the script refuses
A request without the right KEY; a bill whose Bill ID does not match its date; a negative total or quantity; malformed
data. A Bill ID that is already in the sheet is **ignored** (so a bill sent twice appears once). Product names that start
with `=`, `+`, `-` or `@` are stored as plain text, never run as formulas.

## Note about Excel
The clickable Bill ID → items jump is a Google Sheets feature. If you download the sheet as `.xlsx` and open it in Excel, the
Bill ID shows as text and the links may not jump; the app's own **Export to Excel** (two sheets) still works for that.
