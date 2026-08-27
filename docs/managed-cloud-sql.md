# Reaching a managed private resource (Cloud SQL) via a subnet router

The main examples put Postgres on the tunnel node itself. Real workloads use
managed services (Cloud SQL, a private ClickHouse, Memorystore) that have only a
private IP inside the VPC. The tunnel node then acts as a **subnet router**: it is
on the tunnel and inside the VPC, and forwards tunnel traffic to the managed
resource's private IP. The task dials that private IP through the tunnel.

```
task ──tunnel──> subnet-router node ──VPC──> managed Cloud SQL (private IP only)
```

## 1. Create the private Cloud SQL

Cloud SQL with a private IP needs Private Service Access (a VPC peering range):

```bash
gcloud compute addresses create google-managed-services-default \
  --global --purpose=VPC_PEERING --prefix-length=16 --network=default
gcloud services vpc-peerings connect --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services-default --network=default

gcloud sql instances create pg-managed \
  --database-version=POSTGRES_15 --tier=db-g1-small \
  --region=us-east4 --network=default --no-assign-ip \
  --root-password="<pw>"
gcloud sql databases create app --instance=pg-managed
```

Note the instance's private IP (call it `CLOUDSQL_IP`):

```bash
gcloud sql instances describe pg-managed --format="value(ipAddresses[0].ipAddress)"
```

Your subnet-router VM (in the same network) can already reach `CLOUDSQL_IP` over
the peering. Verify with `psql -h CLOUDSQL_IP` from the VM.

## 2a. Tailscale subnet router

On the VM (enable IP forwarding first: `sudo sysctl -w net.ipv4.ip_forward=1`):

```bash
sudo tailscale set --advertise-routes=CLOUDSQL_IP/32
```

Then, in the Tailscale admin:

- **Approve the route** for that machine (Machines -> the VM -> approve subnet
  route), or add an auto-approver to your policy:
  ```jsonc
  "autoApprovers": { "routes": { "CLOUDSQL_IP/32": ["tag:gcp-db"] } }
  ```
- **Add an ACL grant for the subnet destination.** This is the easy-to-miss step:
  a grant to the router's own tag does NOT cover IPs behind it. The destination IP
  must be allowed explicitly:
  ```jsonc
  { "src": ["tag:trigger"], "dst": ["CLOUDSQL_IP/32"], "ip": ["tcp:5432"] }
  ```

Set `PGHOST=CLOUDSQL_IP` on the Trigger.dev project. The task reaches Cloud SQL
through the tunnel via the subnet router.

## 2b. WireGuard subnet router

WireGuard has no ACL layer, so there is no grant step. On the WireGuard server
(IP forwarding on):

```bash
PRIMARY_IF=$(ip -o route get 8.8.8.8 | grep -oE 'dev [^ ]+' | awk '{print $2}')
sudo iptables -t nat -A POSTROUTING -s 10.9.0.0/24 -d CLOUDSQL_IP/32 -o "$PRIMARY_IF" -j MASQUERADE
sudo iptables -A FORWARD -i wg0 -o "$PRIMARY_IF" -j ACCEPT
sudo iptables -A FORWARD -i "$PRIMARY_IF" -o wg0 -m state --state RELATED,ESTABLISHED -j ACCEPT
```

Add the Cloud SQL IP to the task's `WG_ALLOWED_IPS` so wireproxy routes it into
the tunnel, and point `PGHOST` at it:

```
WG_ALLOWED_IPS=10.9.0.1/32, CLOUDSQL_IP/32
PGHOST=CLOUDSQL_IP
```

Because the wireproxy config is written when the tunnel first starts, a running
worker keeps its old `WG_ALLOWED_IPS` until a fresh (cold) process picks up the
new value.

## Verified

Both paths were tested end to end against a private-IP-only Cloud SQL Postgres 15
instance: the deployed task's query returned the Cloud SQL private IP from
`inet_server_addr()`, confirming the connection traversed the tunnel and the
subnet router rather than any public path.
