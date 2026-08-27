"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import {
  cancelOrder,
  DISPUTE_REASON_LABELS,
  openDispute,
  type DisputeReasonCode,
  type OrderDetail,
} from "@/lib/api/orders";

/** 購入者向け: 支払い前の注文キャンセル(screen-design.md §6.3) */
export function CancelOrderButton({
  order,
  token,
}: {
  order: OrderDetail;
  token: string;
}) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);

  const cancelMutation = useMutation({
    mutationFn: () => cancelOrder(token, order.id),
    onSuccess: () => {
      toast.success("注文をキャンセルしました");
      setIsOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["order", order.id] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "キャンセルに失敗しました",
      );
    },
  });

  return (
    <>
      <Button variant="outline" onClick={() => setIsOpen(true)}>
        注文をキャンセル
      </Button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>注文をキャンセルしますか?</DialogTitle>
            <DialogDescription>
              キャンセルすると商品は再度公開され、他の方が購入できるようになります。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              戻る
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? "処理中…" : "キャンセルする"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 購入者向け: 問題の報告(screen-design.md §6.4) */
export function DisputeLink({
  order,
  token,
}: {
  order: OrderDetail;
  token: string;
}) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState<DisputeReasonCode | "">("");
  const [description, setDescription] = useState("");

  const disputeMutation = useMutation({
    mutationFn: () =>
      openDispute(token, order.id, {
        reasonCode: reasonCode as DisputeReasonCode,
        description: description.trim(),
      }),
    onSuccess: () => {
      toast.success("問題を報告しました。運営が調査します");
      setIsOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["order", order.id] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "報告に失敗しました",
      );
    },
  });

  return (
    <>
      <button
        type="button"
        className="text-sm text-muted-foreground underline hover:text-foreground"
        onClick={() => setIsOpen(true)}
      >
        取引に問題がある場合は報告してください
      </button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>問題を報告する</DialogTitle>
            <DialogDescription>
              報告後、この取引は運営の調査中となり、発送・受領の操作が一時停止されます。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>理由 *</Label>
              <Select
                value={reasonCode}
                onValueChange={(value) =>
                  setReasonCode(value as DisputeReasonCode)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="理由を選択" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DISPUTE_REASON_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="disputeDescription">詳細 *</Label>
              <Textarea
                id="disputeDescription"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="状況をできるだけ具体的に記載してください(1000文字以内)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              戻る
            </Button>
            <Button
              variant="destructive"
              onClick={() => disputeMutation.mutate()}
              disabled={
                !reasonCode || !description.trim() || disputeMutation.isPending
              }
            >
              {disputeMutation.isPending ? "送信中…" : "報告する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
