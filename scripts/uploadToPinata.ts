/**
 * Upload and encrypt capyTab.png to Pinata IPFS storage.
 * Outputs a complete RemoteAttachment metadata object for reuse.
 * Usage: PINATA_JWT=<your_jwt> tsx scripts/uploadToPinata.ts
 */
import { readFile } from "node:fs/promises";
import FormData from "form-data";
import axios from "axios";
import * as dotenv from "dotenv";
import { encryptAttachment } from "../utils/attachment";

dotenv.config();

const PINATA_JWT = process.env.PINATA_JWT;
const IMAGE_PATH = "./capyTab.jpg";

if (!PINATA_JWT) {
  console.error("❌ Error: PINATA_JWT environment variable is required");
  console.log("\nUsage: PINATA_JWT=<your_jwt> tsx scripts/uploadToPinata.ts");
  process.exit(1);
}

interface PinataResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

async function uploadToPinata(): Promise<void> {
  try {
    console.log(`📤 Reading ${IMAGE_PATH}...`);
    const fileData = await readFile(IMAGE_PATH);
    console.log(`✓ File size: ${fileData.byteLength} bytes`);

    console.log(`🔐 Encrypting image for XMTP...`);
    const encrypted = await encryptAttachment(
      new Uint8Array(fileData),
      "capyTab.png",
      "image/png",
    );

    console.log(`📤 Uploading encrypted image to Pinata IPFS...`);
    const formData = new FormData();
    formData.append("file", Buffer.from(encrypted.encryptedData), {
      filename: encrypted.filename,
      contentType: "application/octet-stream",
    });

    const response = await axios.post<PinataResponse>(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      formData,
      {
        maxContentLength: Infinity,
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${PINATA_JWT}`,
        },
      },
    );

    const ipfsHash = response.data.IpfsHash;
    const fileUrl = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;

    // Create the complete RemoteAttachment metadata
    // Convert Uint8Arrays to regular arrays for JSON serialization
    const remoteAttachmentMetadata = {
      url: fileUrl,
      contentDigest: encrypted.digest,
      salt: Array.from(encrypted.salt),
      nonce: Array.from(encrypted.nonce),
      secret: Array.from(encrypted.secret),
      scheme: "https://",
      filename: "capyTab.png",
      contentLength: fileData.byteLength,
    };

    console.log("\n✅ Upload successful!");
    console.log(`\n📋 IPFS Hash: ${ipfsHash}`);
    console.log(`🔗 URL: ${fileUrl}`);
    console.log(`\n💾 Copy this line to your .env file:\n`);
    console.log(`CAPY_REMOTE_ATTACHMENT=${JSON.stringify(remoteAttachmentMetadata)}`);
    console.log(`\n📝 The encrypted image is stored on IPFS.`);
    console.log(`   The RemoteAttachment metadata includes decryption keys.`);
    console.log(`   This can be reused for every welcome message!`);
  } catch (error) {
    console.error("❌ Upload failed:", error);
    process.exit(1);
  }
}

uploadToPinata();

