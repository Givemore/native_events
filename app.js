const crypto = require('crypto');
const express = require('express');
const net = require('net');
const tls = require('tls');

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const whatsappToken = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;
const identifyApiUrl =
  process.env.IDENTIFY_API_URL || 'https://moeng.io/mvumba/api/identify.php';
const webAppUrl = process.env.WEB_APP_URL || 'https://moeng.io/mvumba/';
const captureProxySecret = process.env.CAPTURE_PROXY_SECRET || '';
const usageIngestUrl =
  process.env.USAGE_INGEST_URL ||
  `${webAppUrl.replace(/\/?$/, '/')}api/usage.php`;
const usageIngestSecret = process.env.USAGE_INGEST_SECRET || '';
const rapidApiKey = process.env.RAPIDAPI_KEY || '';
const rapidApiHost =
  process.env.RAPIDAPI_HOST || 'shazam-core.p.rapidapi.com';
const recognizeUrl =
  process.env.RECOGNIZE_URL ||
  'https://shazam-core.p.rapidapi.com/v1/tracks/recognize';
const acrHost =
  process.env.ACRCLOUD_HOST || 'identify-eu-west-1.acrcloud.com';
const acrAccessKey = process.env.ACRCLOUD_ACCESS_KEY || '';
const acrAccessSecret = process.env.ACRCLOUD_ACCESS_SECRET || '';
const sampleSeconds = Math.min(
  15,
  Math.max(3, Number(process.env.SAMPLE_SECONDS) || 10)
);

const ACTION_HUM = 'action_hum';

// Botswana stations — button titles must be ≤ 20 chars (WhatsApp limit)
const STATIONS = {
  yarona: {
    id: 'station_yarona',
    title: 'Yarona FM',
    streamUrl: 'https://iceant.eclipse-streaming.co.za/yarona',
  },
  duma: {
    id: 'station_duma',
    title: 'Duma FM',
    streamUrl: 'http://s3.voscast.com:10076/stream',
  },
  gabz: {
    id: 'station_gabz',
    title: 'Gabz FM',
    streamUrl: 'http://fmt01.egihosting.com:17721/;',
  },
};

const STATION_BY_ID = Object.fromEntries(
  Object.values(STATIONS).map((s) => [s.id, s])
);

function graphUrl(path) {
  return `https://graph.facebook.com/v21.0/${path}`;
}

async function sendWhatsApp(payload) {
  if (!whatsappToken || !phoneNumberId) {
    console.error('Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID');
    return;
  }

  const response = await fetch(graphUrl(`${phoneNumberId}/messages`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${whatsappToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...payload,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('WhatsApp send failed', response.status, JSON.stringify(body));
  }
  return body;
}

async function sendText(to, text, { previewUrl = true } = {}) {
  return sendWhatsApp({
    to,
    type: 'text',
    text: { preview_url: previewUrl, body: text },
  });
}

/**
 * Upload a buffer to WhatsApp Cloud API media storage.
 * Returns the media id used by sendAudio / other media messages.
 */
async function uploadWhatsAppMedia(buffer, mimeType = 'audio/mpeg', filename = 'clip.mp3') {
  if (!whatsappToken || !phoneNumberId) {
    throw new Error('Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID');
  }
  const minBytes = mimeType.startsWith('image/') ? 100 : 500;
  if (!Buffer.isBuffer(buffer) || buffer.length < minBytes) {
    throw new Error(`Media too small (${buffer?.length || 0} bytes)`);
  }

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);

  const response = await fetch(graphUrl(`${phoneNumberId}/media`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${whatsappToken}` },
    body: form,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.id) {
    throw new Error(
      body.error?.message || `Media upload failed (HTTP ${response.status})`
    );
  }
  return body.id;
}

async function sendAudio(to, mediaId, { voice = false } = {}) {
  return sendWhatsApp({
    to,
    type: 'audio',
    audio: { id: mediaId, voice },
  });
}

async function sendImage(to, imageUrl, caption = '') {
  const captionText = caption ? String(caption).slice(0, 1024) : '';

  // Upload first so WhatsApp delivers the image before later messages (link
  // images often arrive out of order and push the menu above the cover).
  try {
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      throw new Error(`Cover fetch HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
    const mimeType =
      contentType.startsWith('image/') ? contentType : 'image/jpeg';
    const ext = mimeType.includes('png')
      ? 'png'
      : mimeType.includes('webp')
        ? 'webp'
        : 'jpg';
    const mediaId = await uploadWhatsAppMedia(buffer, mimeType, `cover.${ext}`);
    return sendWhatsApp({
      to,
      type: 'image',
      image: {
        id: mediaId,
        ...(captionText ? { caption: captionText } : {}),
      },
    });
  } catch (err) {
    console.warn('Cover upload failed, falling back to link:', err.message || err);
    return sendWhatsApp({
      to,
      type: 'image',
      image: {
        link: imageUrl,
        ...(captionText ? { caption: captionText } : {}),
      },
    });
  }
}

/** Upload a ~10s stream snap and send it as a playable WhatsApp audio message. */
async function sendStreamClip(to, audioBuffer, stationTitle) {
  const clip = stripIcyPreamble(audioBuffer);
  if (!Buffer.isBuffer(clip) || clip.length < 500) {
    throw new Error(`Stream clip too small after cleanup (${clip?.length || 0} bytes)`);
  }

  // Detect AAC ADTS (layer bits 00) vs MP3 so WhatsApp gets the right mime type
  let mimeType = 'audio/mpeg';
  let filename = 'stream-clip.mp3';
  for (let i = 0; i < Math.min(clip.length - 1, 64); i++) {
    if (clip[i] !== 0xff || (clip[i + 1] & 0xf0) !== 0xf0) continue;
    if ((clip[i + 1] & 0x06) === 0x00) {
      mimeType = 'audio/aac';
      filename = 'stream-clip.aac';
    }
    break;
  }

  await sendText(
    to,
    `*${stationTitle}* — here’s ~${sampleSeconds}s of what’s on air:`,
    { previewUrl: false }
  );

  const mediaId = await uploadWhatsAppMedia(clip, mimeType, filename);
  return sendAudio(to, mediaId, { voice: false });
}

async function sendStationButtons(to, name) {
  const greeting = name ? `Hi ${name}! ` : '';
  return sendWhatsApp({
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text:
          `${greeting}What’s this song?\n\n` +
          `• Pick a radio station to detect what’s playing\n` +
          `• Or hum / detect a song from a voice note`,
      },
      action: {
        button: 'What’s this song',
        sections: [
          {
            title: 'What’s playing',
            rows: Object.values(STATIONS).map((station) => ({
              id: station.id,
              title: station.title,
              description: 'What’s this song playing',
            })),
          },
          {
            title: 'Hum or detect',
            rows: [
              {
                id: ACTION_HUM,
                title: 'Hum or detect a song',
                description: 'Send a 10–15s voice note',
              },
            ],
          },
        ],
      },
    },
  });
}

