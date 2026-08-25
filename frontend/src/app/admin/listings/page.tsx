"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AmountJpy } from "@/components/amount-jpy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type AdminListing = {
  id: string;
  title: string;
  priceMinor: string;
  status: string;
  sellerDisplayName: string;
  cardName: string;
  psaCertNumber: string | null;
  createdAt: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "下書き",
  active: "公開中",
  reserved: "取引中",
  sold: "売却済み",
  closed: "停止",
};

export default function AdminListingsPage() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [closingListingId, setClosingListingId] = useState<string | null>(null);

  const listingsQuery = useQuery({
    queryKey: ["admin-listings", token, statusFilter],
    queryFn: () =>
      api<{ items: AdminListing[] }>(
        `/api/v1/admin/listings${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`,
        {},
        token,
      ),
    enabled: token.length > 0,
    retry: false,
  });

  const closeMutation = useMutation({
    mutationFn: (listingId: string) =>
      api(
        `/api/v1/admin/listings/${encodeURIComponent(listingId)}/close`,
        { method: "POST" },
        token,
      ),
    onSuccess: () => {
      toast.success("出品を強制停止しました");
      setClosingListingId(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-listings"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "停止に失敗しました",
      );
    },
  });

  const items = listingsQuery.data?.items ?? [];

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <h1 className="text-2xl font-bold">出品管理</h1>

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
            <SelectTrigger className="w-40">
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

      {listingsQuery.isError && (
        <p className="text-sm text-destructive">
          {listingsQuery.error instanceof ApiError
            ? listingsQuery.error.message
            : "取得に失敗しました。トークンを確認してください。"}
        </p>
      )}

      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>商品</TableHead>
              <TableHead>販売者</TableHead>
              <TableHead>価格</TableHead>
              <TableHead>PSA</TableHead>
              <TableHead>状態</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((listing) => (
              <TableRow key={listing.id}>
                <TableCell className="font-medium">{listing.title}</TableCell>
                <TableCell>{listing.sellerDisplayName}</TableCell>
                <TableCell>
                  <AmountJpy amountMinor={listing.priceMinor} />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {listing.psaCertNumber ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      listing.status === "active" ? "default" : "secondary"
                    }
                  >
                    {STATUS_LABELS[listing.status] ?? listing.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {["draft", "active"].includes(listing.status) && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setClosingListingId(listing.id)}
                    >
                      強制停止
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={closingListingId !== null}
        onOpenChange={(open) => !open && setClosingListingId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>出品を強制停止しますか?</DialogTitle>
            <DialogDescription>
              規約違反等の理由で出品を停止します。この操作は販売者へ通知されません(通知機能は今後の対応)。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosingListingId(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                closingListingId && closeMutation.mutate(closingListingId)
              }
              disabled={closeMutation.isPending}
            >
              {closeMutation.isPending ? "停止中…" : "強制停止する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
