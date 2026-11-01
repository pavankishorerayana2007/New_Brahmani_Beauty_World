const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { env } = require('../config/env');
const { HttpError } = require('../utils/httpError');

const PUBLIC = 'public-media';
const PRIVATE = 'payment-proofs';
const MAX_BYTES = 2_000_000;

let sb;
function client() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(503, 'Image storage is not set up on the server yet (see README, Supabase step).');
  }
  if (!sb) sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return sb;
}

const publicBase = () => `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${PUBLIC}/`;
const isOurPublicUrl = (u) => typeof u === 'string' && !!env.SUPABASE_URL && u.startsWith(publicBase());

/** Validates a data: URL image (type, size, real file signature). */
function decodeImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, 'Please choose a JPG, PNG or WebP image');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new HttpError(400, 'The image is empty');
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'Image is too large. Choose a smaller one');
  const sig = {
    'image/jpeg': buf[0] === 0xff && buf[1] === 0xd8,
    'image/png': buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    'image/webp': buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP',
  }[m[1]];
  if (!sig) throw new HttpError(400, 'That file is not a valid image');
  return { buf, type: m[1], ext: m[1] === 'image/jpeg' ? 'jpg' : m[1].split('/')[1] };
}

async function put(bucket, folder, dataUrl) {
  const { buf, type, ext } = decodeImage(dataUrl);
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await client().storage.from(bucket).upload(path, buf, { contentType: type, upsert: false });
  if (error) {
    console.error('[storage] upload failed:', error.message);
    throw new HttpError(502, 'Could not store the image. Please try again.');
  }
  return path;
}

async function uploadPublic(folder, dataUrl) {
  const path = await put(PUBLIC, folder, dataUrl);
  return { path, url: client().storage.from(PUBLIC).getPublicUrl(path).data.publicUrl };
}
const uploadPrivate = (folder, dataUrl) => put(PRIVATE, folder, dataUrl);

async function signedProofUrl(path, seconds = 300) {
  const { data, error } = await client().storage.from(PRIVATE).createSignedUrl(path, seconds);
  if (error) throw new HttpError(404, 'Payment screenshot is not available');
  return data.signedUrl;
}

async function removePublic(path) {
  if (!path) return;
  try { await client().storage.from(PUBLIC).remove([path]); } catch (e) { console.error('[storage] remove failed', e.message); }
}

module.exports = { uploadPublic, uploadPrivate, signedProofUrl, removePublic, isOurPublicUrl, PUBLIC, PRIVATE };
