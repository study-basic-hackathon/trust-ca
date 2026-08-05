import { NextResponse } from "next/server";
import { getRecentWebhookLogs } from "@/lib/db";

/** Recent webhook deliveries (no raw payloads — audit metadata only). */
export async function GET() {
  try {
    return NextResponse.json({ success: true, data: getRecentWebhookLogs() });
  } catch (error) {
    console.error("Failed to read webhook logs:", error);
    return NextResponse.json(
      { success: false, error: "Failed to read webhook logs" },
      { status: 500 },
    );
  }
}
