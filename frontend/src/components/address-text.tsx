"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const explorerBaseUrl =
  process.env.NEXT_PUBLIC_PAYMENT_EXPLORER_URL || "https://polygonscan.com";

/**
 * EVMアドレス・tx hashの短縮表示。コピーとexplorerリンクを備える。
 */
export function AddressText({
  value,
  kind = "address",
  className,
}: {
  value: string;
  kind?: "address" | "tx";
  className?: string;
}) {
  const [isCopied, setIsCopied] = useState(false);
  const short = `${value.slice(0, 8)}…${value.slice(-6)}`;
  const explorerPath = kind === "tx" ? "tx" : "address";

  async function copy() {
    await navigator.clipboard.writeText(value);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="font-mono text-sm">{short}</span>
      <button
        type="button"
        onClick={() => void copy()}
        className="text-muted-foreground hover:text-foreground"
        aria-label="コピー"
      >
        {isCopied ? (
          <Check className="size-3.5 text-success" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </button>
      <a
        href={`${explorerBaseUrl}/${explorerPath}/${value}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-foreground"
        aria-label="エクスプローラーで確認"
      >
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </span>
  );
}
