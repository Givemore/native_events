const express = require('express');

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const whatsappToken = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;
const identifyApiUrl =
  process.env.IDENTIFY_API_URL || 'https://moeng.io/mvumba/api/identify.php';
const webAppUrl = process.env.WEB_APP_URL || 'https://moeng.io/mvumba/';

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

async function sendText(to, text) {
  return sendWhatsApp({
    to,
    type: 'text',
    text: { preview_url: true, body: text },
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
      footer: {
        text: 'StreamID · moeng.io/mvumba',
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

async function identifyStream(streamUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

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

function formatSongMessage(stationTitle, data) {
  const song = data.song || {};

  if (!song.matched) {
    return (
      `🎧 *${stationTitle}*\n\n` +
      `No match this time — try again when a song is playing (not ads or talk).\n\n` +
      `Web: ${webAppUrl}`
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

  const links = [
    song.shazam_url && `Shazam: ${song.shazam_url}`,
    song.spotify_url && `Spotify: ${song.spotify_url}`,
    song.youtube_url && `YouTube: ${song.youtube_url}`,
    song.apple_music_url && `Apple Music: ${song.apple_music_url}`,
  ].filter(Boolean);

  if (links.length) {
    lines.push('', ...links);
  }

  lines.push('', `More: ${webAppUrl}`);
  return lines.join('\n');
}

async function handleIdentify(to, station) {
  await sendText(
    to,
    `Listening to *${station.title}*… this takes about 10 seconds.`
  );

  try {
    const data = await identifyStream(station.streamUrl);
    await sendText(to, formatSongMessage(station.title, data));
  } catch (err) {
    console.error('Identify error', err);
    await sendText(
      to,
      `Sorry — I couldn’t identify ${station.title} right now.\n${err.message || err}\n\nTry again or use the web app: ${webAppUrl}`
    );
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
    whatsappConfigured: Boolean(whatsappToken && phoneNumberId),
  });
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
  console.log(`Identify API: ${identifyApiUrl}`);
});
