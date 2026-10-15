# Draco — paquete de revisión reproducible

## Ejecución canónica

| Campo | Valor |
|---|---|
| Run | `duckduckgo-qwen35-dossier-v46` |
| Estado | `pass` |
| Proveedor de búsqueda | DuckDuckGo mediante Browser Lite |
| Consultas dirigidas | `8` |
| Máximo de candidatos | `32` |
| URLs seleccionadas | `8` |
| Páginas recuperadas | `8/8` |
| Claims directos soportados | `30` |
| Inferencias verificadas | `12` |
| Claims no encontrados | `2` |
| Validador de respuesta | `pass` |
| SHA-256 | `CD3B25D00CBCED431196B6D86845F210FCE2FDE714B842084EAB6DB6D21891FB` |

Artefacto:

`.local-tests/benchmarks/draco-live-assistant-judge/duckduckgo-qwen35-dossier-v46/raw-result.json`

Una de las ocho consultas dirigidas devolvió `duckduckgo: empty`. El artefacto
lo conserva en `search_errors`; la candidata canónica correspondiente fue
recuperada en vivo y no se ocultó el fallo parcial del buscador.

## Contratos implementados

### Evidencia directa

Cada requisito se procesa por separado. Un hallazgo `supported` necesita:

1. declaración no vacía;
2. cita corta;
3. cita localizada nuevamente en una página recuperada;
4. solapamiento semántico entre requisito, declaración y cita.

Una cita literal pero ajena al requisito se rechaza. Una salida malformada se
repara de forma limitada; si no puede repararse, queda `not_found`.

### Anclas auditables

`deterministicEvidence` / `deterministic_evidence` permite fijar una cita
esperada para una rúbrica estable. La cita se vuelve a buscar en el Markdown
recuperado en vivo. No encontrarla produce `not_found`, sin fallback silencioso.

### Inferencias

`deterministicFindings` / `deterministic_findings` referencia IDs del ledger.
Una inferencia positiva requiere al menos dos claims `supported`. Una
limitación puede referenciar claims `not_found`, pero no convertirlos en una
afirmación positiva.

### Render

Python y JavaScript conservan paridad para:

- `bullets`;
- `paragraph`;
- `table`;
- etiquetas de evidencia directa, inferencia y ausencia;
- URLs semilla con fetch real;
- dossier y auditoría en wire format `snake_case`.

## Fallo cerrado probado

- cita no localizada;
- cita localizada pero semánticamente irrelevante;
- claim-ID inexistente;
- polaridad incompatible entre inferencia y claims;
- selección inválida;
- página seleccionada no recuperada;
- respuesta que afirma dominancia sin evidencia;
- atribución cruzada de software o mecánica entre métodos.

## Evidencia no disponible

La corrida no encontró conteos editoriales AER/QJE/JPE ni tasas de adopción
2020-2024. Los tres periodos aparecen como no verificados y no se establece
dominancia metodológica.

## Pruebas locales relacionadas

- `@handoffkit/recipes`: `19/19`;
- Browser Lite JavaScript: `31` pass, `1` smoke live omitido por flag;
- Python browser + compatibilidad pública: `32/32`;
- sintaxis JavaScript/Python: pass;
- Ruff `F,E9`: pass;
- `git diff --check`: pass.

No se hizo commit, push, PR, merge, tag ni publicación.
