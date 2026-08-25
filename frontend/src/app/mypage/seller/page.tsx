"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/auth-provider";
import { EventTimeline } from "@/components/event-timeline";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import {
  getMe,
  getVerification,
  registerSeller,
  startKycSession,
} from "@/lib/api/me";
import { deriveKycSteps, kycStatusLabel } from "@/lib/kyc-steps";

const POLL_INTERVAL_MS = 5_000;

const CHECK_LABELS: Record<string, string> = {
  document: "本人確認書類",
  liveness: "ライブネス",
  faceMatch: "顔照合",
  ipAnalysis: "IP分析",
};

const CHECK_RESULT_LABELS: Record<string, string> = {
  passed: "合格",
  failed: "不合格",
  in_review: "確認中",
  not_run: "未実施",
};

const EVENT_LABELS: Record<string, string> = {
  session_created: "本人確認セッションを作成",
  status_changed: "ステータスが変化",
  checks_updated: "チェック結果を更新",
  operator_decision: "運営者が判断",
};

const SOURCE_LABELS: Record<string, string> = {
  created: "セッション作成",
  poll: "取得元: ポーリング(decision API)",
  webhook: "取得元: Webhook(署名検証済み)",
  operator: "取得元: 運営者判断",
};

export default function SellerOnboardingPage() {
  const { session, isSignedIn, isBusy, login } = useAuth();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [hasAgreed, setHasAgreed] = useState(false);

  const meQuery = useQuery({
    queryKey: ["me", session?.token],
    queryFn: () => getMe(session!.token),
    enabled: Boolean(session),
  });
  const sellerId = meQuery.data?.seller?.id ?? null;

  const verificationQuery = useQuery({
    queryKey: ["verification", sellerId],
    queryFn: () =>
      getVerification(sellerId!, { refresh: true, token: session?.token }),
    enabled: Boolean(sellerId),
    refetchInterval: (query) => {
      const status = query.state.data?.verification?.status;
      return status === "not_started" || status === "in_progress"
        ? POLL_INTERVAL_MS
        : false;
    },
  });

  const registerMutation = useMutation({
    mutationFn: () => registerSeller(session!.token, displayName),
    onSuccess: () => {
      toast.success("販売者登録が完了しました。続けて本人確認へ進んでください");
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "登録に失敗しました",
      );
    },
  });

  const startKycMutation = useMutation({
    mutationFn: () => startKycSession(session!.token, sellerId!),
    onSuccess: (data) => {
      window.location.href = data.sessionUrl;
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "本人確認を開始できませんでした",
      );
    },
  });

  if (!isSignedIn) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">販売者登録</h1>
        <p className="mt-3 text-muted-foreground">
          販売者登録にはログインが必要です。
        </p>
        <Button className="mt-6" onClick={() => void login()} disabled={isBusy}>
          {isBusy ? "ログイン中…" : "ログイン"}
        </Button>
      </main>
    );
  }

  const verification = verificationQuery.data?.verification ?? null;
  const status = verification?.status ?? null;
  const isKycActionable =
    sellerId &&
    (status === null ||
      ["not_started", "declined", "abandoned", "expired"].includes(status));

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <h1 className="text-2xl font-bold">販売者登録・本人確認</h1>

      {meQuery.isPending && <Skeleton className="h-48 w-full" />}

      {/* Step1: 販売者登録 */}
      {meQuery.data && !meQuery.data.seller && (
        <Card>
          <CardHeader>
            <CardTitle>販売者登録</CardTitle>
            <CardDescription>
              出品時に表示される名前を登録します。本名である必要はありません。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">表示名</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={100}
                placeholder="例: カードショップたなか"
              />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="agree"
                checked={hasAgreed}
                onCheckedChange={(checked) => setHasAgreed(checked === true)}
              />
              <Label
                htmlFor="agree"
                className="text-sm font-normal text-muted-foreground"
              >
                <a href="/terms" className="underline" target="_blank">
                  利用規約
                </a>
                および
                <a href="/privacy" className="underline" target="_blank">
                  プライバシーポリシー
                </a>
                に同意します
              </Label>
            </div>
            <Button
              onClick={() => registerMutation.mutate()}
              disabled={
                !displayName.trim() || !hasAgreed || registerMutation.isPending
              }
            >
              {registerMutation.isPending ? "登録中…" : "登録する"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step2: 本人確認 */}
      {meQuery.data?.seller && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Fingerprint className="size-5 text-primary" aria-hidden />
                本人確認(eKYC)
                {meQuery.data.isSellingAllowed && (
                  <TrustBadge signal="seller_verified" />
                )}
              </CardTitle>
              <CardDescription>
                現在の状態: {kycStatusLabel(status ?? "not_started")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <StatusStepper steps={deriveKycSteps(status)} />

              {verification?.checks && (
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  {Object.entries(verification.checks).map(([key, value]) => (
                    <div key={key} className="rounded-md border p-2">
                      <p className="text-xs text-muted-foreground">
                        {CHECK_LABELS[key] ?? key}
                      </p>
                      <p className="font-medium">
                        {CHECK_RESULT_LABELS[value] ?? value}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {status === "in_review" && (
                <Alert>
                  <AlertTitle>運営が確認しています</AlertTitle>
                  <AlertDescription>
                    結果が確定するまでしばらくお待ちください(通常1営業日以内)。
                  </AlertDescription>
                </Alert>
              )}
              {status === "declined" && (
                <Alert variant="destructive">
                  <AlertTitle>本人確認が承認されませんでした</AlertTitle>
                  <AlertDescription>
                    書類の再撮影などにより、再度お試しいただけます。
                  </AlertDescription>
                </Alert>
              )}
              {status === "in_progress" && (
                <p className="text-sm text-muted-foreground">
                  本人確認の完了を確認しています。5秒ごとに自動更新されます。
                </p>
              )}

              {isKycActionable && (
                <div className="space-y-2">
                  <Button
                    onClick={() => startKycMutation.mutate()}
                    disabled={startKycMutation.isPending}
                  >
                    {startKycMutation.isPending
                      ? "準備中…"
                      : status === null || status === "not_started"
                        ? "本人確認を開始"
                        : "本人確認をやり直す"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    身分証明書と顔の撮影が必要です。提出された情報は認証事業者(Didit)にのみ保存され、Trustcaには審査結果のみが保存されます。
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>状態変化の履歴</CardTitle>
            </CardHeader>
            <CardContent>
              <EventTimeline
                events={(verificationQuery.data?.events ?? []).map(
                  (event, index) => ({
                    id: index,
                    title: EVENT_LABELS[event.eventType] ?? event.eventType,
                    description:
                      event.fromStatus && event.toStatus
                        ? `${kycStatusLabel(event.fromStatus)} → ${kycStatusLabel(event.toStatus)}`
                        : kycStatusLabel(event.toStatus),
                    occurredAt: event.createdAt,
                    meta: SOURCE_LABELS[event.source] ?? event.source,
                  }),
                )}
              />
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
