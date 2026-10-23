# Security model

This project is open source. Anyone can read every line, so **nothing here depends on hiding how it works**.
A deployment is protected only by its secrets, its settings and the checks below.

## What is public and what is secret

| Public (in this repo) | Secret (never in the repo) |
|---|---|
| All code, the protocol, how rooms, tokens and sponsors work | The `ADMIN_TOKEN`, database password, TLS keys |
| Example self-hosting templates with placeholders | The real server's address, ports, proxy layout and deploy scripts (kept in a private ops folder) |
| The sponsor *system* | Sponsor bookings, images and impression numbers (in the database) |
| The Android TV app source | The release signing key |

The live site sits behind Cloudflare, and the origin only answers requests that come through Cloudflare.

## Rooms and players

- **Room secrets:** a room has an unguessable host token (TV) and invite token (QR), both 24 random bytes.
  It also has a 5-character join code (30 look-alike-free characters, so 24.3 million codes) that expires
  after 10 minutes.
- **Player tokens:** each player gets their own token. Tokens are compared in constant time. Joining and room
  creation are rate-limited per IP.
- **Join-code guessing:** typed join codes are guarded in layers that slow guessing down without letting an
  attacker lock real families out for long:
  - one address: 10 wrong codes in 10 minutes locks that address;
  - one network block (IPv4 /24, IPv6 /48, after validating and expanding the address): 60 wrong codes, then
    one every 2 s, a short back-off rather than a ban, because mobile carriers put many people behind shared
    addresses;
  - everyone together: 300 wrong codes, then 5 per second site-wide. At that rate, hitting a live room's
    code within its 10 minutes is impractical. Floods also raise an ops alert.

  QR invites use the long token and are never affected, so scanning always works.
- **Client addresses:** these are only believed from the last trusted proxy hop (`TRUST_PROXY_HOPS`,
  default 1), never from a client-written `X-Forwarded-For`. That is what keeps per-IP limits and the admin
  lock from being bypassed.
- **Who can do what:** a phone can only send input and its own ready/leave; only the TV can run the game. The
  hub enforces this, not the client.
- **Input limits:** every WebSocket frame is size-capped (4 KB), schema-validated and rate-limited.
  WebSocket upgrades are only accepted from allowed origins.
- **Direct links:** direct phone→TV links (WebRTC) are only introduced between devices that are already
  authenticated in the same room. The TV validates every direct message exactly like hub input. No STUN/TURN
  servers are used, so nobody outside the home network learns anyone's IP address.

## Admin console

- **One secret:** `ADMIN_TOKEN` is the only key. It must be at least 32 random characters, and the server
  refuses to start in production otherwise.
- **Brute-force lock:** after 5 wrong tokens from an address, that address is locked out for 15 minutes, even
  if the next guess is right. Failures are logged as ops events.
- **Admin-only data:** `/metrics` and usage numbers are admin-only. The public `/healthz` only says whether the
  service is up.
- **Recommended for the live site:** put `/admin` and `/api/admin` behind Cloudflare Access (Zero Trust) as
  well, so the login page itself is only reachable by allowed accounts.

## Sponsors (advertising)

- **Who manages sponsors:** only the admin can create sponsors or upload images. Images are checked by their
  actual bytes (PNG/JPEG/WebP only; disguised SVG or scripts are rejected) and are limited to 300 KB.
- **Who reports impressions:** only a TV can report them, over its authenticated room connection. There is no
  open endpoint.
- **Server-side caps:** the server caps each report by what it saw in that room:
  - nothing counts from a room nobody has joined;
  - each banner slot counts at most one sponsor per 15 s since the last report;
  - "presented by" and in-game sponsors count at most once per game the server started;
  - only sponsors live that day and booked for that slot count;
  - a room can report at most once every 20 s.
- **Honest numbers:** impressions remain "reported by TVs, capped by the server". They are good for
  billing-by-booking and trends, not an audited count.
- **Privacy:** impressions are counts per sponsor, placement and day. No viewer, device or room details are
  stored. Ads never appear on phones or during gameplay.

## In the browser

Every response carries:
- **Content Security Policy:** only our own scripts may run. There are no inline scripts and no `eval`, which
  is why the validation library runs in "jitless" mode. Pages can't be framed by other sites.
- **HSTS:** browsers only use HTTPS for the site.
- **Permissions-Policy:** motion sensors and screen wake are allowed; the camera, microphone, location and
  payments are explicitly blocked.
- **No-referrer:** invite links never leak to other sites through the browser's Referer header.

## Code, contributions and CI

- **Owner review:** changes to the server, protocol, admin, sponsors, direct links, service worker, TV app,
  CI and dependencies need a maintainer's review (`.github/CODEOWNERS`).
- **CI permissions:** CI runs with read-only permissions and **no secrets**. It never uses
  `pull_request_target`, and third-party actions are pinned to exact commits.
- **No deploys from GitHub:** deployment never happens from GitHub. It's done by maintainers from their own
  machines, so there are no deploy keys or server credentials to steal.
- **Dependencies:** Dependabot proposes updates as reviewed pull requests. Install scripts are disabled
  except for allow-listed packages (`pnpm.onlyBuiltDependencies`).
- **Secret scanning:** a secret scan (gitleaks) runs before every commit (`pnpm hooks:install`). GitHub
  secret scanning with push protection is enabled once the repository is public.
- **Community games:** they run in the TV page, so they get the same review as any other code.
  Sandboxing community games in a separate origin is on the roadmap.

## Self-hosting checklist

1. Generate secrets: `openssl rand -hex 24` for `ADMIN_TOKEN` and the database password. Keep `.env` out of
   git.
2. Set `PUBLIC_URL` (https) and `ALLOWED_ORIGINS` to your own domain.
3. Put the app behind a TLS-terminating proxy. Bind the app to `127.0.0.1` only.
4. Pass the real client IP in `X-Forwarded-For` (overwritten by your proxy, never appended from the client).
   Rate limits depend on it.
5. Keep Postgres and Redis on an internal network with no published ports.