async function logUsage(partial) {
  if (!usageIngestUrl) return;
  if (!usageIngestSecret) {
    console.warn(
      'Usage log skipped: set USAGE_INGEST_SECRET on Render to match PHP usage_ingest_secret'
    );
    return;
  }
  try {
    const res = await fetch(usageIngestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Usage-Secret': usageIngestSecret,
      },
      body: JSON.stringify({
        channel: 'whatsapp',
        ...partial,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(
        `Usage log failed: HTTP ${res.status}${body ? ` ${body.slice(0, 200)}` : ''}`
      );
    }
  } catch (err) {
    console.warn('Usage log failed:', err.message || err);
  }
}

async function sendHumInstructions(to) {
  return sendText(
    to,
    '*Hum or detect a song*\n\n' +
      'Send a voice note (about *10–15 seconds*):\n' +
      '• Hum or sing the melody, or\n' +
      '• Hold your phone near a song that’s playing\n\n' +
      'Tip: one clear tune works best — avoid heavy background noise.',
    { previewUrl: false }
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Shoutcast/ICY may prepend status lines before MPEG frames. */
function stripIcyPreamble(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return buffer;

  // Layer III (MP3) only — avoids AAC ADTS, Layer I/II junk, and 0xFF padding
  // that made Gabz clips invalid for WhatsApp / Shazam.
  const isMp3Sync = (buf, i) =>
    buf[i] === 0xff &&
    (buf[i + 1] & 0xf0) === 0xf0 &&
    (buf[i + 1] & 0x06) === 0x02;

  for (let i = 0; i < buffer.length - 1; i++) {
    if (isMp3Sync(buffer, i)) return buffer.subarray(i);
    if (
      buffer[i] === 0x49 &&
      buffer[i + 1] === 0x44 &&
      i + 2 < buffer.length &&
      buffer[i + 2] === 0x33
    ) {
      return buffer.subarray(i);
    }
  }

  // Fallback: any MPEG layer except reserved
  for (let i = 0; i < buffer.length - 1; i++) {
    if (
      buffer[i] === 0xff &&
      (buffer[i + 1] & 0xe0) === 0xe0 &&
      (buffer[i + 1] & 0x06) !== 0x00
    ) {
      return buffer.subarray(i);
    }
  }

  return buffer;
}

/** Classic Shoutcast mount that Node fetch can't parse (ICY 200 OK). */
function looksLikeShoutcastUrl(streamUrl) {
  return streamUrl.includes('/;') || /:\/\/*[^/]+:\d+\/;/.test(streamUrl);
}

/**
 * Capture ~N seconds of a live stream. Used by WhatsApp identify (local)
 * and by the PHP app on shared hosting via /api/capture.
 *
 * Many Shoutcast servers reply with "ICY 200 OK" (HTTP/0.9). Node fetch
 * rejects that, so we use a raw TCP reader for those mounts (e.g. Gabz FM).
 */
async function captureStreamAudio(streamUrl, seconds = sampleSeconds) {
  if (looksLikeShoutcastUrl(streamUrl)) {
    try {
      return await captureViaIcySocket(streamUrl, seconds);
    } catch (icyErr) {
      console.warn('ICY capture failed, trying fetch:', icyErr.message || icyErr);
      return captureViaFetch(streamUrl, seconds);
    }
  }

  try {
    return await captureViaFetch(streamUrl, seconds);
  } catch (fetchErr) {
    console.warn('fetch capture failed, trying ICY socket:', fetchErr.message || fetchErr);
    return captureViaIcySocket(streamUrl, seconds);
  }
}

async function captureViaFetch(streamUrl, seconds = sampleSeconds) {
  const byteBudget = seconds * 20000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), seconds * 1000 + 25000);

  try {
    const response = await fetch(streamUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Icy-MetaData': '0',
        Accept: '*/*',
        Connection: 'close',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.body) {
      throw new Error(`Stream returned no body (HTTP ${response.status})`);
    }

    const reader = response.body.getReader();
    const chunks = [];
    let written = 0;

    while (written < byteBudget) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      const remaining = byteBudget - written;
      if (value.length <= remaining) {
        chunks.push(Buffer.from(value));
        written += value.length;
      } else {
        chunks.push(Buffer.from(value.subarray(0, remaining)));
        written += remaining;
        break;
      }
    }

    try {
      await reader.cancel();
    } catch (_) {
      // ignore cancel errors
    }

    if (written < 2000) {
      throw new Error(`Captured only ${written} bytes from stream`);
    }

    return stripIcyPreamble(Buffer.concat(chunks, written));
  } finally {
    clearTimeout(timeout);
  }
}

function streamRequestPath(parsed, originalUrl) {
  let path = parsed.pathname || '/';
  if (parsed.search) path += parsed.search;
  // Shoutcast often needs a trailing ";" (e.g. http://host:port/;)
  if (originalUrl.includes('/;') && !path.includes(';')) {
    path = path.endsWith('/') ? `${path};` : `${path}/;`;
  }
  return path || '/';
}

function captureViaIcySocket(streamUrl, seconds = sampleSeconds) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(streamUrl);
    } catch (err) {
      reject(err);
      return;
    }

    const isTls = parsed.protocol === 'https:';
    const port = Number(parsed.port || (isTls ? 443 : 80));
    const path = streamRequestPath(parsed, streamUrl);
    // Gabz is ~96kbps — budget a bit above that so we get a full sample
    const byteBudget = Math.max(seconds * 16000, seconds * 20000);
    const chunks = [];
    let written = 0;
    let settled = false;
    let headerBuf = Buffer.alloc(0);
    let headerDone = false;

    const connectOpts = { host: parsed.hostname, port };
    let socket;
    const finish = (err, buffer) => {
      if (settled) return;
      settled = true;
      try {
        socket?.destroy();
      } catch (_) {}
      if (err) reject(err);
      else resolve(buffer);
    };

    const pushAudio = (chunk) => {
      if (!Buffer.isBuffer(chunk) || chunk.length === 0) return;
      const remaining = byteBudget - written;
      if (remaining <= 0) {
        finish(null, stripIcyPreamble(Buffer.concat(chunks, written)));
        return;
      }
      if (chunk.length <= remaining) {
        chunks.push(chunk);
        written += chunk.length;
      } else {
        chunks.push(chunk.subarray(0, remaining));
        written += remaining;
      }
      if (written >= byteBudget) {
        finish(null, stripIcyPreamble(Buffer.concat(chunks, written)));
      }
    };

    const onData = (chunk) => {
      if (!Buffer.isBuffer(chunk) || chunk.length === 0) return;

      // Split response headers from audio body (was previously mixed in — broke Gabz)
      if (!headerDone) {
        headerBuf = Buffer.concat([headerBuf, chunk]);
        const sep = headerBuf.indexOf('\r\n\r\n');
        if (sep < 0) {
          // Some ICY servers use bare LF
          const sepLf = headerBuf.indexOf('\n\n');
          if (sepLf < 0) return;
          headerDone = true;
          pushAudio(headerBuf.subarray(sepLf + 2));
          headerBuf = Buffer.alloc(0);
          return;
        }
        headerDone = true;
        pushAudio(headerBuf.subarray(sep + 4));
        headerBuf = Buffer.alloc(0);
        return;
      }

      pushAudio(chunk);
    };

    function onConnect() {
      const hostHeader = parsed.port
        ? `${parsed.hostname}:${parsed.port}`
        : parsed.hostname;
      socket.write(
        `GET ${path} HTTP/1.0\r\n` +
          `Host: ${hostHeader}\r\n` +
          `User-Agent: Mozilla/5.0 (compatible; StreamID/1.0)\r\n` +
          `Icy-MetaData: 0\r\n` +
          `Accept: */*\r\n` +
          `Connection: close\r\n` +
          `\r\n`
      );
    }

    socket = isTls
      ? tls.connect({ ...connectOpts, servername: parsed.hostname }, onConnect)
      : net.connect(connectOpts, onConnect);

    socket.setTimeout(seconds * 1000 + 25000);
    socket.on('data', onData);
    socket.on('timeout', () => {
      if (written >= 2000) {
        finish(null, stripIcyPreamble(Buffer.concat(chunks, written)));
      } else {
        finish(new Error('ICY stream connection timed out'));
      }
    });
    socket.on('error', (err) => finish(err));
    socket.on('end', () => {
      if (written >= 2000) {
        finish(null, stripIcyPreamble(Buffer.concat(chunks, written)));
      } else {
        finish(new Error(`ICY stream ended early (${written} bytes)`));
      }
    });
  });
}

