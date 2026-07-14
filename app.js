/**
 * Native Events — WhatsApp Client Enquiry Chatbot
 * Hosted on Render · Webhook for Meta WhatsApp Cloud API
 *
 * Env (Render):
 *   VERIFY_TOKEN       — Meta webhook verify token
 *   WHATSAPP_TOKEN     — Cloud API access token (or ACCESS_TOKEN)
 *   PHONE_NUMBER_ID    — WhatsApp phone number ID
 *   PORT               — set by Render
 *   NOTIFY_EMAIL       — optional sales alert email
 *   SMTP_HOST/PORT/USER/PASS/FROM — optional SMTP for alerts
 *   APP_URL            — public Render URL (for email links)
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();
app.use(express.json({ limit: '5mb' }));

const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const whatsappToken = process.env.WHATSAPP_TOKEN || process.env.ACCESS_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;
const apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';

const dataDir = path.join(__dirname, 'data');
const sessionsFile = path.join(dataDir, 'sessions.json');
const enquiriesFile = path.join(dataDir, 'enquiries.json');

function ensureData() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(sessionsFile)) fs.writeFileSync(sessionsFile, '{}');
  if (!fs.existsSync(enquiriesFile)) fs.writeFileSync(enquiriesFile, '[]');
}
ensureData();

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─── Enquiry flow (matches Native Events brief) ─────────────────────────────

const EVENT_TYPES = [
  'Conference', 'Corporate Event', 'Product Launch', 'Awards', 'Festival',
  'Wedding', 'Private Event', 'Exhibition', 'Sports Event', 'Other'
];

const SERVICES = [
  'Event Planning', 'Event Management', 'Project Management', 'Stage Design',
  'Stage Construction', 'Audio', 'Lighting', 'LED Screens', 'Livestream',
  'Photography', 'Videography', 'Branding', 'Printing', 'Registration System',
  'Accreditation', 'RSVP Management', 'Guest Management', 'Event Website',
  'Mobile App', 'Entertainment', 'MC', 'Artists', 'DJs', 'Security', 'Decor',
  'Furniture', 'Catering', 'Transport', 'Accommodation', 'Staffing',
  'Exhibition Stands', 'Custom Builds', 'Other'
];

const BUDGET_RANGES = [
  'Under P50,000', 'P50k-P100k', 'P100k-P250k',
  'P250k-P500k', 'Above P500,000', 'Prefer not to say'
];

/** Ordered conversation steps */
const STEPS = [
  {
    id: 'welcome',
    message:
      "Welcome to Native Events. We'd love to help bring your event to life. I'll ask a few quick questions so our team can prepare a tailored quotation for you.\n\nTap *Get started* when you're ready.",
    field: null,
    type: 'buttons',
    options: [{ id: 'get_started', title: 'Get started' }]
  },
  {
    id: 'full_name',
    message: "1. What's your full name?",
    field: 'full_name',
    type: 'text',
    required: true
  },
  {
    id: 'company',
    message: "2. What's your company or organisation?",
    field: 'company',
    type: 'text',
    required: true
  },
  {
    id: 'email',
    message: "3. What's your email address?",
    field: 'email',
    type: 'text',
    required: true,
    validate: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Please send a valid email address.')
  },
  {
    id: 'phone',
    message: "What's your phone number?\n\nReply *same* to use this WhatsApp number.",
    field: 'phone',
    type: 'text',
    required: true
  },
  {
    id: 'preferred_contact',
    message: 'How would you prefer us to contact you?',
    field: 'preferred_contact',
    type: 'buttons',
    options: [
      { id: 'Email', title: 'Email' },
      { id: 'Phone', title: 'Phone' },
      { id: 'WhatsApp', title: 'WhatsApp' }
    ]
  },
  {
    id: 'event_type',
    message: 'What type of event are you planning?',
    field: 'event_type',
    type: 'list',
    options: EVENT_TYPES.map((t) => ({ id: t, title: t.slice(0, 24) }))
  },
  {
    id: 'event_name',
    message: "What's the name of your event?",
    field: 'event_name',
    type: 'text',
    required: true
  },
  {
    id: 'event_date',
    message: "What's the event date? (e.g. 15 Sept 2026)",
    field: 'event_date',
    type: 'text',
    required: true
  },
  {
    id: 'alternative_date',
    message: 'Do you have an alternative date? Reply *skip* if none.',
    field: 'alternative_date',
    type: 'text',
    required: false
  },
  {
    id: 'event_start_time',
    message: 'What time does the event start? (e.g. 09:00)',
    field: 'event_start_time',
    type: 'text',
    required: true
  },
  {
    id: 'event_end_time',
    message: 'What time does the event end? (e.g. 17:00)',
    field: 'event_end_time',
    type: 'text',
    required: true
  },
  {
    id: 'venue',
    message: 'Where is the event taking place (venue)?',
    field: 'venue',
    type: 'text',
    required: true
  },
  {
    id: 'venue_confirmed',
    message: 'Is the venue confirmed?',
    field: 'venue_confirmed',
    type: 'buttons',
    options: [
      { id: 'Yes', title: 'Yes' },
      { id: 'No', title: 'No' }
    ]
  },
  {
    id: 'expected_guests',
    message: 'How many guests are you expecting?',
    field: 'expected_guests',
    type: 'text',
    required: true
  },
  {
    id: 'vip_guests',
    message: 'Will there be VIP guests?',
    field: 'vip_guests',
    type: 'buttons',
    options: [
      { id: 'Yes', title: 'Yes' },
      { id: 'No', title: 'No' },
      { id: 'Not sure', title: 'Not sure' }
    ]
  },
  {
    id: 'indoor_outdoor',
    message: 'Will the event be indoor or outdoor?',
    field: 'indoor_outdoor',
    type: 'buttons',
    options: [
      { id: 'Indoor', title: 'Indoor' },
      { id: 'Outdoor', title: 'Outdoor' },
      { id: 'Both', title: 'Both' }
    ]
  },
  {
    id: 'theme',
    message: 'Do you have a theme or concept? Reply *skip* if none.',
    field: 'theme',
    type: 'text',
    required: false
  },
  {
    id: 'event_objectives',
    message: 'What are the main objectives of this event?',
    field: 'event_objectives',
    type: 'text',
    required: true
  },
  {
    id: 'target_audience',
    message: 'Who is the target audience?',
    field: 'target_audience',
    type: 'text',
    required: true
  },
  {
    id: 'services_required',
    message: 'Which services do you need?',
    field: 'services_required',
    type: 'services'
  },
  {
    id: 'has_budget',
    message: 'Do you have an estimated budget?',
    field: 'has_budget',
    type: 'buttons',
    options: [
      { id: 'Yes', title: 'Yes' },
      { id: 'No', title: 'No' },
      { id: 'Not sure', title: 'Not sure' }
    ]
  },
  {
    id: 'budget_range',
    message: 'What is your estimated budget range?',
    field: 'budget_range',
    type: 'list',
    options: BUDGET_RANGES.map((t) => ({ id: t, title: t.slice(0, 24) })),
    skipIf: (data) => data.has_budget !== 'Yes'
  },
  {
    id: 'quotation_needed_by',
    message: 'When do you need the quotation?',
    field: 'quotation_needed_by',
    type: 'text',
    required: true
  },
  {
    id: 'is_urgent',
    message: 'Is this enquiry urgent?',
    field: 'is_urgent',
    type: 'buttons',
    options: [
      { id: 'Yes', title: 'Yes' },
      { id: 'No', title: 'No' }
    ]
  },
  {
    id: 'decision_deadline',
    message: 'When is your decision deadline? Reply *skip* if none.',
    field: 'decision_deadline',
    type: 'text',
    required: false
  },
  {
    id: 'supporting_documents',
    message:
      'You can send supporting documents now (event brief, floor plans, mood boards, brand guidelines, etc.).\n\nSend files here, or reply *skip* / *done* to continue.',
    field: 'documents',
    type: 'upload'
  },
  {
    id: 'additional_requirements',
    message: "Is there anything else you'd like us to know about your event? Reply *skip* if none.",
    field: 'additional_requirements',
    type: 'text',
    required: false
  },
  {
    id: 'consent_contact',
    message: 'Do you agree to be contacted about this enquiry?',
    field: 'consent_contact',
    type: 'buttons',
    options: [
      { id: 'Yes', title: 'Yes, I agree' },
      { id: 'No', title: 'No' }
    ]
  },
  {
    id: 'consent_marketing',
    message: 'May we send proposals and marketing communications?',
    field: 'consent_marketing',
    type: 'buttons',
    options: [
      { id: 'Yes', title: 'Yes, I agree' },
      { id: 'No', title: 'Proposals only' }
    ]
  }
];

