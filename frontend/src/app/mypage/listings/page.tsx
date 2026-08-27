"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageOpen } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AmountJpy } from "@/components/amount-jpy";
import { EmptyState } from "@/components/empty-state";
import { useAuth } from "@/components/auth/auth-provider";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api";
import {
  closeListing,
  discardCard,
  fetchCardDrafts,
  fetchMyListings,
} from "@/lib/api/listings";

const STATUS_LABELS: Record<string, string> = {
  draft: "下書き",
  active: "公開中",
  reserved: "取引中",
  sold: "売却済み",
  closed: "停止",
};

export default function MyListingsPage() {
  const { session, isSignedIn, isBusy, login } = useAuth();
  const queryClient = useQueryClient();
  const [closingListingId, setClosingListingId] = useState<string | null>(null);
  const [discardingCardId, setDiscardingCardId] = useState<string | null>(null);

  const listingsQuery = useQuery({
    queryKey: ["my-listings", session?.token],
    queryFn: () => fetchMyListings(session!.token),
    enabled: Boolean(session),
  });

  const draftsQuery = useQuery({
    queryKey: ["my-card-drafts", session?.token],
    queryFn: () => fetchCardDrafts(session!.token),
    enabled: Boolean(session),
  });

  const closeMutation = useMutation({
    mutationFn: (listingId: string) => closeListing(session!.token, listingId),
    onSuccess: () => {
      toast.success("出品を停止しました");
      setClosingListingId(null);
      void queryClient.invalidateQueries({ queryKey: ["my-listings"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "停止に失敗しました",
      );
    },
  });

  const discardMutation = useMutation({
    mutationFn: (cardId: string) => discardCard(session!.token, cardId),
    onSuccess: () => {
      toast.success("作成中の出品を破棄しました");
      setDiscardingCardId(null);
      void queryClient.invalidateQueries({ queryKey: ["my-card-drafts"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "破棄に失敗しました",
      );
    },
  });

  if (!isSignedIn) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">自分の出品</h1>
        <p className="mt-3 text-muted-foreground">ログインが必要です。</p>
        <Button className="mt-6" onClick={() => void login()} disabled={isBusy}>
          {isBusy ? "ログイン中…" : "ログイン"}
        </Button>
      </main>
    );
  }

  const items = listingsQuery.data?.items ?? [];

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">自分の出品</h1>
        <Button asChild>
          <Link href="/sell">新しく出品する</Link>
        </Button>
      </div>

      {draftsQuery.isSuccess && draftsQuery.data.items.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">作成中の出品</h2>
          <p className="text-sm text-muted-foreground">
            出品ウィザードを最後まで完了していないカードです。続きから入力するか、不要なら破棄してください。
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>カード</TableHead>
                <TableHead>作成日</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {draftsQuery.data.items.map((draft) => (
                <TableRow key={draft.id}>
                  <TableCell className="font-medium">{draft.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(draft.createdAt).toLocaleDateString("ja-JP")}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/sell?cardId=${draft.id}`}>
                        続きから入力
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDiscardingCardId(draft.id)}
                    >
                      破棄
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {listingsQuery.isPending && <Skeleton className="h-48 w-full" />}

      {listingsQuery.isSuccess && items.length === 0 && (
        <EmptyState
          icon={PackageOpen}
          title="まだ出品がありません"
          description="本人確認を完了すると出品できます。"
          action={
            <Button asChild>
              <Link href="/sell">出品する</Link>
            </Button>
          }
        />
      )}

      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>商品</TableHead>
              <TableHead>価格</TableHead>
              <TableHead>状態</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((listing) => (
              <TableRow key={listing.id}>
                <TableCell>
                  <Link
                    href={`/listings/${listing.id}`}
                    className="font-medium hover:underline"
                  >
                    {listing.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <AmountJpy amountMinor={listing.priceMinor} />
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
                  {listing.status === "active" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setClosingListingId(listing.id)}
                    >
                      公開停止
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
            <DialogTitle>出品を停止しますか?</DialogTitle>
            <DialogDescription>
              停止した出品は購入できなくなります。再度出品するには新規に作成が必要です。
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
              {closeMutation.isPending ? "停止中…" : "停止する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={discardingCardId !== null}
        onOpenChange={(open) => !open && setDiscardingCardId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>作成中の出品を破棄しますか?</DialogTitle>
            <DialogDescription>
              入力済みのカード情報・アップロード済みの画像は破棄され、元に戻せません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardingCardId(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                discardingCardId && discardMutation.mutate(discardingCardId)
              }
              disabled={discardMutation.isPending}
            >
              {discardMutation.isPending ? "破棄中…" : "破棄する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
