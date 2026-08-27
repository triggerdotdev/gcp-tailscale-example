import { task, wait, metadata, logger } from "@trigger.dev/sdk";
import { ensureTunnelHealthy, getTunnelTiming } from "../runtime/tunnel.js";
import { pgSelect } from "../runtime/db.js";

/**
 * Proves the tunnel survives checkpoint/restore. Queries the private Postgres,
 * then blocks on a wait token long enough (>1 min, externally completed) to be
 * checkpointed and restored, then probes the tunnel and queries again.
 */
export const checkpointRestore = task({
  id: "checkpoint-restore",
  run: async () => {
    const before = await pgSelect("select now() as ts, inet_server_addr() as ip");
    const tunnelBefore = getTunnelTiming();

    const token = await wait.createToken({ timeout: "2h" });
    metadata.set("tokenId", token.id);
    logger.info("created wait token", { tokenId: token.id });

    const waitStart = Date.now();
    const result = await wait.forToken<{ resumedAt: number }>(token);
    const waitedMs = Date.now() - waitStart;

    const probeStart = Date.now();
    const health = await ensureTunnelHealthy();
    const healthMs = Date.now() - probeStart;

    const qStart = Date.now();
    const after = await pgSelect("select now() as ts, inet_server_addr() as ip");
    const afterQueryMs = Date.now() - qStart;

    return {
      before: before[0],
      after: after[0],
      waitedMs,
      waitOk: result.ok,
      survivedWithoutReconnect: !health.reconnected,
      health,
      healthMs,
      afterQueryMs,
      tunnelBefore,
    };
  },
});
