import { appendStudioBrowserControl, loadStudioBrowserSnapshot } from "@/lib/studio/browser-events.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await loadStudioBrowserSnapshot();
  return Response.json(snapshot, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  let action = "";
  let sessionId = "";
  let expectedVersion = 0;
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object") {
      const payload = body as { action?: unknown; session_id?: unknown; expected_version?: unknown };
      action = String(payload.action ?? "");
      sessionId = String(payload.session_id ?? "");
      expectedVersion = Number(payload.expected_version ?? 0) || 0;
    }
  } catch {
    action = "";
  }
  const result = await appendStudioBrowserControl(action, sessionId, expectedVersion);
  return Response.json(result, {
    status: result.ok ? 200 : result.error_code === "invalid_request" ? 400 : 409,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
