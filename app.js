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
const rapidApiKey = process.env.RAPIDAPI_KEY || '';
const rapidApiHost =
  process.env.RAPIDAPI_HOST || 'shazam-core.p.rapidapi.com';
const recognizeUrl =
  process.env.RECOGNIZE_URL ||
  'https://shazam-core.p.rapidapi.com/v1/tracks/recognize';
const sampleSeconds = Math.min(
  15,
  Math.max(3, Number(process.env.SAMPLE_SECONDS) || 10)
);

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

async function sendStationButtons(to, name) {
  const greeting = name ? `Hi ${name}! ` : '';
  return sendWhatsApp({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text:
          `${greeting}Pick a Botswana station and I’ll identify what’s playing right now.`,
      },
      action: {
        buttons: Object.values(STATIONS).map((station) => ({
          type: 'reply',
          reply: {
            id: station.id,
            title: station.title,
          },
        })),
      },
    },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Shoutcast/ICY may prepend status lines before MPEG frames. */
function stripIcyPreamble(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return buffer;

  const head = buffer.subarray(0, Math.min(16, buffer.length)).toString('ascii');
  if (!head.startsWith('ICY ') && !head.startsWith('HTTP/')) {
    return buffer;
  }

  for (let i = 0; i < buffer.length - 1; i++) {
    // MPEG frame sync
    if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) {
      return buffer.subarray(i);
    }
    // ID3 tag
    if (
      buffer[i] === 0x49 &&
      buffer[i + 1] === 0x44 &&
      i + 2 < buffer.length &&
      buffer[i + 2] === 0x33
    ) {
      return buffer.subarray(i);
    }
  }
  return buffer;
}

/**
 * Capture ~N seconds of a live stream. Used by WhatsApp identify (local)
 * and by the PHP app on shared hosting via /api/capture.
 *
 * Many Shoutcast servers reply with "ICY 200 OK" (HTTP/0.9). Node fetch
 * rejects that, so we fall back to a raw TCP reader.
 */
