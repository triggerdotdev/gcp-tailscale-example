import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { SocksClient } from "socks";

const STATE_DIR = process.env.WG_STATE_DIR ?? "/home/node/.wg-state";
const CONF = `${STATE_DIR}/wireproxy.conf`;
const SOCKS_HOST = "127.0.0.1";
const SOCKS_PORT = Number(process.env.WG_SOCKS_PORT ?? 25344);

export const wgProxy = { host: SOCKS_HOST, port: SOCKS_PORT, type: 5 as const };

export type WgTiming = { reusedProcess: boolean; setupMs: number };
let readyPromise: Promise<void> | undefined;
let lastTiming: WgTiming | undefined;
let lastAwaitMs = 0;

export function getWgTiming(): WgTiming | undefined {
  return lastTiming;
}
export function getWgAwaitMs(): number {
  return lastAwaitMs;
}

export function ensureWgTunnel(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = start().catch((err) => {
    readyPromise = undefined;
    throw err;
  });
  return readyPromise;
}

export async function awaitWgTunnelTimed(): Promise<void> {
  const t = Date.now();
  await ensureWgTunnel();
  lastAwaitMs = Date.now() - t;
}

export async function ensureWgHealthy(): Promise<{ reconnected: boolean }> {
  if (await isPortOpen(SOCKS_HOST, SOCKS_PORT)) return { reconnected: false };
  readyPromise = undefined;
  await ensureWgTunnel();
  return { reconnected: true };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function start(): Promise<void> {
  const t0 = Date.now();
  const conf = [
    "[Interface]",
    `PrivateKey = ${requireEnv("WG_PRIVATE_KEY")}`,
    `Address = ${process.env.WG_ADDRESS ?? "10.9.0.2/32"}`,
    "",
    "[Peer]",
    `PublicKey = ${requireEnv("WG_SERVER_PUBLIC_KEY")}`,
    `Endpoint = ${requireEnv("WG_ENDPOINT")}`,
    `AllowedIPs = ${process.env.WG_ALLOWED_IPS ?? "10.9.0.1/32"}`,
    "PersistentKeepalive = 25",
    "",
    "[Socks5]",
    `BindAddress = ${SOCKS_HOST}:${SOCKS_PORT}`,
    "",
  ].join("\n");
  writeFileSync(CONF, conf, { mode: 0o600 });

  const wp = spawn("wireproxy", ["-c", CONF], { stdio: "inherit", detached: false });
  wp.on("exit", (code) => console.error(`[wg] wireproxy exited: ${code}`));

  await waitForPort(SOCKS_HOST, SOCKS_PORT, 15_000);
  lastTiming = { reusedProcess: false, setupMs: Date.now() - t0 };
  console.log("[wg] wireproxy up; SOCKS5 ready timing=" + JSON.stringify(lastTiming));
}

export async function wgTunnelSocket(host: string, port: number): Promise<net.Socket> {
  const info = await SocksClient.createConnection({
    proxy: wgProxy,
    command: "connect",
    destination: { host, port },
    timeout: 10_000,
  });
  return info.socket;
}

function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(port, host, () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });
}

async function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(host, port)) return;
    await sleep(100);
  }
  throw new Error(`[wg] SOCKS port ${host}:${port} never opened`);
}
