"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { formatUnits, getAddress } from "viem";
import { useConnection, useWriteContract } from "wagmi";
import { useAuth } from "@/components/auth/auth-provider";
import { getActiveKernel } from "@/lib/aa/kernel-client";
import { AddressText } from "@/components/address-text";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ApiError } from "@/lib/api";
import {
  createPaymentIntent,
  fetchPaymentIntent,
  submitPaymentTransaction,
  type OrderDetail,
  type PaymentIntent,
} from "@/lib/api/orders";

const jpycAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const PAYMENT_POLL_INTERVAL_MS = 3_000;

/**
 * 購入者向け支払いパネル。
 * 金額・宛先はブラウザで組み立てず、backendが固定したpayment intentのみを使う。
 */
export function PaymentPanel({
  order,
  token,
}: {
  order: OrderDetail;
  token: string;
}) {
  const queryClient = useQueryClient();
  const connection = useConnection();
  const { paymentMode } = useAuth();
  const { writeContractAsync } = useWriteContract();
  const [intentId, setIntentId] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);

  const intentQuery = useQuery({
    queryKey: ["payment-intent", intentId],
    queryFn: () => fetchPaymentIntent(token, intentId!),
    enabled: Boolean(intentId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "confirmed") {
        // 決済確定 → 注文情報を再取得して発送待ちフェーズへ
        void queryClient.invalidateQueries({ queryKey: ["order", order.id] });
        return false;
      }
      return status === "submitted" ? PAYMENT_POLL_INTERVAL_MS : false;
    },
  });

  const createIntentMutation = useMutation({
    mutationFn: () => createPaymentIntent(token, order.id),
    onSuccess: (intent) => setIntentId(intent.id),
    onError: (error) => {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "支払条件を取得できませんでした",
      );
    },
  });

  const intent: PaymentIntent | null = intentQuery.data ?? null;

  async function pay() {
    if (!intent) return;
    setIsPaying(true);
    try {
      let txHash: `0x${string}`;
      if (paymentMode === "aa") {
        // smart account経路: ZeroDev Paymasterがgasを負担するため
        // 購入者はPOL残高なしで送金できる
        const kernel = getActiveKernel();
        if (
          !kernel ||
          kernel.aaAddress.toLowerCase() !== intent.fromAddress.toLowerCase()
        ) {
          toast.error(
            "スマートアカウントを確認できません。再度ログインしてください",
          );
          return;
        }
        txHash = await kernel.sendJpycTransfer({
          tokenAddress: getAddress(intent.tokenAddress),
          to: getAddress(intent.toAddress),
          amountAtomic: BigInt(intent.amountAtomic),
        });
      } else {
        if (
          connection.status !== "connected" ||
          connection.address?.toLowerCase() !==
            intent.fromAddress.toLowerCase() ||
          connection.chainId !== intent.chainId
        ) {
          toast.error(
            "支払条件と同じウォレット・ネットワークへ接続してください",
          );
          return;
        }
        txHash = await writeContractAsync({
          address: getAddress(intent.tokenAddress),
          abi: jpycAbi,
          functionName: "transfer",
          args: [getAddress(intent.toAddress), BigInt(intent.amountAtomic)],
          chainId: intent.chainId,
        });
      }
      await submitPaymentTransaction(token, intent.id, txHash);
      await intentQuery.refetch();
      toast.success("送金を受け付けました。ブロックチェーン上で確認しています");
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "送金がキャンセルまたは失敗しました",
      );
    } finally {
      setIsPaying(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">JPYCで支払う</CardTitle>
        <CardDescription>
          支払金額と受取先は注文から固定され、ブロックチェーン上の記録で検証されます。
          {paymentMode === "aa" &&
            "ガス代はTrustcaが負担するため、POL残高は不要です。"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!intent ? (
          <Button
            onClick={() => createIntentMutation.mutate()}
            disabled={createIntentMutation.isPending}
          >
            {createIntentMutation.isPending
              ? "支払条件を取得中…"
              : "支払い手続きを開始"}
          </Button>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <dt className="text-muted-foreground">支払額</dt>
              <dd className="col-span-2 font-semibold tabular-nums">
                {formatUnits(BigInt(intent.amountAtomic), intent.tokenDecimals)}{" "}
                JPYC
              </dd>
              <dt className="text-muted-foreground">受取先</dt>
              <dd className="col-span-2">
                <AddressText value={intent.toAddress} />
              </dd>
              <dt className="text-muted-foreground">有効期限</dt>
              <dd className="col-span-2">
                {new Date(intent.expiresAt).toLocaleString("ja-JP")}
              </dd>
            </dl>

            {intent.status === "created" && (
              <Button onClick={() => void pay()} disabled={isPaying}>
                {isPaying ? "送金中…" : "内容を確認してJPYCを送る"}
              </Button>
            )}
            {intent.status === "submitted" && (
              <Alert>
                <AlertTitle>支払いを確認しています</AlertTitle>
                <AlertDescription>
                  ブロックチェーン上で送金を確認しています。通常1〜2分かかります。この画面のまましばらくお待ちください。
                </AlertDescription>
              </Alert>
            )}
            {intent.status === "failed" && (
              <Alert variant="destructive">
                <AlertTitle>支払いを確認できませんでした</AlertTitle>
                <AlertDescription>
                  送金内容が支払条件と一致しませんでした。もう一度支払い手続きを開始してください。
                </AlertDescription>
              </Alert>
            )}
            {intent.status === "expired" && (
              <Alert variant="destructive">
                <AlertTitle>支払い期限が切れました</AlertTitle>
                <AlertDescription>
                  もう一度支払い手続きを開始してください。
                </AlertDescription>
              </Alert>
            )}
            {(intent.status === "failed" || intent.status === "expired") && (
              <Button
                variant="outline"
                onClick={() => {
                  setIntentId(null);
                  createIntentMutation.mutate();
                }}
                disabled={createIntentMutation.isPending}
              >
                支払いをやり直す
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
