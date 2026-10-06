/** S3-mos drayver: Cloudflare R2 yoki Railway bucket (faqat env bilan farqlanadi, Q3). */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PRESIGN_TTL_S, isValidKey } from "./storage";
import type { Storage, StoredObject } from "./storage";

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export class S3Storage implements Storage {
  readonly driver = "s3" as const;
  private readonly client: S3Client;

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      // R2 va Railway bucket "auto" region'ni qabul qiladi.
      region: config.region ?? "auto",
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  private check(key: string): void {
    if (!isValidKey(key)) throw new Error(`Noto'g'ri storage kaliti: ${key}`);
  }

  async presignPut(key: string, options: { contentType?: string; ttlS?: number } = {}) {
    this.check(key);
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentType: options.contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: options.ttlS ?? PRESIGN_TTL_S });
  }

  async presignGet(key: string, options: { ttlS?: number } = {}) {
    this.check(key);
    const command = new GetObjectCommand({ Bucket: this.config.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: options.ttlS ?? PRESIGN_TTL_S });
  }

  async head(key: string): Promise<StoredObject | null> {
    this.check(key);
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return { size: res.ContentLength ?? 0 };
    } catch (error) {
      if ((error as { name?: string }).name === "NotFound") return null;
      throw error;
    }
  }

  async getBytes(key: string): Promise<Buffer | null> {
    this.check(key);
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      const bytes = await res.Body?.transformToByteArray();
      return bytes === undefined ? null : Buffer.from(bytes);
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return null;
      throw error;
    }
  }

  async putBytes(key: string, data: Buffer, contentType?: string): Promise<void> {
    this.check(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    this.check(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ...(token === undefined ? {} : { ContinuationToken: token }),
        }),
      );
      for (const item of res.Contents ?? []) if (item.Key !== undefined) keys.push(item.Key);
      token = res.IsTruncated === true ? res.NextContinuationToken : undefined;
    } while (token !== undefined);
    return keys.sort();
  }
}