const STEP_INDEX = Object.fromEntries(STEPS.map((s, i) => [s.id, i]));

function getStep(id) {
  return STEPS.find((s) => s.id === id);
}

function nextStepId(currentId, data) {
  let i = STEP_INDEX[currentId] + 1;
  while (i < STEPS.length) {
    const step = STEPS[i];
    if (step.skipIf && step.skipIf(data)) {
      i += 1;
      continue;
    }
    return step.id;
  }
  return 'complete';
}

// ─── WhatsApp Cloud API ─────────────────────────────────────────────────────

async function waPost(payload) {
  if (!whatsappToken || !phoneNumberId) {
    console.error(
      '❌ Cannot send WhatsApp reply: set WHATSAPP_TOKEN (or ACCESS_TOKEN) and PHONE_NUMBER_ID on Render.'
    );
    console.log('[DEV] Would send:', JSON.stringify(payload, null, 2));
    return { error: { message: 'Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID' } };
  }
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${whatsappToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('❌ WhatsApp API error:', res.status, JSON.stringify(data, null, 2));
    } else {
      console.log('✅ Sent', payload.type, 'to', payload.to);
    }
    return data;
  } catch (err) {
    console.error('❌ WhatsApp send failed:', err.message);
    return { error: { message: err.message } };
  }
}

