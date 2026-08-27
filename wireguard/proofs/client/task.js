import { spawn } from "node:child_process";
import net from "node:net";
import pg from "pg";
import { SocksClient } from "socks";

const { Client } = pg;
const PROXY = { host: "127.0.0.1", port: 25344, type: 5 };
const PG = { host: "10.50.0.2", port: 5432, user: "app", password: "secret", database: "app" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portOpen(host, port) {
  return new Promise((res) => {
    const s = net.connect(port, host, () => { s.destroy(); res(true); });
    s.on("error", () => res(false));
  });
}

async function queryViaProxy() {
  const info = await SocksClient.createConnection({
    proxy: PROXY, command: "connect",
    destination: { host: PG.host, port: PG.port }, timeout: 8000,
  });
  const c = new Client({ user: PG.user, password: PG.password, database: PG.database, stream: info.socket });
  await c.connect();
  const r = await c.query("select inet_server_addr() as ip, version() as v");
  await c.end();
  return r.rows[0];
}

const tStart = Date.now();
const wp = spawn("wireproxy", ["-c", "/app/wg.conf"], { stdio: "inherit" });
wp.on("exit", (code) => console.error(`wireproxy exited: ${code}`));

for (let i = 0; i < 60; i++) {
  if (await portOpen("127.0.0.1", 25344)) break;
  await sleep(100);
}
console.log(`SOCKS port open after ${Date.now() - tStart}ms`);

const t1 = Date.now();
const first = await queryViaProxy();
const firstMs = Date.now() - t1;
const t2 = Date.now();
await queryViaProxy();
const secondMs = Date.now() - t2;

const bringupMs = Date.now() - tStart;
console.log(`[proxy] first query (incl WG handshake): ${firstMs}ms  server_ip=${first.ip}`);
console.log(`[proxy] second query (tunnel warm):      ${secondMs}ms`);
console.log(`total bring-up (wireproxy start -> first query done): ${bringupMs}ms`);
console.log(bringupMs < 2000 && String(first.ip) === "10.50.0.2" ? "WG_PROOF_PASS" : "WG_PROOF_FAIL");
process.exit(0);
