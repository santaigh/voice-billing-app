/* Settings that belong to the shop, not to a phone. MASTER_URL is the "Publish to web -> CSV" link of the master price
   list (Google Sheet). It only exposes prices. Never put the Apps Script KEY or Web app URL here: this file is public.
   Leave it empty to turn automatic price updates off. */
window.APP_CONFIG = { MASTER_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSp6jEI9Z3yO1GNxBlhn9Tk3u9CQCQwftSLV3PHjH6i0Asfa8I35jrOSECw1WqlERt7-CjOhn8oVTCR/pub?gid=976169911&single=true&output=csv' };
