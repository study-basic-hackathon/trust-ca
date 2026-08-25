"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ListOrdered,
  PackageOpen,
  Store,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { StatusStepper } from "@/components/status-stepper";
import { TrustBadge } from "@/components/trust-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getMe } from "@/lib/api/me";
import { deriveKycSteps, kycStatusLabel } from "@/lib/kyc-steps";

export default function MyPage() {
  const { session, isSignedIn, isBusy, login } = useAuth();

  const meQuery = useQuery({
    queryKey: ["me", session?.token],
    queryFn: () => getMe(session!.token),
    enabled: Boolean(session),
  });

  if (!isSignedIn) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">マイページ</h1>
        <p className="mt-3 text-muted-foreground">
          マイページの利用にはログインが必要です。
        </p>
        <Button
          className="mt-6"
          onClick={() => void login()}
          disabled={isBusy}
        >
          {isBusy ? "ログイン中…" : "ログイン"}
        </Button>
      </main>
    );
  }

  const me = meQuery.data;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <h1 className="text-2xl font-bold">マイページ</h1>

      {meQuery.isPending && (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {meQuery.isError && (
        <Alert variant="destructive">
          <AlertTitle>情報を取得できませんでした</AlertTitle>
          <AlertDescription>
            {meQuery.error instanceof Error
              ? meQuery.error.message
              : "時間をおいて再度お試しください。"}
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void meQuery.refetch()}
            >
              再試行
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {me && (
        <>
          {/* アカウント */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="size-5 text-primary" aria-hidden />
                アカウント
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">ウォレット: </span>
                <span className="font-mono">{me.wallet.address}</span>
              </p>
              <p>
                <span className="text-muted-foreground">chain ID: </span>
                {me.wallet.chainId}
              </p>
            </CardContent>
          </Card>

          {/* 販売者ステータス */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Store className="size-5 text-primary" aria-hidden />
                販売者ステータス
                {me.isSellingAllowed && <TrustBadge signal="seller_verified" />}
              </CardTitle>
              {me.seller ? (
                <CardDescription>
                  表示名: {me.seller.displayName} / 現在の状態:{" "}
                  {kycStatusLabel(me.verification?.status ?? "not_started")}
                </CardDescription>
              ) : (
                <CardDescription>
                  販売者登録をすると、本人確認(eKYC)を経て出品できるようになります。
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {me.seller && (
                <StatusStepper
                  steps={deriveKycSteps(me.verification?.status ?? null)}
                />
              )}
              <Button asChild>
                <Link href="/mypage/seller">
                  {me.seller ? "本人確認の状況を見る" : "販売者登録へ"}
                  <ArrowRight className="ml-1 size-4" aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* ショートカット */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 py-6"
              asChild
            >
              <Link href="/sell">
                <Store className="size-6" aria-hidden />
                出品する
              </Link>
            </Button>
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 py-6"
              asChild
            >
              <Link href="/mypage/listings">
                <PackageOpen className="size-6" aria-hidden />
                自分の出品
              </Link>
            </Button>
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 py-6"
              asChild
            >
              <Link href="/mypage/orders">
                <ListOrdered className="size-6" aria-hidden />
                取引一覧
              </Link>
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
