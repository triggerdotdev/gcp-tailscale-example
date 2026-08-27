import { defineConfig } from "@trigger.dev/sdk";
import { tasks } from "@trigger.dev/sdk";
import { tailscaleTunnel } from "./extension/tailscaleTunnel.js";
import { ensureTunnel, awaitTunnelTimed } from "./runtime/tunnel.js";
import { wireguardTunnel } from "./wireguard/extension/wireguardTunnel.js";
import { ensureWgTunnel, awaitWgTunnelTimed } from "./wireguard/runtime/wgTunnel.js";

const isBuild = !!process.env.TRIGGER_BUILD_MANIFEST_PATH;
if (process.env.TS_AUTHKEY && !isBuild) void ensureTunnel().catch(() => {});
if (process.env.WG_PRIVATE_KEY && !isBuild) void ensureWgTunnel().catch(() => {});

tasks.middleware("tunnel", async ({ ctx, next }) => {
  if (ctx.task.id === "query-private-gcp-wg") {
    await awaitWgTunnelTimed();
  } else if (ctx.task.id !== "baseline-cold-start") {
    await awaitTunnelTimed();
  }
  await next();
});

export default defineConfig({
  project: "<your-project-ref>",
  maxDuration: 300,
  dirs: ["./src"],
  processKeepAlive: true,
  build: {
    extensions: [tailscaleTunnel({ arch: "amd64" }), wireguardTunnel({ arch: "amd64" })],
    external: ["tailscale", "tailscaled", "wireproxy"],
  },
});
