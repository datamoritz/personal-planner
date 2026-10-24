# Google access and reconnect review

Reviewed October 24, 2026. Analysis only: no Google authorization code, credentials, or Cloud settings changed.

## Findings

- The app already requests offline access and stores its Google refresh token in the database. Reopening the browser or restarting the backend should not inherently require reconnecting.
- A roughly weekly failure is consistent with Google's seven-day refresh-token expiry for external OAuth applications in **Testing**. The app requests Calendar and Gmail scopes, so the basic-profile exception does not apply. The actual publishing status has not been inspected; this is a hypothesis to verify, not a confirmed configuration issue.
- The frontend's `lib/useGoogleCalendar.ts` marks every non-success response and every network failure as `googleNeedsReconnect`. Temporary outages, rate limits, and unrelated server errors can therefore look like expired authorization.
- The backend's `backend/app/routers/google.py` handles every `RefreshError` as a permanent reconnect requirement. It also reloads access tokens without their expiration timestamp; explicit proactive refresh and persistence of refreshed credentials need review. The Google client library can still attempt refresh after an API authentication failure, so missing expiry alone does not prove why access is lost.
- Calendar and Gmail share one authorization grant. Google documents that changing a password can invalidate refresh tokens containing Gmail scopes. Reconnecting always requests consent again; this is appropriate for recovery but not a remedy for a temporary calendar fetch failure.

## Options

| Option | Benefit | Limits / effort |
| --- | --- | --- |
| Check **Google Auth Platform → Audience**; if Testing, move to **In production** and authorize once afterward | Addresses the possible seven-day expiry at its source | Requires access to the Cloud project. Production publishing and verification are separate; personal-use exceptions may apply, while Google's actual console requirements still need checking. |
| Correct error classification and token lifecycle handling | Stops false reconnect prompts; distinguishes retryable failures from revoked or expired refresh tokens | Requires a separate implementation. Record expiry, persist refreshed credentials, retry temporary errors with backoff, and request reconnect only for confirmed authorization problems. Does not bypass Testing expiry. |
| Separate Calendar and Gmail authorization | Reduces coupling; Calendar can request only Calendar permissions | Larger change to credential storage, consent flows, and the email automation integration. Does not by itself remove Testing expiry. |
| Keep Testing and reconnect weekly | No development or configuration change | Continues the recurring interruption; not recommended for ongoing personal use. |

## Recommendation

1. Inspect the OAuth publishing status and the next actual failure reason without exposing tokens.
2. If Testing, move the project to production under the applicable personal-use requirements, then obtain a fresh authorization.
3. In a separately authorized change, improve error classification and refresh handling. Preserve the existing server-side refresh-token design.
4. Consider separate Calendar/Gmail grants only if meaningful coupling problems remain.

This should make normal access persistent, but revoked consent, account policies, password changes, or other Google invalidation rules can still require reconnecting. No promise of permanently non-expiring authorization is appropriate.

## Primary sources

- [Google OAuth refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Google server-side offline access](https://developers.google.com/identity/protocols/oauth2/web-server#offline)
- [When Google OAuth verification is not needed](https://support.google.com/cloud/answer/13464323?hl=en)

## Related local changes

The requested UI and shared-notepad changes are independent of Google authorization. Shared notes require the new `0016_uncertainty_notepad` database migration when deployed later. Existing browser notes are imported on first successful sync; local text and its last synced revision remain stored for offline recovery. Active visible clients poll every three seconds, and typing is autosaved after a 600 ms pause. Concurrent edits to different ranges merge; overlapping edits preserve both versions separated by “Notes from another edit.”
