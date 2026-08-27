import { task } from "@trigger.dev/sdk";
import { getTunnelTiming, getAwaitMs } from "../runtime/tunnel.js";
import { pgSelect } from "../runtime/db.js";

/**
 * Reaches the tailnet-private Postgres through the userspace tunnel and reports
 * the tunnel setup timing (0 when the tunnel was reused across warm starts).
 */
export const queryPrivateGcp = task({
  id: "query-private-gcp",
  run: async () => {
    const qStart = Date.now();
    const rows = await pgSelect("select now() as ts, inet_server_addr() as ip, version() as version");
    const queryMs = Date.now() - qStart;

    return { postgres: rows[0], queryMs, awaitMs: getAwaitMs(), tunnel: getTunnelTiming() };
  },
});
