# Private Planner access

Only the verified Google identity for `moritz.knoedler@gmail.com` can initialize access. Its permanent Google subject is then pinned in `planner_owner`; matching an email alone cannot replace an existing subject.

## Architecture

- `/about`, `/privacy` and `/login` are public. The root server component verifies the session before rendering Planner. Client checks on return/focus and every minute detect revocation; private UI is hidden while returning from a backgrounded page.
- Browser business requests use `/api/backend/*`. Next.js route handlers forward a server-only gateway credential plus the device session to FastAPI. Arbitrary headers, cookies, redirects and internal auth routes are not forwarded.
- FastAPI rejects all requests without the gateway credential and a valid device session, except minimal health, the state-validated Google callback, internal login start/exchange (gateway only), and two automation POSTs authenticated with their existing automation secret.
- Production cookies use `__Host-`, Secure, HttpOnly, SameSite=Lax and Path=/, without a Domain attribute. CSRF defenses require the canonical Origin for mutations and disallow cross-site requests. Session values never enter URLs or browser localStorage.
- Sessions are random 384-bit values; only SHA-256 hashes are stored. Idle expiry is 30 days; absolute expiry is 90 days. Activity refreshes last-seen at most every five minutes without extending absolute expiry. Logout revokes the device or all owner sessions server-side.
- Login uses the existing registered backend Google callback, with separate identity-only scopes. Google's library handles code exchange/PKCE and verifies the signed ID token, audience, issuer and expiry. The app additionally checks nonce, verified owner email and pinned subject. Database-backed OAuth attempts expire after ten minutes and are single use. The callback issues a single-use 60-second grant bound to a browser-held verifier; only the gateway can exchange it for a session.
- Existing Calendar/Gmail tokens remain separate. Calendar reconnection starts behind private access, with state bound to the initiating session and a ten-minute expiry. A Calendar 401 is not treated as a Planner session failure.
- Sign-out first syncs pending notes. A failed sync keeps the session and local notes. Successful sign-out clears private local persistence and fully navigates away. Ordinary session expiry preserves unsynced local data for recovery after signing in. This is not encryption of the device's browser storage.

## Configuration

Vercel Production requires `PLANNER_GATEWAY_SECRET` as a secret. FastAPI requires the same value in `AUTH_GATEWAY_SECRET`; missing/empty values always deny access. Never use a `NEXT_PUBLIC_` variable for this credential. The automation `API_SECRET` is separate and cannot unlock other endpoints.

Optional server-only variables: `PLANNER_BACKEND_URL` (defaults to existing API origin) and `PLANNER_APP_ORIGIN` (defaults to existing production Vercel origin; development defaults to local port 3107). On the backend, `FRONTEND_URL` must match the canonical app origin, `AUTH_OWNER_EMAIL` defaults to the allowed address, and existing Google OAuth client/secret/redirect values remain required. A future domain change must update both canonical origins. Preview deployments deliberately receive no production gateway secret and fail closed.

No Google Cloud redirect change is needed: identity login reuses the existing registered `/auth/google/callback`. This release does not change Google's Testing/Production publishing status or fix the separate Calendar token expiry policy.

## Verification

Run backend unit tests with all pinned requirements installed. Authentication tests cover every private route/method, missing/invalid credentials, idle/absolute/revoked sessions, device/all-device logout, owner restrictions, PKCE/nonce, callback rejection, browser-bound single-use grants and automation isolation. Run TypeScript, changed-file ESLint and a production build. The isolated browser flow covers anonymous/direct API denial, CSRF, hidden cached content, HttpOnly persistent sessions across reopening, desktop/mobile controls, panel geometry, pending notes and revocation.

The real login form also has a Chromium/WebKit regression test in `tests/login-browser.test.cjs`. Run it with `PLANNER_TEST_ORIGIN` set to the configured app origin and `PLANNER_PLAYWRIGHT_MODULE` pointing to an installed Playwright module. It intercepts only the external Google page; the actual form submission, origin validation, redirect and cookie are exercised. Keep the document Referrer-Policy at `same-origin`: `no-referrer` makes native form POSTs send `Origin: null`, which must remain rejected by the CSRF check.

After rollout, verify production root redirects to login, direct API and anonymous gateway calls return 401, public pages return 200, and production sign-in start redirects to Google's existing callback with identity scopes. The owner must complete the real Google sign-in once per device; do not create a test bypass or seed an owner session on production.

## Recovery

Before rollout, save a private database dump and existing image metadata. The migration only adds four auth tables and does not modify tasks/calendar data. Do not restore a whole database to roll back application code or drop auth tables, which would remove the subject pin and revocations.

**Never deploy the pre-authentication backend as rollback while it is publicly reachable.** Keep the protected backend running when reverting frontend changes. If no known-good protected backend exists, stop the backend until a corrected protected build is ready; return service-unavailable instead of reopening data access. Old frontend deployments cannot bypass the protected backend. Save the first working protected backend image as a separate rollback tag after verification.

Backups under `/opt/planner-api/backups/planner-private-20261024` are private and excluded from Git on the server. They are disaster-recovery assets, not instructions to reopen the old service.
