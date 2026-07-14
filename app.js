/**
 * Native Events — WhatsApp Client Enquiry Chatbot
 * Meta WhatsApp Cloud API webhook for Render
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const {
  STEPS,
  SERVICES,
  getStepConfig,
  validateInput,
  processInput
} = require('./server/chatbot');
const store = require('./server/store');
const { sendText, sendButtons, sendList, markAsRead } = require('./server/whatsapp');
const { sendNewEnquiryNotification } = require('./server/email');
const { generateExcel, generatePDF } = require('./server/export');

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const whatsappToken = process.env.WHATSAPP_TOKEN || process.env.ACCESS_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;

const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Serve admin dashboard (optional)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// ─── WhatsApp webhook verification (GET) ───────────────────────────────────
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

// ─── Incoming WhatsApp messages (POST) ─────────────────────────────────────
app.post('/', async (req, res) => {
  // Always acknowledge quickly so Meta doesn't retry
  res.status(200).end();

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\nWebhook received ${timestamp}`);

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value?.messages) continue;

        for (const message of value.messages) {
          const from = message.from; // WhatsApp ID (phone number)
          const messageId = message.id;

          if (whatsappToken && phoneNumberId) {
            markAsRead(messageId).catch(() => {});
          }

          const text = extractUserInput(message);
          if (text == null) {
            await replyText(from, 'Please send a text message, or use the buttons/list when shown.');
            continue;
          }

          console.log(`From ${from}: ${text}`);
          await handleConversation(from, text, message);
        }
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
  }
});

function extractUserInput(message) {
  if (message.type === 'text') {
    return message.text?.body?.trim() ?? null;
  }
  if (message.type === 'interactive') {
    const interactive = message.interactive;
    if (interactive?.type === 'button_reply') {
      return interactive.button_reply?.id || interactive.button_reply?.title;
    }
    if (interactive?.type === 'list_reply') {
      return interactive.list_reply?.id || interactive.list_reply?.title;
    }
  }
  if (message.type === 'button') {
    return message.button?.payload || message.button?.text;
  }
  // Document / image — treat as upload acknowledgement at document step
  if (message.type === 'document' || message.type === 'image') {
    return { __media: true, message };
  }
  return null;
}

async function replyText(to, text) {
  if (!whatsappToken || !phoneNumberId) {
    console.log(`[DEV] → ${to}: ${text}`);
    return;
  }
  await sendText(to, text);
}

async function sendStepPrompt(to, stepId) {
  const step = STEPS[stepId];
  if (!step) return;

  const config = getStepConfig(stepId);

  // Multi-select services: numbered list via text (WhatsApp list max 10)
  if (step.inputType === 'multiselect') {
    const lines = SERVICES.map((s, i) => `${i + 1}. ${s}`).join('\n');
    await replyText(
      to,
      `${config.message}\n\n${lines}\n\nReply with the numbers separated by commas (e.g. 1,5,12).\nType *done* when finished if you already selected some.`
    );
    return;
  }

  // Upload step
  if (step.inputType === 'upload') {
    await replyText(
      to,
      `${config.message}\n\nSend photos or documents here, or reply *skip* to continue without uploads.`
    );
    return;
  }

  // ≤3 choices → reply buttons
  if ((step.inputType === 'choice' || step.inputType === 'button') && step.options) {
    const opts = step.options.map((o) =>
      typeof o === 'string' ? { id: o, title: o } : { id: o.value, title: o.label }
    );

    if (opts.length <= 3 && whatsappToken && phoneNumberId) {
      await sendButtons(to, config.message, opts.slice(0, 3));
      return;
    }

    // 4–10 choices → list message
    if (opts.length <= 10 && whatsappToken && phoneNumberId) {
      await sendList(to, config.message, 'Choose option', opts);
      return;
    }

    // Fallback: numbered text
    const lines = opts.map((o, i) => `${i + 1}. ${o.title}`).join('\n');
    await replyText(to, `${config.message}\n\n${lines}\n\nReply with the number or the option text.`);
    return;
  }

  // Free text / date / time / email
  let hint = '';
  if (step.placeholder) hint = `\n\n_Example: ${step.placeholder}_`;
  if (step.required === false) hint += '\n(Reply *skip* to leave blank)';
  await replyText(to, `${config.message}${hint}`);
}

async function handleConversation(from, input, rawMessage) {
  let session = store.getSession(from);

  // Restart command
  if (typeof input === 'string' && /^(hi|hello|hey|start|menu|restart)$/i.test(input.trim())) {
    store.resetSession(from);
    session = store.getSession(from);
  }

  // New session → welcome
  if (!session || session.current_step === 'complete') {
    if (session?.current_step === 'complete' && typeof input === 'string' && !/^(hi|hello|hey|start|menu|restart)$/i.test(input.trim())) {
      await replyText(from, 'Your previous enquiry is complete. Reply *start* to submit a new one.');
      return;
    }
    session = store.createSession(from, {
      phone: from,
      preferred_contact: 'WhatsApp'
    });
    await sendStepPrompt(from, 'welcome');
    return;
  }

  const currentStep = session.current_step;
  const step = STEPS[currentStep];
  const data = { ...session.data };

  // Handle media at upload step
  if (typeof input === 'object' && input.__media) {
    if (currentStep !== 'supporting_documents') {
      await replyText(from, 'Please answer the current question with text, or use the buttons shown.');
      return;
    }
    data.uploaded_files = data.uploaded_files || [];
    data.uploaded_files.push({
      type: rawMessage.type,
      id: rawMessage.document?.id || rawMessage.image?.id,
      name: rawMessage.document?.filename || 'image'
    });
    store.updateSession(from, { data });
    await replyText(from, `Got it (${data.uploaded_files.length} file(s)). Send more, or reply *done* / *skip* to continue.`);
    return;
  }

  let value = typeof input === 'string' ? input.trim() : input;

  // Resolve numbered choices
  if (step && (step.inputType === 'choice' || step.inputType === 'button') && step.options) {
    value = resolveChoice(value, step.options);
  }

  // Multi-select services
  if (step?.inputType === 'multiselect') {
    if (/^(done|skip)$/i.test(value) && (data.services_required || []).length > 0) {
      value = data.services_required;
    } else {
      const selected = parseServiceNumbers(value);
      if (selected.length === 0) {
        await replyText(from, 'Please reply with numbers like *1,5,12* from the list, then say *done*.');
        return;
      }
      const existing = data.services_required || [];
      data.services_required = [...new Set([...existing, ...selected])];
      store.updateSession(from, { data });
      await replyText(
        from,
        `Added: ${selected.join(', ')}\nSelected so far: ${data.services_required.join(', ')}\n\nAdd more numbers, or reply *done* to continue.`
      );
      return;
    }
  }

  // Upload done/skip
  if (step?.inputType === 'upload') {
    if (/^(done|skip)$/i.test(value) || (data.uploaded_files || []).length > 0 && /^(done|continue)$/i.test(value)) {
      value = 'skip';
    } else if (!/^(skip|done)$/i.test(value)) {
      await replyText(from, 'Please send a file, or reply *skip* / *done* to continue.');
      return;
    }
  }

  // Pre-fill phone from WhatsApp if user is on phone step and sends "same" or empty skip intent
  if (currentStep === 'phone' && /^(same|this|whatsapp)$/i.test(value)) {
    value = from.startsWith('+') ? from : `+${from}`;
  }

  const error = validateInput(currentStep, value, data);
  if (error) {
    await replyText(from, error);
    await sendStepPrompt(from, currentStep);
    return;
  }

  const { data: updatedData, nextStep } = processInput(currentStep, value, data);

  if (!nextStep || nextStep === 'complete') {
    const enquiry = store.saveEnquiry(from, updatedData);
    store.updateSession(from, {
      current_step: 'complete',
      data: updatedData,
      enquiry_id: enquiry.id
    });

    sendNewEnquiryNotification(enquiry).catch(console.error);

    await replyText(
      from,
      STEPS.complete.message +
        `\n\n*Reference:* ${enquiry.id.slice(0, 8).toUpperCase()}`
    );
    return;
  }

  // Skip budget_range handled in getNextStep / processInput
  store.updateSession(from, { current_step: nextStep, data: updatedData });
  await sendStepPrompt(from, nextStep);
}

function resolveChoice(value, options) {
  const opts = options.map((o) =>
    typeof o === 'string' ? { id: o, title: o } : { id: String(o.value), title: o.label }
  );

  // Exact id / title match
  const byId = opts.find((o) => o.id === value || o.title === value);
  if (byId) return byId.id;

  // Numbered reply
  const n = parseInt(value, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= opts.length) {
    return opts[n - 1].id;
  }

  // Case-insensitive title
  const lower = value.toLowerCase();
  const byTitle = opts.find((o) => o.title.toLowerCase() === lower || o.id.toLowerCase() === lower);
  if (byTitle) return byTitle.id;

  return value;
}

function parseServiceNumbers(value) {
  const parts = value.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
  const selected = [];
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= SERVICES.length) {
      selected.push(SERVICES[n - 1]);
    } else {
      // Direct service name match
      const match = SERVICES.find((s) => s.toLowerCase() === part.toLowerCase());
      if (match) selected.push(match);
    }
  }
  return selected;
}

// ─── Admin API (dashboard at /admin.html) ──────────────────────────────────
app.get('/api/enquiries', (req, res) => {
  const { search, status } = req.query;
  res.json(store.listEnquiries({ search, status }));
});

app.get('/api/enquiries/stats', (_req, res) => {
  res.json(store.getStats());
});

app.get('/api/enquiries/export/excel', (req, res) => {
  const { search, status } = req.query;
  const enquiries = store.listEnquiries({ search, status });
  const buffer = generateExcel(enquiries);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="native-events-enquiries.xlsx"');
  res.send(buffer);
});

app.get('/api/enquiries/:id', (req, res) => {
  const enquiry = store.getEnquiry(req.params.id);
  if (!enquiry) return res.status(404).json({ error: 'Enquiry not found' });
  res.json({ ...enquiry, documents: enquiry.documents || [] });
});

app.patch('/api/enquiries/:id', (req, res) => {
  const updated = store.updateEnquiry(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Enquiry not found' });
  res.json(updated);
});

app.get('/api/enquiries/:id/export/pdf', async (req, res) => {
  const enquiry = store.getEnquiry(req.params.id);
  if (!enquiry) return res.status(404).json({ error: 'Enquiry not found' });
  const pdf = await generatePDF(enquiry, enquiry.documents || []);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="enquiry-${enquiry.id.slice(0, 8)}.pdf"`);
  res.send(pdf);
});

app.listen(port, () => {
  console.log(`\nNative Events WhatsApp chatbot listening on port ${port}`);
  console.log(`Webhook URL: <your-render-url>/`);
  console.log(`Admin: http://localhost:${port}/admin.html\n`);
  if (!verifyToken) console.warn('WARN: VERIFY_TOKEN not set');
  if (!whatsappToken) console.warn('WARN: WHATSAPP_TOKEN not set');
  if (!phoneNumberId) console.warn('WARN: PHONE_NUMBER_ID not set');
});
