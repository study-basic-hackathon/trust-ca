import {
  BadgeCheck,
  Banknote,
  Fingerprint,
  PackageCheck,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  UserX,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TrustBadge } from "@/components/trust-badge";
import { HoloCardImage } from "@/components/holo-card-image";

const CHALLENGES = [
  {
    icon: ShieldAlert,
    title: "偽物の出品",
    description:
      "偽スラブや、正規の鑑定番号を複製した偽ラベルが市場に流通しています。",
  },
  {
    icon: ScanSearch,
    title: "状態の虚偽表示",
    description:
      "グレードや状態の偽装、他人の画像の盗用による出品が後を絶ちません。",
  },
  {
    icon: UserX,
    title: "不正アカウント",
    description:
      "匿名の使い捨てアカウントや乗っ取りによる、責任の所在が曖昧な取引。",
  },
] as const;

const STEPS = [
  {
    icon: Fingerprint,
    title: "本人確認(eKYC)",
    description:
      "販売者は出品前に、身分証と顔照合による本人確認を完了します。",
  },
  {
    icon: BadgeCheck,
    title: "カード検証",
    description:
      "PSA鑑定番号の登録情報照会、または画像解析でカード情報を確認します。",
  },
  {
    icon: Banknote,
    title: "JPYC決済",
    description:
      "支払いはブロックチェーン上で検証され、取引記録は改竄を検知できる形で残ります。",
  },
  {
    icon: PackageCheck,
    title: "発送・受領確認",
    description:
      "追跡番号による配送状況の共有と受領確認で、取引を最後まで見届けます。",
  },
] as const;

export default function Home() {
  return (
    <main>
      {/* ヒーロー: 信頼のネイビー帯(screen-design.md §7.1) */}
      <section className="relative overflow-hidden text-white">
        <Image
          src="/images/mainvisual_pc@2x.avif"
          alt=""
          fill
          priority
          className="object-cover"
        />
        <div className="absolute inset-0 bg-black/55" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide">
              <ShieldCheck className="size-3.5" aria-hidden />
              高額トレーディングカードのC2Cマーケットプレイス
            </p>
            <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
              出品前に、
              <br />
              審査する。
            </h1>
            <p className="text-lg text-white/80">
              Trustcaは販売者の本人確認とカード検証を出品前に行う、
              事前審査型のマーケットプレイスです。実績を待つのではなく、
              入口で信頼をつくります。
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                className="bg-white text-brand-deep hover:bg-white/90"
                asChild
              >
                <Link href="/listings">商品を探す</Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
                asChild
              >
                <Link href="/mypage/seller">販売者になる</Link>
              </Button>
            </div>
          </div>

          {/* 商品カードのイメージ(鑑定スラブ風) */}
          <Card className="mx-auto w-full max-w-sm rotate-1 border-white/20 bg-black/20 text-white shadow-2xl backdrop-blur-xl transition-transform duration-300 hover:rotate-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <CardHeader>
              <HoloCardImage
                src="/images/charizard-ex-sample.jpg"
                alt="リザードン HOLO 1999 / PSA 10 のサンプル画像"
                priority
              />
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="font-semibold">リザードン HOLO 1999 / PSA 10</p>
              <div className="flex flex-wrap gap-1.5">
                <TrustBadge signal="seller_verified" />
                <TrustBadge signal="psa_verified" />
              </div>
              <p className="text-xl font-bold tabular-nums text-white">
                1,200,000
                <span className="ml-1 text-sm font-normal text-white/60">
                  JPYC
                </span>
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 課題 */}
      <section className="border-y bg-card">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-center text-2xl font-bold">
            高額カード取引の3つの課題
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {CHALLENGES.map((item) => (
              <Card key={item.title}>
                <CardHeader>
                  <item.icon className="size-8 text-destructive" aria-hidden />
                  <CardTitle className="text-lg">{item.title}</CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* 仕組み */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold">Trustcaの仕組み</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
          既存サービスは、取引実績が積み上がるのを待ちます。
          Trustcaは出品の前に審査を置くことで、最初の1枚から信頼できる取引を実現します。
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-4">
          {STEPS.map((step, index) => (
            <div key={step.title} className="relative space-y-3">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                <step.icon className="size-6 text-primary" aria-hidden />
              </div>
              <p className="text-sm font-semibold text-gold">
                STEP {index + 1}
              </p>
              <h3 className="font-semibold">{step.title}</h3>
              <p className="text-sm text-muted-foreground">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 信頼シグナルの説明 */}
      <section className="border-y bg-card">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-center text-2xl font-bold">
            表示するのは、確認できた事実だけ
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
            Trustcaは「真贋保証」を謳いません。それぞれのバッジが、
            何をどのように確認した事実なのかを明示します。
          </p>
          <div className="mx-auto mt-8 max-w-2xl space-y-4">
            <div className="flex items-start gap-4 rounded-lg border p-4">
              <TrustBadge signal="seller_verified" />
              <p className="text-sm text-muted-foreground">
                販売者が身分証・顔照合・ライブネスによる本人確認を完了しています。
              </p>
            </div>
            <div className="flex items-start gap-4 rounded-lg border p-4">
              <TrustBadge signal="psa_verified" />
              <p className="text-sm text-muted-foreground">
                入力されたPSA鑑定番号の登録情報を、PSA Public
                APIで照会し出品内容と照合しています。現物の真贋を保証するものではありません。
              </p>
            </div>
            <div className="flex items-start gap-4 rounded-lg border p-4">
              <TrustBadge signal="image_analyzed" />
              <p className="text-sm text-muted-foreground">
                出品画像を画像解析にかけ、記載内容との整合を確認しています。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 text-center">
        <h2 className="text-2xl font-bold">
          安心して取引できる場所を、一緒に。
        </h2>
        <div className="mt-6 flex justify-center gap-3">
          <Button size="lg" asChild>
            <Link href="/listings">商品を探す</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/mypage/seller">販売者になる</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
