import { 
  Agent, 
  Team, 
  HandoffProtocol, 
  HandoffState, 
  HandoffQualityEvaluator, 
  RunTrace, 
  defineTool 
} from "@handoffkit/core";

import { 
  OpenAICompatibleProvider, 
  RetryPolicy 
} from "@handoffkit/providers";

import { 
  TemplateScaffolder 
} from "@handoffkit/templates";

import { 
  RecipeRunner, 
  WorkflowTemplate 
} from "@handoffkit/recipes";

import { 
  FileTraceStore, 
  writeReportFiles, 
  ProjectIndexer 
} from "@handoffkit/node";

import { 
  renderReport 
} from "@handoffkit/cli";

import path from "node:path";
import { rm } from "node:fs/promises";

// Esta demo asume que se ejecuta dentro del entorno local o mediante paquetes instalados
const TEST_DIR = path.join(process.cwd(), ".local-tests/demo-all-packages");

async function main() {
  console.log("=== INICIANDO DEMO COMPLETA DE TODOS LOS PAQUETES Y ESTADOS ===");

  // Limpiar directorio de pruebas local si existe
  try {
    await rm(TEST_DIR, { recursive: true, force: true });
  } catch (_) {}

  // 1. @handoffkit/templates - Scaffolding de un proyecto
  console.log("\n[1/5] @handoffkit/templates - Creando andamiaje del proyecto...");
  const scaffolder = new TemplateScaffolder();
  const scaffoldResult = await scaffolder.scaffold("mi-agente-demo", {
    output: TEST_DIR,
    template: "basic-agent",
    force: true,
  });
  console.log("Proyecto creado con éxito. Archivos generados:");
  console.log(scaffoldResult.filesWritten.map(f => `  - ${f}`).join("\n"));

  // 2. @handoffkit/providers - Proveedor de LLM (NVIDIA o Mock si no hay clave de API)
  console.log("\n[2/5] @handoffkit/providers - Configurando proveedor...");
  const useRealAPI = Boolean(process.env.NVIDIA_API_KEY);
  
  const provider = new OpenAICompatibleProvider({
    provider: "nvidia",
    model: "meta/llama-3.1-8b-instruct",
    retryPolicy: new RetryPolicy({ maxAttempts: 2 }),
  });
  
  console.log(`Proveedor: ${provider.name} | URL: ${provider.baseURL} | Modelo: ${provider.model}`);

  if (!useRealAPI) {
    console.log("AVISO: No se detectó la variable NVIDIA_API_KEY. La ejecución de la receta fallará si intenta conectarse a la red sin credenciales.");
  }

  // 3. @handoffkit/core - Agentes, Herramientas y Protocolo
  console.log("\n[3/5] @handoffkit/core - Creando Agentes, Herramientas y Protocolo...");
  
  const sumTool = defineTool({
    name: "sumar",
    description: "Suma dos números.",
    parameters: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"]
    },
    execute: ({ a, b }) => a + b
  });

  const planner = new Agent({
    name: "Planner",
    role: "Eres un planificador de tareas matemáticas. Escribe una oración con el plan para resolver el problema.",
    provider: provider
  });

  const solver = new Agent({
    name: "Solver",
    role: "Eres un matemático experto. Resuelve la tarea usando el plan provisto.",
    provider: provider
  });

  const protocol = new HandoffProtocol({ mode: "hybrid_state" });

  const manualHandoff = new HandoffState({
    task: "Calcular la suma de 5 y 10",
    fromAgent: "User",
    toAgent: "Planner",
    summary: "Se requiere calcular la suma de dos números.",
    decisions: ["Usar la herramienta 'sumar' para el cálculo."],
    importantFiles: ["operaciones.json"],
    errors: ["Ninguno reportado."],
    nextSteps: ["Ejecutar la herramienta sumar con los números 5 y 10."],
    contextRefs: ["documento_referencia.md"],
    metadata: { version: "1.9.0", environment: "demo" }
  });

  console.log("Estado de Handoff manual validado correctamente:", manualHandoff.validate() instanceof HandoffState);

  const evaluator = new HandoffQualityEvaluator();
  const qualityReport = evaluator.evaluate(manualHandoff);
  console.log(`Evaluación de calidad de Handoff: Grado: ${qualityReport.grade} | Puntuación: ${qualityReport.score}`);

  // 4. @handoffkit/recipes - Ejecutando una Receta de Workflow
  console.log("\n[4/5] @handoffkit/recipes - Ejecutando receta 'plan-execute-review'...");
  const recipe = WorkflowTemplate.planExecuteReview({
    name: "calculo-matematico",
    task: "Sumar 15 y 30 utilizando la herramienta.",
    planner: planner,
    executor: solver,
    reviewer: new Agent({
      name: "Reviewer",
      role: "Eres un revisor de resultados. Confirma si el resultado es correcto.",
      provider: provider
    })
  });

  const runner = new RecipeRunner(recipe);
  let recipeResult;
  if (useRealAPI) {
    recipeResult = await runner.arun("Sumar 15 y 30.");
    console.log("Resultado de la receta:");
    console.log(recipeResult.toMarkdown());
  } else {
    console.log("Omitiendo ejecución de la receta por falta de NVIDIA_API_KEY.");
    return;
  }

  // 5. @handoffkit/node - Guardar Traces y Reportes
  console.log("\n[5/5] @handoffkit/node - Guardando traza de ejecución e indexando...");
  const traceStore = new FileTraceStore({ root: path.join(TEST_DIR, "traces") });
  
  const trace = RunTrace.fromTeamResult(recipeResult, { name: "trace-demo" });
  await traceStore.save(trace, "ejecucion_final");
  
  const reportPaths = await writeReportFiles(trace, "ejecucion_final", path.join(TEST_DIR, "reports"));
  console.log(`Reporte JSON escrito en: ${reportPaths.jsonPath}`);
  console.log(`Reporte Markdown escrito en: ${reportPaths.markdownPath}`);

  const indexer = new ProjectIndexer({ root: path.join(TEST_DIR, "mi-agente-demo") });
  const indexedFiles = indexer.index();
  console.log(`Archivos indexados en el subproyecto: ${indexedFiles.length}`);
  for (const doc of indexedFiles) {
    console.log(`  - [${doc.path}] Summary: ${doc.summary}`);
  }

  // 6. @handoffkit/cli - Renderizar el Reporte mediante la CLI
  console.log("\n[EXTRA] @handoffkit/cli - Renderizando reporte generado...");
  const renderedMarkdown = await renderReport(reportPaths.jsonPath);
  console.log("\n--- REPORTE RENDERIZADO POR LA CLI (MARKDOWN) ---");
  console.log(renderedMarkdown);
  console.log("-------------------------------------------------");

  console.log("\n=== DEMO FINALIZADA CON ÉXITO ===");
}

main().catch(err => {
  console.error("Error en la demo:", err);
});
