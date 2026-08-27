# Reach a private GCP resource from a deployed Trigger.dev task

A **deployed** [Trigger.dev](https://trigger.dev) task (managed worker) can connect
to a resource that only lives inside a private GCP VPC (a Cloud SQL Postgres, a
private ClickHouse, anything with no public IP), using only a **build extension**,
**runtime code**, and **environment variables**. There are no changes to
Trigger.dev itself, so it is a pattern you can adopt today.

Two tunnels are shown, sharing the same shape (bundle a userspace client, bring it
up before the task runs, route DB clients through a local SOCKS5 proxy):

- **Tailscale** — mesh VPN with a coordination server, ACLs, and NAT traversal.
- **WireGuard** (`wireproxy`) — a static point-to-point tunnel, no coordination
  server, much faster cold start.

Both were verified end to end on Trigger.dev Cloud against a private-IP-only
managed **Cloud SQL** instance.

## Tailscale vs WireGuard

| | Tailscale | WireGuard |
|---|---|---|
| Reaches VM Postgres | yes | yes |
| Reaches managed Cloud SQL (private IP, via subnet router) | yes | yes |
| Cold tunnel bring-up | ~1.2s | **~0.1s** |
| Warm run | ~0.17s | ~0.17s |
| Query latency (GCP + AWS in same metro) | ~0.12s | ~0.03–0.12s |
| Access control | tailnet ACLs (tags/grants) | none built-in (raw WireGuard) |
| NAT traversal / dynamic peers | yes | no (needs a reachable endpoint) |
| Key management | auth keys, rotation, admin UI | you manage static keys |
| Vendor cost | SaaS device/minute limits (or self-host Headscale) | none |

**Rule of thumb:** WireGuard when you control a stable endpoint in the VPC and want
the fastest cold start with no vendor limits. Tailscale when you want ACLs, easy
key management, NAT traversal, and a managed control plane (and can wear the ~1s
cold-start handshake, or self-host Headscale to shrink it).

## How it works

1. A **build extension** bakes the userspace client (`tailscale`/`tailscaled`, or
   `wireproxy`) into the deployed image via `image.instructions`. Only bytes are
   added to the image.
2. A global **`tasks.middleware`** brings the tunnel up before every run (started
   eagerly at worker boot so the handshake overlaps cold-start init).
3. The client runs in **userspace** (no TUN device, no `NET_ADMIN`), so it works as
   the non-root task user, and exposes a local **SOCKS5 proxy**.
4. The task routes its DB connection through that proxy: `pg` via its `stream`
   option. Traffic egresses through the tunnel to a node inside the VPC and on to
   the private resource.

```
[ Trigger.dev task (AWS) ] --userspace tunnel--> SOCKS5 --> [ node in the GCP VPC ] --> private Postgres / Cloud SQL
```

## Repo layout

```
extension/tailscaleTunnel.ts        Tailscale build extension
runtime/tunnel.ts                   Tailscale userspace bootstrap + pg/http helpers + timing/health
runtime/db.ts                       pgSelect() over the tunnel
src/queryPrivateGcp.ts              Tailscale task
src/queryPrivateGcpWg.ts            WireGuard task
src/baselineColdStart.ts            No-tunnel baseline (for cold-start measurement)
src/checkpointRestore.ts            Proves the tunnel survives checkpoint/restore
trigger.config.ts                   Wires both extensions + a tunnel middleware
wireguard/extension/…               WireGuard build extension (bakes wireproxy)
wireguard/runtime/wgTunnel.ts       WireGuard userspace bootstrap
wireguard/proofs/                   Local WireGuard proof (no cloud needed)
proofs/                             Local Tailscale proofs (no cloud needed)
gcp/provision.sh                    A tailnet-joined Postgres VM (Tailscale)
gcp/provision-wireguard.sh          A WireGuard-server Postgres VM
docs/managed-cloud-sql.md           Reaching managed Cloud SQL via a subnet router
docs/cold-start.md                  Measurements and tuning
docs/headscale.md                   Self-hosted control plane (removes Tailscale limits)
docs/pricing.md                     Tailscale pricing model
```

## Setup

Common: install deps (`npm install`), set `project` in `trigger.config.ts`, set the
env vars for whichever tunnel you use (see `.env.example`), then
`npx trigger.dev@latest deploy`. Trigger the task from the dashboard or the API.

### Tailscale

1. In your tailnet policy add `tagOwners` for `tag:trigger` and `tag:gcp-db`, plus
   a grant `tag:trigger -> tag:gcp-db` on `tcp:5432` (and `8123` for ClickHouse).
   See `gcp/tailscale-acl.jsonc`.
2. Mint two ephemeral + reusable + tagged auth keys (`tag:gcp-db` for the resource,
   `tag:trigger` for the tasks -> `TS_AUTHKEY`).
3. Stand up the private resource: `gcp/provision.sh` (a VM that joins the tailnet),
   or a subnet router for existing infra (see `docs/managed-cloud-sql.md`).
4. Set `TS_AUTHKEY` and the `PG*` vars, deploy, trigger `query-private-gcp`.

### WireGuard

1. Generate a client keypair (`wg genkey | tee priv | wg pubkey`).
2. Stand up the server: `gcp/provision-wireguard.sh` (pass the client public key),
   then read back the server public key.
3. Set `WG_PRIVATE_KEY`, `WG_SERVER_PUBLIC_KEY`, `WG_ENDPOINT`, `WG_ALLOWED_IPS`
   and the `PG*` vars, deploy, trigger `query-private-gcp-wg`.

### Managed resources (Cloud SQL, private ClickHouse)

Point the tunnel node at the managed resource's private IP as a **subnet router**.
Full steps for both tunnels (including the Tailscale route-approval and the ACL
grant for the subnet destination) are in [docs/managed-cloud-sql.md](./docs/managed-cloud-sql.md).

## Cold start

You pay tunnel setup only on a cold worker process; warm runs reuse it. WireGuard
is ~0.1s; Tailscale is ~1.2s (its coordination-server handshake, which is
network-bound and not helped by bigger machines). Region proximity cuts query
latency (~500ms -> ~120ms), and self-hosting Headscale can shrink the Tailscale
handshake. Details and how to reproduce: [docs/cold-start.md](./docs/cold-start.md).

## What was verified

On a real Trigger.dev Cloud project (managed workers in AWS, GCP resource in
us-east4):

- Both tunnels bake into the deployed image via the build extension and come up in
  the middleware before `run()`.
- The deployed task reaches a VM Postgres and a **private-IP-only managed Cloud
  SQL** instance (the query returns the private server IP), over both tunnels.
- WireGuard cold bring-up ~100ms; Tailscale ~1.2s; warm ~170ms.
- Both survive checkpoint/restore (tested to 5+ minutes) with no re-auth.

## Local proofs

`proofs/` (Tailscale) and `wireguard/proofs/` (WireGuard) prove the mechanics with
Docker, no cloud account: the client bakes into the real base image, starts as a
non-root user with all capabilities dropped, and reaches a Postgres on an isolated
network only through the tunnel.

## License

MIT. See [LICENSE](./LICENSE).
