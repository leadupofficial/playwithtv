# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through GitHub:
**Security → Report a vulnerability** on this repository. That opens a private advisory that only the
maintainers can see.

Include what you found, how to reproduce it, and what an attacker could do with it. We aim to:
- reply within 3 days;
- fix serious issues within 14 days;
- credit you in the advisory (unless you prefer not to be named).

Please test only against your own local or self-hosted copy, never against the live site or other people's
rooms, and don't access other users' data.

## Scope

In scope:
- the hub server (`apps/server`);
- the web app (`apps/web`);
- the protocol (`packages/protocol`);
- the motion SDK (`packages/motion`);
- the Android TV app (`apps/tv-android`).

How the system is protected is described in [docs/security.md](docs/security.md).
