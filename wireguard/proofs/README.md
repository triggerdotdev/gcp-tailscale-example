# Local WireGuard proof

Proves the userspace WireGuard mechanism and measures its bring-up time, with no
cloud account. A `keygen` step generates throwaway WireGuard keypairs at runtime
(nothing is committed), then:

- `pg` and `wgserver` sit on an `internal: true` network (no external route).
- `wgserver` runs a WireGuard server and forwards/masquerades tunnel traffic into
  that private network (the subnet-router role).
- `client` runs `wireproxy` (userspace WireGuard + SOCKS5) as a non-root user with
  all capabilities dropped and no TUN device, then queries the private Postgres
  through the tunnel and times the bring-up.

```bash
docker compose up --build --abort-on-container-exit --exit-code-from client
docker compose down -v
```

Expected: `WG_PROOF_PASS`, with the query returning the private server IP
(`10.50.0.2`) and a total bring-up (wireproxy start -> first query) around 100ms.
On x86 pass `--build-arg TARGETARCH=amd64` to the client image.

Note: Docker Desktop does not always L3-isolate its bridge networks, so this proof
demonstrates the tunnel path and its speed, not hard network isolation. Genuine
isolation is a property of the real deployment (a resource with no public route),
which the deployed examples exercise.
