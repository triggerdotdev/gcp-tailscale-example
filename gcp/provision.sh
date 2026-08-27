#!/usr/bin/env bash
# Stand up a genuinely-private GCP Postgres reachable ONLY over a tailnet.
# Single GCE VM: Postgres + Tailscale node on it (no subnet router needed for a
# first e2e). Default-deny ingress means the DB is not reachable from the public
# internet; the task reaches it by the VM's 100.x tailnet IP / MagicDNS name.
#
# Requires: gcloud authed to a project, and a Tailscale tagged ephemeral auth key.
#   TS_AUTHKEY=tskey-auth-xxxx GCP_PROJECT=my-proj ./provision.sh
set -euo pipefail

PROJECT="${GCP_PROJECT:?set GCP_PROJECT}"
ZONE="${GCP_ZONE:-us-central1-a}"
VM="${GCP_VM:-gcp-private-db}"
DBPASS="${DBPASS:-demo-$(openssl rand -hex 8)}"
: "${TS_AUTHKEY:?set TS_AUTHKEY (tagged, ephemeral, pre-authorized)}"

STARTUP=$(cat <<EOF
#!/usr/bin/env bash
set -eux
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get install -y postgresql curl
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --authkey='${TS_AUTHKEY}' --hostname=gcp-private-db --ssh
PGCONF=\$(ls /etc/postgresql/*/main/postgresql.conf | head -1)
PGHBA=\$(dirname "\$PGCONF")/pg_hba.conf
sed -i "s/#*listen_addresses.*/listen_addresses = '*'/" "\$PGCONF"
echo "host all all 100.64.0.0/10 md5" >> "\$PGHBA"
sudo -u postgres psql -c "alter user postgres password '${DBPASS}';"
sudo -u postgres psql -c "create database app;" || true
systemctl restart postgresql
EOF
)

gcloud compute instances create "$VM" \
  --project="$PROJECT" --zone="$ZONE" \
  --machine-type=e2-small \
  --image-family=debian-12 --image-project=debian-cloud \
  --metadata=startup-script="$STARTUP"

echo
echo "VM '$VM' creating (Postgres install + tailnet join takes ~90s)."
echo "  db=app  user=postgres  password=$DBPASS"
echo "Find its tailnet IP in the Tailscale admin console or: tailscale status | grep $VM"
echo "Then set these Trigger.dev env vars (PGHOST = that 100.x tailnet IP or the full MagicDNS name):"
echo "  PGHOST=<tailnet-ip>  PGPORT=5432  PGUSER=postgres  PGPASSWORD=$DBPASS  PGDATABASE=app"
