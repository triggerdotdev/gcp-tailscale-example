# Local proofs

These prove the load-bearing mechanics of the pattern without any cloud account. They run against
the exact Trigger.dev deployed base image and use the same client libraries as the task.

Requirements: Docker. The examples pin `arm64`; pass `--build-arg TARGETARCH=amd64` on x86.

## Proof 1 + 2: the client bakes in and starts as a locked-down non-root user

`Dockerfile.bake` reproduces what the build extension's `image.instructions` inject, layered on the
real base image, with a `FROM base AS final` stage. `start-tunnel-check.sh` then starts userspace
`tailscaled` as the non-root `node` user with no capabilities and no TUN device, and checks that its
SOCKS5 proxy comes up.

```bash
TS_VERSION=$(curl -fsSL "https://pkgs.tailscale.com/stable/?mode=json" | \
  python3 -c "import sys,json;print(json.load(sys.stdin)['TarballsVersion'])")
docker build --build-arg TS_VERSION="$TS_VERSION" -f Dockerfile.bake -t ts-bake-poc .
docker run --rm --user node --cap-drop=ALL ts-bake-poc
```

Expected: the `tailscale`/`tailscaled` binaries are present, the daemon stays alive, and
`PORT 1055 OPEN` is printed. (Without an auth key the daemon parks in `NeedsLogin`, which is all
that is needed to show it runs in the task environment.)

## Proof 3: private resource reachable only through the proxy

`docker-compose.yml` builds a topology mirroring AWS -> GCP-private: a Postgres and an HTTP endpoint
on an `internal: true` network with no external route, a dual-homed SOCKS5 proxy standing in for the
userspace Tailscale proxy + subnet router, and a task on a separate network. The task uses the real
`pg` and SOCKS agent libraries.

```bash
docker compose up --build --abort-on-container-exit --exit-code-from task
docker compose down -v
```

Expected: the direct Postgres connect fails (proving isolation), while the proxied path runs a real
`SELECT version(), inet_server_addr()` and the HTTP leg returns 200 (`PROOF3_PASS`).