async function sendText(to, body) {
  return waPost({
    messaging_product: 'whatsapp',
    to: String(to).replace(/\D/g, ''), // digits only
    type: 'text',
    text: { preview_url: false, body: String(body).slice(0, 4096) }
  });
}

async function sendButtons(to, body, options) {
  const payload = {
    messaging_product: 'whatsapp',
    to: String(to).replace(/\D/g, ''),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: String(body).slice(0, 1024) },
      action: {
        buttons: options.slice(0, 3).map((o) => ({
          type: 'reply',
          reply: { id: String(o.id).slice(0, 256), title: String(o.title).slice(0, 20) }
        }))
      }
    }
  };
  const result = await waPost(payload);
  if (result?.error) {
    const lines = options.map((o, i) => `${i + 1}. ${o.title}`).join('\n');
    return sendText(to, `${body}\n\n${lines}\n\nReply with the option text or number.`);
  }
  return result;
}

async function sendList(to, body, buttonLabel, options) {
  const payload = {
    messaging_product: 'whatsapp',
    to: String(to).replace(/\D/g, ''),
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: String(body).slice(0, 1024) },
      action: {
        button: String(buttonLabel || 'Select').slice(0, 20),
        sections: [
          {
            title: 'Options',
            rows: options.slice(0, 10).map((o) => ({
              id: String(o.id).slice(0, 200),
              title: String(o.title).slice(0, 24)
            }))
          }
        ]
      }
    }
  };
  const result = await waPost(payload);
  if (result?.error) {
    const lines = options.map((o, i) => `${i + 1}. ${o.title}`).join('\n');
    return sendText(to, `${body}\n\n${lines}\n\nReply with the option text or number.`);
  }
  return result;
}

async function markRead(messageId) {
  if (!whatsappToken || !phoneNumberId || !messageId) return;
  return waPost({
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId
  });
}

async function promptStep(to, stepId) {
  const step = getStep(stepId);
  if (!step) return;

  if (step.type === 'services') {
    const lines = SERVICES.map((s, i) => `${i + 1}. ${s}`).join('\n');
    await sendText(
      to,
      `${step.message}\n\n${lines}\n\nReply with numbers separated by commas (e.g. *1,5,12*), then *done*.`
    );
    return;
  }

  if (step.type === 'upload') {
    await sendText(to, step.message);
    return;
  }

  if (step.type === 'buttons' && step.options?.length) {
    if (whatsappToken && phoneNumberId) {
      await sendButtons(to, step.message, step.options);
    } else {
      await sendText(to, `${step.message}\n\n${step.options.map((o) => `• ${o.title}`).join('\n')}`);
    }
    return;
  }

  if (step.type === 'list' && step.options?.length) {
    if (whatsappToken && phoneNumberId) {
      await sendList(to, step.message, 'Choose', step.options);
    } else {
      await sendText(to, `${step.message}\n\n${step.options.map((o, i) => `${i + 1}. ${o.title}`).join('\n')}`);
    }
    return;
  }

  await sendText(to, step.message);
}

