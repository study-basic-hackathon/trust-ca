"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ImagePlus, Loader2 } from "lucide-react";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/auth-provider";
import { StatusStepper, type Step } from "@/components/status-stepper";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, backendUrl } from "@/lib/api";
import {
  uploadCardImage,
  type CardImageKind,
  type UploadedCardImage,
} from "@/lib/api/card-images";
import {
  attachPsaVerification,
  createCard,
  createListing,
  discardCard,
  fetchCardDraft,
  issuePossessionChallenge,
  verifyPsaCert,
  type CardDetail,
  type PsaVerificationResult,
} from "@/lib/api/listings";
import { getMe } from "@/lib/api/me";

type WizardStep = 1 | 2 | 3 | 4 | 5;

const IMAGE_SLOTS: { kind: CardImageKind; label: string; required: boolean }[] =
  [
    { kind: "front", label: "表面", required: true },
    { kind: "back", label: "裏面", required: true },
    { kind: "label", label: "ラベル拡大", required: false },
    { kind: "corner_top_left", label: "四隅(左上)", required: false },
  ];

/**
 * 出品ウィザードの再開用スナップショット。リロードや誤操作で入力・アップロード済みの
 * 進捗が失われないよう、sessionStorageに保存する(タブを閉じると消える)。
 * 期限付きの所持確認コードやアップロード中フラグ等の一時状態は保存しない。
 * プレビュー用objectURLはリロードで無効になるため保存対象外(復元後はアップロード済み
 * 表示のみになる)。
 */
const WIZARD_STORAGE_KEY = "trustca.sell-wizard";

type WizardSnapshot = {
  step: WizardStep;
  name: string;
  series: string;
  cardNumber: string;
  grade: string;
  hasPsa: boolean | null;
  psaCertNumber: string;
  title: string;
  description: string;
  price: string;
  card: CardDetail | null;
  uploadedImages: Partial<Record<CardImageKind, UploadedCardImage>>;
  isPossessionUploaded: boolean;
  psaResult: PsaVerificationResult | null;
};

function loadWizard(): WizardSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(WIZARD_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WizardSnapshot) : null;
  } catch {
    return null;
  }
}

function saveWizard(snapshot: WizardSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // 保存不可は致命的でないため無視する
  }
}

function clearWizard(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(WIZARD_STORAGE_KEY);
  } catch {
    // 無視
  }
}

function wizardSteps(current: WizardStep): Step[] {
  const defs = [
    { key: "info", label: "カード情報" },
    { key: "images", label: "画像" },
    { key: "possession", label: "所持確認" },
    { key: "verify", label: "検証" },
    { key: "confirm", label: "確認" },
  ];
  return defs.map((def, index) => ({
    ...def,
    state:
      index + 1 < current ? "done" : index + 1 === current ? "active" : "waiting",
  }));
}

function SellWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resumeCardId = searchParams.get("cardId");
  const { session, isSignedIn, isBusy, login } = useAuth();
  const [step, setStep] = useState<WizardStep>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  // Step1
  const [name, setName] = useState("");
  const [series, setSeries] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [grade, setGrade] = useState("");
  const [hasPsa, setHasPsa] = useState<boolean | null>(null);
  const [psaCertNumber, setPsaCertNumber] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [card, setCard] = useState<CardDetail | null>(null);

  // Step2
  const [uploadedImages, setUploadedImages] = useState<
    Partial<Record<CardImageKind, UploadedCardImage>>
  >({});
  const [uploadingKind, setUploadingKind] = useState<CardImageKind | null>(
    null,
  );
  // アップロード画像のプレビュー(ローカルFileのobjectURL。リロードで消える)
  const [previews, setPreviews] = useState<
    Partial<Record<CardImageKind, string>>
  >({});

  // Step3(所持確認)
  const [possessionCode, setPossessionCode] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [isPossessionUploaded, setIsPossessionUploaded] = useState(false);
  const [isUploadingPossession, setIsUploadingPossession] = useState(false);

  // Step4(検証)
  const [psaResult, setPsaResult] = useState<PsaVerificationResult | null>(
    null,
  );
  const [isVerifying, setIsVerifying] = useState(false);

  // 進捗の復元はマウント後に行う(SSRのhydration不一致を避けるため初期値はデフォルト)。
  // 復元完了までは保存を止め、デフォルト値で上書きしないようにする。
  const [hasRestored, setHasRestored] = useState(false);
  // 復元は各マウントにつき一度だけ行う。submitStep1/discardWizardが自ら
  // ?cardIdをURLへ同期するため、それによるresumeCardIdの変化でこのeffectが
  // 再実行されても復元処理をやり直さない(やり直すと入力済みの内容を
  // 上書きしてしまう)。sessionがまだ無い場合だけは、届き次第もう一度試す。
  const restoreDoneRef = useRef(false);
  useEffect(() => {
    if (restoreDoneRef.current) return;
    // マウント後にsessionStorageから復元する(初期renderで読むとSSRのhydrationが
    // 不一致になるため)。この用途ではeffect内setStateが正当なので規則を無効化する。
    /* eslint-disable react-hooks/set-state-in-effect */
    const snap = loadWizard();

    // 一覧の「作成中」から?cardId=付きで開かれた場合、同じカードの
    // 続きであればsessionStorageのスナップショットをそのまま使う
    // (Step5で入力中のタイトル・価格をreloadで失わないため)。
    // 別カード・スナップショット無しの場合のみbackendから正が取れる状態を取得する。
    if (resumeCardId && snap?.card?.id === resumeCardId) {
      restoreDoneRef.current = true;
      setStep(snap.step);
      setName(snap.name);
      setSeries(snap.series);
      setCardNumber(snap.cardNumber);
      setGrade(snap.grade);
      setHasPsa(snap.hasPsa);
      setPsaCertNumber(snap.psaCertNumber);
      setTitle(snap.title);
      setDescription(snap.description);
      setPrice(snap.price);
      setCard(snap.card);
      setUploadedImages(snap.uploadedImages ?? {});
      setIsPossessionUploaded(snap.isPossessionUploaded);
      setPsaResult(snap.psaResult);
      setHasRestored(true);
      return;
    }

    if (resumeCardId) {
      if (!session) return; // sessionが届き次第、再度このeffectを試す
      restoreDoneRef.current = true;
      void (async () => {
        try {
          const draft = await fetchCardDraft(session.token, resumeCardId);
          const c = draft.card;
          setName(c.name);
          setSeries(c.series ?? "");
          setCardNumber(c.cardNumber ?? "");
          setGrade(c.grade ?? "");
          setHasPsa(Boolean(c.psaCertNumber));
          setPsaCertNumber(c.psaCertNumber ?? "");
          setCard(c);
          const images: Partial<Record<CardImageKind, UploadedCardImage>> = {};
          for (const image of draft.images) {
            if (image.imageKind === "possession") continue;
            images[image.imageKind] = image;
          }
          setUploadedImages(images);
          setIsPossessionUploaded(draft.hasPossessionProof);
          // タイトル・価格はStep1でのみ入力する項目でbackendに保存されないため
          // (このネットワーク再取得の場合は必ず未入力)、以降のステップの完了状況に
          // 関わらず常にStep1へ着地させる。名前欄等は既存カードとしてロックされる
          // 一方、タイトル・価格欄は編集可能なままなので、ここで入力してから
          // 「次へ」で進める(既に完了済みのステップは自動的に素通りできる)。
          setStep(1);
        } catch (error) {
          toast.error(
            error instanceof ApiError
              ? error.message
              : "出品の再開に失敗しました",
          );
        } finally {
          setHasRestored(true);
        }
      })();
      return;
    }

    // cardIdなしで開かれた場合(ヘッダーの「出品する」・一覧の「新しく出品する」等)は
    // 常に新規の入力から始める。カード作成後はStep1でURLへcardIdを同期するため、
    // ここに来るのは「まだカードを作成していない」場合のみであり、失うデータはない。
    // 過去の中断分のsessionStorageスナップショットが残っていれば破棄する。
    restoreDoneRef.current = true;
    if (snap) clearWizard();
    setStep(1);
    setName("");
    setSeries("");
    setCardNumber("");
    setGrade("");
    setHasPsa(null);
    setPsaCertNumber("");
    setTitle("");
    setDescription("");
    setPrice("");
    setCard(null);
    setUploadedImages({});
    setIsPossessionUploaded(false);
    setPsaResult(null);
    setHasRestored(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [resumeCardId, session]);

  useEffect(() => {
    if (!hasRestored) return;
    saveWizard({
      step,
      name,
      series,
      cardNumber,
      grade,
      hasPsa,
      psaCertNumber,
      title,
      description,
      price,
      card,
      uploadedImages,
      isPossessionUploaded,
      psaResult,
    });
  }, [
    hasRestored,
    step,
    name,
    series,
    cardNumber,
    grade,
    hasPsa,
    psaCertNumber,
    title,
    description,
    price,
    card,
    uploadedImages,
    isPossessionUploaded,
    psaResult,
  ]);

  const meQuery = useQuery({
    queryKey: ["me", session?.token],
    queryFn: () => getMe(session!.token),
    enabled: Boolean(session),
  });

  if (!isSignedIn) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">出品する</h1>
        <p className="mt-3 text-muted-foreground">出品にはログインが必要です。</p>
        <Button className="mt-6" onClick={() => void login()} disabled={isBusy}>
          {isBusy ? "ログイン中…" : "ログイン"}
        </Button>
      </main>
    );
  }

  if (meQuery.isPending) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (meQuery.data && !meQuery.data.isSellingAllowed) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">出品する</h1>
        <Alert className="mx-auto mt-6 max-w-md text-left">
          <AlertTitle>本人確認の完了後に出品できます</AlertTitle>
          <AlertDescription>
            Trustcaは出品前に販売者の本人確認(eKYC)を行う、事前審査型のマーケットプレイスです。
          </AlertDescription>
        </Alert>
        <Button className="mt-6" asChild>
          <Link href="/mypage/seller">本人確認へ進む</Link>
        </Button>
      </main>
    );
  }

  async function submitStep1() {
    if (!name.trim() || !title.trim() || !price.trim() || hasPsa === null) {
      toast.error("必須項目(カード名・タイトル・価格・PSA鑑定の有無)を入力してください");
      return;
    }
    if (hasPsa && !/^[0-9]{1,32}$/.test(psaCertNumber.trim())) {
      toast.error("PSA証明書番号は1〜32桁の数字で入力してください");
      return;
    }
    if (!/^[0-9]+$/.test(price.trim()) || BigInt(price.trim()) <= BigInt(0)) {
      toast.error("価格は1以上の整数(JPYC)で入力してください");
      return;
    }
    setIsSubmitting(true);
    try {
      const created =
        card ??
        (await createCard(session!.token, {
          name: name.trim(),
          series: series.trim() || undefined,
          cardNumber: cardNumber.trim() || undefined,
          grade: grade.trim() || undefined,
          psaCertNumber: hasPsa ? psaCertNumber.trim() : undefined,
        }));
      setCard(created);
      setStep(2);
      // 以降のreload・一覧の「続きから入力」からこのカードを正として再開できるよう、
      // URLにcardIdを同期する(履歴を汚さないためreplace)。
      if (resumeCardId !== created.id) {
        router.replace(`/sell?cardId=${created.id}`);
      }
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "カードを登録できませんでした",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUpload(kind: CardImageKind, file: File) {
    if (!card) return;
    setUploadingKind(kind);
    try {
      const uploaded = await uploadCardImage({
        backendUrl,
        token: session!.token,
        cardId: card.id,
        imageKind: kind,
        uploadContext: "listing",
        file,
      });
      setUploadedImages((current) => ({ ...current, [kind]: uploaded }));
      setPreviews((current) => {
        const next = { ...current };
        if (next[kind]) URL.revokeObjectURL(next[kind]!);
        next[kind] = URL.createObjectURL(file);
        return next;
      });
      toast.success("画像をアップロードしました");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "アップロードに失敗しました",
      );
    } finally {
      setUploadingKind(null);
    }
  }

  async function requestPossessionCode() {
    if (!card) return;
    try {
      const challenge = await issuePossessionChallenge(session!.token, card.id);
      setPossessionCode(challenge);
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "確認コードを発行できませんでした",
      );
    }
  }

  async function handlePossessionUpload(file: File) {
    if (!card || !possessionCode) return;
    setIsUploadingPossession(true);
    try {
      await uploadCardImage({
        backendUrl,
        token: session!.token,
        cardId: card.id,
        imageKind: "possession",
        uploadContext: "listing",
        file,
        captureNonce: possessionCode.code,
      });
      setIsPossessionUploaded(true);
      toast.success("所持確認の画像を受け付けました");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "アップロードに失敗しました",
      );
      // コードが期限切れ・使用済みの場合は再発行を促す
      setPossessionCode(null);
    } finally {
      setIsUploadingPossession(false);
    }
  }

  async function runPsaVerification() {
    if (!card) return;
    setIsVerifying(true);
    try {
      const result = await verifyPsaCert(card.psaCertNumber!);
      setPsaResult(result);
      if (result.verificationId) {
        await attachPsaVerification(
          session!.token,
          card.id,
          result.verificationId,
        );
      }
      if (result.status === "verified") {
        toast.success("PSA登録情報を確認しました");
      } else {
        toast.warning("自動確認ができなかったため、審査扱いになります");
      }
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "PSA照会に失敗しました。時間をおいて再度お試しください",
      );
    } finally {
      setIsVerifying(false);
    }
  }

  async function submitListing() {
    if (!card) return;
    setIsSubmitting(true);
    try {
      const listing = await createListing(session!.token, {
        cardId: card.id,
        title: title.trim(),
        description: description.trim() || null,
        priceMinor: price.trim(),
      });
      clearWizard();
      if (listing.reviewRequired) {
        toast.info(
          "出品を受け付けました。運営の確認後に公開されます",
          { duration: 8000 },
        );
        router.push("/mypage/listings");
      } else {
        toast.success("出品を公開しました");
        router.push(`/listings/${listing.id}`);
      }
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "出品に失敗しました",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function discardWizard() {
    if (!card) return;
    setIsDiscarding(true);
    try {
      await discardCard(session!.token, card.id);
      toast.success("入力内容を破棄しました");
      setCard(null);
      setStep(1);
      setUploadedImages({});
      setPreviews({});
      setPossessionCode(null);
      setIsPossessionUploaded(false);
      setPsaResult(null);
      setIsDiscardDialogOpen(false);
      // 破棄済みカードのcardIdが残っていると、reloadで再び復元されてしまうため外す
      if (resumeCardId) router.replace("/sell");
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "破棄に失敗しました",
      );
    } finally {
      setIsDiscarding(false);
    }
  }

  const requiredImagesUploaded = IMAGE_SLOTS.filter(
    (slot) => slot.required,
  ).every((slot) => uploadedImages[slot.kind]);
  const psaAlreadyVerified = Boolean(card?.psaVerificationStatus);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">出品する</h1>
        {card && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsDiscardDialogOpen(true)}
          >
            破棄してやり直す
          </Button>
        )}
      </div>
      <StatusStepper steps={wizardSteps(step)} />

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>カード情報</CardTitle>
            <CardDescription>
              出品するカードの情報を入力してください。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cardName">カード名 *</Label>
                <Input
                  id="cardName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例: リザードン"
                  disabled={Boolean(card)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="series">シリーズ</Label>
                <Input
                  id="series"
                  value={series}
                  onChange={(e) => setSeries(e.target.value)}
                  placeholder="例: 基本拡張パック"
                  disabled={Boolean(card)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardNumber">カード番号</Label>
                <Input
                  id="cardNumber"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  placeholder="例: 006/102"
                  disabled={Boolean(card)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="grade">グレード表記</Label>
                <Input
                  id="grade"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  placeholder="例: 10"
                  disabled={Boolean(card)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>PSA鑑定 *</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={hasPsa === true ? "default" : "outline"}
                  onClick={() => setHasPsa(true)}
                  disabled={Boolean(card)}
                >
                  PSA鑑定済み
                </Button>
                <Button
                  type="button"
                  variant={hasPsa === false ? "default" : "outline"}
                  onClick={() => setHasPsa(false)}
                  disabled={Boolean(card)}
                >
                  未鑑定
                </Button>
              </div>
            </div>
            {hasPsa && (
              <div className="space-y-2">
                <Label htmlFor="psaCert">PSA証明書番号 *</Label>
                <Input
                  id="psaCert"
                  value={psaCertNumber}
                  onChange={(e) => setPsaCertNumber(e.target.value)}
                  placeholder="例: 12345678"
                  className="font-mono"
                  disabled={Boolean(card)}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="title">出品タイトル *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例: リザードン HOLO 1999 PSA10"
                maxLength={255}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">価格(JPYC) *</Label>
              <Input
                id="price"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="例: 50000"
              />
              <p className="text-xs text-muted-foreground">
                取引実績に応じて出品可能な上限金額が拡大されます。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">説明</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="カードの状態や購入経緯などを記載してください"
              />
            </div>

            <Button onClick={() => void submitStep1()} disabled={isSubmitting}>
              {isSubmitting ? "登録中…" : "次へ(画像アップロード)"}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && card && (
        <Card>
          <CardHeader>
            <CardTitle>画像アップロード</CardTitle>
            <CardDescription>
              表面・裏面は必須です。画像は非公開ストレージへ保存されます。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {IMAGE_SLOTS.map((slot) => {
                const uploaded = uploadedImages[slot.kind];
                return (
                  <div key={slot.kind} className="rounded-lg border p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">
                        {slot.label}
                        {slot.required && (
                          <span className="ml-1 text-destructive">*</span>
                        )}
                      </p>
                      {uploaded && (
                        <CheckCircle2
                          className="size-5 text-success"
                          aria-hidden
                        />
                      )}
                    </div>
                    {previews[slot.kind] && (
                      // アップロードした画像のプレビュー(このセッション内のみ)
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previews[slot.kind]}
                        alt={`${slot.label}のプレビュー`}
                        className="mt-3 aspect-[4/3] w-full rounded-md border object-cover"
                      />
                    )}
                    {uploaded && !previews[slot.kind] && (
                      <p className="mt-3 rounded-md border border-dashed bg-muted/40 py-4 text-center text-xs text-muted-foreground">
                        アップロード済み
                      </p>
                    )}
                    <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed py-6 text-sm text-muted-foreground hover:bg-accent">
                      {uploadingKind === slot.kind ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <ImagePlus className="size-4" aria-hidden />
                      )}
                      {uploaded ? "画像を差し替える" : "画像を選択"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        disabled={uploadingKind !== null}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleUpload(slot.kind, file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                戻る
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={!requiredImagesUploaded}
              >
                次へ(所持確認)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && card && (
        <Card>
          <CardHeader>
            <CardTitle>所持確認</CardTitle>
            <CardDescription>
              確認コードを紙に書き、カードと同じ写真に収めて撮影してください。盗用画像による出品を防ぐための手順です。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!possessionCode ? (
              <Button onClick={() => void requestPossessionCode()}>
                確認コードを発行する
              </Button>
            ) : (
              <>
                <div className="rounded-lg border-2 border-primary/40 bg-accent p-6 text-center">
                  <p className="text-sm text-muted-foreground">確認コード</p>
                  <p className="font-mono text-3xl font-bold tracking-widest">
                    {possessionCode.code}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    有効期限:{" "}
                    {new Date(possessionCode.expiresAt).toLocaleTimeString(
                      "ja-JP",
                    )}
                  </p>
                </div>
                {isPossessionUploaded ? (
                  <p className="flex items-center gap-2 text-sm text-success">
                    <CheckCircle2 className="size-4" aria-hidden />
                    所持確認の画像を受け付けました
                  </p>
                ) : (
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed py-8 text-sm text-muted-foreground hover:bg-accent">
                    {isUploadingPossession ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <ImagePlus className="size-4" aria-hidden />
                    )}
                    コードとカードを一緒に撮影した画像を選択
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={isUploadingPossession}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handlePossessionUpload(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                戻る
              </Button>
              <Button onClick={() => setStep(4)} disabled={!isPossessionUploaded}>
                次へ(検証)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && card && (
        <Card>
          <CardHeader>
            <CardTitle>カード検証</CardTitle>
            <CardDescription>
              {card.psaCertNumber
                ? "PSA証明書番号の登録情報を照会し、入力内容と照合します。"
                : "アップロードされた画像を解析し、入力内容との整合を確認します。"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {card.psaCertNumber ? (
              <>
                <p className="text-sm">
                  証明書番号:{" "}
                  <span className="font-mono">{card.psaCertNumber}</span>
                </p>
                {psaResult ? (
                  <div className="rounded-lg border p-4">
                    {psaResult.status === "verified" && psaResult.card ? (
                      <div className="space-y-2">
                        <TrustBadge signal="psa_verified" />
                        <dl className="grid grid-cols-2 gap-2 text-sm">
                          <dt className="text-muted-foreground">カード名</dt>
                          <dd>{psaResult.card.subject ?? "—"}</dd>
                          <dt className="text-muted-foreground">年</dt>
                          <dd>{psaResult.card.year ?? "—"}</dd>
                          <dt className="text-muted-foreground">グレード</dt>
                          <dd>{psaResult.card.cardGrade ?? "—"}</dd>
                          <dt className="text-muted-foreground">バリエーション</dt>
                          <dd>{psaResult.card.variety ?? "—"}</dd>
                        </dl>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <TrustBadge signal="needs_review" />
                        <p className="text-sm text-muted-foreground">
                          自動確認ができませんでした。このまま出品した場合、審査扱いとなります。
                        </p>
                      </div>
                    )}
                  </div>
                ) : psaAlreadyVerified ? (
                  <div className="rounded-lg border p-4 space-y-2">
                    <TrustBadge signal="psa_verified" />
                    <p className="text-sm text-muted-foreground">
                      この証明書番号は照会済みです。
                    </p>
                  </div>
                ) : (
                  <Button
                    onClick={() => void runPsaVerification()}
                    disabled={isVerifying}
                  >
                    {isVerifying ? "照会中…" : "PSA登録情報を照会する"}
                  </Button>
                )}
              </>
            ) : (
              <Alert>
                <AlertTitle>画像解析による確認</AlertTitle>
                <AlertDescription>
                  アップロードされた画像は出品後に解析され、結果は商品ページの信頼シグナルとして表示されます。
                </AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(3)}>
                戻る
              </Button>
              <Button
                onClick={() => setStep(5)}
                disabled={
                  Boolean(card.psaCertNumber) &&
                  !psaResult &&
                  !psaAlreadyVerified
                }
              >
                次へ(確認)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 5 && card && (
        <Card>
          <CardHeader>
            <CardTitle>出品内容の確認</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <dt className="text-muted-foreground">タイトル</dt>
              <dd className="col-span-2">{title}</dd>
              <dt className="text-muted-foreground">カード名</dt>
              <dd className="col-span-2">{card.name}</dd>
              <dt className="text-muted-foreground">価格</dt>
              <dd className="col-span-2 font-semibold tabular-nums">
                {BigInt(price || "0").toLocaleString("ja-JP")} JPYC
              </dd>
              <dt className="text-muted-foreground">PSA</dt>
              <dd className="col-span-2">
                {card.psaCertNumber
                  ? `証明書番号 ${card.psaCertNumber}(${
                      (psaResult ? psaResult.status === "verified" : psaAlreadyVerified)
                        ? "登録情報確認済み"
                        : "審査扱い"
                    })`
                  : "未鑑定(画像解析)"}
              </dd>
              <dt className="text-muted-foreground">画像</dt>
              <dd className="col-span-2">
                {Object.keys(uploadedImages).length}枚
              </dd>
            </dl>
            <p className="text-xs text-muted-foreground">
              出品手数料は現在無料です。公開後、購入が入ると取引がロックされます。
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(4)}>
                戻る
              </Button>
              <Button onClick={() => void submitListing()} disabled={isSubmitting}>
                {isSubmitting ? "公開中…" : "出品を公開する"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={isDiscardDialogOpen}
        onOpenChange={(open) => !isDiscarding && setIsDiscardDialogOpen(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>入力内容を破棄しますか?</DialogTitle>
            <DialogDescription>
              登録済みのカード情報・アップロード済みの画像は破棄され、元に戻せません。カード名などを修正して入力し直せます。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDiscardDialogOpen(false)}
              disabled={isDiscarding}
            >
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => void discardWizard()}
              disabled={isDiscarding}
            >
              {isDiscarding ? "破棄中…" : "破棄する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export default function SellPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-3xl px-4 py-10">
          <Skeleton className="h-64 w-full" />
        </main>
      }
    >
      <SellWizard />
    </Suspense>
  );
}
