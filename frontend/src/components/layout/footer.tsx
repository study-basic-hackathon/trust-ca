import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-16 border-t bg-card">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link href="/terms" className="hover:text-foreground">
            利用規約
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            プライバシーポリシー
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          本サービスの各表示(本人確認済み・PSA登録情報確認済み・画像解析済み等)は、
          確認できた事実のみを示すものであり、商品の真贋を保証するものではありません。
        </p>
        <p className="mt-2 text-xs text-muted-foreground">© 2026 Trustca</p>
      </div>
    </footer>
  );
}