// ─── Sessions & enquiries ───────────────────────────────────────────────────

function getSession(waId) {
  return readJson(sessionsFile, {})[waId] || null;
}

function saveSession(waId, session) {
  const all = readJson(sessionsFile, {});
  all[waId] = { ...session, updated_at: new Date().toISOString() };
  writeJson(sessionsFile, all);
}

function resetSession(waId) {
  const all = readJson(sessionsFile, {});
  delete all[waId];
  writeJson(sessionsFile, all);
}

function createSession(waId) {
  const session = {
    id: randomUUID(),
    step: 'welcome',
    data: { phone: waId, preferred_contact: 'WhatsApp', documents: [] },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  saveSession(waId, session);
  return session;
}

function saveEnquiry(waId, data) {
  const enquiries = readJson(enquiriesFile, []);
  const services = Array.isArray(data.services_required)
    ? data.services_required.join(', ')
    : data.services_required || '';

  const enquiry = {
    id: randomUUID(),
    status: 'New',
    assigned_to: '',
    internal_notes: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    wa_id: waId,
    full_name: data.full_name || '',
    company: data.company || '',
    email: data.email || '',
    phone: data.phone || waId,
    preferred_contact: data.preferred_contact || 'WhatsApp',
    event_type: data.event_type || '',
    event_name: data.event_name || '',
    event_date: data.event_date || '',
    alternative_date: data.alternative_date || '',
    event_start_time: data.event_start_time || '',
    event_end_time: data.event_end_time || '',
    venue: data.venue || '',
    venue_confirmed: data.venue_confirmed || '',
    expected_guests: data.expected_guests || '',
    vip_guests: data.vip_guests || '',
    indoor_outdoor: data.indoor_outdoor || '',
    theme: data.theme || '',
    event_objectives: data.event_objectives || '',
    target_audience: data.target_audience || '',
    services_required: services,
    has_budget: data.has_budget || '',
    budget_range: data.budget_range || '',
    quotation_needed_by: data.quotation_needed_by || '',
    is_urgent: data.is_urgent || '',
    decision_deadline: data.decision_deadline || '',
    additional_requirements: data.additional_requirements || '',
    documents: data.documents || [],
    consent_contact: data.consent_contact || '',
    consent_marketing: data.consent_marketing || ''
  };

  enquiries.unshift(enquiry);
  writeJson(enquiriesFile, enquiries);
  notifyNewEnquiry(enquiry).catch((err) => console.error('Email notify failed:', err.message));
  return enquiry;
}

async function notifyNewEnquiry(enquiry) {
  const to = process.env.NOTIFY_EMAIL;
  if (!to || !process.env.SMTP_HOST) {
    console.log('New enquiry saved:', enquiry.id, enquiry.event_name);
    return;
  }
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined
  });
  const appUrl = process.env.APP_URL || '';
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: `[New Enquiry] ${enquiry.event_name} — ${enquiry.full_name}`,
    text: [
      'New Native Events enquiry',
      `Client: ${enquiry.full_name} (${enquiry.company})`,
      `Email: ${enquiry.email}`,
      `Phone: ${enquiry.phone}`,
      `Event: ${enquiry.event_name} (${enquiry.event_type})`,
      `Date: ${enquiry.event_date}`,
      `Venue: ${enquiry.venue}`,
      `Guests: ${enquiry.expected_guests}`,
      `Budget: ${enquiry.budget_range || enquiry.has_budget}`,
      `Services: ${enquiry.services_required}`,
      `Urgent: ${enquiry.is_urgent}`,
      appUrl ? `Dashboard: ${appUrl}/admin` : ''
    ].join('\n')
  });
}

// ─── Conversation handler ───────────────────────────────────────────────────

