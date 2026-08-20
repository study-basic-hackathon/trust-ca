"use client";

import { useQuery } from "@tanstack/react-query";
import { ListOrdered } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AmountJpy } from "@/components/amount-jpy";
import { EmptyState } from "@/components/empty-state";
import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchOrders } from "@/lib/api/orders";

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "支払い待ち",
  payment_submitted: "支払い確認中",
  paid: "発送待ち",
  shipped: "配送中",
  delivered: "受領済み",
  completed: "完了",
  cancelled: "キャンセル",
  disputed: "調査中",
  refunded: "返金済み",
};

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (["cancelled", "disputed", "refunded"].includes(status)) {
    return "destructive";
  }
  return status === "completed" ? "secondary" : "default";
}

export default function MyOrdersPage() {
  const { session, isSignedIn, isBusy, login } = useAuth();
  const [role, setRole] = useState<"buyer" | "seller">("buyer");

  const ordersQuery = useQuery({
    queryKey: ["orders", role, session?.token],
    queryFn: () => fetchOrders(session!.token, role),
    enabled: Boolean(session),
  });

  if (!isSignedIn) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">取引一覧</h1>
        <p className="mt-3 text-muted-foreground">ログインが必要です。</p>
        <Button className="mt-6" onClick={() => void login()} disabled={isBusy}>
          {isBusy ? "ログイン中…" : "ログイン"}
        </Button>
      </main>
    );
  }

  const items = ordersQuery.data?.items ?? [];

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <h1 className="text-2xl font-bold">取引一覧</h1>

      <Tabs
        value={role}
        onValueChange={(value) => setRole(value as "buyer" | "seller")}
      >
        <TabsList>
          <TabsTrigger value="buyer">購入した商品</TabsTrigger>
          <TabsTrigger value="seller">販売した商品</TabsTrigger>
        </TabsList>
      </Tabs>

      {ordersQuery.isPending && <Skeleton className="h-48 w-full" />}

      {ordersQuery.isSuccess && items.length === 0 && (
        <EmptyState
          icon={ListOrdered}
          title={
            role === "buyer"
              ? "購入した商品はまだありません"
              : "販売した商品はまだありません"
          }
          action={
            <Button variant="outline" asChild>
              <Link href={role === "buyer" ? "/listings" : "/sell"}>
                {role === "buyer" ? "商品を探す" : "出品する"}
              </Link>
            </Button>
          }
        />
      )}

      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>商品</TableHead>
              <TableHead>相手</TableHead>
              <TableHead>金額</TableHead>
              <TableHead>状態</TableHead>
              <TableHead>更新日</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((order) => (
              <TableRow key={order.id}>
                <TableCell>
                  <Link
                    href={`/orders/${order.id}`}
                    className="font-medium hover:underline"
                  >
                    {order.listingTitle}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {role === "buyer"
                    ? order.sellerDisplayName
                    : order.buyerDisplayName}
                </TableCell>
                <TableCell>
                  <AmountJpy amountMinor={order.priceMinor} />
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(order.status)}>
                    {STATUS_LABELS[order.status] ?? order.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(order.createdAt).toLocaleDateString("ja-JP")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
