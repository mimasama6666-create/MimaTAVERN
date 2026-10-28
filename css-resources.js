(function (root) {
 'use strict';
 // Only live leases retain source strings; releasing the last lease removes the
 // entry, decoder, and Blob URL. Preset CSS itself is never changed or cached.
 const pool = new Map();
 const DEFAULT_MAX_PIXELS = 16 * 1024 * 1024;
 const DEFAULT_MAX_ANIMATION_PIXELS = 64 * 1024 * 1024;
 const DEFAULT_MAX_ANIMATION_FRAMES = 1000;
 const raster = /^(?:image\/(?:png|jpeg|jpg|gif|webp|bmp|x-icon|vnd\.microsoft\.icon))$/i;
 const fonts = /^(?:font\/(?:woff2?|ttf|otf|sfnt|collection)|application\/(?:font-woff|x-font-(?:woff|ttf|opentype)|vnd\.ms-fontobject))$/i;
 const abortError = () => new DOMException('CSS resource preparation cancelled', 'AbortError');
 function imageError(message) { return new Error('CSS image: ' + message); }
 function resourceLimits(options) {
  const limits = {maxImagePixels:DEFAULT_MAX_PIXELS, maxAnimationPixels:DEFAULT_MAX_ANIMATION_PIXELS, maxAnimationFrames:DEFAULT_MAX_ANIMATION_FRAMES};
  for (const key of Object.keys(limits)) {
   if (options[key] !== undefined) limits[key] = options[key];
   if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) throw new TypeError(key + ' must be a positive safe integer');
  }
  return limits;
 }
 function checkPixels(width, height, limit) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw imageError('invalid raster dimensions');
  if (width > limit / height) throw imageError('original raster ' + width + ' × ' + height + ' exceeds the ' + limit.toLocaleString() + ' pixel safety budget');
 }
 function dimensions(bytes, mime) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n = bytes.length;
  const ascii = (at, value) => at + value.length <= n && [...value].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  let width, height;
  if (mime === 'image/png' && n >= 24 && bytes[0] === 137 && ascii(1, 'PNG\r\n\x1a\n') && ascii(12, 'IHDR')) {
   width = d.getUint32(16); height = d.getUint32(20);
  } else if (mime === 'image/gif' && n >= 10 && (ascii(0, 'GIF87a') || ascii(0, 'GIF89a'))) {
   width = d.getUint16(6, true); height = d.getUint16(8, true);
  } else if ((mime === 'image/jpeg' || mime === 'image/jpg') && n >= 4 && bytes[0] === 255 && bytes[1] === 216) {
   let p = 2;
   while (p + 1 < n) {
    if (bytes[p++] !== 255) break;
    while (p < n && bytes[p] === 255) p++;
    const marker = bytes[p++];
    if (marker === 218 || marker === 217) break;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    if (p + 2 > n) break;
    const length = d.getUint16(p);
    if (length < 2 || p + length > n) break;
    if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker) && length >= 7) {
     height = d.getUint16(p + 3); width = d.getUint16(p + 5); break;
    }
    p += length;
   }
  } else if (mime === 'image/webp' && n >= 20 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
   let p = 12;
   while (p + 8 <= n) {
    const size = d.getUint32(p + 4, true), start = p + 8;
    if (start + size > n) break;
    if (ascii(p, 'VP8X') && size >= 10) {
     width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
     height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16); break;
    }
    if (ascii(p, 'VP8L') && size >= 5 && bytes[start] === 47) {
     const bits = d.getUint32(start + 1, true);
     width = 1 + (bits & 16383); height = 1 + ((bits >>> 14) & 16383); break;
    }
    if (ascii(p, 'VP8 ') && size >= 10 && bytes[start + 3] === 157 && bytes[start + 4] === 1 && bytes[start + 5] === 42) {
     width = d.getUint16(start + 6, true) & 16383; height = d.getUint16(start + 8, true) & 16383; break;
    }
    p = start + size + (size & 1);
   }
  } else if (mime === 'image/bmp' && n >= 26 && ascii(0, 'BM')) {
   const header = d.getUint32(14, true);
   if (header === 12) { width = d.getUint16(18, true); height = d.getUint16(20, true); }
   else if (header >= 40) { width = Math.abs(d.getInt32(18, true)); height = Math.abs(d.getInt32(22, true)); }
  } else if ((mime === 'image/x-icon' || mime === 'image/vnd.microsoft.icon') && n >= 22 && d.getUint32(0, true) === 65536) {
   const count = d.getUint16(4, true);
   if (count && 6 + count * 16 <= n) {
    width = 0; height = 0;
    for (let p = 6; p < 6 + count * 16; p += 16) { width = Math.max(width, bytes[p] || 256); height = Math.max(height, bytes[p + 1] || 256); }
   }
  }
  if (!width || !height) throw imageError('invalid or unreadable ' + mime + ' raster header');
  return {width, height};
 }
 function checkAnimation(size, limits) {
  checkPixels(size.width, size.height, limits.maxImagePixels);
  if (size.frames > limits.maxAnimationFrames) throw imageError('animation has ' + size.frames + ' frames; exceeds the ' + limits.maxAnimationFrames + ' frame safety budget');
  if (size.frames > 1 && size.animationPixels > limits.maxAnimationPixels) throw imageError('animation requires ' + size.animationPixels.toLocaleString() + ' canvas pixels across ' + size.frames + ' frames; exceeds the ' + limits.maxAnimationPixels.toLocaleString() + ' pixel animation work budget');
 }
 function inspectBytes(bytes, mime, limits) {
  const size = dimensions(bytes, mime), d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n = bytes.length;
  checkPixels(size.width, size.height, limits.maxImagePixels);
  size.frames = 0; size.animationPixels = 0;
  function frame(width, height) {
   checkPixels(width, height, limits.maxImagePixels);
   size.frames++;
   // Disposal/compositing can touch the complete canvas even for a small patch.
   size.animationPixels += Math.max(size.width * size.height, width * height);
   checkAnimation(size, limits);
  }
  if (mime === 'image/png') {
   let declared = 0;
   for (let p = 8; p + 8 <= n;) {
    const length = d.getUint32(p), start = p + 8;
    if (start + length + 4 > n) break;
    const kind = String.fromCharCode(...bytes.subarray(p + 4, start));
    if (kind === 'acTL') {
     if (length !== 8 || !d.getUint32(start)) throw imageError('invalid PNG animation control');
     declared = d.getUint32(start);
     checkAnimation({...size, frames:declared, animationPixels:size.width * size.height * declared}, limits);
    } else if (kind === 'fcTL') {
     if (length !== 26) throw imageError('invalid PNG animation frame');
     const width = d.getUint32(start + 4), height = d.getUint32(start + 8);
     if (d.getUint32(start + 12) + width > size.width || d.getUint32(start + 16) + height > size.height) throw imageError('PNG animation frame exceeds its canvas');
     frame(width, height);
    }
    if (kind === 'IEND') break;
    p = start + length + 4;
   }
   if (declared && size.frames !== declared) throw imageError('PNG animation frame count does not match its declaration');
  } else if (mime === 'image/gif' && n >= 13) {
   let p = 13 + (bytes[10] & 128 ? 3 * (2 << (bytes[10] & 7)) : 0);
   function skipBlocks() {
    while (p < n) { const length = bytes[p++]; if (!length) return; if (p + length > n) { p = n; return; } p += length; }
   }
   while (p < n) {
    const tag = bytes[p];
    if (tag === 59) break;
    if (tag === 33 && p + 2 <= n) { p += 2; skipBlocks(); continue; }
    if (tag !== 44 || p + 10 > n) break;
    frame(d.getUint16(p + 5, true), d.getUint16(p + 7, true));
    const packed = bytes[p + 9]; p += 10 + (packed & 128 ? 3 * (2 << (packed & 7)) : 0);
    p++; skipBlocks();
   }
  } else if (mime === 'image/webp') {
   let p = 12;
   while (p + 8 <= n) {
    const length = d.getUint32(p + 4, true), start = p + 8;
    if (start + length > n) break;
    if (bytes[p] === 65 && bytes[p + 1] === 78 && bytes[p + 2] === 77 && bytes[p + 3] === 70 && length >= 16) {
     const width = 1 + bytes[start + 6] + (bytes[start + 7] << 8) + (bytes[start + 8] << 16);
     const height = 1 + bytes[start + 9] + (bytes[start + 10] << 8) + (bytes[start + 11] << 16);
     frame(width, height);
    }
    p = start + length + (length & 1);
   }
  }
  return size;
 }
 function decodeBase64(base64) {
  let binary;
  try { binary = atob(base64); } catch (_) { throw new Error('Invalid base64 CSS resource'); }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
 }
 function inspectImage(source, options = {}) {
  if (typeof source !== 'string') return null;
  const match = /^data:([^;,\s]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(source);
  if (!match || !raster.test(match[1])) return null;
  return inspectBytes(decodeBase64(match[2]), match[1].toLowerCase(), resourceLimits(options));
 }
 function quotedEnd(css, start) {
  const quote = css[start]; let p = start + 1;
  for (; p < css.length; p++) { if (css[p] === '\\') p++; else if (css[p] === quote) return p + 1; }
  return css.length;
 }
 function tokens(css) {
  const found = [], stack = []; let p = 0, statement = 0;
  while (p < css.length) {
   const c = css[p];
   if (c === '/' && css[p + 1] === '*') { const end = css.indexOf('*/', p + 2); p = end < 0 ? css.length : end + 2; continue; }
   if (c === '"' || c === "'") { p = quotedEnd(css, p); continue; }
   if (c === '{') { const header = css.slice(statement, p).replace(/\/\*[\s\S]*?\*\//g, '').trim(); stack.push(/^@font-face\b/i.test(header)); statement = ++p; continue; }
   if (c === '}') { stack.pop(); statement = ++p; continue; }
   if (c === ';') { statement = ++p; continue; }
   if ((c === 'u' || c === 'U') && !/[\w\\\u0080-\uffff-]/.test(css[p - 1] || '') && /^url\(/i.test(css.slice(p, p + 4))) {
    let start = p + 4; while (/\s/.test(css[start] || '') && start < css.length) start++;
    let end, finish;
    if (css[start] === '"' || css[start] === "'") {
     finish = quotedEnd(css, start); end = finish - 1; start++;
     while (/\s/.test(css[finish] || '') && finish < css.length) finish++;
     if (css[finish] !== ')') { p = finish; continue; }
    } else {
     finish = start;
     while (finish < css.length && css[finish] !== ')') { if (css[finish] === '\\') finish++; finish++; }
     if (finish === css.length) break;
     end = finish; while (end > start && /\s/.test(css[end - 1])) end--;
    }
    const source = css.slice(start, end);
    const match = /^data:([^;,\s]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(source);
    if (match && match[2] && match[2].length % 4 !== 1) {
     const mime = match[1].toLowerCase(), image = raster.test(mime);
     if (image || fonts.test(mime) || mime === 'application/octet-stream' && stack[stack.length - 1]) found.push({start, end, source, mime, image, base64:match[2]});
    }
    p = finish + 1; continue;
   }
   p++;
  }
  return found;
 }
 function decodeImage(entry) {
  const image = new Image();
  let rejectLoad;
  const loaded = new Promise((resolve, reject) => {
   rejectLoad = reject;
   image.onload = resolve;
   image.onerror = () => reject(imageError('raster could not be loaded'));
  });
  entry.cancel = () => { image.onload = image.onerror = null; image.src = ''; rejectLoad(abortError()); };
  image.src = entry.url;
  return (async () => {
   try {
    await loaded;
    if (!entry.refs) throw abortError();
    checkPixels(image.naturalWidth, image.naturalHeight, entry.limit);
    // Header validation runs before src/decode. The browser remains the final
    // format validator; only one new raster per prepare is decoded at a time.
    if (typeof image.decode === 'function') await image.decode();
    if (!entry.refs) throw abortError();
   } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw imageError('raster decoding failed: ' + error.message);
   } finally { image.onload = image.onerror = null; image.src = ''; entry.cancel = null; }
  })();
 }
 function acquire(token, limits) {
  let entry = pool.get(token.source);
  if (entry) { if (entry.dimensions) checkAnimation(entry.dimensions, limits); entry.refs++; return entry; }
  const bytes = decodeBase64(token.base64);
  const size = token.image ? inspectBytes(bytes, token.mime, limits) : null;
  entry = {url:URL.createObjectURL(new Blob([bytes], {type:token.mime})), refs:1, dimensions:size, limit:limits.maxImagePixels, cancel:null, promise:null};
  pool.set(token.source, entry);
  try { entry.promise = token.image ? decodeImage(entry) : Promise.resolve(); }
  catch (error) { drop(token.source, entry); throw error; }
  // An aborted last consumer can leave a native decoder's rejection arriving
  // later. Keep that rejection observed without starting any further work.
  entry.promise.catch(() => {});
  return entry;
 }
 function drop(source, entry) {
  if (--entry.refs !== 0) return;
  if (pool.get(source) === entry) pool.delete(source);
  if (entry.cancel) entry.cancel();
  URL.revokeObjectURL(entry.url);
 }
 async function prepare(css, options = {}) {
  if (typeof css !== 'string') throw new TypeError('CSS must be a string');
  const signal = options.signal, limits = resourceLimits(options);
  const owned = new Map(); let state = 'pending', aborted = false, rejectAbort;
  const cancelled = new Promise((_, reject) => { rejectAbort = reject; });
  cancelled.catch(() => {});
  function cleanup() { for (const [source, entry] of owned) drop(source, entry); owned.clear(); signal?.removeEventListener('abort', abort); }
  function abort() { if (state !== 'pending') return; aborted = true; state = 'discarded'; cleanup(); rejectAbort(abortError()); }
  function check() { if (signal?.aborted && state === 'pending') abort(); if (aborted) throw abortError(); }
  signal?.addEventListener('abort', abort, {once:true});
  try {
   check();
   const found = tokens(css);
   for (const token of found) {
    check();
    let entry = owned.get(token.source);
    if (!entry) {
     entry = acquire(token, limits); owned.set(token.source, entry);
     await Promise.race([entry.promise, cancelled]);
     check();
    }
    token.url = entry.url;
   }
   check();
   let transformed = '', cursor = 0;
   for (const token of found) { transformed += css.slice(cursor, token.start) + token.url; cursor = token.end; }
   transformed += css.slice(cursor);
   return {
    css:transformed,
    accept() { check(); if (state === 'pending') { state = 'accepted'; signal?.removeEventListener('abort', abort); } },
    discard() { if (state === 'pending') { state = 'discarded'; cleanup(); } },
    release() { if (state === 'pending' || state === 'accepted') { state = 'released'; cleanup(); } }
   };
  } catch (error) { if (state === 'pending') { state = 'discarded'; cleanup(); } throw error; }
 }
 root.MimaCssResources = {prepare, inspectImage};
})(window);
