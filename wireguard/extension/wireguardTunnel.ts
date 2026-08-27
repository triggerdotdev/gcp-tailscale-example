import type { BuildExtension } from "@trigger.dev/build";

export type WireguardTunnelOptions = {
  /** wireproxy release version. See https://github.com/windtf/wireproxy/releases */
  version?: string;
  arch?: "amd64" | "arm64";
};

/**
 * Bakes the userspace WireGuard client `wireproxy` into the deployed image.
 * wireproxy runs a static WireGuard tunnel (no coordination server) and exposes
 * a local SOCKS5 proxy, so it needs no TUN device and no NET_ADMIN. Pairs with
 * the runtime bootstrap in wireguard/runtime/wgTunnel.ts.
 */
export function wireguardTunnel(options: WireguardTunnelOptions = {}): BuildExtension {
  const version = options.version ?? "v1.1.3";
  const arch = options.arch ?? "amd64";
  const url = `https://github.com/windtf/wireproxy/releases/download/${version}/wireproxy_linux_${arch}.tar.gz`;

  return {
    name: "wireguardTunnel",
    onBuildComplete(context) {
      if (context.target === "dev") return;
      context.addLayer({
        id: "wireguard-tunnel",
        image: {
          instructions: [
            `RUN apt-get update \\`,
            `  && apt-get install -y --no-install-recommends curl ca-certificates \\`,
            `  && curl -fsSL "${url}" -o /tmp/wp.tgz \\`,
            `  && tar -xzf /tmp/wp.tgz -C /usr/local/bin wireproxy \\`,
            `  && chmod 755 /usr/local/bin/wireproxy \\`,
            `  && mkdir -p /home/node/.wg-state && chown -R node:node /home/node/.wg-state \\`,
            `  && rm -f /tmp/wp.tgz \\`,
            `  && apt-get clean && rm -rf /var/lib/apt/lists/*`,
          ],
        },
      });
    },
  };
}
