import type { BuildExtension } from "@trigger.dev/build";

export type TailscaleTunnelOptions = {
  /** Tailscale static build version to bake in. See https://pkgs.tailscale.com/stable/#static */
  version?: string;
  /** Target CPU arch of the deployed image. Trigger.dev cloud builds linux/amd64. */
  arch?: "amd64" | "arm64";
};

/**
 * Build extension that bakes the Tailscale userspace client (`tailscale` +
 * `tailscaled`) into the deployed task image. Adds ONLY bytes to the image via
 * `image.instructions`; requires no changes to trigger.dev itself.
 *
 * The auth key is NOT baked in. Provide it at runtime via a Trigger.dev env var
 * (e.g. TS_AUTHKEY) so it is stored encrypted and never lands in the image.
 *
 * Pairs with the runtime bootstrap in runtime/tunnel.ts, which starts the daemon
 * in userspace-networking mode (no TUN device, no NET_ADMIN) and exposes a local
 * SOCKS5 proxy the task routes DB traffic through.
 */
export function tailscaleTunnel(options: TailscaleTunnelOptions = {}): BuildExtension {
  const version = options.version ?? "1.102.3";
  const arch = options.arch ?? "amd64";
  const dir = `tailscale_${version}_${arch}`;
  const url = `https://pkgs.tailscale.com/stable/${dir}.tgz`;

  return {
    name: "tailscaleTunnel",
    onBuildComplete(context) {
      if (context.target === "dev") {
        return;
      }

      context.addLayer({
        id: "tailscale-tunnel",
        image: {
          instructions: [
            `RUN apt-get update \\`,
            `  && apt-get install -y --no-install-recommends curl \\`,
            `  && curl -fsSL "${url}" -o /tmp/ts.tgz \\`,
            `  && tar -xzf /tmp/ts.tgz -C /tmp \\`,
            `  && cp /tmp/${dir}/tailscale /tmp/${dir}/tailscaled /usr/local/bin/ \\`,
            `  && chmod 755 /usr/local/bin/tailscale /usr/local/bin/tailscaled \\`,
            `  && mkdir -p /home/node/.ts-state \\`,
            `  && chown -R node:node /home/node/.ts-state \\`,
            `  && rm -rf /tmp/ts.tgz /tmp/${dir} \\`,
            `  && apt-get clean && rm -rf /var/lib/apt/lists/*`,
          ],
        },
      });
    },
  };
}
