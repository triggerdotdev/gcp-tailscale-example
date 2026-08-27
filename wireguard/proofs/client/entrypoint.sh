#!/usr/bin/env bash
set -euo pipefail

until [ -f /keys/client.key ] && [ -f /keys/server.pub ]; do sleep 0.3; done

cat > /app/wg.conf <<EOF
[Interface]
PrivateKey = $(cat /keys/client.key)
Address = 10.9.0.2/32

[Peer]
PublicKey = $(cat /keys/server.pub)
Endpoint = wgserver:51820
AllowedIPs = 10.50.0.0/24, 10.9.0.0/24
PersistentKeepalive = 25

[Socks5]
BindAddress = 127.0.0.1:25344
EOF

exec node task.js
