/**
 * Botswana Housing Corporation — WhatsApp Customer Assistant
 * Hosted on Render · Webhook for Meta WhatsApp Cloud API
 *
 * Menu-driven support flow: Buy, Rent, Maintenance, Payments,
 * Office Information, Speak to Customer Care.
 *
 * Env (Render):
 *   VERIFY_TOKEN       — Meta webhook verify token
 *   WHATSAPP_TOKEN     — Cloud API access token (or ACCESS_TOKEN)
 *   PHONE_NUMBER_ID    — WhatsApp phone number ID
 *   PORT               — set by Render
 *   DATA_DIR           — session storage (e.g. /var/data on Render)
 *   WHATSAPP_API_VERSION — optional, default v21.0
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

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const sessionsFile = path.join(dataDir, 'sessions.json');
const submissionsFile = path.join(dataDir, 'submissions.json');

function ensureData() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(sessionsFile)) fs.writeFileSync(sessionsFile, '{}');
  if (!fs.existsSync(submissionsFile)) fs.writeFileSync(submissionsFile, '[]');
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

function ref() {
  return String(Date.now()).slice(-8);
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

const NAV = {
  MAIN: { id: '__main__', title: 'Main menu' },
  BACK: { id: '__back__', title: 'Back' }
};

/** Conversation tree — mirrors the BHC flowchart (WhatsApp-safe text) */
const TREE = {
  welcome: {
    message:
      '*Welcome to Botswana Housing Corporation*\n\nHow can we help you today?',
    options: [
      { id: 'buy', title: 'Buy a House' },
      { id: 'rent', title: 'Rent a Property' },
      { id: 'maintenance', title: 'Maintenance' },
      { id: 'payments', title: 'Payments' },
      { id: 'office', title: 'Office Information' },
      { id: 'care', title: 'Customer Care' }
    ]
  },

  // ── Buy a House ──────────────────────────────────────────
  buy: {
    message: "You're exploring *home ownership* with BHC.\n\nWhat would you like to know?",
    options: [
      { id: 'buy_view', title: 'Available properties' },
      { id: 'buy_pricing', title: 'Pricing' },
      { id: 'buy_eligibility', title: 'Eligibility' },
      { id: 'buy_docs', title: 'Required documents' },
      { id: 'buy_viewing', title: 'Book viewing' },
      NAV.MAIN
    ]
  },
  buy_view: {
    message:
      '*Available properties*\n\nCurrent BHC sale listings include:\n\n• *Phakalane Estate* — 3-bed units from P685,000\n• *Block 8, Gaborone* — 2-bed flats from P420,000\n• *Francistown Extension 14* — 3-bed houses from P510,000\n• *Palapye* — starter homes from P295,000\n\nListings update regularly. Visit *bhc.bw* or a branch for the full catalogue.',
    options: [
      { id: 'buy_viewing', title: 'Book a viewing' },
      { id: 'buy_pricing', title: 'See pricing' },
      { id: 'buy', title: 'Back' },
      NAV.MAIN
    ]
  },
  buy_pricing: {
    message:
      '*Pricing overview*\n\nBHC sale prices vary by location, size, and finishing:\n\n• Starter / 1–2 bed — from *P250,000*\n• Family / 3-bed — from *P450,000*\n• Premium estates — from *P650,000+*\n\nA 10% deposit is typically required. Payment plans and bank financing options are available for eligible buyers.',
    options: [
      { id: 'buy_eligibility', title: 'Check eligibility' },
      { id: 'buy', title: 'Back' },
      NAV.MAIN
    ]
  },
  buy_eligibility: {
    message:
      '*Buyer eligibility*\n\nTo purchase a BHC house you generally need to:\n\n• Be a Botswana citizen or permanent resident\n• Be 18 years or older\n• Provide proof of income / financing\n• Not already own a BHC-subsidised property (where subsidy rules apply)\n\nFinal eligibility is confirmed during application review.',
    options: [
      { id: 'buy_docs', title: 'Required documents' },
      { id: 'buy', title: 'Back' },
      NAV.MAIN
    ]
  },
  buy_docs: {
    message:
      '*Required documents*\n\nPlease prepare:\n\n1. Certified copy of Omang / passport\n2. Proof of income (payslips or bank statements)\n3. Marriage certificate / affidavit (if applicable)\n4. Proof of residence\n5. Bank pre-approval letter (recommended)\n\nBring originals and certified copies to your nearest BHC office.',
    options: [
      { id: 'buy_viewing', title: 'Book a viewing' },
      { id: 'buy', title: 'Back' },
      NAV.MAIN
    ]
  },
  buy_viewing: {
    message:
      '*Book a property viewing*\n\nShare your details and preferred property. A BHC officer will confirm your appointment.',
    form: 'viewing',
    options: [{ id: 'buy', title: 'Back' }, NAV.MAIN]
  },

  // ── Rent a Property ──────────────────────────────────────
  rent: {
    message: 'Looking to *rent* with BHC?\n\nChoose an option below.',
    options: [
      { id: 'rent_available', title: 'Available rentals' },
      { id: 'rent_rates', title: 'Rental rates' },
      { id: 'rent_apply', title: 'Apply' },
      { id: 'rent_lease', title: 'Lease enquiries' },
      NAV.MAIN
    ]
  },
  rent_available: {
    message:
      '*Available rentals*\n\nUnits currently open for application:\n\n• *Gaborone — Broadhurst* — 2-bed flat\n• *Gaborone — Extension 9* — 3-bed house\n• *Lobatse* — 2-bed unit\n• *Maun* — 3-bed house\n• *Selebi-Phikwe* — 1-bed flat\n\nAvailability changes quickly — apply early or visit a branch.',
    options: [
      { id: 'rent_apply', title: 'Apply now' },
      { id: 'rent_rates', title: 'Rental rates' },
      { id: 'rent', title: 'Back' },
      NAV.MAIN
    ]
  },
  rent_rates: {
    message:
      '*Rental rates*\n\nIndicative monthly rents:\n\n• Bedsitter / 1-bed — *P1,200 – P2,500*\n• 2-bed — *P2,500 – P4,500*\n• 3-bed — *P4,000 – P7,500*\n\nRates depend on location, condition, and unit type. A security deposit (usually one month’s rent) is required.',
    options: [
      { id: 'rent_apply', title: 'Start application' },
      { id: 'rent', title: 'Back' },
      NAV.MAIN
    ]
  },
  rent_apply: {
    message:
      '*Rental application*\n\nComplete a few questions and we’ll log your application. You’ll receive a reference number for follow-up.',
    form: 'rent_apply',
    options: [{ id: 'rent', title: 'Back' }, NAV.MAIN]
  },
  rent_lease: {
    message:
      '*Lease enquiries*\n\nStandard BHC residential leases:\n\n• Initial term: *12 months*\n• Renewable subject to good standing\n• Notice period: *1 calendar month*\n• Subletting is not permitted without written approval\n• Rent is due on or before the 1st of each month\n\nFor a specific lease query, speak to Customer Care or visit your branch.',
    options: [
      { id: 'care', title: 'Customer Care' },
      { id: 'rent', title: 'Back' },
      NAV.MAIN
    ]
  },

  // ── Maintenance ──────────────────────────────────────────
  maintenance: {
    message: '*Maintenance support*\n\nHow can we assist with your property?',
    options: [
      { id: 'maint_report', title: 'Report issue' },
      { id: 'maint_emergency', title: 'Emergency repair' },
      { id: 'maint_track', title: 'Track request' },
      { id: 'maint_faq', title: 'Maintenance FAQs' },
      NAV.MAIN
    ]
  },
  maint_report: {
    message:
      '*Report a maintenance issue*\n\nDescribe the problem and your unit details. Non-urgent requests are usually acknowledged within 1–2 working days.',
    form: 'maint_report',
    options: [{ id: 'maintenance', title: 'Back' }, NAV.MAIN]
  },
  maint_emergency: {
    message:
      '*Emergency repair*\n\nFor urgent issues that threaten safety or cause major damage (burst pipe, electrical hazard, no access, structural risk):\n\n• Call the emergency line: *0800 600 700* (toll-free demo)\n• Or continue below and mark as emergency\n\nPlease only use this for true emergencies.',
    form: 'maint_emergency',
    options: [{ id: 'maintenance', title: 'Back' }, NAV.MAIN]
  },
  maint_track: {
    message:
      '*Track a maintenance request*\n\nEnter your request reference number (e.g. MNT-2026-00482).',
    form: 'maint_track',
    options: [{ id: 'maintenance', title: 'Back' }, NAV.MAIN]
  },
  maint_faq: {
    message:
      '*Maintenance FAQs*\n\n*Who is responsible for repairs?*\nBHC handles structural and common-area repairs. Tenants handle day-to-day care and damage caused by misuse.\n\n*How long do repairs take?*\nEmergencies: within 24 hours. Routine: 5–14 working days depending on parts and priority.\n\n*Can I hire my own contractor?*\nOnly with prior written approval from BHC.\n\n*Will I be charged?*\nTenant-caused damage may be billed to your account.',
    options: [
      { id: 'maint_report', title: 'Report an issue' },
      { id: 'maintenance', title: 'Back' },
      NAV.MAIN
    ]
  },

  // ── Payments ─────────────────────────────────────────────
  payments: {
    message: '*Payments*\n\nManage rent, balances, and confirmations.',
    options: [
      { id: 'pay_balance', title: 'Rental balance' },
      { id: 'pay_methods', title: 'Payment methods' },
      { id: 'pay_statements', title: 'Statements' },
      { id: 'pay_confirm', title: 'Payment confirm' },
      NAV.MAIN
    ]
  },
  pay_balance: {
    message:
      '*Rental balance enquiry*\n\nEnter your tenant / account number to look up your balance. (Demo returns a sample balance.)',
    form: 'pay_balance',
    options: [{ id: 'payments', title: 'Back' }, NAV.MAIN]
  },
  pay_methods: {
    message:
      '*Payment methods*\n\nYou can pay BHC via:\n\n• *Bank deposit / EFT* — use your account number as reference\n• *Orange Money / MyZaka / Smega*\n• *Point of sale* at BHC cashier desks\n• *Debit order* (arrange at your branch)\n\nAlways keep your proof of payment.',
    options: [
      { id: 'pay_confirm', title: 'Submit confirmation' },
      { id: 'payments', title: 'Back' },
      NAV.MAIN
    ]
  },
  pay_statements: {
    message:
      '*Account statements*\n\nRequest a statement for your rental or purchase account. Statements are emailed within 1 working day (demo).',
    form: 'pay_statements',
    options: [{ id: 'payments', title: 'Back' }, NAV.MAIN]
  },
  pay_confirm: {
    message:
      '*Payment confirmation*\n\nAlready paid? Share the details so we can allocate your payment.',
    form: 'pay_confirm',
    options: [{ id: 'payments', title: 'Back' }, NAV.MAIN]
  },

  // ── Office Information ───────────────────────────────────
  office: {
    message: '*Office information*\n\nFind a branch, hours, contacts, or directions.',
    options: [
      { id: 'office_branches', title: 'Branches' },
      { id: 'office_hours', title: 'Working hours' },
      { id: 'office_contacts', title: 'Contacts' },
      { id: 'office_directions', title: 'Directions' },
      NAV.MAIN
    ]
  },
  office_branches: {
    message:
      '*BHC branches*\n\n• *Head Office — Gaborone*\n  Plot 5129, Corner Machel Drive & Station Road\n• *Francistown* — Blue Jacket Street\n• *Maun* — Tsheko Tsheko Road\n• *Palapye* — Central Business District\n• *Lobatse* — Woodhall Industrial\n• *Selebi-Phikwe* — The Mall\n\nVisit any branch for applications, payments, and enquiries.',
    options: [
      { id: 'office_directions', title: 'Get directions' },
      { id: 'office_hours', title: 'Working hours' },
      { id: 'office', title: 'Back' },
      NAV.MAIN
    ]
  },
  office_hours: {
    message:
      '*Working hours*\n\n• Monday – Friday: *07:30 – 16:30*\n• Lunch: 12:45 – 14:00 (cashier may pause)\n• Saturday, Sunday & public holidays: *Closed*\n\nEmergency maintenance remains available after hours via the emergency line.',
    options: [
      { id: 'office_contacts', title: 'Contacts' },
      { id: 'office', title: 'Back' },
      NAV.MAIN
    ]
  },
  office_contacts: {
    message:
      '*Contacts*\n\n• Switchboard: *+267 360 5100*\n• Customer Care: *+267 360 5200*\n• Email: *customercare@bhc.bw*\n• Emergency (demo): *0800 600 700*\n• Website: *www.bhc.bw*',
    options: [
      { id: 'care', title: 'Customer Care' },
      { id: 'office', title: 'Back' },
      NAV.MAIN
    ]
  },
  office_directions: {
    message:
      '*Directions*\n\n*Gaborone Head Office*\nPlot 5129, corner of Machel Drive and Station Road — near the CBD / railway area.\n\n*Francistown*\nBlue Jacket Street, central business district.\n\nFor GPS / map links, search “Botswana Housing Corporation” on Google Maps, or ask at reception when you arrive.',
    options: [
      { id: 'office_branches', title: 'All branches' },
      { id: 'office', title: 'Back' },
      NAV.MAIN
    ]
  },

  // ── Customer Care ────────────────────────────────────────
  care: {
    message: '*Customer Care*\n\nWe’re here to help. How would you like to connect?',
    options: [
      { id: 'care_live', title: 'Live Agent' },
      { id: 'care_callback', title: 'Call Back' },
      { id: 'care_ticket', title: 'Support Ticket' },
      NAV.MAIN
    ]
  },
  care_live: {
    message:
      '*Live Agent*\n\nConnecting you to a Customer Care agent…\n\n_Demo mode:_ agents are available Mon–Fri, 07:30–16:30. Outside these hours, please request a call back or create a support ticket.\n\nEstimated wait: *~3 minutes* during business hours.',
    options: [
      { id: 'care_callback', title: 'Request call back' },
      { id: 'care_ticket', title: 'Support ticket' },
      { id: 'care', title: 'Back' },
      NAV.MAIN
    ]
  },
  care_callback: {
    message:
      '*Request a call back*\n\nLeave your number and preferred time. An officer will return your call.',
    form: 'callback',
    options: [{ id: 'care', title: 'Back' }, NAV.MAIN]
  },
  care_ticket: {
    message:
      '*Create a support ticket*\n\nDescribe your issue and we’ll open a ticket for follow-up.',
    form: 'ticket',
    options: [{ id: 'care', title: 'Back' }, NAV.MAIN]
  }
};

