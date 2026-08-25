"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { AmountJpy } from "@/components/amount-jpy";
import { useAuth } from "@/components/auth/auth-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { fetchListingDetail } from "@/lib/api/listings";
import { createOrder, type ShippingAddressInput } from "@/lib/api/orders";

function NewOrderContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const listingId = searchParams.get("listingId") ?? "";
  const { session, isSignedIn, isBusy, login } = useAuth();

  const [address, setAddress] = useState<ShippingAddressInput>({
    recipientName: "",
    postalCode: "",
    prefecture: "",
    city: "",
    addressLine1: "",
    addressLine2: null,
    phoneNumber: "",
  });

  const listingQuery = useQuery({
    queryKey: ["listing", listingId],
    queryFn: () => fetchListingDetail(listingId),
    enabled: Boolean(listingId),
  });

  const orderMutation = useMutation({
    mutationFn: () =>
      createOrder(session!.token, { listingId, shippingAddress: address }),
    onSuccess: (order) => {
      toast.success("注文を確定しました。続けて支払いへ進んでください");
      router.push(`/orders/${order.id}`);
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "注文に失敗しました",
      );
    },
  });

  if (!listingId) {
    return (
      <Alert variant="destructive">
        <AlertTitle>商品が指定されていません</AlertTitle>
      </Alert>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="text-center">
        <p className="text-muted-foreground">購入にはログインが必要です。</p>
        <Button className="mt-4" onClick={() => void login()} disabled={isBusy}>
          {isBusy ? "ログイン中…" : "ログイン"}
        </Button>
      </div>
    );
  }

  if (listingQuery.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (listingQuery.isError || !listingQuery.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>商品を取得できませんでした</AlertTitle>
        <AlertDescription>
          {listingQuery.error instanceof Error
            ? listingQuery.error.message
            : "時間をおいて再度お試しください。"}
        </AlertDescription>
      </Alert>
    );
  }

  const listing = listingQuery.data;

  const isAddressComplete =
    address.recipientName.trim() &&
    address.postalCode.trim() &&
    address.prefecture.trim() &&
    address.city.trim() &&
    address.addressLine1.trim() &&
    address.phoneNumber.trim();

  return (
    <div className="grid gap-6 md:grid-cols-5">
      {/* 商品サマリ */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">注文内容</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="font-medium">{listing.title}</p>
          <p className="text-muted-foreground">{listing.card.name}</p>
          <div className="flex items-center justify-between border-t pt-3">
            <span>支払金額</span>
            <AmountJpy amountMinor={listing.priceMinor} className="text-xl" />
          </div>
          <p className="text-xs text-muted-foreground">
            支払いはJPYC(ウォレット送金)で行います。注文確定後、支払い画面へ進みます。
          </p>
        </CardContent>
      </Card>

      {/* 配送先入力 */}
      <Card className="md:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">配送先</CardTitle>
          <CardDescription>
            配送先は本取引の当事者と運営者のみが参照できます。取引完了から90日後に削除されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="recipientName">受取人氏名 *</Label>
              <Input
                id="recipientName"
                value={address.recipientName}
                onChange={(e) =>
                  setAddress({ ...address, recipientName: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postalCode">郵便番号 *</Label>
              <Input
                id="postalCode"
                value={address.postalCode}
                onChange={(e) =>
                  setAddress({ ...address, postalCode: e.target.value })
                }
                placeholder="100-0001"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prefecture">都道府県 *</Label>
              <Input
                id="prefecture"
                value={address.prefecture}
                onChange={(e) =>
                  setAddress({ ...address, prefecture: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">市区町村 *</Label>
              <Input
                id="city"
                value={address.city}
                onChange={(e) => setAddress({ ...address, city: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="addressLine1">番地 *</Label>
            <Input
              id="addressLine1"
              value={address.addressLine1}
              onChange={(e) =>
                setAddress({ ...address, addressLine1: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="addressLine2">建物名・部屋番号</Label>
            <Input
              id="addressLine2"
              value={address.addressLine2 ?? ""}
              onChange={(e) =>
                setAddress({
                  ...address,
                  addressLine2: e.target.value || null,
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phoneNumber">電話番号 *</Label>
            <Input
              id="phoneNumber"
              value={address.phoneNumber}
              onChange={(e) =>
                setAddress({ ...address, phoneNumber: e.target.value })
              }
              placeholder="090-1234-5678"
            />
          </div>
          <Button
            className="w-full"
            size="lg"
            onClick={() => orderMutation.mutate()}
            disabled={!isAddressComplete || orderMutation.isPending}
          >
            {orderMutation.isPending ? "注文処理中…" : "注文を確定する"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NewOrderPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <h1 className="text-2xl font-bold">購入手続き</h1>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <NewOrderContent />
      </Suspense>
    </main>
  );
}
