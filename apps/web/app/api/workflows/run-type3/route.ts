import { connection, NextResponse, type NextRequest } from "next/server";
import { workerApiGuard } from "../../../../lib/worker-api-guard";
import { runScheduledType3 } from "../../../../lib/workflow-runtime";

export async function POST(request: NextRequest) {
  await connection();
  // `?force=1` bypasses the daily-time gate for an on-demand "sweep now"; without
  // it the sweep runs at most once per Beijing day, only after the configured
  // time — so the Settings time is authoritative however often cron pings here.
  const force = new URL(request.url).searchParams.get("force") === "1";
  // Read `force` BEFORE the guard: forcing is the one thing an anonymous caller
  // could use to bypass the once-per-day gate, so it is the one path that never
  // runs without a worker secret (see lib/worker-api-guard.ts).
  const denied = workerApiGuard(request, { force });
  if (denied) return denied;

  const result = await runScheduledType3({ force });
  return NextResponse.json(result);
}

// Vercel Cron / system cron hit scheduled endpoints with GET; reuse POST.
export async function GET(request: NextRequest) {
  return POST(request);
}
