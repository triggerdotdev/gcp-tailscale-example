import { task } from "@trigger.dev/sdk";
import pg from "pg";
import { wgTunnelSocket, getWgTiming, getWgAwaitMs } from "../wireguard/runtime/wgTunnel.js";

const { Client } = pg;

/**
 * Reaches the private Postgres over a static WireGuard tunnel (via wireproxy).
 * The middleware brings the tunnel up before this runs. PGHOST is the private
 * resource reachable through the tunnel: the WireGuard server's own address, or
 * a managed resource's private IP when the server acts as a subnet router.
 */
export const queryPrivateGcpWg = task({
  id: "query-private-gcp-wg",
  run: async () => {
    const qStart = Date.now();
    const client = new Client({
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      stream: await wgTunnelSocket(process.env.PGHOST!, Number(process.env.PGPORT ?? 5432)),
    });
    await client.connect();
    const { rows } = await client.query("select now() as ts, inet_server_addr() as ip, version() as version");
    await client.end();

    return { postgres: rows[0], queryMs: Date.now() - qStart, awaitMs: getWgAwaitMs(), tunnel: getWgTiming() };
  },
});
