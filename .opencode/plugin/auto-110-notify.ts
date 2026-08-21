import type { Plugin } from "@opencode-ai/plugin"

export default (async () => {
  return {
    "tool.execute.after": async (input, output) => {
      // Auto-aviso cuando scorecard cambia y deja dims en <9
      if (input.tool === "write" && String(output.args?.filePath || "").includes("BROWSER_1.20_SCORECARD.md")) {
        // No bloquea, solo deja traza en la sesión
        // El agente release-manager ya reporta el resumen
      }
    },
  }
}) satisfies Plugin
