import { createHash, randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";

export type UploadContentType = "image/jpeg" | "image/png" | "image/webp";

const EXTENSION_BY_CONTENT_TYPE: Record<UploadContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export class StorageServiceError extends Error {
  constructor(
    public readonly code:
      | "STORAGE_OBJECT_NOT_FOUND"
      | "STORAGE_CONTENT_TYPE_MISMATCH"
      | "STORAGE_BYTE_SIZE_MISMATCH"
      | "STORAGE_SHA256_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "StorageServiceError";
  }
}

export type StorageFileLike = {
  exists(): Promise<[boolean, ...unknown[]]>;
  getMetadata(): Promise<
    [{ contentType?: string; size?: string | number }, ...unknown[]]
  >;
  download(): Promise<[Buffer, ...unknown[]]>;
  getSignedUrl(options: {
    version: "v4";
    action: "write";
    expires: number;
    contentType: string;
  }): Promise<[string, ...unknown[]]>;
};

export type StorageClientLike = {
  bucket(name: string): { file(objectKey: string): StorageFileLike };
};

let defaultClient: StorageClientLike | null = null;
function getDefaultClient(): StorageClientLike {
  defaultClient ??= new Storage();
  return defaultClient;
}

export function buildObjectKey(contentType: UploadContentType): string {
  return `card-images/${randomUUID()}.${EXTENSION_BY_CONTENT_TYPE[contentType]}`;
}

export async function issueUploadUrl(params: {
  bucket: string;
  contentType: UploadContentType;
  ttlSeconds: number;
  now?: () => number;
  storageClient?: StorageClientLike;
}): Promise<{ objectKey: string; uploadUrl: string }> {
  const client = params.storageClient ?? getDefaultClient();
  const now = params.now ?? Date.now;
  const objectKey = buildObjectKey(params.contentType);
  const [uploadUrl] = await client
    .bucket(params.bucket)
    .file(objectKey)
    .getSignedUrl({
      version: "v4",
      action: "write",
      expires: now() + params.ttlSeconds * 1_000,
      contentType: params.contentType,
    });
  return { objectKey, uploadUrl };
}

export async function verifyUploadedObject(params: {
  bucket: string;
  objectKey: string;
  expectedContentType: string;
  expectedByteSize: number;
  expectedSha256: string;
  storageClient?: StorageClientLike;
}): Promise<void> {
  const client = params.storageClient ?? getDefaultClient();
  const file = client.bucket(params.bucket).file(params.objectKey);

  const [exists] = await file.exists();
  if (!exists) {
    throw new StorageServiceError(
      "STORAGE_OBJECT_NOT_FOUND",
      "アップロードされたobjectがCloud Storage上に見つかりません。",
    );
  }

  const [metadata] = await file.getMetadata();
  if (metadata.contentType !== params.expectedContentType) {
    throw new StorageServiceError(
      "STORAGE_CONTENT_TYPE_MISMATCH",
      "アップロード済みobjectのcontent typeが申告値と一致しません。",
    );
  }
  if (Number(metadata.size) !== params.expectedByteSize) {
    throw new StorageServiceError(
      "STORAGE_BYTE_SIZE_MISMATCH",
      "アップロード済みobjectのbyte sizeが申告値と一致しません。",
    );
  }

  const [bytes] = await file.download();
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== params.expectedSha256) {
    throw new StorageServiceError(
      "STORAGE_SHA256_MISMATCH",
      "アップロード済みobjectのSHA-256が申告値と一致しません。",
    );
  }
}
