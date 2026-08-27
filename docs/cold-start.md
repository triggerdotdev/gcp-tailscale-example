# Cold start: measurements and tuning

The tunnel is brought up once per worker process and reused across runs. You pay
the setup cost only on a cold start (a fresh worker process); warm runs reuse the
live tunnel. All numbers below are from a deployed managed-worker project on
Trigger.dev Cloud, GCP resource in us-east4, workers in AWS us-east-1.

## Headline

| | Tailscale | WireGuard |
|---|---|---|
| Cold tunnel bring-up | ~1.2s | **~0.1s** |
| Warm run | ~0.17s | ~0.17s |
| Query latency (same region) | ~0.12s | ~0.03–0.12s |

The difference is the handshake: Tailscale registers a fresh node with its
coordination server and negotiates connectivity (DERP/relays) on every cold node,
which is ~1s of round trips. Static WireGuard does a single 1-RTT handshake to a
known endpoint with no coordination server, so bring-up is ~100ms.

## What moves the number (and what doesn't)

- **Region proximity.** Moving the GCP resource to the AWS region's metro
  (us-east4 for us-east-1) cut query latency from ~500ms to ~120ms. It does NOT
  change the Tailscale handshake (that talks to the control plane, not the DB).
- **Machine size.** Bigger machines only speed up the daemon *spawn* (~200ms ->
  ~30ms from micro to large). The ~1s Tailscale handshake is network-bound and
  flat across sizes. `medium-1x` captures essentially all of the gain.
- **Eager start.** Starting the tunnel at worker boot (this repo does, guarded to
  runtime) overlaps the handshake with the rest of cold-start init. It saves
  ~150ms but cannot hide the whole ~1s, because there isn't ~1s of other boot work
  to overlap with.
- **Skip the dead-socket probe.** On a cold start there is no daemon yet; probing
  its socket first (via `existsSync`) instead of shelling out to `tailscale
  status` avoids ~2s of the CLI retrying against a missing socket.

## If you need sub-second cold start

The ~1s Tailscale handshake is the floor. To go lower:

1. **Self-host the control plane near the region (Headscale + an in-region DERP).**
   Shorter round trips shrink the handshake. See [headscale.md](./headscale.md).
2. **Use static WireGuard.** No coordination server, so ~100ms bring-up. The
   tradeoff is no built-in ACLs and you run a WireGuard endpoint. See the
   WireGuard variant in the main README.

## Checkpoint / restore

Both tunnels survive Trigger.dev's checkpoint/restore. A task that queried, then
waited on a `wait.forToken` long enough to be checkpointed (tested at 1 and 5
minutes), then queried again after restore, reconnected with no re-auth: the
userspace daemon came back `Running`. The runtime also self-heals: if the proxy
is not reachable after restore it rebuilds the tunnel before continuing.