function extractInput(message) {
  if (message.type === 'text') return { kind: 'text', value: message.text?.body?.trim() || '' };
  if (message.type === 'interactive') {
    const i = message.interactive;
    if (i?.type === 'button_reply') return { kind: 'text', value: i.button_reply?.id || i.button_reply?.title || '' };
    if (i?.type === 'list_reply') return { kind: 'text', value: i.list_reply?.id || i.list_reply?.title || '' };
  }
  if (message.type === 'button') return { kind: 'text', value: message.button?.payload || message.button?.text || '' };
  if (message.type === 'document' || message.type === 'image') {
    return {
      kind: 'media',
      value: {
        type: message.type,
        id: message.document?.id || message.image?.id,
        name: message.document?.filename || 'image.jpg'
      }
    };
  }
  return null;
}

function resolveOption(value, options) {
  if (!options?.length) return value;
  const match = options.find((o) => o.id === value || o.title === value);
  if (match) return match.id;
  const n = parseInt(value, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= options.length) return options[n - 1].id;
  const lower = value.toLowerCase();
  const soft = options.find((o) => o.id.toLowerCase() === lower || o.title.toLowerCase() === lower);
  return soft ? soft.id : value;
}

function parseServices(value) {
  return value
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part) => {
      const n = parseInt(part, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= SERVICES.length) return SERVICES[n - 1];
      return SERVICES.find((s) => s.toLowerCase() === part.toLowerCase()) || null;
    })
    .filter(Boolean);
}

async function handleMessage(from, message) {
  const input = extractInput(message);
  if (!input) {
    await sendText(from, 'Please reply with text, or use the buttons/list when shown.');
    return;
  }

  const text = input.kind === 'text' ? input.value : '';
  const isRestart = /^(hi|hello|hey|start|menu|restart)$/i.test(text);

  let session = getSession(from);

  // "Get started" button id used to be "start", which matched isRestart and
  // re-showed welcome forever. Still treat start/get_started on welcome as continue.
  const advancingWelcome =
    session?.step === 'welcome' && /^(start|get[_ ]?started|continue)$/i.test(text);

  if ((isRestart || !session || session.step === 'complete') && !advancingWelcome) {
    if (session?.step === 'complete' && !isRestart) {
      await sendText(from, 'Your enquiry is already submitted. Reply *start* to begin a new one.');
      return;
    }
    resetSession(from);
    session = createSession(from);
    await promptStep(from, 'welcome');
    return;
  }

  const step = getStep(session.step);
  if (!step) {
    session.step = 'welcome';
    saveSession(from, session);
    await promptStep(from, 'welcome');
    return;
  }

  const data = { ...session.data };

  // Documents
  if (step.type === 'upload') {
    if (input.kind === 'media') {
      data.documents = data.documents || [];
      data.documents.push(input.value);
      session.data = data;
      saveSession(from, session);
      await sendText(from, `Received (${data.documents.length}). Send more, or reply *done* / *skip*.`);
      return;
    }
    if (!/^(skip|done|continue)$/i.test(text)) {
      await sendText(from, 'Please send a file, or reply *skip* / *done* to continue.');
      return;
    }
  }

  // Services multi-select
  if (step.type === 'services') {
    if (/^(done|skip)$/i.test(text)) {
      if (!(data.services_required || []).length) {
        await sendText(from, 'Please select at least one service number first (e.g. *1,5,12*).');
        return;
      }
    } else {
      const picked = parseServices(text);
      if (!picked.length) {
        await sendText(from, 'Reply with numbers like *1,5,12*, then *done*.');
        return;
      }
      data.services_required = [...new Set([...(data.services_required || []), ...picked])];
      session.data = data;
      saveSession(from, session);
      await sendText(
        from,
        `Added. Selected: ${data.services_required.join(', ')}\n\nAdd more numbers, or reply *done*.`
      );
      return;
    }
  }

  // Normal answer
  let value = text;

  if (step.type === 'buttons' || step.type === 'list') {
    value = resolveOption(value, step.options);
  }

  if (step.id === 'phone' && /^(same|this|whatsapp)$/i.test(value)) {
    value = from.startsWith('+') ? from : `+${from}`;
  }

  if (step.type === 'upload') {
    value = data.documents || [];
  }

  if (step.type === 'services') {
    value = data.services_required;
  }

  if (step.field && step.type === 'text') {
    if (!step.required && /^skip$/i.test(value)) {
      value = '';
    } else if (step.required && !value.trim()) {
      await sendText(from, 'This is required — please reply with your answer.');
      return;
    } else if (step.validate) {
      const err = step.validate(value);
      if (err) {
        await sendText(from, err);
        return;
      }
    }
  }

  if (step.field && step.type !== 'upload') {
    data[step.field] = value;
  }
  if (step.field === 'documents') {
    data.documents = Array.isArray(value) ? value : data.documents || [];
  }
  if (step.type === 'services') {
    data.services_required = value;
  }

  const next = nextStepId(step.id, data);

  if (next === 'complete') {
    const enquiry = saveEnquiry(from, data);
    session.step = 'complete';
    session.data = data;
    session.enquiry_id = enquiry.id;
    saveSession(from, session);

    await sendText(
      from,
      `Thank you! Your enquiry has been submitted successfully.\n\nOur sales team will review your event brief and prepare a tailored quotation. We'll be in touch shortly.\n\n*Reference:* ${enquiry.id.slice(0, 8).toUpperCase()}\n\nReply *start* anytime for a new enquiry.`
    );
    return;
  }

  session.step = next;
  session.data = data;
  saveSession(from, session);
  await promptStep(from, next);
}

