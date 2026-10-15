#!/usr/bin/env node
import { runCli } from "./index.js";

const code = await runCli();
if (typeof code === "number" && code !== 0) {
  process.exitCode = code;
}