/** Multi-step form flows (asked one question at a time on WhatsApp) */
const FORMS = {
  viewing: {
    fields: [
      { name: 'name', message: "What's your full name?", required: true },
      { name: 'phone', message: "What's your phone number?\n\nReply *same* to use this WhatsApp number.", required: true },
      { name: 'property', message: 'Which property / area are you interested in?', required: true },
      { name: 'date', message: 'Preferred viewing date? (e.g. 15 Sept 2026)', required: true }
    ],
    success: (d) =>
      `Thank you, *${d.name}*. Your viewing request for *${d.property}* on *${d.date}* has been logged.\n\nReference: *VW-${ref()}*\n\nWe’ll confirm on *${d.phone}*.`
  },
  rent_apply: {
    fields: [
      { name: 'name', message: "What's your full name?", required: true },
      { name: 'phone', message: "What's your phone number?\n\nReply *same* to use this WhatsApp number.", required: true },
      { name: 'omang', message: "What's your Omang / ID number?", required: true },
      {
        name: 'location',
        message: 'Preferred location?',
        type: 'list',
        options: ['Gaborone', 'Francistown', 'Maun', 'Palapye', 'Lobatse', 'Selebi-Phikwe', 'Other'].map(
          (t) => ({ id: t, title: t.slice(0, 24) })
        ),
        required: true
      },
      {
        name: 'beds',
        message: 'How many bedrooms do you need?',
        type: 'buttons',
        options: [
          { id: '1', title: '1' },
          { id: '2', title: '2' },
          { id: '3', title: '3' }
        ],
        required: true
      }
    ],
    success: (d) =>
      `Application received for *${d.name}*.\n\nLocation: *${d.location}* · ${d.beds} bedroom(s)\nReference: *RA-${ref()}*\n\nA housing officer will contact you on *${d.phone}*.`
  },
  maint_report: {
    fields: [
      { name: 'account', message: "What's your tenant / unit number?", required: true },
      { name: 'phone', message: "What's your phone number?\n\nReply *same* to use this WhatsApp number.", required: true },
      {
        name: 'category',
        message: 'Issue category?',
        type: 'list',
        options: ['Plumbing', 'Electrical', 'Doors / locks', 'Roof / leaks', 'Painting', 'Other'].map(
          (t) => ({ id: t, title: t.slice(0, 24) })
        ),
        required: true
      },
      { name: 'details', message: 'Please describe the issue.', required: true }
    ],
    success: (d) =>
      `Maintenance request logged.\n\nCategory: *${d.category}*\nUnit: *${d.account}*\nReference: *MNT-${ref()}*\n\nWe’ll update you on *${d.phone}*.`
  },
  maint_emergency: {
    fields: [
      { name: 'account', message: "What's your tenant / unit number?", required: true },
      { name: 'phone', message: "What's your phone number?\n\nReply *same* to use this WhatsApp number.", required: true },
      { name: 'details', message: 'Please describe the emergency.', required: true }
    ],
    success: (d) =>
      `*Emergency request received*\n\nUnit: *${d.account}*\nReference: *EMG-${ref()}*\n\nA technician will be dispatched. Keep your phone (*${d.phone}*) available.\n\nIf life or property is in immediate danger, also call *999 / 911*.`
  },
  maint_track: {
    fields: [
      { name: 'ref', message: 'Enter your request reference (e.g. MNT-2026-00482).', required: true }
    ],
    success: (d) => {
      const statuses = ['Received', 'Assigned to technician', 'Parts ordered', 'In progress', 'Completed'];
      const status = statuses[Math.abs(hash(d.ref)) % statuses.length];
      return `Reference *${d.ref}*\n\nStatus: *${status}*\nLast update: today\n\nFor more detail, call Customer Care with this reference.`;
    }
  },
  pay_balance: {
    fields: [
      { name: 'account', message: "What's your tenant / account number?", required: true }
    ],
    success: (d) => {
      const bal = ((Math.abs(hash(d.account)) % 8500) + 350).toLocaleString('en-BW');
      return `Account *${d.account}*\n\nOutstanding balance: *P${bal}*\nDue date: 1st of next month\n\n_Demo figures only — confirm at a branch or on your statement._`;
    }
  },
  pay_statements: {
    fields: [
      { name: 'account', message: "What's your tenant / account number?", required: true },
      {
        name: 'email',
        message: "What's your email address?",
        required: true,
        validate: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Please send a valid email address.')
      }
    ],
    success: (d) =>
      `Statement request logged for account *${d.account}*.\n\nIt will be sent to *${d.email}*.\nReference: *ST-${ref()}*`
  },
  pay_confirm: {
    fields: [
      { name: 'account', message: "What's your tenant / account number?", required: true },
      { name: 'amount', message: 'Amount paid (Pula)?', required: true },
      { name: 'date', message: 'Payment date? (e.g. 3 Aug 2026)', required: true },
      { name: 'ref', message: 'Bank / mobile money reference?', required: true }
    ],
    success: (d) =>
      `Payment confirmation received.\n\nAccount: *${d.account}*\nAmount: *P${d.amount}*\nYour ref: *${d.ref}*\nBHC ref: *PC-${ref()}*\n\nAllocation usually completes within 1–2 working days.`
  },
  callback: {
    fields: [
      { name: 'name', message: "What's your full name?", required: true },
      { name: 'phone', message: "What's your phone number?\n\nReply *same* to use this WhatsApp number.", required: true },
      {
        name: 'time',
        message: 'Preferred call time?',
        type: 'list',
        options: [
          { id: 'Morning (08:00–12:00)', title: 'Morning' },
          { id: 'Afternoon (14:00–16:30)', title: 'Afternoon' },
          { id: 'Anytime during office hours', title: 'Anytime' }
        ],
        required: true
      },
      { name: 'reason', message: 'Reason for the call? Reply *skip* if none.', required: false }
    ],
    success: (d) =>
      `Call-back scheduled for *${d.name}*.\n\nWe’ll call *${d.phone}* — preferred: *${d.time}*\nReference: *CB-${ref()}*`
  },
  ticket: {
    fields: [
      { name: 'name', message: "What's your full name?", required: true },
      { name: 'phone', message: "What's your phone number?\n\nReply *same* to use this WhatsApp number.", required: true },
      { name: 'email', message: "Email address? Reply *skip* if none.", required: false },
      {
        name: 'topic',
        message: 'Topic?',
        type: 'list',
        options: ['Buying', 'Renting', 'Maintenance', 'Payments', 'Lease', 'Other'].map((t) => ({
          id: t,
          title: t
        })),
        required: true
      },
      { name: 'details', message: 'Please describe your issue.', required: true }
    ],
    success: (d) =>
      `Support ticket created.\n\nTopic: *${d.topic}*\nTicket: *TKT-${ref()}*\n\nWe’ll follow up with *${d.name}* on *${d.phone}*.`
  }
};