// ─── Webhook (same pattern as before) ───────────────────────────────────────

app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else if (!mode) {
    res.status(200).send('Native Events WhatsApp Enquiry Bot is running. Open /admin for the sales dashboard.');
  } else {
    res.status(403).end();
  }
});

app.post('/', async (req, res) => {
  // Always ACK immediately so Meta does not retry
  res.status(200).end();

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\nWebhook received ${timestamp}`);
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const body = req.body || {};
    if (body.object !== 'whatsapp_business_account') {
      console.log('Ignoring non-WhatsApp payload');
      return;
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        // Status updates (delivered/read) — ignore
        if (!value?.messages?.length) {
          if (value?.statuses) console.log('Status update (ignored)');
          continue;
        }

        for (const message of value.messages) {
          const from = message.from;
          console.log(`Incoming from ${from} type=${message.type}`);
          try {
            await markRead(message.id);
          } catch (_) {}
          try {
            await handleMessage(from, message);
          } catch (err) {
            console.error('handleMessage error:', err);
            await sendText(from, 'Sorry, something went wrong. Please reply *start* to try again.').catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    verifyTokenSet: Boolean(verifyToken),
    whatsappTokenSet: Boolean(whatsappToken),
    phoneNumberIdSet: Boolean(phoneNumberId),
    phoneNumberIdPreview: phoneNumberId ? `${String(phoneNumberId).slice(0, 4)}…` : null,
    apiVersion
  });
});

// ─── Sales dashboard API ────────────────────────────────────────────────────

app.use('/admin', express.static(path.join(__dirname, 'public')));

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/enquiries', (req, res) => {
  let list = readJson(enquiriesFile, []);
  const { search, status } = req.query;
  if (status) list = list.filter((e) => e.status === status);
  if (search) {
    const t = String(search).toLowerCase();
    list = list.filter(
      (e) =>
        (e.full_name || '').toLowerCase().includes(t) ||
        (e.company || '').toLowerCase().includes(t) ||
        (e.email || '').toLowerCase().includes(t) ||
        (e.event_name || '').toLowerCase().includes(t) ||
        (e.phone || '').includes(t)
    );
  }
  res.json(list);
});

app.get('/api/enquiries/stats', (_req, res) => {
  const list = readJson(enquiriesFile, []);
  res.json({
    total: list.length,
    new_count: list.filter((e) => e.status === 'New').length,
    contacted: list.filter((e) => e.status === 'Contacted').length,
    quoting: list.filter((e) => e.status === 'Quoting').length,
    won: list.filter((e) => e.status === 'Won').length,
    lost: list.filter((e) => e.status === 'Lost').length,
    urgent: list.filter((e) => e.is_urgent === 'Yes').length
  });
});

app.get('/api/enquiries/export/csv', (req, res) => {
  let list = readJson(enquiriesFile, []);
  if (req.query.status) list = list.filter((e) => e.status === req.query.status);

  const headers = [
    'id', 'status', 'created_at', 'full_name', 'company', 'email', 'phone',
    'preferred_contact', 'event_type', 'event_name', 'event_date', 'venue',
    'expected_guests', 'services_required', 'budget_range', 'is_urgent',
    'quotation_needed_by', 'assigned_to', 'internal_notes'
  ];
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [headers.join(',')].concat(
    list.map((e) => headers.map((h) => escape(e[h])).join(','))
  );
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="enquiries.csv"');
  res.send(rows.join('\n'));
});

app.get('/api/enquiries/:id/brief.txt', (req, res) => {
  const e = readJson(enquiriesFile, []).find((x) => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'Not found' });

  const brief = [
    'NATIVE EVENTS — EVENT ENQUIRY BRIEF',
    '===================================',
    '',
    'CLIENT DETAILS',
    `Name: ${e.full_name}`,
    `Company: ${e.company}`,
    `Email: ${e.email}`,
    `Phone: ${e.phone}`,
    `Preferred contact: ${e.preferred_contact}`,
    '',
    'EVENT SUMMARY',
    `Type: ${e.event_type}`,
    `Name: ${e.event_name}`,
    `Date: ${e.event_date}`,
    `Alternative date: ${e.alternative_date || '—'}`,
    `Time: ${e.event_start_time} – ${e.event_end_time}`,
    `Venue: ${e.venue} (confirmed: ${e.venue_confirmed})`,
    `Guests: ${e.expected_guests}`,
    `VIP guests: ${e.vip_guests}`,
    `Indoor/Outdoor: ${e.indoor_outdoor}`,
    `Theme: ${e.theme || '—'}`,
    `Objectives: ${e.event_objectives}`,
    `Target audience: ${e.target_audience}`,
    '',
    'SERVICES REQUESTED',
    e.services_required || '—',
    '',
    'BUDGET',
    `Has budget: ${e.has_budget}`,
    `Range: ${e.budget_range || '—'}`,
    '',
    'TIMELINE',
    `Quotation needed by: ${e.quotation_needed_by}`,
    `Urgent: ${e.is_urgent}`,
    `Decision deadline: ${e.decision_deadline || '—'}`,
    '',
    'ADDITIONAL NOTES',
    e.additional_requirements || '—',
    '',
    'DOCUMENTS',
    (e.documents || []).length
      ? e.documents.map((d) => `- ${d.name || d.type} (${d.id || ''})`).join('\n')
      : 'None',
    '',
    'META',
    `Enquiry ID: ${e.id}`,
    `Submitted: ${e.created_at}`,
    `Status: ${e.status}`,
    `Consent contact: ${e.consent_contact}`,
    `Consent marketing: ${e.consent_marketing}`
  ].join('\n');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="brief-${e.id.slice(0, 8)}.txt"`);
  res.send(brief);
});

