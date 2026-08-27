import { task } from "@trigger.dev/sdk";
import pg from "pg";
import { createClient } from "@clickhouse/client";
import { SocksProxyAgent } from "socks-proxy-agent";
import { tunnelSocket, tunnelProxy } from "../runtime/tunnel.js";

const { Client } = pg;

/**
 * Runs inside the deployed AWS worker; reaches the customer's GCP-private
 * Postgres and ClickHouse through the Tailscale userspace proxy. The middleware
 * in trigger.config.ts guarantees the tunnel is up before this body runs.
 */
export const queryPrivateGcp = task({
  id: "query-private-gcp",
  run: async () => {
    const pgClient = new Client({
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      stream: await tunnelSocket(process.env.PGHOST!, Number(process.env.PGPORT ?? 5432)),
    });
    await pgClient.connect();
    const { rows } = await pgClient.query(
      "select now() as ts, inet_server_addr() as ip, version() as version"
    );
    await pgClient.end();

    let clickhouse: unknown = "skipped (no CLICKHOUSE_URL)";
    if (process.env.CLICKHOUSE_URL) {
      const agent = new SocksProxyAgent(`socks5h://${tunnelProxy.host}:${tunnelProxy.port}`);
      const ch = createClient({ url: process.env.CLICKHOUSE_URL, http_agent: agent });
      const rs = await ch.query({ query: "SELECT 1 AS ok", format: "JSONEachRow" });
      clickhouse = await rs.json();
      await ch.close();
    }

    return { postgres: rows[0], clickhouse };
  },
});