const PARENT = {
  buy_view: 'buy',
  buy_pricing: 'buy',
  buy_eligibility: 'buy',
  buy_docs: 'buy',
  buy_viewing: 'buy',
  rent_available: 'rent',
  rent_rates: 'rent',
  rent_apply: 'rent',
  rent_lease: 'rent',
  maint_report: 'maintenance',
  maint_emergency: 'maintenance',
  maint_track: 'maintenance',
  maint_faq: 'maintenance',
  pay_balance: 'payments',
  pay_methods: 'payments',
  pay_statements: 'payments',
  pay_confirm: 'payments',
  office_branches: 'office',
  office_hours: 'office',
  office_contacts: 'office',
  office_directions: 'office',
  care_live: 'care',
  care_callback: 'care',
  care_ticket: 'care'
};

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
    to: String(to).replace(/\D/g, ''),
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

async function promptOptions(to, body, options) {
  if (!options?.length) {
    await sendText(to, body);
    return;
  }
  if (options.length <= 3) {
    if (whatsappToken && phoneNumberId) {
      await sendButtons(to, body, options);
    } else {
      await sendText(to, `${body}\n\n${options.map((o) => `• ${o.title}`).join('\n')}`);
    }
    return;
  }
  if (whatsappToken && phoneNumberId) {
    await sendList(to, body, 'Choose', options);
  } else {
    await sendText(to, `${body}\n\n${options.map((o, i) => `${i + 1}. ${o.title}`).join('\n')}`);
  }
}

