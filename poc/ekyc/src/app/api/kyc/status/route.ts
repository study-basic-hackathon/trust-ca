import { NextRequest, NextResponse } from "next/server";
import { getSessionDecision } from "@/lib/didit/client";
import {
  getEventsForSession,
  getLatestVerificationForSeller,
  getSellerById,
  updateVerification,
} from "@/lib/db";
import { isSellingAllowed, normalizeDecision } from "@/lib/didit/normalize";
import { deriveFlowSteps } from "@/lib/flow";

/**
 * GET /api/kyc/status?sellerId=...&refresh=1
 *
 * Returns the seller's latest verification state from the local DB.
 * With refresh=1 it first pulls the current decision from Didit — the
 * polling fallback that lets local development work without a public
 * webhook URL.
 */
export async function GET(request: NextRequest) {
  const sellerId = request.nextUrl.searchParams.get("sellerId") ?? "";
  const shouldRefresh = request.nextUrl.searchParams.get("refresh") === "1";

  const seller = sellerId ? getSellerById(sellerId) : null;
  if (!seller) {
    return NextResponse.json(
      { success: false, error: "Unknown sellerId" },
      { status: 404 },
    );
  }

  let verification = getLatestVerificationForSeller(seller.id);

  if (verification && shouldRefresh) {
    try {
      const decision = await getSessionDecision(verification.sessionId);
      const normalized = normalizeDecision(decision);
      updateVerification({
        sessionId: normalized.sessionId,
        status: normalized.status,
        checks: normalized.checks,
        source: "poll",
      });
      verification = getLatestVerificationForSeller(seller.id);
    } catch (error) {
      console.error("Didit decision refresh failed:", error);
      // Fall through: serve the last known local state rather than failing.
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      seller,
      verification,
      isSellingAllowed: verification
        ? isSellingAllowed(verification.status)
        : false,
      flowSteps: deriveFlowSteps(verification),
      events: verification ? getEventsForSession(verification.sessionId) : [],
    },
  });
}
