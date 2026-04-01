
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data } = await supabase
    .from("attendance_events")
    .select("status");

  const online = (data||[]).filter(x=>x.status==="online").length;
  const offline = (data||[]).filter(x=>x.status==="offline").length;

  return NextResponse.json({
    ok: true,
    online,
    offline
  });
}