async function promptNode(to, nodeId) {
  const node = TREE[nodeId];
  if (!node) return;

  // Form entry nodes: show intro, then first field
  if (node.form) {
    await sendText(to, node.message);
    return;
  }

  await promptOptions(to, node.message, node.options);
}

async function promptFormField(to, formKey, fieldIndex) {
  const form = FORMS[formKey];
  const field = form?.fields?.[fieldIndex];
  if (!field) return;

  if (field.type === 'buttons' && field.options?.length) {
    await promptOptions(to, field.message, field.options);
    return;
  }
  if (field.type === 'list' && field.options?.length) {
    if (whatsappToken && phoneNumberId) {
      await sendList(to, field.message, 'Choose', field.options);
    } else {
      await sendText(
        to,
        `${field.message}\n\n${field.options.map((o, i) => `${i + 1}. ${o.title}`).join('\n')}`
      );
    }
    return;
  }
  await sendText(to, field.message);
}

// ─── Sessions ───────────────────────────────────────────────────────────────

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
    mode: 'menu',
    node: 'welcome',
    form: null,
    formStep: 0,
    formParent: null,
    data: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  saveSession(waId, session);
  return session;
}

function logSubmission(waId, formKey, data) {
  const all = readJson(submissionsFile, []);
  const entry = {
    id: randomUUID(),
    wa_id: waId,
    form: formKey,
    data,
    created_at: new Date().toISOString()
  };
  all.push(entry);
  writeJson(submissionsFile, all);
  console.log('Submission saved:', entry.id, formKey);
  return entry;
}

