export type ApiResult<T> = { data: T } | { error: { code: string; message: string } };

async function api<T>(
  backendUrl: string,
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  const body = (await response.json()) as ApiResult<T>;
  if (!response.ok || "error" in body) {
    throw new Error(
      "error" in body ? body.error.message : "API処理に失敗しました。",
    );
  }
  return body.data;
}

export type CardImageKind =
  | "front"
  | "back"
  | "label"
  | "corner_top_left"
  | "corner_top_right"
  | "corner_bottom_left"
  | "corner_bottom_right"
  | "possession";

export type UploadedCardImage = {
  id: string;
  cardId: string;
  uploadedByUserId: string;
  imageKind: CardImageKind;
  contentType: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
};

async function sha256Hex(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 署名付きURL発行 → GCSへPUT → backendへ登録、の3ステップをまとめる。
 * (docs/design/api-catalog.md §5.5のアップロード手順)
 */
export async function uploadCardImage(params: {
  backendUrl: string;
  token: string;
  cardId: string;
  imageKind: CardImageKind;
  uploadContext: "listing" | "arrival";
  file: File;
}): Promise<UploadedCardImage> {
  const { backendUrl, token, cardId, imageKind, uploadContext, file } = params;
  const contentType = file.type;
  const sha256 = await sha256Hex(file);

  const { objectKey, uploadUrl } = await api<{
    objectKey: string;
    uploadUrl: string;
    bucket: string;
  }>(backendUrl, "/api/v1/uploads/card-images", token, {
    method: "POST",
    body: JSON.stringify({ contentType }),
  });

  const putResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: file,
  });
  if (!putResponse.ok) {
    throw new Error("画像のアップロードに失敗しました。時間をおいて再度お試しください。");
  }

  return api<UploadedCardImage>(
    backendUrl,
    `/api/v1/cards/${cardId}/images`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        objectKey,
        contentType,
        byteSize: file.size,
        sha256,
        imageKind,
        uploadContext,
      }),
    },
  );
}

export type CardImageAnalysisResult = {
  id: string;
  cardId: string;
  sourceImageId: string;
  status: "completed" | "in_review" | "failed";
  score: number | null;
  normalizedResult: {
    ocrText: string;
    matchedName: boolean;
    matchedCardNumber: boolean | null;
    cardLikeLabelDetected: boolean;
    labels: { description: string; score: number }[];
  } | null;
};

export async function runCardImageAnalysis(params: {
  backendUrl: string;
  token: string;
  cardId: string;
  imageId: string;
}): Promise<CardImageAnalysisResult> {
  return api<CardImageAnalysisResult>(
    params.backendUrl,
    "/api/v1/card-image-analyses",
    params.token,
    {
      method: "POST",
      body: JSON.stringify({ cardId: params.cardId, imageId: params.imageId }),
    },
  );
}