async function captureWithRetries(streamUrl, seconds = sampleSeconds, attempts = 3) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await captureStreamAudio(streamUrl, seconds);
    } catch (err) {
      lastError = err;
      console.warn(`Capture attempt ${i}/${attempts} failed:`, err.message || err);
      if (i < attempts) await sleep(800 * i);
    }
  }
  throw lastError || new Error('Failed to capture stream');
}

function emptySongResult() {
  return {
    matched: false,
    title: null,
    artist: null,
    album: null,
    genres: [],
    cover_art: null,
    shazam_url: null,
    apple_music_url: null,
    spotify_url: null,
    youtube_url: null,
    score: null,
  };
}

function hubProviderUrl(hub, providerType) {
  const providers = Array.isArray(hub?.providers) ? hub.providers : [];
  for (const provider of providers) {
    if (String(provider?.type || '').toLowerCase() !== providerType) continue;
    const actions = Array.isArray(provider.actions) ? provider.actions : [];
    for (const action of actions) {
      if (typeof action?.uri === 'string' && action.uri) return action.uri;
    }
  }
  return null;
}

function normalizeShazamResponse(data) {
  if (!data || typeof data !== 'object') return emptySongResult();
  if (data.track == null && !data.title) return emptySongResult();

  const track = data.track && typeof data.track === 'object' ? data.track : data;
  if (!track.title) return emptySongResult();

  const images = track.images && typeof track.images === 'object' ? track.images : {};
  const cover =
    (typeof images.coverarthq === 'string' && images.coverarthq) ||
    (typeof images.coverart === 'string' && images.coverart) ||
    (typeof images.background === 'string' && images.background) ||
    null;

  const genres = [];
  if (typeof track.genres?.primary === 'string') genres.push(track.genres.primary);

  let album = null;
  const sections = Array.isArray(track.sections) ? track.sections : [];
  for (const section of sections) {
    if (section?.type !== 'SONG' || !Array.isArray(section.metadata)) continue;
    for (const meta of section.metadata) {
      if (String(meta?.title || '').toLowerCase() === 'album' && typeof meta.text === 'string') {
        album = meta.text;
      }
    }
  }

  const hub = track.hub && typeof track.hub === 'object' ? track.hub : {};
  let appleUrl =
    hub.options?.[0]?.actions?.[0]?.uri ||
    hub.actions?.[0]?.uri ||
    null;
  if (typeof appleUrl !== 'string') appleUrl = null;

  let youtubeUrl = hubProviderUrl(hub, 'youtube');
  for (const section of sections) {
    const actions = section?.youtubeurl?.actions;
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      if (typeof action?.uri === 'string' && action.uri) {
        youtubeUrl = action.uri;
        break;
      }
    }
    if (youtubeUrl) break;
  }
  if (!youtubeUrl && typeof track.url === 'string' && /youtu\.?be|youtube\.com/i.test(track.url)) {
    youtubeUrl = track.url;
  }
  // Last resort: scan hub/actions for any YouTube URI
  if (!youtubeUrl) {
    youtubeUrl = findYoutubeUri(track);
  }

  return {
    matched: true,
    title: track.title || null,
    artist: track.subtitle || null,
    album,
    genres,
    cover_art: cover,
    shazam_url: typeof track.url === 'string' ? track.url : null,
    apple_music_url: appleUrl,
    spotify_url: hubProviderUrl(hub, 'spotify'),
    youtube_url: youtubeUrl,
    score: null,
  };
}