// ─── Conversation handler ───────────────────────────────────────────────────

function extractInput(message) {
  if (message.type === 'text') return { kind: 'text', value: message.text?.body?.trim() || '' };
  if (message.type === 'interactive') {
    const i = message.interactive;
    if (i?.type === 'button_reply') {
      return { kind: 'text', value: i.button_reply?.id || i.button_reply?.title || '' };
    }
    if (i?.type === 'list_reply') {
      return { kind: 'text', value: i.list_reply?.id || i.list_reply?.title || '' };
    }
  }
  if (message.type === 'button') {
    return { kind: 'text', value: message.button?.payload || message.button?.text || '' };
  }
  return null;
}

function resolveOption(value, options) {
  if (!options?.length) return value;
  const match = options.find((o) => o.id === value || o.title === value);
  if (match) return match.id;
  const n = parseInt(value, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= options.length) return options[n - 1].id;
  const lower = String(value).toLowerCase();
  const soft = options.find(
    (o) => o.id.toLowerCase() === lower || o.title.toLowerCase() === lower
  );
  return soft ? soft.id : value;
}

const AFTER_FORM_OPTIONS = [
  { id: '__back__', title: 'Back' },
  NAV.MAIN
];

async function goToNode(from, session, nodeId) {
  if (nodeId === NAV.MAIN.id) nodeId = 'welcome';

  const node = TREE[nodeId];
  if (!node) {
    await sendText(from, 'Sorry, I didn’t understand that. Reply *menu* for the main menu.');
    return;
  }

  session.mode = 'menu';
  session.node = nodeId;
  session.form = null;
  session.formStep = 0;
  session.formParent = null;
  session.data = {};
  saveSession(from, session);

  if (node.form) {
    session.mode = 'form';
    session.form = node.form;
    session.formStep = 0;
    session.formParent = nodeId;
    session.data = {};
    saveSession(from, session);
    await promptNode(from, nodeId);
    await promptFormField(from, node.form, 0);
    return;
  }

  await promptNode(from, nodeId);
}

