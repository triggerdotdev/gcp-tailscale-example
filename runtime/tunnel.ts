import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { SocksClient } from "socks";

const STATE_DIR = process.env.TS_STATE_DIR ?? "/home/node/.ts-state";
const SOCKS_HOST = "127.0.0.1";
const SOCKS_PORT = Number(process.env.TS_SOCKS_PORT ?? 1055);
const SOCKET = `${STATE_DIR}/tailscaled.sock`;

export const tunnelProxy = { host: SOCKS_HOST, port: SOCKS_PORT, type: 5 as const };

let readyPromise: Promise<void> | undefined;

/**
 * Idempotently start userspace `tailscaled`, authenticate with TS_AUTHKEY, and
 * resolve once the tailnet is up. Safe to call on every run: a warm worker
 * starts the daemon once and reuses it across runs.
 */
export function ensureTunnel(): Promise<void> {
  if (!readyPromise) {
    readyPromise = start().catch((err) => {
      readyPromise = undefined;
      throw err;
    });
  }
  return readyPromise;
}

async function start(): Promise<void> {
  const authKey = process.env.TS_AUTHKEY;
  if (!authKey) throw new Error("TS_AUTHKEY is not set");

  if (!(await daemonAlive())) {
    const daemon = spawn(
      "tailscaled",
      [
        "--tun=userspace-networking",
        `--socks5-server=${SOCKS_HOST}:${SOCKS_PORT}`,
        `--outbound-http-proxy-listen=${SOCKS_HOST}:${SOCKS_PORT}`,
        `--state=${STATE_DIR}/tailscaled.state`,
        `--socket=${SOCKET}`,
      ],
      { stdio: "inherit", detached: false }
    );
    daemon.on("exit", (code) => console.error(`[tunnel] tailscaled exited: ${code}`));
    await waitForPort(SOCKS_HOST, SOCKS_PORT, 15_000);
  } else {
    console.log("[tunnel] reusing tailscaled already running in this worker");
  }

  if ((await backendState()) !== "Running") {
    await run("tailscale", [
      `--socket=${SOCKET}`,
      "up",
      `--authkey=${authKey}`,
      `--hostname=${process.env.TS_HOSTNAME ?? "trigger-task"}`,
      "--accept-routes",
      ...(process.env.TS_LOGIN_SERVER ? [`--login-server=${process.env.TS_LOGIN_SERVER}`] : []),
    ]);
  }

  await waitForBackendRunning(30_000);
  await waitForPort(SOCKS_HOST, SOCKS_PORT, 15_000);
  console.log("[tunnel] tailnet up; SOCKS5 proxy ready on " + `${SOCKS_HOST}:${SOCKS_PORT}`);
}

async function daemonAlive(): Promise<boolean> {
  return (await backendState()) !== null;
}

async function backendState(): Promise<string | null> {
  const out = await run("tailscale", [`--socket=${SOCKET}`, "status", "--json"], true).catch(
    () => ""
  );
  const m = /"BackendState"\s*:\s*"([^"]*)"/.exec(out);
  return m ? m[1] : null;
}

/**
 * Open a TCP socket to a tailnet-private `host:port` through the userspace
 * proxy. Hand the returned socket to a `pg` Client via its `stream` option.
 */
export async function tunnelSocket(host: string, port: number): Promise<net.Socket> {
  const info = await SocksClient.createConnection({
    proxy: tunnelProxy,
    command: "connect",
    destination: { host, port },
    timeout: 10_000,
  });
  return info.socket;
}

function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    while (Date.now() < deadline) {
      const open = await new Promise<boolean>((resolve) => {
        const s = net.connect(port, host, () => {
          s.destroy();
          resolve(true);
        });
        s.on("error", () => resolve(false));
      });
      if (open) return;
      await sleep(300);
    }
    throw new Error(`[tunnel] proxy port ${host}:${port} never opened`);
  })();
}

async function waitForBackendRunning(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await backendState()) === "Running") return;
    await sleep(500);
  }
  throw new Error("[tunnel] tailnet did not reach Running");
}

function run(cmd: string, args: string[], capture = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let out = "";
    if (capture) p.stdout?.on("data", (d) => (out += d));
    p.on("exit", (code) => (code === 0 || capture ? resolve(out) : reject(new Error(`${cmd} exited ${code}`))));
    p.on("error", reject);
  });
}