/** Walk a Shazam track payload for any YouTube-looking URI. */
function findYoutubeUri(node, depth = 0) {
  if (depth > 6 || node == null) return null;
  if (typeof node === 'string') {
    return /youtu\.?be|youtube\.com/i.test(node) ? node : null;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findYoutubeUri(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === 'object') {
    for (const value of Object.values(node)) {
      const found = findYoutubeUri(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function recognizeWithShazam(audioBuffer) {
  if (!rapidApiKey) {
    throw new Error('RAPIDAPI_KEY is not configured on Render');
  }

  const form = new FormData();
  form.append(
    'file',
    new Blob([audioBuffer], { type: 'audio/mpeg' }),
    'sample.mp3'
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch(recognizeUrl, {
      method: 'POST',
      headers: {
        'x-rapidapi-key': rapidApiKey,
        'x-rapidapi-host': rapidApiHost,
      },
      body: form,
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body.message || body.error || `Shazam HTTP ${response.status}`;
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }

    return normalizeShazamResponse(body);
  } finally {
    clearTimeout(timeout);
  }
}

function acrCloudConfigured() {
  return Boolean(acrAccessKey && acrAccessSecret);
}

function normalizeAcrCloudResponse(data) {
  const empty = emptySongResult();

  if (!data || typeof data !== 'object') return empty;

  const code = data.status?.code;
  // 0 = success with results; 1001 = no result
  if (code === 1001) return empty;
  if (code != null && code !== 0) {
    throw new Error(data.status?.msg || `ACRCloud status ${code}`);
  }

  const meta = data.metadata || {};
  // Prefer music DB matches (radio) over humming candidates
  const candidates = []
    .concat(Array.isArray(meta.music) ? meta.music : [])
    .concat(Array.isArray(meta.humming) ? meta.humming : []);

  if (!candidates.length) return empty;

  const track = candidates[0];
  const artists = Array.isArray(track.artists)
    ? track.artists.map((a) => a?.name).filter(Boolean)
    : [];
  const genres = Array.isArray(track.genres)
    ? track.genres.map((g) => g?.name).filter(Boolean)
    : [];

  const spotifyMeta = track.external_metadata?.spotify;
  const spotifyId =
    spotifyMeta?.track?.id ||
    (Array.isArray(spotifyMeta) ? spotifyMeta[0]?.track?.id : null);
  const youtubeId =
    track.external_metadata?.youtube?.vid ||
    (Array.isArray(track.external_metadata?.youtube)
      ? track.external_metadata.youtube[0]?.vid
      : null);
  const spotifyUrl = spotifyId
    ? `https://open.spotify.com/track/${spotifyId}`
    : null;
  const youtubeUrl = youtubeId
    ? `https://youtu.be/${youtubeId}`
    : null;

  const appleMeta = Array.isArray(track.external_metadata?.applemusic)
    ? track.external_metadata.applemusic[0]
    : track.external_metadata?.applemusic;
  const appleUrl =
    (typeof appleMeta?.link === 'string' && appleMeta.link) || null;

  const cover =
    (typeof track.album?.cover === 'string' && track.album.cover) ||
    (typeof track.album?.covers?.large === 'string' && track.album.covers.large) ||
    (typeof track.album?.covers?.medium === 'string' && track.album.covers.medium) ||
    (typeof track.album?.cover_art === 'string' && track.album.cover_art) ||
    (typeof appleMeta?.album?.cover === 'string' && appleMeta.album.cover) ||
    null;

  return {
    matched: true,
    title: track.title || null,
    artist: artists.join(', ') || null,
    album: track.album?.name || null,
    genres,
    cover_art: cover,
    shazam_url: null,
    apple_music_url: appleUrl,
    spotify_url: spotifyUrl,
    youtube_url: youtubeUrl,
    score: typeof track.score === 'number' ? track.score : null,
  };
}

/** Humming matches often omit artwork — fill from Spotify/iTunes when needed. */
async function enrichSongCover(song) {
  if (!song?.matched || cleanHttpUrl(song.cover_art)) return song;

  // Spotify oEmbed thumbnail
  if (song.spotify_url) {
    try {
      const res = await fetch(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(song.spotify_url)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const data = await res.json();
        if (typeof data.thumbnail_url === 'string' && data.thumbnail_url) {
          song.cover_art = data.thumbnail_url;
          return song;
        }
      }
    } catch (err) {
      console.warn('Spotify cover lookup failed:', err.message || err);
    }
  }

  // Free iTunes Search artwork
  const q = [song.artist, song.title].filter(Boolean).join(' ').trim();
  if (q) {
    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=1`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const data = await res.json();
        const art = data.results?.[0]?.artworkUrl100;
        if (typeof art === 'string' && art) {
          song.cover_art = art.replace('100x100bb', '600x600bb');
          return song;
        }
      }
    } catch (err) {
      console.warn('iTunes cover lookup failed:', err.message || err);
    }
  }

  return song;
}

async function recognizeWithAcrCloud(audioBuffer, filename = 'sample.ogg') {
  if (!acrCloudConfigured()) {
    throw new Error(
      'ACRCloud is not configured. Set ACRCLOUD_ACCESS_KEY and ACRCLOUD_ACCESS_SECRET.'
    );
  }

  const endpoint = '/v1/identify';
  const dataType = 'audio';
  const signatureVersion = '1';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const stringToSign = [
    'POST',
    endpoint,
    acrAccessKey,
    dataType,
    signatureVersion,
    timestamp,
  ].join('\n');
  const signature = crypto
    .createHmac('sha1', acrAccessSecret)
    .update(Buffer.from(stringToSign, 'utf-8'))
    .digest('base64');

  const form = new FormData();
  form.append(
    'sample',
    new Blob([audioBuffer], { type: 'application/octet-stream' }),
    filename
  );
  form.append('sample_bytes', String(audioBuffer.length));
  form.append('access_key', acrAccessKey);
  form.append('data_type', dataType);
  form.append('signature_version', signatureVersion);
  form.append('signature', signature);
  form.append('timestamp', timestamp);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch(`https://${acrHost}${endpoint}`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        body.status?.msg || body.message || `ACRCloud HTTP ${response.status}`;
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }

    return enrichSongCover(normalizeAcrCloudResponse(body));
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadWhatsAppMedia(mediaId) {
  if (!whatsappToken) {
    throw new Error('WHATSAPP_TOKEN is not configured');
  }

  const metaResponse = await fetch(graphUrl(mediaId), {
    headers: { Authorization: `Bearer ${whatsappToken}` },
  });
  const meta = await metaResponse.json().catch(() => ({}));
  if (!metaResponse.ok || !meta.url) {
    throw new Error(meta.error?.message || `Failed to resolve media ${mediaId}`);
  }

  const fileResponse = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${whatsappToken}` },
  });
  if (!fileResponse.ok) {
    throw new Error(`Failed to download media (HTTP ${fileResponse.status})`);
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length < 500) {
    throw new Error(`Downloaded media too small (${buffer.length} bytes)`);
  }

  const mimeType = String(meta.mime_type || fileResponse.headers.get('content-type') || '');
  let filename = 'sample.ogg';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) filename = 'sample.mp3';
  else if (mimeType.includes('mp4') || mimeType.includes('m4a') || mimeType.includes('aac')) {
    filename = 'sample.m4a';
  } else if (mimeType.includes('wav')) filename = 'sample.wav';

  return { buffer, filename, mimeType };
}

/** Prefer local capture+ACRCloud (Shazam quota exhausted). PHP is last-resort fallback. */
async function identifyStream(streamUrl) {
  if (acrCloudConfigured()) {
    return identifyLocally(streamUrl);
  }
  if (rapidApiKey) {
    console.warn('ACRCloud missing — falling back to Shazam (may be quota-limited)');
    return identifyLocallyWithShazam(streamUrl);
  }
  console.warn('No local recognizer configured — falling back to PHP identify API');
  return identifyViaPhp(streamUrl);
}

async function identifyLocally(streamUrl) {
  let lastError = null;

  // Up to 2 listen attempts — talk/ads often cause a no-match on the first try.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const audio = await captureWithRetries(streamUrl, sampleSeconds, 3);
      const song = await recognizeWithAcrCloud(audio, 'sample.mp3');

      if (song.matched || attempt === 2) {
        return {
          ok: true,
          matched: Boolean(song.matched),
          capture: {
            method: 'render-local-acrcloud',
            bytes: audio.length,
            seconds: sampleSeconds,
            attempt,
          },
          song,
          audio,
        };
      }

      console.log('No match on attempt 1 — sampling again');
      await sleep(1500);
    } catch (err) {
      lastError = err;
      console.error(`Identify attempt ${attempt} failed:`, err.message || err);
      if (attempt < 2) await sleep(1200);
    }
  }

  throw lastError || new Error('Identify failed');
}

/** Legacy Shazam path — only used when ACRCloud is not configured. */
async function identifyLocallyWithShazam(streamUrl) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const audio = await captureWithRetries(streamUrl, sampleSeconds, 3);
      const song = await recognizeWithShazam(audio);

      if (song.matched || attempt === 2) {
        return {
          ok: true,
          matched: Boolean(song.matched),
          capture: {
            method: 'render-local-shazam',
            bytes: audio.length,
            seconds: sampleSeconds,
            attempt,
          },
          song,
          audio,
        };
      }

      console.log('No match on attempt 1 — sampling again');
      await sleep(1500);
    } catch (err) {
      lastError = err;
      console.error(`Shazam identify attempt ${attempt} failed:`, err.message || err);
      if (attempt < 2) await sleep(1200);
    }
  }

  throw lastError || new Error('Identify failed');
}

async function identifyViaPhp(streamUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(identifyApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream_url: streamUrl }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `Identify failed (${response.status})`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/** Prefer https image/cover URLs WhatsApp can fetch. */
function cleanHttpUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;

  if (value.startsWith('intent://')) {
    const path = value.slice('intent://'.length).split('#')[0];
    if (path) return `https://${path}`;
  }

  if (value.startsWith('https://') || value.startsWith('http://')) {
    return value;
  }

  return null;
}

/** Labeled card — no links; nudge users to search on their preferred app. */
function formatSongCard(stationTitle, song) {
  const lines = [
    `*${stationTitle}*`,
    '',
    `*Title:* ${song.title || 'Unknown title'}`,
    `*Artist:* ${song.artist || 'Unknown artist'}`,
  ];
  if (song.album) lines.push(`*Album:* ${song.album}`);
  if (song.genres?.length) lines.push(`*Genre:* ${song.genres.join(', ')}`);

  lines.push(
    '',
    `*You can now search this song on your preferred platform* — Spotify, Apple Music, YouTube, and more.`
  );

  return lines.join('\n');
}

function formatSongMessage(stationTitle, data) {
  const song = data.song || {};

  if (!song.matched) {
    return (
      `*${stationTitle}*\n\n` +
      `Couldn’t find a match — try again when a song is playing (not ads or talk).`
    );
  }

  return formatSongCard(stationTitle, song);
}

async function sendSongResult(to, stationTitle, data) {
  const song = await enrichSongCover(data.song || {});
  data.song = song;

  if (!song.matched) {
    await sendText(to, formatSongMessage(stationTitle, data), {
      previewUrl: false,
    });
    return;
  }

  const card = formatSongCard(stationTitle, song);
  const cover = cleanHttpUrl(song.cover_art);

  // Cover + details first. Caller sends the menu after a settle delay.
  if (cover) {
    const body = await sendImage(to, cover, card);
    if (body?.error) {
      console.warn('Cover image send failed', body.error);
      await sendText(to, card, { previewUrl: false });
    }
  } else {
    await sendText(to, card, { previewUrl: false });
  }
}



function formatHummingNoMatch() {
  return (
    `*Hum or detect*\n\n` +
    `Couldn’t match that tune. Try a clearer 10–15s voice note — hum the melody, or hold your phone near the song.`
  );
}

function isTechnicalError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  const technicalHints = [
    'timeout',
    'timed out',
    'fetch failed',
    'econn',
    'enotfound',
    'socket',
    'proxy',
    'http ',
    '502',
    '503',
    '500',
    '401',
    '429',
    'quota',
    'curl',
    'ffmpeg',
    'abort',
    'network',
    'identify failed',
    'capture',
    'unauthorized',
    'ssl',
    'certificate',
    'acrcloud',
    'media',
  ];
  return technicalHints.some((hint) => msg.includes(hint));
}

function formatIdentifyError(stationTitle, err) {
  console.error('Identify error', err);

  const msg = String(err?.message || err || '');
  if (/429|quota|exceeded the monthly/i.test(msg)) {
    return (
      `*${stationTitle}*\n\n` +
      `Song recognition is temporarily unavailable — the monthly API limit was reached. Please try again later.`
    );
  }

  if (isTechnicalError(err)) {
    return (
      `*${stationTitle}*\n\n` +
      `We hit a technical error while listening to the station. Please try again in a moment.`
    );
  }

  return (
    `*${stationTitle}*\n\n` +
    `Sorry — I couldn’t identify what’s playing right now. Please try again shortly.`
  );
}

function formatHummingError(err) {
  console.error('Humming identify error', err);

  if (!acrCloudConfigured()) {
    return (
      `*Hum or detect*\n\n` +
      `This option isn’t set up yet on the server. Please try again later.`
    );
  }

  const msg = String(err?.message || err || '').toLowerCase();
  if (
    msg.includes('access') ||
    msg.includes('signature') ||
    msg.includes('unauthorized') ||
    msg.includes('invalid key') ||
    msg.includes('permission') ||
    msg.includes('status 20') ||
    msg.includes('status 30')
  ) {
    return (
      `*Hum or detect*\n\n` +
      `ACRCloud rejected the credentials. Use the *project* Access Key + Access Secret from your AVR humming project (not Old Access Keys / Personal Access Token), then redeploy.`
    );
  }

  if (isTechnicalError(err)) {
    return (
      `*Hum or detect*\n\n` +
      `We hit a technical error while checking your voice note. Please try again in a moment.`
    );
  }

  return (
    `*Hum or detect*\n\n` +
    `Sorry — I couldn’t identify that tune. Please try again shortly.`
  );
}

async function handleIdentify(to, station) {
  await sendText(
    to,
    `Checking what’s playing on *${station.title}*…`
  );

  try {
    const data = await identifyStream(station.streamUrl);
    const song = data.song || {};

    // Prefer the identify capture; otherwise grab a fresh ~10s sample for playback
    let clip = Buffer.isBuffer(data.audio) ? data.audio : null;
    if (!clip) {
      try {
        clip = await captureWithRetries(station.streamUrl, sampleSeconds, 2);
      } catch (clipErr) {
        console.warn('Stream clip capture failed:', clipErr.message || clipErr);
      }
    }

    // Song sample right after the "Checking…" message
    if (Buffer.isBuffer(clip) && clip.length >= 500) {
      try {
        await sendStreamClip(to, clip, station.title);
        await logUsage({
          event: 'clip',
          user_id: to,
          phone: to,
          station: station.title,
          meta: { seconds: sampleSeconds, bytes: clip.length },
        });
      } catch (clipErr) {
        console.warn('Stream clip send failed:', clipErr.message || clipErr);
      }
    }

    await logUsage({
      event: 'identify',
      user_id: to,
      phone: to,
      station: station.title,
      matched: Boolean(song.matched),
      title: song.title || '',
      artist: song.artist || '',
      genres: song.genres || [],
    });
    await sendSongResult(to, station.title, data);

    await sendStationButtons(to);
  } catch (err) {
    await logUsage({
      event: 'error',
      user_id: to,
      phone: to,
      station: station.title,
      error: String(err?.message || err || 'identify failed'),
    });
    await sendText(to, formatIdentifyError(station.title, err), {
      previewUrl: false,
    });
    await sendStationButtons(to);
  }
}

async function handleHummingAudio(to, mediaId) {
  if (!acrCloudConfigured()) {
    await sendText(to, formatHummingError(new Error('ACRCloud not configured')), {
      previewUrl: false,
    });
    await sendStationButtons(to);
    return;
  }

  await sendText(to, 'Checking your voice note… usually a few seconds.');

  try {
    const media = await downloadWhatsAppMedia(mediaId);
    const song = await recognizeWithAcrCloud(media.buffer, media.filename);
    const data = {
      ok: true,
      matched: Boolean(song.matched),
      song,
    };

    await logUsage({
      event: 'hum',
      user_id: to,
      phone: to,
      station: 'Hum or detect',
      matched: Boolean(song.matched),
      title: song.title || '',
      artist: song.artist || '',
      genres: song.genres || [],
    });

    if (!song.matched) {
      await sendText(to, formatHummingNoMatch(), { previewUrl: false });
      await sendStationButtons(to);
    } else {
      await sendSongResult(to, 'Hum or detect', data);
      await sendStationButtons(to);
    }
  } catch (err) {
    await logUsage({
      event: 'error',
      user_id: to,
      phone: to,
      station: 'Hum or detect',
      error: String(err?.message || err || 'hum failed'),
    });
    await sendText(to, formatHummingError(err), { previewUrl: false });
    await sendStationButtons(to);
  }
}

function extractIncomingMessages(body) {
  const messages = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};
      for (const message of value.messages || []) {
        const contact = (value.contacts || [])[0];
        messages.push({
          from: message.from,
          type: message.type,
          text: message.text?.body?.trim() || '',
          buttonId:
            message.interactive?.button_reply?.id ||
            message.interactive?.list_reply?.id ||
            '',
          mediaId: message.audio?.id || message.voice?.id || '',
          name: contact?.profile?.name || '',
        });
      }
    }
  }
  return messages;
}

async function handleMessage(msg) {
  if (msg.buttonId === ACTION_HUM) {
    await logUsage({
      event: 'menu',
      user_id: msg.from,
      phone: msg.from,
      name: msg.name || '',
      meta: { action: 'hum' },
    });
    await sendHumInstructions(msg.from);
    return;
  }

  const station = STATION_BY_ID[msg.buttonId];
  if (station) {
    await handleIdentify(msg.from, station);
    return;
  }

  // Voice notes / audio clips → ACRCloud humming recognition
  if ((msg.type === 'audio' || msg.type === 'voice') && msg.mediaId) {
    await handleHummingAudio(msg.from, msg.mediaId);
    return;
  }

  // Any text (hi, help, identify, station name) → show clickable stations
  if (msg.type === 'text' || msg.type === 'button' || msg.type === 'interactive') {
    const lower = msg.text.toLowerCase();
    if (
      lower.includes('hum') ||
      lower.includes('sing') ||
      lower.includes('voice note') ||
      lower.includes('record')
    ) {
      await sendHumInstructions(msg.from);
      return;
    }

    const named = Object.values(STATIONS).find(
      (s) =>
        lower.includes(s.title.toLowerCase()) ||
        lower.includes(s.id.replace('station_', ''))
    );
    if (named) {
      await handleIdentify(msg.from, named);
      return;
    }

    await logUsage({
      event: 'menu',
      user_id: msg.from,
      phone: msg.from,
      name: msg.name || '',
    });
    await sendStationButtons(msg.from, msg.name);
  }
}

// Meta webhook verification
app.get('/', (req, res) => {
  const {
    'hub.mode': mode,
    'hub.challenge': challenge,
    'hub.verify_token': token,
  } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    identifyApiUrl,
    webAppUrl,
    usageIngestUrl,
    captureEndpoint: '/api/capture',
    identifyMode: acrCloudConfigured()
      ? 'render-local-acrcloud'
      : rapidApiKey
        ? 'render-local-shazam'
        : 'php-fallback',
    rapidapiConfigured: Boolean(rapidApiKey),
    acrcloudConfigured: acrCloudConfigured(),
    acrcloudHost: acrHost,
    whatsappConfigured: Boolean(whatsappToken && phoneNumberId),
    usageLoggingConfigured: Boolean(usageIngestUrl && usageIngestSecret),
    usageIngestSecretConfigured: Boolean(usageIngestSecret),
  });
});

