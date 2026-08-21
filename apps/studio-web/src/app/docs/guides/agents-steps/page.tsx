import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs/DocsShell";
import { CodeBlock } from "@/components/docs/CodeBlock";

export const metadata: Metadata = { title: "Agents & Steps" };

const toc = [
  { id: "agents", title: "Agents" },
  { id: "teams", title: "Teams as steps" },
  { id: "recipes", title: "Recipe steps" },
  { id: "async", title: "Async" },
];

export default function AgentsStepsPage() {
  return (
    <DocsShell toc={toc}>
      <div className="docs-prose">
        <p className="section-label">Guides</p>
        <h1 className="!mt-0 text-[clamp(1.75rem,3vw,2.35rem)] font-extrabold tracking-[-0.035em] text-[var(--navy)]">
          Agents &amp; Steps
        </h1>
        <p>
          Agents are named workers with a role and provider. Steps are the
          executable units in a team or recipe that advance shared state.
        </p>

        <h2 id="agents">Agents</h2>
        <CodeBlock
          code={`from handoffkit import Agent

architect = Agent("Architect", "Plan the work.")
coder = Agent("Coder", "Implement the work.")

# Optional: pass provider, tools, and metadata
# architect = Agent(name="Architect", role="...", provider=my_provider)`}
          filename="agents.py"
          language="python"
        />
        <CodeBlock
          code={`import { Agent } from "@handoffkit/core";

const agent = new Agent({
  name: "Architect",
  role: "Plan the work.",
});
const result = agent.run("Outline a CLI calculator.");
console.log(result.finalOutput);`}
          filename="agents.js"
          language="javascript"
        />

        <h2 id="teams">Teams as sequential steps</h2>
        <p>
          <code>Team.run(task)</code> executes agents in order. Each agent after
          the first receives a <code>HandoffState</code> produced by the protocol.
        </p>
        <CodeBlock
          code={`from handoffkit import Agent, HandoffProtocol, Team

team = Team(
    agents=[
        Agent("Planner", "Plan."),
        Agent("Reviewer", "Review."),
    ],
    protocol=HandoffProtocol(mode="hybrid_state"),
)
result = team.run("Create a release checklist.")
assert len(result.handoffs) == 1`}
          filename="team_steps.py"
          language="python"
        />

        <h2 id="recipes">Recipe steps</h2>
        <p>
          Recipes define named steps with responsibilities. Use built-ins or
          register your own via <code>Extension</code> /{" "}
          <code>ExtensionRegistry</code>.
        </p>
        <CodeBlock
          code={`from handoffkit.recipes.builtins import plan_execute_review_recipe
from handoffkit import RecipeRunner

recipe = plan_execute_review_recipe()
result = RecipeRunner(recipe).run(
    initial_task="Create a short local release checklist."
)
print(result.to_markdown())`}
          filename="recipe.py"
          language="python"
        />

        <h2 id="async">Async runtime</h2>
        <p>
          Sync APIs remain the compatibility baseline. Async helpers are additive:
          <code>Agent.arun()</code>, <code>Team.arun()</code>,{" "}
          <code>RecipeRunner.arun()</code> in Python;{" "}
          <code>arun()</code> / <code>arunWithTools()</code> in TypeScript.
        </p>
        <CodeBlock
          code={`result = await team.arun("Create a short async release checklist.")`}
          filename="async.py"
          language="python"
        />

        <p>
          Next: <Link href="/docs/guides/state">State Management</Link>
        </p>
      </div>
    </DocsShell>
  );
}
