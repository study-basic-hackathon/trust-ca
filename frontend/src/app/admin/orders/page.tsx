"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AmountJpy } from "@/components/amount-jpy";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";

type AdminOrder = {
  id: string;
  listingTitle: string;
  priceMinor: string;
  status: string;
  buyerDisplayName: string;
  sellerDisplayName: string;
  trackingNumber: string | null;
  createdAt: string;
};

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

export default function AdminOrdersPage() {
  const [token, setToken] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const ordersQuery = useQuery({
    queryKey: ["admin-orders", token, statusFilter],
    queryFn: () =>
      api<{ items: AdminOrder[] }>(
        `/api/v1/admin/orders${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`,
        {},
        token,
      ),
    enabled: token.length > 0,
    retry: false,
  });

  const items = ordersQuery.data?.items ?? [];

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <h1 className="text-2xl font-bold">取引一覧(運営)</h1>

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-72 space-y-2">
          <Label htmlFor="admin-token">運営者トークン(ADMIN_API_TOKEN)</Label>
          <Input
            id="admin-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>状態</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">すべて</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {ordersQuery.isError && (
        <p className="text-sm text-destructive">
          {ordersQuery.error instanceof ApiError
            ? ordersQuery.error.message
            : "取得に失敗しました。トークンを確認してください。"}
        </p>
      )}

      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>商品</TableHead>
              <TableHead>購入者</TableHead>
              <TableHead>販売者</TableHead>
              <TableHead>金額</TableHead>
              <TableHead>追跡番号</TableHead>
              <TableHead>状態</TableHead>
              <TableHead>作成日</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="font-medium">
                  {order.listingTitle}
                </TableCell>
                <TableCell>{order.buyerDisplayName}</TableCell>
                <TableCell>{order.sellerDisplayName}</TableCell>
                <TableCell>
                  <AmountJpy amountMinor={order.priceMinor} />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {order.trackingNumber ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      ["disputed", "cancelled", "refunded"].includes(
                        order.status,
                      )
                        ? "destructive"
                        : order.status === "completed"
                          ? "secondary"
                          : "default"
                    }
                  >
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
