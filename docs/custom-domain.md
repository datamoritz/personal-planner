# Planner custom domain

Canonical app address: `https://planner.moritzknodler.com`.

Cloudflare holds one new record: CNAME `planner` → `44da4cc9ec271e59.vercel-dns-017.com`, DNS only, TTL Auto. The 21 existing records were compared before and after and were unchanged. Nameservers remain with Cloudflare. Vercel project `personal-planner` owns the hostname and serves HTTPS.

Vercel Production uses server-only `PLANNER_APP_ORIGIN=https://planner.moritzknodler.com`. Backend Compose passes `FRONTEND_URL` from its private environment; set it to the same origin. The backend API and registered Google callback remain at `planner-api.moritzknodler.com`, so no Google OAuth client redirect change is needed. Existing Calendar/Gmail tokens, owner identity and device session records are preserved. Host-only cookies require a new login on the new hostname.

The previous public address `personal-planner-sooty.vercel.app` redirects through Vercel's project-domain configuration to `planner.moritzknodler.com` with status 307, preserving paths and queries. This temporary redirect can be removed without browsers retaining a permanent migration. Only enable it after HTTPS and the new login handshake pass verification.

## Recovery

Private server configuration and image metadata from immediately before the switch are retained under `/opt/planner-api/backups/planner-domain-20261024`; the Vercel domain configuration is also saved there. To revert the hostname, first remove the old-address redirect, restore Vercel's previous `PLANNER_APP_ORIGIN` setting (previously unset, using the original Vercel fallback), restore the backend `FRONTEND_URL` environment and restart only the protected backend, then redeploy the frontend. Leave authentication enabled and preserve the database. The new CNAME can remain as an unused alias during recovery.

## Google branding

Use `https://planner.moritzknodler.com/about` as the public application homepage and `https://planner.moritzknodler.com/privacy` as the privacy-policy URL, with authorized domain `moritzknodler.com`. These are separate Google Auth Platform branding settings. Connecting DNS does not change Google's Testing/Production status, verification status, or Calendar reconnection policy. Do not claim those settings are updated without checking the console.
