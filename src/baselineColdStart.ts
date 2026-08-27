import { task } from "@trigger.dev/sdk";
import { getTunnelTiming } from "../runtime/tunnel.js";

/**
 * Baseline with NO tunnel (the middleware skips ensureTunnel for this task id),
 * to compare cold-start behavior against the tunnel task.
 */
export const baselineColdStart = task({
  id: "baseline-cold-start",
  run: async () => {
    return { ok: true, tunnel: getTunnelTiming() ?? "no-tunnel" };
  },
});
