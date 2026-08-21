import { ClinicalError } from "@handoffkit/clinical";
import {
  actClinicalRun,
  clinicalErrorStatus,
  clinicalManifests,
  createClinicalRun,
  loadClinicalRun,
  startClinicalBenchmark,
} from "@/lib/studio/clinical-lab.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Clinical-Stream": "snapshot",
};

const MAX_BODY = 65_536;
const hits = new Map<string, number[]>();

type RouteProps = { params: Promise<{ path?: string[] }> };

function json(status: number, payload: unknown) {
  return Response.json(payload, { status, headers: HEADERS });
}

function clientKey(request: Request) {
  return request.headers.get("x-forwarded-for") || "local";
}

function rateLimit(request: Request) {
  const now = Date.now();
  const key = clientKey(request);
  const bucket = (hits.get(key) || []).filter((item) => now - item < 10_000);
  if (bucket.length >= 60) {
    throw new ClinicalError("rate limit exceeded", { code: "invalid_request" });
  }
  bucket.push(now);
  hits.set(key, bucket);
}

function loopback(request: Request) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  if (host && !["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new ClinicalError("clinical demo is restricted to loopback", { code: "invalid_request" });
  }
}

function safeId(value: string | undefined) {
  const id = String(value || "");
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id) || id.includes("..")) {
    throw new ClinicalError("invalid run id", { code: "invalid_request" });
  }
  return id;
}

export async function GET(request: Request, { params }: RouteProps) {
  const parts = (await params).path ?? [];
  try {
    loopback(request);
    rateLimit(request);
    if (parts.length === 1 && parts[0] === "manifests") {
      return json(200, clinicalManifests());
    }
    if (parts[0] === "runs" && parts[1] && parts[2] === "events") {
      const run = loadClinicalRun(safeId(parts[1]));
      return json(200, { stream: "snapshot", run: run.toWire() });
    }
    if (parts[0] === "runs" && parts[1] && parts.length === 2) {
      return json(200, loadClinicalRun(safeId(parts[1])).toWire());
    }
    if (parts[0] === "benchmarks" && parts[1] && parts[2] === "report") {
      return json(409, {
        code: "run_incomplete",
        message: "official report cannot be published until 897/897 is complete",
        details: {},
      });
    }
    if (parts[0] === "benchmarks" && parts[1]) {
      return json(200, startClinicalBenchmark({ official: false }));
    }
    return json(404, { code: "invalid_request", message: "not found" });
  } catch (error) {
    const mapped = clinicalErrorStatus(error);
    return json(mapped.status, mapped.body);
  }
}

export async function POST(request: Request, { params }: RouteProps) {
  const parts = (await params).path ?? [];
  let body: Record<string, unknown> = {};
  try {
    loopback(request);
    rateLimit(request);
    const raw = await request.arrayBuffer();
    if (raw.byteLength > MAX_BODY) {
      return json(400, { code: "invalid_request", message: "request body too large", details: {} });
    }
    const parsed: unknown = raw.byteLength ? JSON.parse(new TextDecoder().decode(raw)) : {};
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  try {
    if (parts.length === 1 && parts[0] === "runs") {
      return json(201, createClinicalRun(body).toWire());
    }
    if (parts[0] === "runs" && parts[1] && parts[2] === "actions") {
      return json(200, actClinicalRun(safeId(parts[1]), body).toWire());
    }
    if (parts.length === 1 && parts[0] === "benchmarks") {
      return json(201, startClinicalBenchmark(body));
    }
    return json(404, { code: "invalid_request", message: "not found" });
  } catch (error) {
    const mapped = clinicalErrorStatus(error);
    return json(mapped.status, mapped.body);
  }
}