async function captureStreamAudio(streamUrl, seconds = sampleSeconds) {
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
    const byteBudget = seconds * 20000;
    const chunks = [];
    let written = 0;
    let settled = false;

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

    const onData = (chunk) => {
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

    function onConnect() {
      const hostHeader = parsed.port
        ? `${parsed.hostname}:${parsed.port}`
        : parsed.hostname;
      socket.write(
        `GET ${path} HTTP/1.0\r\n` +
          `Host: ${hostHeader}\r\n` +
          `User-Agent: Mozilla/5.0 (compatible; StreamShazam/1.0)\r\n` +
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

function normalizeShazamResponse(data) {
  if (!data || typeof data !== 'object') {
    return { matched: false, title: null, artist: null, album: null, genres: [], shazam_url: null };
  }

  if (data.track == null && !data.title) {
    return { matched: false, title: null, artist: null, album: null, genres: [], shazam_url: null };
  }

  const track = data.track && typeof data.track === 'object' ? data.track : data;
  if (!track.title) {
    return { matched: false, title: null, artist: null, album: null, genres: [], shazam_url: null };
  }

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

  return {
    matched: true,
    title: track.title || null,
    artist: track.subtitle || null,
    album,
    genres,
    shazam_url: typeof track.url === 'string' ? track.url : null,
  };
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

/** Prefer local capture+Shazam on Render (reliable). PHP path is fallback only. */
async function identifyStream(streamUrl) {
  if (rapidApiKey) {
    return identifyLocally(streamUrl);
  }
  console.warn('RAPIDAPI_KEY missing — falling back to PHP identify API');
  return identifyViaPhp(streamUrl);
}

async function identifyLocally(streamUrl) {
  let lastError = null;

  // Up to 2 listen attempts — talk/ads often cause a no-match on the first try.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const audio = await captureWithRetries(streamUrl, sampleSeconds, 3);
      const song = await recognizeWithShazam(audio);

      if (song.matched || attempt === 2) {
        return {
          ok: true,
          matched: Boolean(song.matched),
          capture: {
            method: 'render-local',
            bytes: audio.length,
            seconds: sampleSeconds,
            attempt,
          },
          song,
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

/** Prefer https links WhatsApp can open; drop intent:// and other app schemes. */
function cleanHttpUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;

  // Android intent → https Apple Music URL
  if (value.startsWith('intent://')) {
    const path = value.slice('intent://'.length).split('#')[0];
    if (path) return `https://${path}`;
  }

  // Spotify search URI → web search
  if (value.startsWith('spotify:search:')) {
    const q = value.slice('spotify:search:'.length);
    try {
      return `https://open.spotify.com/search/${decodeURIComponent(q)}`;
    } catch (_) {
      return `https://open.spotify.com/search/${q}`;
    }
  }

  if (value.startsWith('https://') || value.startsWith('http://')) {
    return value;
  }

  return null;
}

function formatSongMessage(stationTitle, data) {
  const song = data.song || {};

  if (!song.matched) {
    return (
      `🎧 *${stationTitle}*\n\n` +
      `Couldn’t find a match — try again when a song is playing (not ads or talk).`
    );
  }

  const lines = [
    `🎧 *${stationTitle}*`,
    '',
    `*${song.title || 'Unknown title'}*`,
    song.artist || 'Unknown artist',
  ];

  if (song.album) lines.push(`Album: ${song.album}`);
  if (song.genres?.length) lines.push(`Genre: ${song.genres.join(', ')}`);

  // One clean Shazam link (WhatsApp shows a nice preview). Skip long/noisy extras.
  const shazam = cleanHttpUrl(song.shazam_url);
  if (shazam) {
    lines.push('', shazam);
  }

  return lines.join('\n');
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
    'curl',
    'ffmpeg',
    'abort',
    'network',
    'identify failed',
    'capture',
    'unauthorized',
    'ssl',
    'certificate',
  ];
  return technicalHints.some((hint) => msg.includes(hint));
}

function formatIdentifyError(stationTitle, err) {
  console.error('Identify error', err);

  if (isTechnicalError(err)) {
    return (
      `🎧 *${stationTitle}*\n\n` +
      `We hit a technical error while listening to the station. Please try again in a moment.`
    );
  }

  return (
    `🎧 *${stationTitle}*\n\n` +
    `Sorry — I couldn’t identify what’s playing right now. Please try again shortly.`
  );
}

async function handleIdentify(to, station) {
  await sendText(
    to,
    `Listening to *${station.title}*… usually about 10–20 seconds.`
  );

  try {
    const data = await identifyStream(station.streamUrl);
    // Shazam link gets a nice preview card; keep that on.
    await sendText(to, formatSongMessage(station.title, data), {
      previewUrl: Boolean(data?.song?.shazam_url && data?.song?.matched),
    });
  } catch (err) {
    await sendText(to, formatIdentifyError(station.title, err), {
      previewUrl: false,
    });
  }

  await sendStationButtons(to);
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
          name: contact?.profile?.name || '',
        });
      }
    }
  }
  return messages;
}

async function handleMessage(msg) {
  const station = STATION_BY_ID[msg.buttonId];
  if (station) {
    await handleIdentify(msg.from, station);
    return;
  }

  // Any text (hi, help, identify, station name) → show clickable stations
  if (msg.type === 'text' || msg.type === 'button' || msg.type === 'interactive') {
    const lower = msg.text.toLowerCase();
    const named = Object.values(STATIONS).find(
      (s) =>
        lower.includes(s.title.toLowerCase()) ||
        lower.includes(s.id.replace('station_', ''))
    );
    if (named) {
      await handleIdentify(msg.from, named);
      return;
    }
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
    captureEndpoint: '/api/capture',
    identifyMode: rapidApiKey ? 'render-local' : 'php-fallback',
    rapidapiConfigured: Boolean(rapidApiKey),
    whatsappConfigured: Boolean(whatsappToken && phoneNumberId),
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
    `Identify mode: ${rapidApiKey ? 'render-local (capture+Shazam)' : 'php-fallback'}`
  );
  console.log(`Identify API (fallback): ${identifyApiUrl}`);
});
