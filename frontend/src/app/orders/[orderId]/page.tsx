"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { StatusStepper, type Step } from "@/components/status-stepper";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AmountJpy } from "@/components/amount-jpy";
import { fetchOrderDetail, type OrderDetail } from "@/lib/api/orders";
import { CompletionPanel } from "./completion-panel";
import { CancelOrderButton, DisputeLink } from "./dispute-panel";
import { PaymentPanel } from "./payment-panel";
import { ShipmentRegisterPanel, TrackingPanel } from "./shipment-panel";

const ORDER_POLL_INTERVAL_MS = 5_000;

function deriveOrderSteps(status: string): Step[] {
  const sequence = [
    "pending_payment",
    "paid",
    "shipped",
    "delivered",
    "completed",
  ];
  const labels = ["注文", "支払い", "発送", "受領", "完了"];
  // payment_submittedは支払いステップ進行中として扱う
  const normalized = status === "payment_submitted" ? "pending_payment" : status;
  const currentIndex = sequence.indexOf(normalized);
  const isAborted = ["cancelled", "disputed", "refunded"].includes(status);

  return labels.map((label, index) => {
    if (isAborted) {
      return {
        key: sequence[index],
        label,
        state: index === 0 ? "done" : "failed",
      };
    }
    // completedはdeliveredと同時に確定するため、完了時は全ステップdone
    if (status === "completed") {
      return { key: sequence[index], label, state: "done" };
    }
    if (currentIndex < 0) {
      return { key: sequence[index], label, state: "waiting" };
    }
    if (index <= currentIndex) {
      return { key: sequence[index], label, state: "done" };
    }
    if (index === currentIndex + 1) {
      return { key: sequence[index], label, state: "active" };
    }
    return { key: sequence[index], label, state: "waiting" };
  });
}

const STATUS_DESCRIPTIONS: Record<string, string> = {
  pending_payment: "支払いをお願いします。",
  payment_submitted: "支払いを確認しています。",
  paid: "販売者の発送をお待ちください。",
  shipped: "商品が発送されました。",
  completed: "取引が完了しました。",
  cancelled: "この取引はキャンセルされました。",
  disputed: "この取引は調査中です。運営からの連絡をお待ちください。",
  refunded: "この取引は返金されました。",
};

function OrderPhasePanels({
  order,
  token,
}: {
  order: OrderDetail;
  token: string;
}) {
  const isBuyer = order.viewerRole === "buyer";

  if (order.status === "completed") {
    return <CompletionPanel order={order} />;
  }
  if (
    isBuyer &&
    ["pending_payment", "payment_submitted"].includes(order.status)
  ) {
    return (
      <div className="space-y-4">
        <PaymentPanel order={order} token={token} />
        {order.status === "pending_payment" && (
          <div className="text-center">
            <CancelOrderButton order={order} token={token} />
          </div>
        )}
      </div>
    );
  }
  if (!isBuyer && order.status === "paid") {
    return <ShipmentRegisterPanel order={order} token={token} />;
  }
  if (["shipped", "delivered"].includes(order.status)) {
    return (
      <div className="space-y-4">
        <TrackingPanel order={order} token={token} />
        {isBuyer && (
          <div className="text-center">
            <DisputeLink order={order} token={token} />
          </div>
        )}
      </div>
    );
  }
  if (isBuyer && order.status === "paid") {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertTitle>販売者の発送をお待ちください</AlertTitle>
          <AlertDescription>
            発送されると追跡番号が表示されます。
          </AlertDescription>
        </Alert>
        <div className="text-center">
          <DisputeLink order={order} token={token} />
        </div>
      </div>
    );
  }
  return (
    <Alert>
      <AlertTitle>
        {STATUS_DESCRIPTIONS[order.status] ?? "取引状況を確認しています。"}
      </AlertTitle>
      {!isBuyer &&
        ["pending_payment", "payment_submitted"].includes(order.status) && (
          <AlertDescription>
            購入者の支払い完了後、発送登録へ進めます。
          </AlertDescription>
        )}
    </Alert>
  );
}

export default function OrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const { session, isSignedIn, isBusy, login } = useAuth();

  const orderQuery = useQuery({
    queryKey: ["order", params.orderId],
    queryFn: () => fetchOrderDetail(session!.token, params.orderId),
    enabled: Boolean(session),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // 相手側の操作(支払い・発送)を待つ間はポーリングで自動更新する
      return status && !["completed", "cancelled", "refunded"].includes(status)
        ? ORDER_POLL_INTERVAL_MS
        : false;
    },
  });

  if (!isSignedIn) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">取引詳細</h1>
        <p className="mt-3 text-muted-foreground">
          取引の確認にはログインが必要です。
        </p>
        <Button className="mt-6" onClick={() => void login()} disabled={isBusy}>
          {isBusy ? "ログイン中…" : "ログイン"}
        </Button>
      </main>
    );
  }

  if (orderQuery.isPending) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (orderQuery.isError || !orderQuery.data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <Alert variant="destructive">
          <AlertTitle>取引を表示できません</AlertTitle>
          <AlertDescription>
            {orderQuery.error instanceof Error
              ? orderQuery.error.message
              : "取引が見つからないか、参照権限がありません。"}
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const order = orderQuery.data;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold">取引詳細</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {STATUS_DESCRIPTIONS[order.status] ?? ""}
        </p>
      </div>

      <StatusStepper steps={deriveOrderSteps(order.status)} />

      {order.status !== "completed" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">注文内容</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <dt className="text-muted-foreground">商品</dt>
              <dd className="col-span-2">{order.listingTitle}</dd>
              <dt className="text-muted-foreground">金額</dt>
              <dd className="col-span-2">
                <AmountJpy amountMinor={order.priceMinor} />
              </dd>
              <dt className="text-muted-foreground">
                {order.viewerRole === "buyer" ? "販売者" : "購入者"}
              </dt>
              <dd className="col-span-2">
                {order.viewerRole === "buyer"
                  ? order.sellerDisplayName
                  : order.buyerDisplayName}
              </dd>
            </dl>
          </CardContent>
        </Card>
      )}

      <OrderPhasePanels order={order} token={session!.token} />
    </main>
  );
}
