---
description: Vigila CI/CodeQL de la rama 1.20 y resume qué gates hosted faltan
agent: release-manager
---

Sin pedir confirmación:

1. Ejecuta `gh run list --branch browser/1.20-platform --limit 10` y `gh api repos/DaosPath/handoffkit/actions/runs?branch=browser/1.20-platform` para ver CI y CodeQL.
2. Lee `reports/BROWSER_1.20_SCORECARD.md` y `reports/BROWSER_1.20_EVIDENCE.json` y lista dims <9/10 con su fail reason.
3. Explica brevemente por qué `browser-real-soak.yml` da 404 vía API (no está en main) y cómo desbloquear soak 4h.
4. Da links directos a los runs y próximo comando a ejecutar. $ARGUMENTS
