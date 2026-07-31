// REV1′ evidence — the ONE dependency the readable preview rests on.
//
// The consultation popup renders the bank document with <object data={presignedUrl}>. The storage
// key is `bank/<userId>/<rowId>` and carries NO file extension, so the browser cannot infer the
// type from the URL: it renders the document if and only if the storage SERVES a correct
// Content-Type, and shows an empty grey box otherwise. That is the failure mode a class-name
// assertion cannot catch, so it is checked here against real MinIO, end to end.
//
// Uploads one JPEG and one PDF through the same storage provider the upload route uses, presigns
// both exactly as the read route does, fetches the headers, and deletes the objects afterwards.
// Scratch keys only — nothing under a real user's prefix.

import { storage } from '../src/storage/s3-storage.js';

const KEY_JPEG = 'bank/__rev1-evidence__/identity.jpg';
const KEY_PDF = 'bank/__rev1-evidence__/identity.pdf';

// A minimal but REAL JPEG (SOI … EOI) and a minimal but REAL one-page PDF — genuine magic bytes,
// so MinIO is asked to serve the same shapes an owner would actually upload.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

const check = async (key: string, body: Buffer, contentType: string): Promise<boolean> => {
  const up = await storage.upload({ key, body, contentType });
  if ('error' in up) {
    console.log(`  ${key}: UPLOAD FAILED (${String(up.error)})`);
    return false;
  }
  const signed = await storage.getPresignedUrl({ key });
  if ('error' in signed) {
    console.log(`  ${key}: PRESIGN FAILED (${String(signed.error)})`);
    return false;
  }
  const res = await fetch(signed.url, { method: 'GET' });
  const served = res.headers.get('content-type');
  const len = res.headers.get('content-length');
  const ok = served === contentType;
  console.log(`  ${key}`);
  console.log(`    HTTP ${res.status}   Content-Type: ${served}   Content-Length: ${len}`);
  console.log(
    `    declared ${contentType} → ${ok ? 'MATCH — <object> renders it' : 'MISMATCH — <object> would show a grey box'}`,
  );
  return ok;
};

const main = async (): Promise<void> => {
  console.log('REV1 preview evidence — does the storage serve a renderable Content-Type?\n');
  const jpegOk = await check(KEY_JPEG, JPEG, 'image/jpeg');
  const pdfOk = await check(KEY_PDF, PDF, 'application/pdf');

  await storage.delete({ key: KEY_JPEG });
  await storage.delete({ key: KEY_PDF });
  console.log('\n  scratch objects deleted.');
  console.log(
    `\nVERDICT: ${jpegOk && pdfOk ? 'BOTH renderable' : 'AT LEAST ONE would fail to render'}`,
  );
  if (!jpegOk || !pdfOk) process.exitCode = 1;
};

void main();
