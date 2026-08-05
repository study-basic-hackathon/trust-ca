import { NextRequest, NextResponse } from "next/server";
import { createSeller } from "@/lib/db";

const MAX_DISPLAY_NAME_LENGTH = 100;

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be JSON" },
      { status: 400 },
    );
  }

  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : "";

  if (!displayName || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return NextResponse.json(
      {
        success: false,
        error: `displayName is required (1-${MAX_DISPLAY_NAME_LENGTH} characters)`,
      },
      { status: 400 },
    );
  }

  try {
    const seller = createSeller(displayName);
    return NextResponse.json({ success: true, data: seller }, { status: 201 });
  } catch (error) {
    console.error("Failed to create seller:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create seller" },
      { status: 500 },
    );
  }
}
