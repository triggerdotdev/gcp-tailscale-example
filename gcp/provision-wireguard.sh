#!/usr/bin/env bash
# GCE VM running a WireGuard server + Postgres. Default-deny ingress keeps 5432
# private; only UDP 51820 (WireGuard) is opened. The deployed task reaches
# Postgres at the server's WG address (10.9.0.1) through the tunnel.
#
# You provide the task's WireGuard PUBLIC key (WG_CLIENT_PUB). The server
# generates its own keypair on boot; read its public key back afterwards with:
#   gcloud compute ssh <vm> --command 'sudo wg show wg0 public-key'
# and set that as WG_SERVER_PUBLIC_KEY on your Trigger.dev project.
#
#   GCP_PROJECT=my-proj WG_CLIENT_PUB=<task pubkey> ./provision-wireguard.sh
set -euo pipefail

PROJECT="${GCP_PROJECT:?set GCP_PROJECT}"
ZONE="${GCP_ZONE:-us-east4-a}"
VM="${GCP_VM:-wg-private-db}"
DBPASS="${DBPASS:-demo-$(openssl rand -hex 8)}"
: "${WG_CLIENT_PUB:?set WG_CLIENT_PUB (the task's WireGuard public key)}"

STARTUP=$(cat <<EOF
#!/usr/bin/env bash
set -eux
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get install -y postgresql wireguard
umask 077
wg genkey | tee /etc/wireguard/server.key | wg pubkey > /etc/wireguard/server.pub
cat >/etc/wireguard/wg0.conf <<WG
[Interface]
Address = 10.9.0.1/24
ListenPort = 51820
PrivateKey = \$(cat /etc/wireguard/server.key)

[Peer]
PublicKey = ${WG_CLIENT_PUB}
AllowedIPs = 10.9.0.2/32
WG
systemctl enable wg-quick@wg0 && systemctl start wg-quick@wg0
PGCONF=\$(ls /etc/postgresql/*/main/postgresql.conf | head -1)
PGHBA=\$(dirname "\$PGCONF")/pg_hba.conf
sed -i "s/#*listen_addresses.*/listen_addresses = '*'/" "\$PGCONF"
echo "host all all 10.9.0.0/24 md5" >> "\$PGHBA"
sudo -u postgres psql -c "alter user postgres password '${DBPASS}';"
sudo -u postgres psql -c "create database app;" || true
systemctl restart postgresql
EOF
)

gcloud compute firewall-rules create allow-wireguard \
  --project="$PROJECT" --network=default --direction=INGRESS \
  --action=ALLOW --rules=udp:51820 --source-ranges=0.0.0.0/0 2>/dev/null || echo "firewall rule exists"

gcloud compute instances create "$VM" \
  --project="$PROJECT" --zone="$ZONE" \
  --machine-type=e2-small \
  --image-family=debian-12 --image-project=debian-cloud \
  --metadata=startup-script="$STARTUP"

echo
echo "VM '$VM' creating. Postgres password: $DBPASS (db app, user postgres)"
echo "WG endpoint = <VM external IP>:51820. Set on Trigger.dev:"
echo "  WG_ENDPOINT=<external ip>:51820  PGHOST=10.9.0.1  PGPASSWORD=$DBPASS"
echo "Read the server public key: gcloud compute ssh $VM --zone $ZONE --command 'sudo wg show wg0 public-key'"