// Capture proxy for cPanel/PHP (non-standard stream ports)
app.get('/api/capture', (_req, res) => {
  res.json({
    ok: true,
    method: 'POST',
    usage: 'POST JSON { "stream_url": "http://...", "seconds": 10 }',
    headers: captureProxySecret
      ? { 'X-Capture-Secret': '(required — must match CAPTURE_PROXY_SECRET)' }
      : {},
    note: 'Used by moeng.io PHP when stream ports are blocked on shared hosting.',
  });
});

app.post('/api/capture', async (req, res) => {
  if (captureProxySecret) {
    const provided = req.get('x-capture-secret') || '';
    if (provided !== captureProxySecret) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  }

  const streamUrl = String(req.body?.stream_url || '').trim();
  if (!streamUrl) {
    return res.status(422).json({ ok: false, error: 'stream_url is required' });
  }

  let parsed;
  try {
    parsed = new URL(streamUrl);
  } catch (_) {
    return res.status(422).json({ ok: false, error: 'Invalid stream_url' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(422).json({ ok: false, error: 'Only http/https streams are supported' });
  }

  const seconds = Math.min(
    15,
    Math.max(3, Number(req.body?.seconds) || sampleSeconds)
  );

  try {
    const audio = await captureWithRetries(streamUrl, seconds, 3);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audio.length),
      'X-Capture-Bytes': String(audio.length),
      'X-Capture-Seconds': String(seconds),
    });
    return res.status(200).send(audio);
  } catch (err) {
    console.error('Capture proxy failed', err);
    return res.status(502).json({
      ok: false,
      error: err.message || 'Failed to capture stream',
    });
  }
});

// Incoming WhatsApp events — ACK immediately, process async
app.post('/', (req, res) => {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\nWebhook received ${timestamp}`);
  console.log(JSON.stringify(req.body, null, 2));

  res.status(200).end();

  const messages = extractIncomingMessages(req.body || {});
  for (const msg of messages) {
    handleMessage(msg).catch((err) => {
      console.error('Message handler failed', err);
    });
  }
});

app.listen(port, () => {
  console.log(`StreamID WhatsApp bot listening on port ${port}`);
  console.log(
    `Identify mode: ${
      acrCloudConfigured()
        ? 'render-local (capture+ACRCloud)'
        : rapidApiKey
          ? 'render-local (capture+Shazam)'
          : 'php-fallback'
    }`
  );
  console.log(
    `Humming (ACRCloud): ${acrCloudConfigured() ? `enabled @ ${acrHost}` : 'not configured'}`
  );
  console.log(`Identify API (fallback): ${identifyApiUrl}`);
});
