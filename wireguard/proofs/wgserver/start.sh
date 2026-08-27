#!/usr/bin/env bash
set -eux
PRIVATE_CIDR="10.50.0.0/24"

until [ -f /keys/server.key ] && [ -f /keys/client.pub ]; do sleep 0.3; done

ip link add wg0 type wireguard
wg set wg0 listen-port 51820 private-key /keys/server.key
wg set wg0 peer "$(cat /keys/client.pub)" allowed-ips 10.9.0.2/32
ip address add 10.9.0.1/24 dev wg0
ip link set wg0 up

GCP_IF=$(ip -o route get 10.50.0.2 | grep -oE 'dev [^ ]+' | awk '{print $2}')
iptables -t nat -A POSTROUTING -s 10.9.0.0/24 -d "$PRIVATE_CIDR" -o "$GCP_IF" -j MASQUERADE
iptables -A FORWARD -i wg0 -j ACCEPT
iptables -A FORWARD -o wg0 -j ACCEPT

echo "wg-server up: wg0=10.9.0.1, forwarding to $PRIVATE_CIDR via $GCP_IF"
wg show
sleep infinity
