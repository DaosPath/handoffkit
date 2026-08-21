---
description: Pipeline completo para cerrar 1.20 Browser Platform (valida local, regenera evidencias, commit, push y vigila hosted)
agent: release-manager
---

Ejecuta el cierre de HandoffKit 1.20 sin pedir órdenes intermedias:

1. Lee docs/roadmap/1.20-BROWSER-PLATFORM.md, reports/BROWSER_1.20_EVIDENCE.json y reports/BROWSER_1.20_SCORECARD.md para saber qué falta (4 gates hosted: Search #10 google-live, Stability #9 soak, Security #10 CodeQL, Performance #3/#9/#10 matrix+checksums+soak).
2. Valida local:
   - `pnpm workspace:validate && pnpm js:typecheck`
   - `pnpm js:pack:check && pnpm js:pack:consumer`
   - `pnpm security:dependencies` (debe quedar pass, si no actualiza deps)
   - `pnpm js:pack:checksums` (genera reports/BROWSER_1.20_PACKAGE_CHECKSUMS_win32_x64.json)
   - `node scripts/js/browser-1.20-scorecard.mjs`
   - Tests críticos: `pnpm --dir packages/js/browser test` y `uv run --project packages/python pytest packages/python/tests/test_browser.py packages/python/tests/test_browser_core.py packages/python/tests/test_browser_grounding.py -q`
3. Si hay reports nuevos o fixes, haz `git add -A` (ignorando .local-tests/ y secretos), commitea con `feat(browser): 1.20 rc.X — ...` y `git push origin browser/1.20-platform`.
4. Vigila hosted: `gh run list --branch browser/1.20-platform` y `gh api repos/DaosPath/handoffkit/actions/runs`. Reporta status de CI y CodeQL. Explica que `browser-real-soak.yml` (4h/1000) solo se puede disparar cuando esté en `main` (ahora da 404) — propón promoverlo si hace falta.
5. Al final imprime: scorecard resumido (dims >=9 vs <9), links a runs, y próximo paso concreto para llegar a 10/10. No spamees subagentes, hazlo directo.

Argumentos extra del usuario: $ARGUMENTS
