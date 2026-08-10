import { NextRequest, NextResponse } from "next/server";
import { createVerificationSession, DiditApiError } from "@/lib/didit/client";
import { createVerification, getSellerById } from "@/lib/db";
import { getAppBaseUrl } from "@/lib/env";

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

  const sellerId = typeof body.sellerId === "string" ? body.sellerId : "";
  const seller = sellerId ? getSellerById(sellerId) : null;
  if (!seller) {
    return NextResponse.json(
      { success: false, error: "Unknown sellerId" },
      { status: 404 },
    );
  }

  try {
    const session = await createVerificationSession({
      vendorData: seller.id,
      callbackUrl: `${getAppBaseUrl()}/callback?sellerId=${encodeURIComponent(seller.id)}`,
    });

    createVerification({ sessionId: session.sessionId, sellerId: seller.id });

    return NextResponse.json(
      {
        success: true,
        data: { sessionId: session.sessionId, sessionUrl: session.sessionUrl },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create KYC session:", error);
    const message =
      error instanceof DiditApiError
        ? error.message
        : "Failed to create verification session";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
