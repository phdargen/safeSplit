/**
 * Attachment utilities for encrypting and handling remote attachments.
 * Based on xmtp-agent-examples utilities.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CodecRegistry } from "@xmtp/content-type-primitives";
import {
  AttachmentCodec,
  RemoteAttachmentCodec,
  type Attachment,
  type RemoteAttachment,
} from "@xmtp/content-type-remote-attachment";

export interface EncryptedAttachment {
  encryptedData: Uint8Array;
  filename: string;
  digest: string;
  salt: Uint8Array;
  nonce: Uint8Array;
  secret: Uint8Array;
}

/**
 * Encrypt attachment data for secure transmission.
 * Returns encrypted data plus encryption metadata for creating RemoteAttachment.
 */
export async function encryptAttachment(
  data: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<EncryptedAttachment> {
  const encrypted = await RemoteAttachmentCodec.encodeEncrypted(
    { filename, mimeType, data },
    new AttachmentCodec(),
  );
  return {
    encryptedData: encrypted.payload,
    filename,
    digest: encrypted.digest,
    salt: encrypted.salt,
    nonce: encrypted.nonce,
    secret: encrypted.secret,
  };
}

/**
 * Create a remote attachment from a file path.
 */
export async function createRemoteAttachmentFromFile(
  filePath: string,
  fileUrl: string,
  mimeType: string,
): Promise<RemoteAttachment> {
  const fileData = await readFile(filePath);
  const filename = path.basename(filePath);
  return createRemoteAttachmentFromData(
    new Uint8Array(fileData),
    filename,
    mimeType,
    fileUrl,
  );
}

/**
 * Create a remote attachment from data in memory.
 */
export async function createRemoteAttachmentFromData(
  data: Uint8Array,
  filename: string,
  mimeType: string,
  fileUrl: string,
): Promise<RemoteAttachment> {
  const encrypted = await RemoteAttachmentCodec.encodeEncrypted(
    { filename, mimeType, data },
    new AttachmentCodec(),
  );

  return {
    url: fileUrl,
    contentDigest: encrypted.digest,
    salt: encrypted.salt,
    nonce: encrypted.nonce,
    secret: encrypted.secret,
    scheme: `${new URL(fileUrl).protocol}//`,
    filename,
    contentLength: data.byteLength,
  };
}

/**
 * Load and decrypt a remote attachment.
 */
export async function loadRemoteAttachment(
  remoteAttachment: RemoteAttachment,
  client: CodecRegistry,
): Promise<Attachment> {
  return await RemoteAttachmentCodec.load(
    remoteAttachment,
    client as unknown as CodecRegistry,
  );
}

