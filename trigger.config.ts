import { defineConfig } from "@trigger.dev/sdk";
import { tasks } from "@trigger.dev/sdk";
import { tailscaleTunnel } from "./extension/tailscaleTunnel.js";
import { ensureTunnel } from "./runtime/tunnel.js";

tasks.middleware("tailscale-tunnel", async ({ next }) => {
  await ensureTunnel();
  await next();
});

export default defineConfig({
  project: "<your-project-ref>",
  maxDuration: 300,
  dirs: ["./src"],
  processKeepAlive: true,
  build: {
    extensions: [tailscaleTunnel({ arch: "amd64" })],
    external: ["tailscale", "tailscaled"],
  },
});
