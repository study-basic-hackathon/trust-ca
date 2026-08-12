import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PSA証明書照会 | Trustca",
  description: "出品前にPSAのカード登録情報を確認するTrustcaの照会画面",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
