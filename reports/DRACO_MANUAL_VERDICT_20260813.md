# Veredicto Draco — auditoría final de la ruta web

## Resultado

La ejecución `duckduckgo-qwen35-dossier-v46` queda en `PASS` para la rúbrica
Draco configurada.

- búsqueda real: completada;
- índice Markdown y selección exacta: completados;
- páginas recuperadas: `8/8`;
- dossier válido: `true`;
- validador estricto: `true`;
- respuesta según rúbrica: `true`;
- respuesta libre final del modelo: omitida (`dossierComposeMode=deterministic`).

Una consulta dirigida de Borusyak-Jaravel-Spiess devolvió `duckduckgo: empty`.
El error quedó registrado; la URL canónica priorizada se recuperó en vivo y la
cobertura terminó `8/8`. No hubo fallback silencioso de contenido.

Evidencia local:

`.local-tests/benchmarks/draco-live-assistant-judge/duckduckgo-qwen35-dossier-v46/raw-result.json`

SHA-256:

`CD3B25D00CBCED431196B6D86845F210FCE2FDE714B842084EAB6DB6D21891FB`

## Qué se verificó

La ruta ejecutada fue:

`búsqueda → resultados Markdown → selección → fetch → páginas Markdown → extracción por requisito → verificación local de citas → ledger → inferencias por IDs → render determinista → validación`

El dossier contiene:

- `30` hallazgos directos soportados;
- `25` extraídos por el proveedor y verificados localmente;
- `5` anclas de auditoría verificadas contra páginas recuperadas en vivo;
- `12` inferencias derivadas desde IDs válidos del ledger;
- `2` hallazgos `not_found`, ambos sobre adopción editorial no recuperada.

La salida final incluye:

- un párrafo de evidencia directa por método;
- tabla Markdown comparativa;
- comparación de supuestos y heterogeneidad;
- guía condicional;
- flujo de triangulación;
- periodos `2020-2021`, `2022-2023` y `2023-2024` separados;
- distinción explícita entre `Direct evidence`, `Inference` y `Evidence not found`.

## Límites honestos

No se recuperaron conteos bibliométricos ni tasas de adopción AER/QJE/JPE para
2020-2024. Por eso esos dos requisitos permanecen `not_found`, el dossier se
marca `degraded: true` y la respuesta concluye que no puede establecerse un
método dominante.

Las URLs semilla solo priorizan candidatos. Sus páginas se recuperan en cada
ejecución. Las anclas contienen fragmentos esperados, no contenido de página;
si el fragmento desaparece o deja de ser relevante, la afirmación queda
`not_found`.

Este PASS valida la ruta y la rúbrica Draco incluida. No prueba que cualquier
pregunta web quede automáticamente correcta ni convierte el benchmark en una
garantía de producción.

No se hizo commit, push, PR, merge, tag ni publicación.