async function handleFormReply(from, session, text) {
  const form = FORMS[session.form];
  if (!form) {
    session.mode = 'menu';
    saveSession(from, session);
    await goToNode(from, session, 'welcome');
    return;
  }

  const field = form.fields[session.formStep];
  if (!field) {
    session.mode = 'menu';
    saveSession(from, session);
    await goToNode(from, session, PARENT[session.formParent] || 'welcome');
    return;
  }

  // Allow escape during forms
  if (/^(menu|restart|cancel)$/i.test(text)) {
    await goToNode(from, session, 'welcome');
    return;
  }
  if (/^(back|__back__)$/i.test(text)) {
    await goToNode(from, session, PARENT[session.formParent] || session.formParent || 'welcome');
    return;
  }

  let value = text;
  if (field.type === 'buttons' || field.type === 'list') {
    value = resolveOption(value, field.options);
  }

  if (field.name === 'phone' && /^(same|this|whatsapp)$/i.test(value)) {
    value = from.startsWith('+') ? from : `+${from}`;
  }

  if (!field.required && /^skip$/i.test(value)) {
    value = '';
  } else if (field.required && !String(value).trim()) {
    await sendText(from, 'This is required — please reply with your answer.');
    return;
  } else if (field.validate) {
    const err = field.validate(value);
    if (err) {
      await sendText(from, err);
      return;
    }
  }

  // If choice field but value didn't match options, re-prompt
  if ((field.type === 'buttons' || field.type === 'list') && field.options?.length) {
    const ok = field.options.some((o) => o.id === value);
    if (!ok) {
      await sendText(from, 'Please choose one of the options provided.');
      await promptFormField(from, session.form, session.formStep);
      return;
    }
  }

  session.data[field.name] = value;
  const nextStep = session.formStep + 1;

  if (nextStep >= form.fields.length) {
    logSubmission(from, session.form, session.data);
    const msg = form.success(session.data);
    const backTarget = PARENT[session.formParent] || session.formParent || 'welcome';
    session.mode = 'menu';
    session.node = session.formParent;
    session.form = null;
    session.formStep = 0;
    session._afterBack = backTarget;
    saveSession(from, session);
    await promptOptions(from, msg, AFTER_FORM_OPTIONS);
    return;
  }

  session.formStep = nextStep;
  saveSession(from, session);
  await promptFormField(from, session.form, nextStep);
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

  if (isRestart || !session) {
    resetSession(from);
    session = createSession(from);
    await goToNode(from, session, 'welcome');
    return;
  }

  // After-form Back / Main menu
  if (session.mode === 'menu' && (text === NAV.MAIN.id || text === '__back__' || /^back$/i.test(text))) {
    if (text === NAV.MAIN.id || /^main menu$/i.test(text)) {
      await goToNode(from, session, 'welcome');
      return;
    }
    const target = session._afterBack || PARENT[session.node] || 'welcome';
    delete session._afterBack;
    saveSession(from, session);
    await goToNode(from, session, target);
    return;
  }

  if (session.mode === 'form') {
    await handleFormReply(from, session, text);
    return;
  }

  const node = TREE[session.node] || TREE.welcome;
  let choice = resolveOption(text, node.options);

  if (choice === NAV.MAIN.id || /^main menu$/i.test(text)) {
    await goToNode(from, session, 'welcome');
    return;
  }

  // Soft match against tree node ids / titles when user types freely
  if (!TREE[choice] && !node.options?.some((o) => o.id === choice)) {
    const allOpts = Object.values(TREE).flatMap((n) => n.options || []);
    const soft = resolveOption(text, allOpts);
    if (TREE[soft]) choice = soft;
  }

  if (TREE[choice]) {
    await goToNode(from, session, choice);
    return;
  }

  await sendText(from, 'Please choose an option from the menu, or reply *menu* to start over.');
  await promptNode(from, session.node);
}

// ─── Webhook ────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else if (!mode) {
    res.status(200).send('BHC WhatsApp Customer Assistant is running.');
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
            await sendText(
              from,
              'Sorry, something went wrong. Please reply *menu* to try again.'
            ).catch(() => {});
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

app.listen(port, () => {
  console.log(`\nBHC WhatsApp chatbot listening on port ${port}`);
  console.log('Webhook: GET/POST /');
  console.log('Health:  GET /health\n');
  console.log('Config check:');
  console.log('  VERIFY_TOKEN:     ', verifyToken ? '✓ set' : '✗ MISSING');
  console.log('  WHATSAPP_TOKEN:   ', whatsappToken ? '✓ set' : '✗ MISSING');
  console.log('  PHONE_NUMBER_ID:  ', phoneNumberId ? '✓ set' : '✗ MISSING');
  console.log('  DATA_DIR:         ', dataDir);
});
