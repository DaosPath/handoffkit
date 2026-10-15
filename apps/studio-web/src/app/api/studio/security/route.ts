import { loadStudioSecuritySnapshot } from "@/lib/studio/security-events.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await loadStudioSecuritySnapshot();
  return Response.json(snapshot, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
