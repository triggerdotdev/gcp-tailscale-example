#!/usr/bin/env bash
# PROOF 2: userspace tailscaled starts as the non-root `node` user in the exact
# deployed base image, with NO added Linux caps and NO /dev/net/tun, and opens
# its SOCKS5 proxy. (No auth key => it parks in NeedsLogin, which is all we need
# to prove the daemon is healthy in the locked-down task environment.)
set -uo pipefail

echo "== whoami / uid =="
id

echo "== binaries present in final image =="
command -v tailscale tailscaled
tailscaled --version | head -1

echo "== can we open /dev/net/tun? (expected: NO in a locked-down task) =="
if [ -e /dev/net/tun ]; then echo "tun device present"; else echo "no /dev/net/tun (as expected)"; fi

echo "== start userspace tailscaled (no caps, no tun) =="
tailscaled \
  --tun=userspace-networking \
  --socks5-server=localhost:1055 \
  --outbound-http-proxy-listen=localhost:1055 \
  --state=/tmp/ts-state/tailscaled.state \
  --socket=/tmp/ts-state/tailscaled.sock \
  >/tmp/ts-state/daemon.log 2>&1 &
DAEMON_PID=$!

for i in $(seq 1 20); do
  if tailscale --socket=/tmp/ts-state/tailscaled.sock status --json >/dev/null 2>&1; then break; fi
  sleep 0.5
done

echo "== daemon still alive? =="
if kill -0 "$DAEMON_PID" 2>/dev/null; then echo "tailscaled RUNNING pid=$DAEMON_PID"; else echo "tailscaled DIED"; cat /tmp/ts-state/daemon.log; exit 1; fi

echo "== backend state (NeedsLogin proves daemon is up sans authkey) =="
tailscale --socket=/tmp/ts-state/tailscaled.sock status --json 2>/dev/null | grep -o '"BackendState":"[^"]*"' | head -1

echo "== SOCKS5 proxy port 1055 listening? =="
if (exec 3<>/dev/tcp/127.0.0.1/1055) 2>/dev/null; then echo "PORT 1055 OPEN (SOCKS5/HTTP proxy listening)"; exec 3>&- 3<&-; else echo "PORT 1055 NOT OPEN"; fi

echo "== daemon log tail =="
tail -5 /tmp/ts-state/daemon.log
echo "PROOF2_DONE"
