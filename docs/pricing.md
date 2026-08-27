# Tailscale pricing for this pattern

Only the Tailscale path has a vendor cost; static WireGuard and Headscale do not.
Rates below are Tailscale's public pricing as of 2026 and can change; treat the
bands as a model, not a quote. Enterprise pricing and ephemeral-minute overage
rates are not public ("contact sales").

## What you are billed for

Each live worker **process** is one node (reused across runs via
`processKeepAlive`), so node count ≈ peak concurrent workers, not total runs.
Node **lifetime** then picks the cost bucket:

- **Steady load, nodes live >= 4h -> billed as tagged devices.** 50 tagged
  devices are included on all plans, then a flat ~$1/device/month. Cheap and
  predictable. `processKeepAlive` pushes you here.
- **Spiky load, nodes die < 4h -> billed as ephemeral node-minutes.** ~1,000
  min/month included (standard plans) / ~10,000 (Enterprise). 1,000 minutes is
  only ~16.7 node-hours total per month, so churn exhausts it quickly and the
  overage rate is not public.

Human seats (~$8/user/mo standard) are separate from nodes; tagged machine nodes
do not consume seats.

## Bands (steady/long-lived regime)

| Band | Peak concurrent nodes | Plan | Tagged vs 50 | Est. monthly |
|---|---|---|---|---|
| Pilot | 3 | Standard | 4 | ~$16 |
| Small prod | 10 | Standard | 11 | ~$16 |
| Medium prod | 40 | Standard | 41 | ~$16 |
| Large prod | 150 | Standard | 151 -> +$101 | ~$117 |
| Very large / spiky | 500+ | Enterprise or Headscale | 501+, or ephemeral blowout | contact sales, or Headscale ~$20-60 |

Assumes ~2 admin seats and one always-on subnet router. The estimate hinges on
node lifetime, which depends on your warm-pool behavior: steady traffic stays in
the cheap $1/device bucket; spiky short-lived nodes risk large ephemeral-minute
overages.

## Escape hatch

Self-hosting the control plane with [Headscale](./headscale.md) removes all
per-device and per-ephemeral-minute licensing. Cost becomes a small coordinator
VM (~$15-40/mo) regardless of node count, at the cost of operating it. This is the
practical answer for the large bands.