app.get('/api/enquiries/:id', (req, res) => {
  const enquiry = readJson(enquiriesFile, []).find((e) => e.id === req.params.id);
  if (!enquiry) return res.status(404).json({ error: 'Not found' });
  res.json(enquiry);
});

app.patch('/api/enquiries/:id', (req, res) => {
  const list = readJson(enquiriesFile, []);
  const idx = list.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const { status, assigned_to, internal_notes } = req.body;
  if (status !== undefined) list[idx].status = status;
  if (assigned_to !== undefined) list[idx].assigned_to = assigned_to;
  if (internal_notes !== undefined) list[idx].internal_notes = internal_notes;
  list[idx].updated_at = new Date().toISOString();
  writeJson(enquiriesFile, list);
  res.json(list[idx]);
});

// Start
app.listen(port, () => {
  console.log(`\nNative Events WhatsApp chatbot listening on port ${port}`);
  console.log('Webhook: GET/POST /');
  console.log('Health:  GET /health');
  console.log('Admin:   /admin\n');
  console.log('Config check:');
  console.log('  VERIFY_TOKEN:     ', verifyToken ? '✓ set' : '✗ MISSING');
  console.log('  WHATSAPP_TOKEN:   ', whatsappToken ? '✓ set' : '✗ MISSING');
  console.log('  PHONE_NUMBER_ID:  ', phoneNumberId ? '✓ set' : '✗ MISSING');
});
