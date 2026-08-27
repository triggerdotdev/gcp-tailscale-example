import pg from "pg";
import { tunnelSocket } from "./tunnel.js";

const { Client } = pg;

/** Run a single query against the tailnet-private Postgres through the tunnel. */
export async function pgSelect(sql: string): Promise<Record<string, unknown>[]> {
  const client = new Client({
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    stream: await tunnelSocket(process.env.PGHOST!, Number(process.env.PGPORT ?? 5432)),
  });
  await client.connect();
  try {
    const { rows } = await client.query(sql);
    return rows;
  } finally {
    await client.end();
  }
}
