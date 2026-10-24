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

Sign-up and login use the existing Supabase `users` table with `Username` and `Access_Code` text columns (lowercase `username` / `access_code` is also recognized). New passwords are stored as salted PBKDF2-SHA-256 verifiers in `Access_Code`; a legacy plain-text value is upgraded after a successful login when the table permits updates. Usernames scope each account's local invoice data. Use **Download backup** regularly; restoring a JSON backup replaces that account's local data.

Cloud invoice backup uses the Supabase project configured near the top of `app.js` and expects an `invoice_backups` table with `username`, `access_code`, `data`, and `updated_at` columns. New cloud backups store the account's PBKDF2 verifier in `access_code`; legacy plain access codes are upgraded when the account owner syncs successfully. Sign-up/login and cloud sync need an internet connection; local invoices, history, printing, and PDF downloads remain available offline during a saved session.

**Security:** This is a static browser app using a publishable Supabase key. Client-side password hashing protects against storing new passwords in plain text, but it is not a substitute for server-side authentication. Configure strict Row Level Security and do not expose unrestricted `SELECT` access to `users`; for sensitive production data, move credential verification and authorization into a server-side RPC/Edge Function or Supabase Auth. A publishable key must never be treated as a secret.

## PWA notes

The web app manifest is `manifest.webmanifest`; `sw.js` precaches the app shell and serves it when offline. Increment `CACHE_NAME` in `sw.js` when changing cached assets so installed copies receive the update. App data is not stored in the service-worker cache.

Third-party runtime assets are bundled locally under `vendor/` so the editor, icons, and PDF export do not depend on a CDN. Their license notices are included next to the assets.
