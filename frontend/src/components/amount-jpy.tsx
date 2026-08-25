import { cn } from "@/lib/utils";

/**
 * price_minor(1円 = 1 minor unit)の金額表示。小数を表示しない。
 * 通貨単位は取引通貨のJPYCで統一する。
 */
export function AmountJpy({
  amountMinor,
  className,
}: {
  amountMinor: string | number | bigint;
  className?: string;
}) {
  const formatted = BigInt(amountMinor).toLocaleString("ja-JP");
  return (
    <span className={cn("font-semibold tabular-nums", className)}>
      {formatted}
      <span className="ml-1 text-sm font-normal text-muted-foreground">
        JPYC
      </span>
    </span>
  );
}
