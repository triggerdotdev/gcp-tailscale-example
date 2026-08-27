# Reach a private GCP resource from a deployed Trigger.dev task

This example shows how a **deployed** [Trigger.dev](https://trigger.dev) task can connect to a
resource that only lives inside a private GCP VPC (a Postgres or ClickHouse with no public
ingress), using nothing but a **build extension**, **runtime code**, and **environment
variables**. There are no changes to Trigger.dev itself, so it is a pattern you can adopt today.

It works by bundling the [Tailscale](https://tailscale.com) userspace client into the deployed
task image and bringing up a tunnel before your task runs. Your database clients then reach the
private resource over the tailnet. The same approach works for any private resource in any network
you can attach a Tailscale [subnet router](https://tailscale.com/kb/1019/subnets) to, not just GCP.

## How it works

1. A **build extension** (`extension/tailscaleTunnel.ts`) bakes the `tailscale` and `tailscaled`
   binaries into the deployed image via `image.instructions`. This only adds bytes to the image.
2. A global **`tasks.middleware`** (`trigger.config.ts`) calls `ensureTunnel()` before every run.
3. **`runtime/tunnel.ts`** starts `tailscaled` in
   [userspace-networking](https://tailscale.com/kb/1112/userspace-networking) mode. This needs no
   `TUN` device and no `NET_ADMIN`, so it runs fine as the non-root task user. It authenticates
   with an ephemeral, tagged auth key and exposes a local SOCKS5 proxy.
4. Your task routes its DB connections through that proxy: `pg` via its `stream` option, and HTTP
   clients (ClickHouse) via a SOCKS proxy agent. Traffic egresses through the tunnel to a Tailscale
   node inside your VPC and on to the private resource.

```
[ Trigger.dev task (managed worker) ]
        |  userspace tailscaled  ->  SOCKS5 127.0.0.1:1055
        |  (WireGuard / DERP over the internet)
        v
[ Tailscale node in your GCP VPC ]  ->  private Postgres / ClickHouse (no public ingress)
```

## Repo layout

```
extension/tailscaleTunnel.ts   Build extension: bakes the Tailscale client into the image
runtime/tunnel.ts              Starts userspace tailscaled, waits for the tunnel, pg/http helpers
trigger.config.ts              Registers the middleware + extension
src/queryPrivateGcp.ts         Example task querying private Postgres (+ optional ClickHouse)
gcp/provision.sh               One-command private Postgres VM on the tailnet (for trying it out)
gcp/tailscale-acl.jsonc        Tailscale policy: tag owners + a rule scoping tasks to the DB
proofs/                        Local Docker proofs of the mechanism, no cloud needed
```

## Prerequisites

- A Trigger.dev account and a project ([cloud.trigger.dev](https://cloud.trigger.dev) or self-hosted).
- A Tailscale tailnet (a free account works). Headscale works too via `TS_LOGIN_SERVER`.
- A private resource in a GCP VPC, plus a Tailscale node that can reach it. `gcp/provision.sh`
  stands up a self-contained example (a Postgres VM that is itself a tailnet node); for real
  infrastructure you would instead run a [subnet router](https://tailscale.com/kb/1019/subnets).

## Setup

### 1. Tailscale policy and keys

Add these tags and rule to your tailnet policy (see `gcp/tailscale-acl.jsonc`). `tagOwners` is
required so tagged auth keys are accepted; the grant scopes the tasks to only the DB ports:

```jsonc
"tagOwners": {
  "tag:trigger": ["autogroup:admin"],
  "tag:gcp-db":  ["autogroup:admin"]
}
// plus a rule allowing src tag:trigger -> dst tag:gcp-db on tcp:5432 (and 8123 for ClickHouse)
```

Then mint two **ephemeral, reusable, tagged** auth keys:

- one tagged `tag:gcp-db` for the resource / subnet router,
- one tagged `tag:trigger` for the tasks (this becomes `TS_AUTHKEY`).

### 2. Stand up the private resource

Try it with the included script (creates a Postgres VM that joins the tailnet, default-deny ingress
so 5432 is not public):

```bash
GCP_PROJECT=your-project TS_AUTHKEY=<tag:gcp-db key> ./gcp/provision.sh
```

It prints the DB password. Grab the VM's tailnet IP from the Tailscale admin console (or
`tailscale status`). For real infrastructure, point a Tailscale subnet router at your existing
private CIDR instead.

### 3. Configure and deploy the task

- Set `project` in `trigger.config.ts` to your project ref.
- Set these environment variables on your Trigger.dev project (see `.env.example`):
  `TS_AUTHKEY` (the `tag:trigger` key), `PGHOST` (the resource's tailnet IP or MagicDNS name),
  `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, and optionally `CLICKHOUSE_URL`.
- Install and deploy:

```bash
npm install
npx trigger.dev@latest deploy
```

### 4. Run it

Trigger `query-private-gcp` from the dashboard or the API. On success it returns the private
Postgres `version()` and `inet_server_addr()` (its tailnet IP), proving the deployed task reached
the private resource over the tunnel.

## Cold vs warm starts

`ensureTunnel()` is a singleton, so within one worker process the tunnel is started once and reused.
The first (cold) run pays the tunnel setup cost; subsequent runs reuse it and only run your query.

- With `processKeepAlive: true` (set in `trigger.config.ts`), the worker process persists across
  warm starts, so warm runs skip tunnel setup entirely.
- If a warm start reuses the container but starts a fresh process, `runtime/tunnel.ts` detects the
  already-running `tailscaled` via its socket and reuses it rather than starting a second one.

## Security notes

- Use **ephemeral** keys so task nodes auto-remove when the container stops, and **tagged** keys so
  ACLs, not device ownership, govern access.
- Scope the grant so `tag:trigger` can reach **only** the DB host and ports, nothing else.
- `TS_AUTHKEY` and DB credentials live as Trigger.dev environment variables (stored encrypted),
  never in the image or the repo.

## Production hardening

- Prefer a **subnet router** in your VPC over putting Tailscale on the database host, so the DB
  itself stays untouched.
- Remove the VM's external IP and use Cloud NAT for egress if you want zero public surface.
- Pin the Tailscale version in the extension and refresh it deliberately.
- Consider key rotation and per-environment tags.

## Local proofs (no cloud needed)

`proofs/` contains Docker-based proofs of the load-bearing mechanics: that the extension's
instructions bake the client into the real Trigger.dev base image, that userspace `tailscaled`
starts as a non-root user with all capabilities dropped, and that a task on one network reaches a
Postgres on an isolated network only through a proxy hop. See `proofs/README.md`.

## License

MIT. See [LICENSE](./LICENSE).
