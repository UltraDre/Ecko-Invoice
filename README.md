# Ecko Invoice

A minimalist, installable invoice and receipt generator for Nigerian naira (₦). The app is built with vanilla HTML, CSS, and JavaScript and works offline after its first load.

## Features

- Edit company and client details, invoice numbers, dates, notes, and terms.
- Add and remove line items; calculate subtotal, tax, discount, amount paid, and balance due.
- Add a logo and adjust its aspect, scale, and balance-box colour.
- Preview, print, and download invoices as PDFs; mark invoices paid to create receipts.
- Save invoices locally to history; edit, duplicate, rename, or delete them.
- Export and restore JSON backups, with optional Supabase cloud backup.
- Install as a PWA on supported browsers. The app shell, icons, fonts, and PDF generator are cached for offline use.

## Run locally

Service workers require a secure context, so use `localhost` rather than opening `index.html` directly:

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

Then open `http://localhost:4173`. For production, deploy the folder to any static host with HTTPS. No build step or package installation is required.

## Data and cloud backup

Invoices and history are stored in this browser's local storage. Use **Backup → Download Backup** regularly if you need an extra copy; restoring a JSON backup replaces the current local data.

Cloud backup uses the Supabase project configured near the top of `app.js` and expects an `invoice_backups` table with `username`, `access_code`, `data`, and `updated_at` columns. Review and configure Supabase Row Level Security for your own project before enabling it. The browser-side access code is only a basic write guard, not encryption, and a publishable key must never be treated as a secret. Cloud upload and restore need an internet connection; local invoices, history, printing, and PDF downloads continue to work offline.

## PWA notes

The web app manifest is `manifest.webmanifest`; `sw.js` precaches the app shell and serves it when offline. Increment `CACHE_NAME` in `sw.js` when changing cached assets so installed copies receive the update. App data is not stored in the service-worker cache.

Third-party runtime assets are bundled locally under `vendor/` so the editor, icons, and PDF export do not depend on a CDN. Their license notices are included next to the assets.
