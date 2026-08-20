"use client";

import { motion } from "framer-motion";

import { CircleCheck, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { AddressText } from "@/components/address-text";
import { AmountJpy } from "@/components/amount-jpy";
import { TrustBadge } from "@/components/trust-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { OrderDetail } from "@/lib/api/orders";

const EVENT_LABELS: Record<string, string> = {
  "order.paid": "支払い確定",
  "order.shipped": "発送",
  "order.completed": "取引完了",
};

/** 取引完了画面。サマリ・信頼シグナル・監査記録をまとめて表示する。 */
export function CompletionPanel({ order }: { order: OrderDetail }) {
  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="rounded-lg border border-success/40 bg-success/5 p-8 text-center"
      >
        <motion.div
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.1 }}
        >
          <CircleCheck className="mx-auto size-12 text-success" aria-hidden />
        </motion.div>
        <h2 className="mt-4 text-xl font-bold">取引が完了しました</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          お取引ありがとうございました。この取引の記録は改竄を検知できる形で保存されています。
        </p>
      </motion.div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">取引サマリ</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <dt className="text-muted-foreground">商品</dt>
            <dd className="col-span-2">{order.listingTitle}</dd>
            <dt className="text-muted-foreground">金額</dt>
            <dd className="col-span-2">
              <AmountJpy amountMinor={order.priceMinor} />
            </dd>
            <dt className="text-muted-foreground">販売者</dt>
            <dd className="col-span-2">{order.sellerDisplayName}</dd>
            <dt className="text-muted-foreground">購入者</dt>
            <dd className="col-span-2">{order.buyerDisplayName}</dd>
            <dt className="text-muted-foreground">完了日時</dt>
            <dd className="col-span-2">
              {order.completedAt
                ? new Date(order.completedAt).toLocaleString("ja-JP")
                : "—"}
            </dd>
          </dl>
          <Separator className="my-4" />
          <div className="flex flex-wrap gap-1.5">
            <TrustBadge signal="seller_verified" />
          </div>
        </CardContent>
      </Card>

      {order.auditAnchors.length > 0 && (
        <Card className="border-gold/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-5 text-gold" aria-hidden />
              監査記録
            </CardTitle>
            <CardDescription>
              各イベントのハッシュ値はブロックチェーンへ非同期に記録され、後から改竄されていないことを検証できます。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm">
              {order.auditAnchors.map((anchor) => (
                <li
                  key={anchor.eventType}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div>
                    <p className="font-medium">
                      {EVENT_LABELS[anchor.eventType] ?? anchor.eventType}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(anchor.occurredAt).toLocaleString("ja-JP")}
                    </p>
                  </div>
                  {anchor.txHash ? (
                    <AddressText value={anchor.txHash} kind="tx" />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      記録処理中
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="text-center">
        <Button asChild>
          <Link href="/listings">商品一覧へ戻る</Link>
        </Button>
      </div>
    </div>
  );
}
