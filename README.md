# NitrateHub control room

Static dashboard for GitHub Pages at `admin.nitratehub.xyz`, with a Cloudflare Worker API at `admin-api.nitratehub.xyz` and a D1 database. Owner Discord ID: `933806891786731640`. All private API routes enforce the numeric owner ID on the server. No personal analytics or push tokens are included in the static site.

## Configuration

1. Create a D1 database named `nitratehub-admin`, put its ID in `wrangler.toml`, then run `pnpm db:migrate`.
2. Create a Discord application with OAuth redirect URI `https://admin-api.nitratehub.xyz/auth/callback` and scope `identify`. Set Worker secrets `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`.
3. Set Worker secrets `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY` (complete PKCS#8 `.p8` contents), and a cryptographically random `INGEST_SECRET`. Never commit credentials or place them in the frontend.
4. Deploy the Worker. Configure its custom domain and keep the Workers Free plan if you want usage capped by the free quotas.
5. Set the GitHub repository Pages source to GitHub Actions, set custom domain `admin.nitratehub.xyz`, and set Cloudflare DNS CNAME `admin` to `natedogg26.github.io`, DNS-only. Enable HTTPS once GitHub issues the certificate.

## App integration

The app catalogue is seeded from the local workspace. Entries are **not connected** until telemetry or devices arrive. Android is listed under Neighbourhood, but this initial push implementation sends **Apple APNs only**. No Google/Android push support is claimed.

Your existing trusted application backend must POST to `https://admin-api.nitratehub.xyz/ingest` with `Authorization: Bearer <INGEST_SECRET>` and JSON. Keep this shared secret only in your backend environment, never in an iOS app or web JavaScript. Authenticate and authorize each app's user on the existing backend before forwarding their data. Use opaque installation identifiers; do not forward email addresses, location, or message content as analytics.

Device registration:

```json
{"type":"device","appId":"neighbourhood","token":"APNS_HEX_TOKEN","environment":"development","model":"iPhone"}
```

Activity:

```json
{"type":"event","appId":"neighbourhood","id":"UNIQUE_EVENT_UUID","installationId":"OPAQUE_INSTALLATION_ID","name":"app_open"}
```

Each app must register for notifications and send token updates through its authenticated backend. APNs tokens are scoped to app and development/production environment. Existing databases are not automatically imported. Mark your own devices in the dashboard once they appear.

Metrics: active installations are distinct installation IDs with events in the last seven days; the graph shows reported event counts by UTC date; registered devices counts enabled APNs registrations. This does not provide App Store downloads, revenue, or crash reports. Events expire after 90 days. Sessions expire after eight hours. The API does not store Discord access tokens.

## Push behavior

Default audience is My devices and development environment. Review is required before sending. APNs acceptance is recorded separately from failures and unknown network outcomes; acceptance does not confirm actual display. Ambiguous requests are not retried automatically. Each send uses a UUID idempotency key and a durable audit record. Interrupted sends are reconciled by daily cleanup; never blindly retry an unknown outcome. APNs credentials must authorize every selected bundle ID. Verify the unconfirmed bundle IDs in the catalogue before sending.

## Development

Use Node 22+ and `pnpm install`; `pnpm test` checks authorization and payload boundaries. `pnpm dev` serves the static site. Local HTTP cannot reproduce cross-subdomain Secure cookie login; use production HTTPS for a real OAuth test. Never add an authentication bypass to the production frontend for previewing.

## Multiple APNs signing keys

For environment-specific or app-specific keys, set the **secret** `APNS_CREDENTIALS` to JSON. Never commit its contents. Each entry contains `keyId`, `teamId`, `privateKey` (full `.p8` PEM). Top-level `development` and `production` entries are team defaults. An app ID such as `neighbourhood` may contain its own `development` / `production` entries to override those defaults. When this secret is present, missing profiles fail closed; the legacy three `APNS_*` secrets are not used. This supports separate sandbox/production keys and different developer teams.

The browser splits large reviewed audiences into batches of 40 to respect the Workers Free outbound request limit. Keep the page open while sending; completed batches are independently audited. If sending stops, review the activity log before trying again.
