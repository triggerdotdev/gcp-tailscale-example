import pg from "pg";
const { Client } = pg;
import { SocksClient } from "socks";
import { SocksProxyAgent } from "socks-proxy-agent";
import http from "node:http";

const PROXY = { host: process.env.PROXY_HOST || "router", port: 1080, type: 5 };
const PG = { host: "pg", port: 5432, user: "app", password: "secret", database: "app" };
const CH = { host: "ch", port: 8123 };

const log = (...a) => console.log(...a);
const ok = (m) => log(`  PASS: ${m}`);
const bad = (m) => log(`  FAIL: ${m}`);

async function directPgShouldFail() {
  log("[1] DIRECT Postgres connect (no proxy) — expect FAILURE (private, no route):");
  const c = new Client({ ...PG, connectionTimeoutMillis: 4000 });
  try {
    await c.connect();
    await c.end();
    bad("direct connect unexpectedly SUCCEEDED (private isolation broken)");
    return false;
  } catch (e) {
    ok(`direct connect refused/unreachable as expected -> ${e.code || e.message}`);
    return true;
  }
}

async function proxiedPgShouldWork() {
  log("[2] Postgres THROUGH SOCKS5 proxy — expect SUCCESS:");
  const info = await SocksClient.createConnection({
    proxy: PROXY,
    command: "connect",
    destination: { host: PG.host, port: PG.port },
    timeout: 6000,
  });
  const c = new Client({
    user: PG.user, password: PG.password, database: PG.database,
    stream: info.socket,
  });
  try {
    await c.connect();
    const r = await c.query("select version() as v, inet_server_addr() as ip");
    ok(`SELECT ok via tunnel -> server_ip=${r.rows[0].ip}`);
    ok(`version -> ${String(r.rows[0].v).slice(0, 40)}...`);
    await c.end();
    return true;
  } catch (e) {
    bad(`proxied query failed -> ${e.stack || e.message}`);
    try { await c.end(); } catch {}
    return false;
  }
}

function proxiedHttpShouldWork() {
  log("[3] ClickHouse-style HTTP endpoint THROUGH SOCKS5 proxy — expect SUCCESS:");
  return new Promise((resolve) => {
    const agent = new SocksProxyAgent(`socks5h://${PROXY.host}:${PROXY.port}`);
    const req = http.get({ host: CH.host, port: CH.port, path: "/", agent, timeout: 6000 }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        ok(`HTTP ${res.statusCode} via tunnel -> ${body.trim().slice(0, 40)}`);
        resolve(true);
      });
    });
    req.on("error", (e) => { bad(`proxied http failed -> ${e.message}`); resolve(false); });
  });
}

const r1 = await directPgShouldFail();
const r2 = await proxiedPgShouldWork();
const r3 = await proxiedHttpShouldWork();
log("");
log(`RESULT direct-blocked=${r1} pg-via-tunnel=${r2} http-via-tunnel=${r3}`);
log(r1 && r2 && r3 ? "PROOF3_PASS" : "PROOF3_FAIL");
process.exit(r1 && r2 && r3 ? 0 : 1);
