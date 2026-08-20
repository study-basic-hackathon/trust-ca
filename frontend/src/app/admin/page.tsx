import type { Metadata } from "next";
import {
  Fingerprint,
  ListOrdered,
  PackageOpen,
  ScanSearch,
} from "lucide-react";
import Link from "next/link";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "管理コンソール | Trustca",
};

const SECTIONS = [
  {
    href: "/admin/verifications",
    icon: Fingerprint,
    title: "本人確認の審査",
    description: "審査中(in_review)のeKYCセッションを承認・却下します。",
  },
  {
    href: "/admin/card-image-analyses",
    icon: ScanSearch,
    title: "画像解析の確認",
    description: "自動判定できなかった画像解析(要確認)を一覧します。",
  },
  {
    href: "/admin/listings",
    icon: PackageOpen,
    title: "出品管理",
    description: "全出品の状態確認と、規約違反等の強制停止を行います。",
  },
  {
    href: "/admin/orders",
    icon: ListOrdered,
    title: "取引一覧",
    description: "全取引の進行状況(支払い・発送・完了・紛争)を確認します。",
  },
] as const;

export default function AdminDashboardPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold">管理コンソール</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          各画面の操作には運営者トークン(ADMIN_API_TOKEN)が必要です。
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} className="group">
            <Card className="h-full transition-shadow group-hover:shadow-md">
              <CardHeader>
                <section.icon className="size-7 text-primary" aria-hidden />
                <CardTitle className="text-base">{section.title}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
