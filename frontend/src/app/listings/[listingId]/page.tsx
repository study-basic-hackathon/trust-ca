"use client";

import { useQuery } from "@tanstack/react-query";
import { ImageOff, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AmountJpy } from "@/components/amount-jpy";
import { TrustBadge } from "@/components/trust-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchListingDetail } from "@/lib/api/listings";

const IMAGE_KIND_LABELS: Record<string, string> = {
  front: "表面",
  back: "裏面",
  label: "ラベル",
  corner_top_left: "四隅(左上)",
  corner_top_right: "四隅(右上)",
  corner_bottom_left: "四隅(左下)",
  corner_bottom_right: "四隅(右下)",
  possession: "所持確認",
};

export default function ListingDetailPage() {
  const params = useParams<{ listingId: string }>();
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [isZoomOpen, setIsZoomOpen] = useState(false);

  const listingQuery = useQuery({
    queryKey: ["listing", params.listingId],
    queryFn: () => fetchListingDetail(params.listingId),
  });

  if (listingQuery.isPending) {
    return (
      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-2">
        <Skeleton className="aspect-square w-full" />
        <div className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-32 w-full" />
        </div>
      </main>
    );
  }

  if (listingQuery.isError || !listingQuery.data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <Alert variant="destructive">
          <AlertTitle>商品を表示できません</AlertTitle>
          <AlertDescription>
            {listingQuery.error instanceof Error
              ? listingQuery.error.message
              : "商品が見つからないか、一時的なエラーが発生しています。"}
          </AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-6" asChild>
          <Link href="/listings">商品一覧へ戻る</Link>
        </Button>
      </main>
    );
  }

  const listing = listingQuery.data;
  const images = listing.images.filter((image) => image.url);
  const selectedImage = images[selectedImageIndex] ?? null;
  const isPurchasable = listing.status === "active";

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="grid gap-8 md:grid-cols-2">
        {/* 画像ギャラリー */}
        <div className="space-y-3">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-secondary">
            {selectedImage?.url ? (
              // 短時間有効の署名付きURLのためnext/imageの最適化対象にしない
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selectedImage.url}
                alt={`${listing.title}(${IMAGE_KIND_LABELS[selectedImage.imageKind] ?? selectedImage.imageKind})`}
                className="size-full cursor-zoom-in object-contain"
                onClick={() => setIsZoomOpen(true)}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <ImageOff className="size-10" aria-hidden />
                <span className="text-sm">画像がありません</span>
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {images.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => setSelectedImageIndex(index)}
                  className={`shrink-0 rounded-md border px-3 py-1.5 text-xs ${
                    index === selectedImageIndex
                      ? "border-primary bg-accent text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  {IMAGE_KIND_LABELS[image.imageKind] ?? image.imageKind}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 商品情報 */}
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold">{listing.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {listing.card.name}
              {listing.card.series && ` / ${listing.card.series}`}
              {listing.card.grade && ` / グレード ${listing.card.grade}`}
            </p>
          </div>

          <AmountJpy amountMinor={listing.priceMinor} className="text-3xl" />

          {/* 信頼シグナル */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-5 text-primary" aria-hidden />
                この出品で確認できた事実
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {listing.seller.isVerified && (
                <div className="flex items-start gap-3">
                  <TrustBadge signal="seller_verified" />
                  <p className="text-muted-foreground">
                    販売者は本人確認(eKYC)を完了しています。
                  </p>
                </div>
              )}
              {listing.card.psaCertNumber &&
                (listing.card.psaVerificationStatus === "verified" ? (
                  <div className="flex items-start gap-3">
                    <TrustBadge signal="psa_verified" />
                    <p className="text-muted-foreground">
                      証明書番号{" "}
                      <span className="font-mono">
                        {listing.card.psaCertNumber}
                      </span>{" "}
                      の登録情報をPSA Public APIで照会済みです。
                    </p>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <TrustBadge signal="in_review" />
                    <p className="text-muted-foreground">
                      PSA登録情報は自動確認できず、審査扱いです。
                    </p>
                  </div>
                ))}
              <p className="text-xs text-muted-foreground">
                これらの表示は確認できた事実であり、商品の真贋を保証するものではありません。
              </p>
            </CardContent>
          </Card>

          {/* 販売者 */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="text-xs text-muted-foreground">販売者</p>
              <p className="font-medium">{listing.seller.displayName}</p>
            </div>
            {listing.seller.isVerified && (
              <TrustBadge signal="seller_verified" />
            )}
          </div>

          {/* 購入導線 */}
          {isPurchasable ? (
            <Button size="lg" className="w-full" asChild>
              <Link href={`/orders/new?listingId=${listing.id}`}>
                購入手続きへ
              </Link>
            </Button>
          ) : (
            <Alert>
              <AlertTitle>
                この商品は現在購入できません
              </AlertTitle>
              <AlertDescription>
                {listing.status === "sold"
                  ? "この商品は売り切れました。"
                  : listing.status === "reserved"
                    ? "他の方が取引手続き中です。"
                    : "この出品は終了しました。"}
              </AlertDescription>
            </Alert>
          )}

          {listing.description && (
            <>
              <Separator />
              <div>
                <h2 className="font-semibold">説明</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {listing.description}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
      {/* 画像拡大Dialog(screen-design.md §6.9) */}
      <Dialog open={isZoomOpen} onOpenChange={setIsZoomOpen}>
        <DialogContent className="max-w-4xl">
          <DialogTitle className="sr-only">{listing.title}の画像</DialogTitle>
          {selectedImage?.url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedImage.url}
              alt={listing.title}
              className="max-h-[80vh] w-full object-contain"
            />
          )}
          {images.length > 1 && (
            <div className="flex justify-center gap-2">
              {images.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => setSelectedImageIndex(index)}
                  className={`rounded-md border px-3 py-1.5 text-xs ${
                    index === selectedImageIndex
                      ? "border-primary bg-accent text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  {IMAGE_KIND_LABELS[image.imageKind] ?? image.imageKind}
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
