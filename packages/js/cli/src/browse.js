/**
 * CLI helpers for `handoffkit-js browse …`
 */
export async function runBrowseCommand(argv = [], io = {}) {
  const stdout = io.stdout || ((text) => console.log(text));
  const {
    createBrowserAgentKit,
    makeFixtureMapTransport,
    webSearch,
    gatherWebResearch,
    researchPromptSection,
  } = await import("@handoffkit/browser");

  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    stdout([
      "handoffkit-js browse",
      "",
      "  browse search <query> [--max 6] [--json] [--allow host] [--deny host]",
      "  browse fetch <url> [--markdown|--json] [--format markdown|readme]",
      "  browse research <query> [--max-pages 3] [--json|--markdown] [--cache] [--allow host]",
      "  browse deep <query> [--max-pages 8] [--max-depth 2] [--json|--markdown] [--cache]",
      "  browse fixture",
      "  browse tools",
    ].join("\n"));
    return 0;
  }

  const asJson = rest.includes("--json");
  const asMarkdown = rest.includes("--markdown");
  const useCache = rest.includes("--cache");
  const useFixture = rest.includes("--fixture") || rest.includes("--transport=fixture");
  const max = Number(readBrowseFlag(rest, "--max") || readBrowseFlag(rest, "--max-pages") || 0) || undefined;
  const maxDepth = Number(readBrowseFlag(rest, "--max-depth") || 0) || undefined;
  const format = readBrowseFlag(rest, "--format") || "markdown";
  const allowHosts = collectBrowseFlags(rest, "--allow");
  const denyHosts = collectBrowseFlags(rest, "--deny");

  const kit = createBrowserAgentKit({
    fixture: useFixture,
    useCache,
    allowHosts,
    denyHosts,
    format,
    maxPages: max || 3,
  });

  if (sub === "tools") {
    stdout(kit.tools.map((t) => t.name).join("\n"));
    return 0;
  }

  if (sub === "fixture") {
    const transport = makeFixtureMapTransport();
    const pack = await gatherWebResearch({
      seedUrls: ["https://fixture.local/"],
      seedOnly: true,
      transport,
      maxPages: 3,
      preferExplore: true,
      maxDepth: 1,
    });
    stdout(asJson ? JSON.stringify(pack.toDict(), null, 2) : pack.markdown_context || researchPromptSection(pack));
    return pack.pages_ok > 0 ? 0 : 1;
  }

  if (sub === "search") {
    const query = rest.filter((a) => !a.startsWith("--")).join(" ").trim();
    if (!query) throw new Error("browse search requires a query.");
    const result = await webSearch(query, {
      transport: kit.transport,
      maxResults: max || 6,
      allowHosts,
      denyHosts,
    });
    if (asJson) stdout(JSON.stringify(result, null, 2));
    else {
      stdout(`query: ${result.query}`);
      stdout(`count: ${result.count}`);
      for (const hit of result.results) {
        stdout(`- ${hit.title || "(untitled)"} :: ${hit.url}`);
      }
    }
    return result.success ? 0 : 1;
  }

  if (sub === "fetch") {
    const url = rest.find((a) => !a.startsWith("--"));
    if (!url) throw new Error("browse fetch requires a url.");
    const page = await kit.fetchMarkdown(url, { format, maxChars: 60000 });
    if (asJson) stdout(JSON.stringify(page.toDict(), null, 2));
    else stdout(page.markdown || page.error || "");
    return page.success ? 0 : 1;
  }

  if (sub === "research") {
    const query = rest.filter((a) => !a.startsWith("--")).join(" ").trim();
    if (!query) throw new Error("browse research requires a query.");
    const pack = await kit.gather({
      query,
      maxPages: max || 3,
      allowHosts,
      denyHosts,
      format,
      useCache,
    });
    if (asJson) stdout(JSON.stringify(pack.toDict(), null, 2));
    else if (asMarkdown) stdout(pack.markdown_context);
    else stdout(researchPromptSection(pack) || pack.error || "no research");
    return pack.pages_ok > 0 ? 0 : 1;
  }

  if (sub === "deep") {
    const query = rest.filter((a) => !a.startsWith("--")).join(" ").trim();
    if (!query) throw new Error("browse deep requires a query.");
    const pack = await kit.deepGather({
      query,
      maxPages: max || 8,
      maxDepth: maxDepth ?? 2,
      seedUrls: useFixture ? ["https://fixture.local/"] : [],
      autoSearch: !useFixture,
      allowHosts,
      denyHosts,
      format,
      useCache,
    });
    if (asJson) stdout(JSON.stringify(pack.toDict(), null, 2));
    else if (asMarkdown) stdout(pack.markdown_context);
    else stdout(researchPromptSection(pack) || pack.error || "no deep research");
    return pack.pages_ok > 0 ? 0 : 1;
  }

  throw new Error(`Unknown browse subcommand: ${sub}`);
}

function readBrowseFlag(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function collectBrowseFlags(argv, name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
      out.push(value);
      i += 1;
    }
  }
  return out;
}
