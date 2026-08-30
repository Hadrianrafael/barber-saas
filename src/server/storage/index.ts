import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";
import { env, isConfigured } from "@/env";

/**
 * Object storage abstraction.
 *
 * Driver is chosen from env: Azure Blob Storage when a connection string is
 * present, otherwise a local-disk driver under ./.storage served by
 * /api/storage/[...path]. Application code only ever sees `put()` / `publicUrl()`.
 */

export interface StorageDriver {
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<{ url: string }>;
  publicUrl(key: string): string;
}

class AzureBlobDriver implements StorageDriver {
  private container = BlobServiceClient.fromConnectionString(
    env.AZURE_STORAGE_CONNECTION_STRING,
  ).getContainerClient(env.AZURE_STORAGE_CONTAINER);

  async put(key: string, body: Buffer | Uint8Array, contentType: string) {
    await this.container.createIfNotExists();
    const blob = this.container.getBlockBlobClient(key);
    await blob.uploadData(Buffer.from(body), {
      blobHTTPHeaders: { blobContentType: contentType },
    });
    return { url: this.publicUrl(key) };
  }

  publicUrl(key: string) {
    if (env.STORAGE_PUBLIC_URL) return `${env.STORAGE_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
    return this.container.getBlockBlobClient(key).url;
  }
}

class LocalDiskDriver implements StorageDriver {
  private root = path.join(process.cwd(), ".storage");

  async put(key: string, body: Buffer | Uint8Array, _contentType: string) {
    const full = path.join(this.root, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, Buffer.from(body));
    return { url: this.publicUrl(key) };
  }

  publicUrl(key: string) {
    return `/api/storage/${key}`;
  }
}

export const storage: StorageDriver = isConfigured.azureBlob
  ? new AzureBlobDriver()
  : new LocalDiskDriver();
