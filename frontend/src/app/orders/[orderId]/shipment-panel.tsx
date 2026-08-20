"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { ApiError, backendUrl } from "@/lib/api";
import {
  runCardImageAnalysis,
  uploadCardImage,
  type CardImageAnalysisResult,
} from "@/lib/api/card-images";
import {
  CARRIER_LABELS,
  CARRIER_TRACKING_URLS,
  confirmDelivery,
  registerShipment,
  type OrderDetail,
} from "@/lib/api/orders";

/** 販売者向け: 配送先の確認と発送登録 */
export function ShipmentRegisterPanel({
  order,
  token,
}: {
  order: OrderDetail;
  token: string;
}) {
  const queryClient = useQueryClient();
  const [carrier, setCarrier] = useState("");
  const [carrierNameOther, setCarrierNameOther] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");

  const shipMutation = useMutation({
    mutationFn: () =>
      registerShipment(token, order.id, {
        carrier,
        carrierNameOther: carrier === "other" ? carrierNameOther : undefined,
        trackingNumber: trackingNumber.trim(),
      }),
    onSuccess: () => {
      toast.success("発送を登録しました");
      void queryClient.invalidateQueries({ queryKey: ["order", order.id] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "発送登録に失敗しました",
      );
    },
  });

  return (
    <div className="space-y-4">
      {order.shippingAddress && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">配送先</CardTitle>
            <CardDescription>
              配送先情報は発送作業のためにのみ利用してください。
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">
            <p className="font-medium">
              {order.shippingAddress.recipientName} 様
            </p>
            <p>〒{order.shippingAddress.postalCode}</p>
            <p>
              {order.shippingAddress.prefecture}
              {order.shippingAddress.city}
              {order.shippingAddress.addressLine1}
            </p>
            {order.shippingAddress.addressLine2 && (
              <p>{order.shippingAddress.addressLine2}</p>
            )}
            <p>TEL: {order.shippingAddress.phoneNumber}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">発送を登録</CardTitle>
          <CardDescription>
            商品を発送したら、配送業者と追跡番号を登録してください。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>配送業者 *</Label>
            <Select value={carrier} onValueChange={setCarrier}>
              <SelectTrigger>
                <SelectValue placeholder="配送業者を選択" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CARRIER_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {carrier === "other" && (
            <div className="space-y-2">
              <Label htmlFor="carrierNameOther">配送業者名 *</Label>
              <Input
                id="carrierNameOther"
                value={carrierNameOther}
                onChange={(e) => setCarrierNameOther(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="trackingNumber">追跡番号 *</Label>
            <Input
              id="trackingNumber"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="例: 1234-5678-9012"
              className="font-mono"
            />
          </div>
          <Button
            onClick={() => shipMutation.mutate()}
            disabled={
              !carrier ||
              !trackingNumber.trim() ||
              (carrier === "other" && !carrierNameOther.trim()) ||
              shipMutation.isPending
            }
          >
            {shipMutation.isPending ? "登録中…" : "発送を登録する"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/** 双方向け: 追跡情報の表示。購入者には受領確認ボタンを表示する */
export function TrackingPanel({
  order,
  token,
}: {
  order: OrderDetail;
  token: string;
}) {
  const queryClient = useQueryClient();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isUploadingArrival, setIsUploadingArrival] = useState(false);
  const [arrivalAnalysis, setArrivalAnalysis] =
    useState<CardImageAnalysisResult | null>(null);

  async function handleArrivalUpload(file: File) {
    setIsUploadingArrival(true);
    try {
      const uploaded = await uploadCardImage({
        backendUrl,
        token,
        cardId: order.cardId,
        imageKind: "front",
        uploadContext: "arrival",
        file,
      });
      const analysis = await runCardImageAnalysis({
        backendUrl,
        token,
        cardId: order.cardId,
        imageId: uploaded.id,
      });
      setArrivalAnalysis(analysis);
      toast.success("到着した商品の画像を確認しました");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "画像の確認に失敗しました。受領確認はそのまま行えます",
      );
      // 解析失敗でも受領確認は妨げない(補助シグナルのため)
      setArrivalAnalysis({
        id: "",
        cardId: order.cardId,
        sourceImageId: "",
        status: "failed",
        score: null,
        normalizedResult: null,
      });
    } finally {
      setIsUploadingArrival(false);
    }
  }

  const deliveryMutation = useMutation({
    mutationFn: () => confirmDelivery(token, order.id),
    onSuccess: () => {
      toast.success("受領を確認しました。お取引ありがとうございました");
      setIsConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["order", order.id] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "受領確認に失敗しました",
      );
    },
  });

  const shipment = order.shipment;
  if (!shipment) return null;
  const carrierLabel =
    shipment.carrier === "other"
      ? (shipment.carrierNameOther ?? "その他")
      : (CARRIER_LABELS[shipment.carrier] ?? shipment.carrier);
  const trackingUrl = CARRIER_TRACKING_URLS[shipment.carrier];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">配送状況</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <dt className="text-muted-foreground">配送業者</dt>
          <dd className="col-span-2">{carrierLabel}</dd>
          <dt className="text-muted-foreground">追跡番号</dt>
          <dd className="col-span-2 flex items-center gap-2">
            <span className="font-mono">{shipment.trackingNumber}</span>
            <button
              type="button"
              className="text-xs text-primary underline"
              onClick={() => {
                void navigator.clipboard.writeText(shipment.trackingNumber);
                toast("追跡番号をコピーしました");
              }}
            >
              コピー
            </button>
          </dd>
          <dt className="text-muted-foreground">発送日時</dt>
          <dd className="col-span-2">
            {new Date(shipment.shippedAt).toLocaleString("ja-JP")}
          </dd>
        </dl>
        {trackingUrl && (
          <a
            href={trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary underline"
          >
            {carrierLabel}の追跡ページで確認する
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}

        {order.viewerRole === "buyer" && order.status === "shipped" && (
          <>
            {/* 到着後の再撮影(screen-design.md §6.2)。解析は補助シグナル */}
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">
                到着した商品を撮影してください
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                出品時の情報と照合し、取引記録として保存します。
              </p>
              {arrivalAnalysis ? (
                <p className="mt-2 text-sm">
                  {arrivalAnalysis.status === "completed" &&
                  arrivalAnalysis.normalizedResult?.matchedName
                    ? "✅ 出品時のカード情報と内容が一致しました"
                    : arrivalAnalysis.status === "failed"
                      ? "画像の自動確認はできませんでした(受領確認は可能です)"
                      : "🔍 自動確認できなかったため、記録として保存しました"}
                </p>
              ) : (
                <label className="mt-3 flex cursor-pointer items-center justify-center rounded-md border border-dashed py-4 text-sm text-muted-foreground hover:bg-accent">
                  {isUploadingArrival ? "確認中…" : "商品の表面を撮影・選択"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    disabled={isUploadingArrival}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleArrivalUpload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
            <Button
              className="w-full"
              onClick={() => setIsConfirmOpen(true)}
              disabled={!arrivalAnalysis}
            >
              商品を受け取りました
            </Button>
            <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>受領を確認しますか?</DialogTitle>
                  <DialogDescription>
                    商品の内容を確認のうえ、受領確認を行ってください。受領確認後、取引は完了します。
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsConfirmOpen(false)}
                  >
                    キャンセル
                  </Button>
                  <Button
                    onClick={() => deliveryMutation.mutate()}
                    disabled={deliveryMutation.isPending}
                  >
                    {deliveryMutation.isPending
                      ? "処理中…"
                      : "受領を確認して取引を完了する"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </CardContent>
    </Card>
  );
}
