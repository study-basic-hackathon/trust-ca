"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";

type AdminSeller = {
  id: string;
  displayName: string;
  onboardingStatus: string;
  activeListingLimit: number;
  maxListingAmountMinor: string;
  completedSales: number;
};

const ONBOARDING_LABELS: Record<string, string> = {
  pending_kyc: "本人確認待ち",
  in_review: "審査中",
  approved: "承認済み",
  declined: "否認",
  suspended: "停止",
};

/** 販売者の条件付き上限を調整する(screen-design.md §6.8)。段階的信頼の運用手段 */
export default function AdminSellersPage() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [edits, setEdits] = useState<
    Record<string, { limit: string; amount: string }>
  >({});

  const sellersQuery = useQuery({
    queryKey: ["admin-sellers", token],
    queryFn: () => api<{ items: AdminSeller[] }>("/api/v1/admin/sellers", {}, token),
    enabled: token.length > 0,
    retry: false,
  });

  const updateMutation = useMutation({
    mutationFn: (input: {
      sellerId: string;
      activeListingLimit: number;
      maxListingAmountMinor: string;
    }) =>
      api(
        `/api/v1/admin/sellers/${encodeURIComponent(input.sellerId)}/limits`,
        {
          method: "PATCH",
          body: JSON.stringify({
            activeListingLimit: input.activeListingLimit,
            maxListingAmountMinor: input.maxListingAmountMinor,
          }),
        },
        token,
      ),
    onSuccess: () => {
      toast.success("上限を更新しました");
      void queryClient.invalidateQueries({ queryKey: ["admin-sellers"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "更新に失敗しました",
      );
    },
  });

  const items = sellersQuery.data?.items ?? [];

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold">販売者管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          取引実績に応じて出品上限を段階的に緩和します(eKYC合格≠無制限出品の運用)。
        </p>
      </div>

      <div className="min-w-72 max-w-sm space-y-2">
        <Label htmlFor="admin-token">運営者トークン(ADMIN_API_TOKEN)</Label>
        <Input
          id="admin-token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </div>

      {sellersQuery.isError && (
        <p className="text-sm text-destructive">
          {sellersQuery.error instanceof ApiError
            ? sellersQuery.error.message
            : "取得に失敗しました。トークンを確認してください。"}
        </p>
      )}

      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>販売者</TableHead>
              <TableHead>eKYC</TableHead>
              <TableHead>取引実績</TableHead>
              <TableHead>同時出品上限</TableHead>
              <TableHead>金額上限(円)</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((seller) => {
              const edit = edits[seller.id] ?? {
                limit: String(seller.activeListingLimit),
                amount: seller.maxListingAmountMinor,
              };
              return (
                <TableRow key={seller.id}>
                  <TableCell className="font-medium">
                    {seller.displayName}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        seller.onboardingStatus === "approved"
                          ? "default"
                          : "secondary"
                      }
                    >
                      {ONBOARDING_LABELS[seller.onboardingStatus] ??
                        seller.onboardingStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>{seller.completedSales}件</TableCell>
                  <TableCell>
                    <Input
                      value={edit.limit}
                      onChange={(event) =>
                        setEdits({
                          ...edits,
                          [seller.id]: { ...edit, limit: event.target.value },
                        })
                      }
                      inputMode="numeric"
                      className="w-20"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={edit.amount}
                      onChange={(event) =>
                        setEdits({
                          ...edits,
                          [seller.id]: { ...edit, amount: event.target.value },
                        })
                      }
                      inputMode="numeric"
                      className="w-32"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      onClick={() =>
                        updateMutation.mutate({
                          sellerId: seller.id,
                          activeListingLimit: Number(edit.limit),
                          maxListingAmountMinor: edit.amount,
                        })
                      }
                      disabled={
                        updateMutation.isPending ||
                        !/^[0-9]+$/.test(edit.limit) ||
                        !/^[0-9]+$/.test(edit.amount)
                      }
                    >
                      更新
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
