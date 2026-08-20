import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "プライバシーポリシー | Trustca",
};

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "1. 取得する情報",
    body: [
      "本サービスは、アカウント情報(表示名、ウォレットアドレス)、本人確認の審査結果(承認・否認等のステータスおよび各確認項目の結果)、出品・取引に関する情報、配送先情報(氏名、住所、電話番号)を取得します。",
    ],
  },
  {
    title: "2. 本人確認情報の取扱い",
    body: [
      "本人確認(eKYC)で提出される身分証明書の画像、顔画像、氏名・生年月日等の個人情報は、認証事業者(Didit)がその責任において保管します。",
      "本サービスのデータベースには、審査結果のステータス、各確認項目の合否、確認日時などの最小限の情報のみを保存し、身分証画像・顔画像・氏名等は保存しません。",
    ],
  },
  {
    title: "3. 配送先情報の取扱い",
    body: [
      "配送先情報は商品の配送のためにのみ利用し、当該取引の購入者・販売者および運営者のみが参照できます。",
      "配送先情報は取引完了から90日を経過した後、削除します。",
    ],
  },
  {
    title: "4. ウォレットアドレス・取引記録",
    body: [
      "ウォレットアドレスおよび取引のトランザクション情報は、パブリックブロックチェーン上で公開される性質の情報です。本サービスは、これらを取引の確認および監査記録のために利用します。",
      "監査記録としてブロックチェーンに書き込むのは取引イベントのハッシュ値のみであり、個人情報は含まれません。",
    ],
  },
  {
    title: "5. 利用目的",
    body: [
      "取得した情報は、本サービスの提供・本人確認・不正防止・取引の安全確保・お問い合わせ対応のために利用し、これらの目的以外には利用しません。",
    ],
  },
  {
    title: "6. 第三者提供",
    body: [
      "法令に基づく場合、および人の生命・身体・財産の保護のために必要がある場合を除き、本人の同意なく個人情報を第三者に提供しません。",
    ],
  },
  {
    title: "7. お問い合わせ",
    body: [
      "個人情報の開示・訂正・削除等のご請求は、本サービスの運営者までご連絡ください。",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold">プライバシーポリシー</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        最終更新日: 2026年8月20日
      </p>
      <div className="mt-8 space-y-8">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="text-lg font-semibold">{section.title}</h2>
            {section.body.map((paragraph, index) => (
              <p
                key={index}
                className="mt-2 text-sm leading-relaxed text-muted-foreground"
              >
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
