/**
 * Botswana Housing Corporation — Customer Assistant
 * Menu-driven chatbot following the BHC support flow.
 */

const chatEl = document.getElementById("chat");
const quickEl = document.getElementById("quickReplies");
const inputForm = document.getElementById("inputForm");
const userInput = document.getElementById("userInput");
const restartBtn = document.getElementById("restartBtn");

const NAV = {
  MAIN: { id: "__main__", label: "← Main menu" },
  BACK: { id: "__back__", label: "← Back" },
};

/** Conversation tree — mirrors the BHC flowchart */
const TREE = {
  welcome: {
    message: () =>
      `<span class="lead">Welcome to Botswana Housing Corporation</span>How can we help you today?`,
    options: [
      { id: "buy", label: "Buy a House" },
      { id: "rent", label: "Rent a Property" },
      { id: "maintenance", label: "Maintenance" },
      { id: "payments", label: "Payments" },
      { id: "office", label: "Office Information" },
      { id: "care", label: "Speak to Customer Care" },
    ],
  },

  // ── Buy a House ──────────────────────────────────────────
  buy: {
    message: () =>
      `You're exploring <strong>home ownership</strong> with BHC.\n\nWhat would you like to know?`,
    options: [
      { id: "buy_view", label: "View available properties" },
      { id: "buy_pricing", label: "Pricing" },
      { id: "buy_eligibility", label: "Eligibility" },
      { id: "buy_docs", label: "Required documents" },
      { id: "buy_viewing", label: "Book viewing" },
      NAV.MAIN,
    ],
  },
  buy_view: {
    message: () =>
      `<strong>Available properties</strong>\n\nCurrent BHC sale listings include:\n\n• <strong>Phakalane Estate</strong> — 3-bed units from P685,000\n• <strong>Block 8, Gaborone</strong> — 2-bed flats from P420,000\n• <strong>Francistown Extension 14</strong> — 3-bed houses from P510,000\n• <strong>Palapye</strong> — starter homes from P295,000\n\nListings update regularly. Visit <strong>bhc.bw</strong> or a branch for the full catalogue.`,
    options: [
      { id: "buy_viewing", label: "Book a viewing", primary: true },
      { id: "buy_pricing", label: "See pricing" },
      { id: "buy", label: NAV.BACK.label },
      NAV.MAIN,
    ],
  },
  buy_pricing: {
    message: () =>
      `<strong>Pricing overview</strong>\n\nBHC sale prices vary by location, size, and finishing:\n\n• Starter / 1–2 bed — from <strong>P250,000</strong>\n• Family / 3-bed — from <strong>P450,000</strong>\n• Premium estates — from <strong>P650,000+</strong>\n\nA 10% deposit is typically required. Payment plans and bank financing options are available for eligible buyers.`,
    options: [
      { id: "buy_eligibility", label: "Check eligibility" },
      { id: "buy", label: NAV.BACK.label },
      NAV.MAIN,
    ],
  },
  buy_eligibility: {
    message: () =>
      `<strong>Buyer eligibility</strong>\n\nTo purchase a BHC house you generally need to:\n\n• Be a Botswana citizen or permanent resident\n• Be 18 years or older\n• Provide proof of income / financing\n• Not already own a BHC-subsidised property (where subsidy rules apply)\n\nFinal eligibility is confirmed during application review.`,
    options: [
      { id: "buy_docs", label: "Required documents" },
      { id: "buy", label: NAV.BACK.label },
      NAV.MAIN,
    ],
  },
  buy_docs: {
    message: () =>
      `<strong>Required documents</strong>\n\nPlease prepare:\n\n1. Certified copy of Omang / passport\n2. Proof of income (payslips or bank statements)\n3. Marriage certificate / affidavit (if applicable)\n4. Proof of residence\n5. Bank pre-approval letter (recommended)\n\nBring originals and certified copies to your nearest BHC office.`,
    options: [
      { id: "buy_viewing", label: "Book a viewing", primary: true },
      { id: "buy", label: NAV.BACK.label },
      NAV.MAIN,
    ],
  },
  buy_viewing: {
    message: () =>
      `<strong>Book a property viewing</strong>\n\nShare your details and preferred property. A BHC officer will confirm your appointment.`,
    form: "viewing",
    options: [{ id: "buy", label: NAV.BACK.label }, NAV.MAIN],
  },

  // ── Rent a Property ──────────────────────────────────────
  rent: {
    message: () =>
      `Looking to <strong>rent</strong> with BHC?\n\nChoose an option below.`,
    options: [
      { id: "rent_available", label: "Available rentals" },
      { id: "rent_rates", label: "Rental rates" },
      { id: "rent_apply", label: "Apply" },
      { id: "rent_lease", label: "Lease enquiries" },
      NAV.MAIN,
    ],
  },
  rent_available: {
    message: () =>
      `<strong>Available rentals</strong>\n\nUnits currently open for application:\n\n• <strong>Gaborone — Broadhurst</strong> — 2-bed flat\n• <strong>Gaborone — Extension 9</strong> — 3-bed house\n• <strong>Lobatse</strong> — 2-bed unit\n• <strong>Maun</strong> — 3-bed house\n• <strong>Selebi-Phikwe</strong> — 1-bed flat\n\nAvailability changes quickly — apply early or visit a branch.`,
    options: [
      { id: "rent_apply", label: "Apply now", primary: true },
      { id: "rent_rates", label: "Rental rates" },
      { id: "rent", label: NAV.BACK.label },
      NAV.MAIN,
    ],
  },
  rent_rates: {
    message: () =>
      `<strong>Rental rates</strong>\n\nIndicative monthly rents:\n\n• Bedsitter / 1-bed — <strong>P1,200 – P2,500</strong>\n• 2-bed — <strong>P2,500 – P4,500</strong>\n• 3-bed — <strong>P4,000 – P7,500</strong>\n\nRates depend on location, condition, and unit type. A security deposit (usually one month’s rent) is required.`,
    options: [
      { id: "rent_apply", label: "Start application" },
      { id: "rent", label: NAV.BACK.label },
      NAV.MAIN,
    ],
  },
  rent_apply: {
    message: () =>
      `<strong>Rental application</strong>\n\nComplete the form and we’ll log your application. You’ll receive a reference number for follow-up.`,
    form: "rent_apply",
    options: [{ id: "rent", label: NAV.BACK.label }, NAV.MAIN],
  },
  rent_lease: {
    message: () =>
      `<strong>Lease enquiries</strong>\n\nStandard BHC residential leases:\n\n• Initial term: <strong>12 months</strong>\n• Renewable subject to good standing\n• Notice period: <strong>1 calendar month</strong>\n• Subletting is not permitted without written approval\n• Rent is due on or before the 1st of each month\n\nFor a specific lease query, speak to Customer Care or visit your branch.`,
    options: [
      { id: "care", label: "Speak to Customer Care", primary: true },
      { id: "rent", label: NAV.BACK.label },
      NAV.MAIN,
    ],
  },

  // ── Maintenance ──────────────────────────────────────────
  maintenance: {
    message: () =>
      `<strong>Maintenance support</strong>\n\nHow can we assist with your property?`,
    options: [
      { id: "maint_report", label: "Report issue" },
      { id: "maint_emergency", label: "Emergency repair" },
      { id: "maint_track", label: "Track maintenance request" },
      { id: "maint_faq", label: "Maintenance FAQs" },
      NAV.MAIN,
    ],
  },
  maint_report: {
    message: () =>
      `<strong>Report a maintenance issue</strong>\n\nDescribe the problem and your unit details. Non-urgent requests are usually acknowledged within 1–2 working days.`,
    form: "maint_report",
    options: [{ id: "maintenance", label: NAV.BACK.label }, NAV.MAIN],
  },
  maint_emergency: {
    message: () =>
      `<strong>Emergency repair</strong>\n\nFor urgent issues that threaten safety or cause major damage (burst pipe, electrical hazard, no access, structural risk):\n\n• Call the emergency line: <strong>0800 600 700</strong> (toll-free demo)\n• Or submit below and mark as emergency\n\nPlease only use this for true emergencies.`,
    form: "maint_emergency",
    options: [{ id: "maintenance", label: NAV.BACK.label }, NAV.MAIN],
  },
  maint_track: {
    message: () =>
      `<strong>Track a maintenance request</strong>\n\nEnter your request reference number (e.g. MNT-2026-00482).`,
    form: "maint_track",
    options: [{ id: "maintenance", label: NAV.BACK.label }, NAV.MAIN],
  },
  maint_faq: {
    message: () =>
      `<strong>Maintenance FAQs</strong>\n\n<strong>Who is responsible for repairs?</strong>\nBHC handles structural and common-area repairs. Tenants handle day-to-day care and damage caused by misuse.\n\n<strong>How long do repairs take?</strong>\nEmergencies: within 24 hours. Routine: 5–14 working days depending on parts and priority.\n\n<strong>Can I hire my own contractor?</strong>\nOnly with prior written approval from BHC.\n\n<strong>Will I be charged?</strong>\nTenant-caused damage may be billed to your account.`,
    options: [
      { id: "maint_report", label: "Report an issue", primary: true },
      { id: "maintenance", label: NAV.BACK.label },
      NAV.MAIN,
    ],
  },

  // ── Payments ─────────────────────────────────────────────
  payments: {
    message: () =>
      `<strong>Payments</strong>\n\nManage rent, balances, and confirmations.`,
    options: [
      { id: "pay_balance", label: "Rental balance" },
      { id: "pay_methods", label: "Payment methods" },
      { id: "pay_statements", label: "Statements" },
      { id: "pay_confirm", label: "Payment confirmation" },
      NAV.MAIN,
    ],
  },
  pay_balance: {
    message: () =>
      `<strong>Rental balance enquiry</strong>\n\nEnter your tenant / account number to look up your balance. (Demo returns a sample balance.)`,
    form: "pay_balance",
    options: [{ id: "payments", label: NAV.BACK.label }, NAV.MAIN],
  },
  pay_methods: {
    message: () =>
      `<strong>Payment methods</strong>\n\nYou can pay BHC via:\n\n• <strong>Bank deposit / EFT</strong> — use your account number as reference\n• <strong>Orange Money / MyZaka / Smega</strong>\n• <strong>Point of sale</strong> at BHC cashier desks\n• <strong>Debit order</strong> (arrange at your branch)\n\nAlways keep your proof of payment.`,
    options: [
      { id: "pay_confirm", label: "Submit payment confirmation" },
      { id: "payments", label: NAV.BACK.label },
      NAV.MAIN,
    ],
  },
  pay_statements: {
    message: () =>
      `<strong>Account statements</strong>\n\nRequest a statement for your rental or purchase account. Statements are emailed within 1 working day (demo).`,
    form: "pay_statements",
    options: [{ id: "payments", label: NAV.BACK.label }, NAV.MAIN],
  },
  pay_confirm: {
    message: () =>
      `<strong>Payment confirmation</strong>\n\nAlready paid? Upload the details so we can allocate your payment.`,
    form: "pay_confirm",
    options: [{ id: "payments", label: NAV.BACK.label }, NAV.MAIN],
  },

  // ── Office Information ───────────────────────────────────
  office: {
    message: () =>
      `<strong>Office information</strong>\n\nFind a branch, hours, contacts, or directions.`,
    options: [
      { id: "office_branches", label: "Branches" },
      { id: "office_hours", label: "Working hours" },
      { id: "office_contacts", label: "Contacts" },
      { id: "office_directions", label: "Directions" },
      NAV.MAIN,
    ],
  },
  office_branches: {
    message: () =>
      `<strong>BHC branches</strong>\n\n• <strong>Head Office — Gaborone</strong>\n  Plot 5129, Corner Machel Drive &amp; Station Road\n• <strong>Francistown</strong> — Blue Jacket Street\n• <strong>Maun</strong> — Tsheko Tsheko Road\n• <strong>Palapye</strong> — Central Business District\n• <strong>Lobatse</strong> — Woodhall Industrial\n• <strong>Selebi-Phikwe</strong> — The Mall\n\nVisit any branch for applications, payments, and enquiries.`,
    options: [
      { id: "office_directions", label: "Get directions" },
      { id: "office_hours", label: "Working hours" },
      { id: "office", label: NAV.BACK.label },
      NAV.MAIN,
    ],
  },
  office_hours: {
    message: () =>
      `<strong>Working hours</strong>\n\n• Monday – Friday: <strong>07:30 – 16:30</strong>\n• Lunch: 12:45 – 14:00 (cashier may pause)\n• Saturday, Sunday &amp; public holidays: <strong>Closed</strong>\n\nEmergency maintenance remains available after hours via the emergency line.`,
    options: [
      { id: "office_contacts", label: "Contacts" },
      { id: "office", label: NAV.BACK.label },
      NAV.MAIN,
    ],
  },
  office_contacts: {
    message: () =>
      `<strong>Contacts</strong>\n\n• Switchboard: <strong>+267 360 5100</strong>\n• Customer Care: <strong>+267 360 5200</strong>\n• Email: <strong>customercare@bhc.bw</strong>\n• Emergency (demo): <strong>0800 600 700</strong>\n• Website: <strong>www.bhc.bw</strong>`,
    options: [
      { id: "care", label: "Speak to Customer Care", primary: true },
      { id: "office", label: NAV.BACK.label },
      NAV.MAIN,
    ],
  },
  office_directions: {
    message: () =>
      `<strong>Directions</strong>\n\n<strong>Gaborone Head Office</strong>\nPlot 5129, corner of Machel Drive and Station Road — near the CBD / railway area.\n\n<strong>Francistown</strong>\nBlue Jacket Street, central business district.\n\nFor GPS / map links, search “Botswana Housing Corporation” on Google Maps, or ask the attendant at reception when you arrive.`,
    options: [
      { id: "office_branches", label: "All branches" },
      { id: "office", label: NAV.BACK.label },
      NAV.MAIN,
    ],
  },

  // ── Customer Care ────────────────────────────────────────
  care: {
    message: () =>
      `<strong>Customer Care</strong>\n\nWe’re here to help. How would you like to connect?`,
    options: [
      { id: "care_live", label: "Live Agent" },
      { id: "care_callback", label: "Call Back" },
      { id: "care_ticket", label: "Create Support Ticket" },
      NAV.MAIN,
    ],
  },
  care_live: {
    message: () =>
      `<strong>Live Agent</strong>\n\nConnecting you to a Customer Care agent…\n\n<em>Demo mode:</em> agents are available Mon–Fri, 07:30–16:30. Outside these hours, please request a call back or create a support ticket.\n\nEstimated wait: <strong>~3 minutes</strong> during business hours.`,
    options: [
      { id: "care_callback", label: "Request call back instead" },
      { id: "care_ticket", label: "Create support ticket" },
      { id: "care", label: NAV.BACK.label },
      NAV.MAIN,
    ],
  },
  care_callback: {
    message: () =>
      `<strong>Request a call back</strong>\n\nLeave your number and preferred time. An officer will return your call.`,
    form: "callback",
    options: [{ id: "care", label: NAV.BACK.label }, NAV.MAIN],
  },
  care_ticket: {
    message: () =>
      `<strong>Create a support ticket</strong>\n\nDescribe your issue and we’ll open a ticket for follow-up.`,
    form: "ticket",
    options: [{ id: "care", label: NAV.BACK.label }, NAV.MAIN],
  },
};

const FORMS = {
  viewing: {
    fields: [
      { name: "name", label: "Full name", type: "text", required: true },
      { name: "phone", label: "Phone number", type: "tel", required: true },
      { name: "property", label: "Property / area of interest", type: "text", required: true },
      {
        name: "date",
        label: "Preferred date",
        type: "date",
        required: true,
      },
    ],
    submitLabel: "Book viewing",
    success: (d) =>
      `Thank you, <strong>${escapeHtml(d.name)}</strong>. Your viewing request for <strong>${escapeHtml(d.property)}</strong> on <strong>${escapeHtml(d.date)}</strong> has been logged.\n\nReference: <strong>VW-${ref()}</strong>\n\nWe’ll confirm on <strong>${escapeHtml(d.phone)}</strong>.`,
  },
  rent_apply: {
    fields: [
      { name: "name", label: "Full name", type: "text", required: true },
      { name: "phone", label: "Phone number", type: "tel", required: true },
      { name: "omang", label: "Omang / ID number", type: "text", required: true },
      {
        name: "location",
        label: "Preferred location",
        type: "select",
        options: ["Gaborone", "Francistown", "Maun", "Palapye", "Lobatse", "Selebi-Phikwe", "Other"],
        required: true,
      },
      {
        name: "beds",
        label: "Bedrooms needed",
        type: "select",
        options: ["1", "2", "3", "4+"],
        required: true,
      },
    ],
    submitLabel: "Submit application",
    success: (d) =>
      `Application received for <strong>${escapeHtml(d.name)}</strong>.\n\nLocation: <strong>${escapeHtml(d.location)}</strong> · ${escapeHtml(d.beds)} bedroom(s)\nReference: <strong>RA-${ref()}</strong>\n\nA housing officer will contact you on <strong>${escapeHtml(d.phone)}</strong>.`,
  },
  maint_report: {
    fields: [
      { name: "account", label: "Tenant / unit number", type: "text", required: true },
      { name: "phone", label: "Phone number", type: "tel", required: true },
      {
        name: "category",
        label: "Issue category",
        type: "select",
        options: ["Plumbing", "Electrical", "Doors / locks", "Roof / leaks", "Painting", "Other"],
        required: true,
      },
      { name: "details", label: "Describe the issue", type: "textarea", required: true },
    ],
    submitLabel: "Submit request",
    success: (d) =>
      `Maintenance request logged.\n\nCategory: <strong>${escapeHtml(d.category)}</strong>\nUnit: <strong>${escapeHtml(d.account)}</strong>\nReference: <strong>MNT-${ref()}</strong>\n\nWe’ll update you on <strong>${escapeHtml(d.phone)}</strong>.`,
  },
  maint_emergency: {
    fields: [
      { name: "account", label: "Tenant / unit number", type: "text", required: true },
      { name: "phone", label: "Phone number", type: "tel", required: true },
      { name: "details", label: "Describe the emergency", type: "textarea", required: true },
    ],
    submitLabel: "Report emergency",
    success: (d) =>
      `<strong>Emergency request received</strong>\n\nUnit: <strong>${escapeHtml(d.account)}</strong>\nReference: <strong>EMG-${ref()}</strong>\n\nA technician will be dispatched. Keep your phone (<strong>${escapeHtml(d.phone)}</strong>) available.\n\nIf life or property is in immediate danger, also call <strong>999 / 911</strong>.`,
  },
  maint_track: {
    fields: [
      { name: "ref", label: "Request reference", type: "text", required: true, placeholder: "MNT-2026-00482" },
    ],
    submitLabel: "Track request",
    success: (d) => {
      const statuses = ["Received", "Assigned to technician", "Parts ordered", "In progress", "Completed"];
      const status = statuses[Math.abs(hash(d.ref)) % statuses.length];
      return `Reference <strong>${escapeHtml(d.ref)}</strong>\n\nStatus: <strong>${status}</strong>\nLast update: today\n\nFor more detail, call Customer Care with this reference.`;
    },
  },
  pay_balance: {
    fields: [
      { name: "account", label: "Tenant / account number", type: "text", required: true },
    ],
    submitLabel: "Check balance",
    success: (d) => {
      const bal = ((Math.abs(hash(d.account)) % 8500) + 350).toLocaleString("en-BW");
      return `Account <strong>${escapeHtml(d.account)}</strong>\n\nOutstanding balance: <strong>P${bal}</strong>\nDue date: 1st of next month\n\n<em>Demo figures only — confirm at a branch or on your statement.</em>`;
    },
  },
  pay_statements: {
    fields: [
      { name: "account", label: "Tenant / account number", type: "text", required: true },
      { name: "email", label: "Email address", type: "email", required: true },
    ],
    submitLabel: "Request statement",
    success: (d) =>
      `Statement request logged for account <strong>${escapeHtml(d.account)}</strong>.\n\nIt will be sent to <strong>${escapeHtml(d.email)}</strong>.\nReference: <strong>ST-${ref()}</strong>`,
  },
  pay_confirm: {
    fields: [
      { name: "account", label: "Tenant / account number", type: "text", required: true },
      { name: "amount", label: "Amount paid (P)", type: "text", required: true },
      { name: "date", label: "Payment date", type: "date", required: true },
      { name: "ref", label: "Bank / mobile money reference", type: "text", required: true },
    ],
    submitLabel: "Submit confirmation",
    success: (d) =>
      `Payment confirmation received.\n\nAccount: <strong>${escapeHtml(d.account)}</strong>\nAmount: <strong>P${escapeHtml(d.amount)}</strong>\nYour ref: <strong>${escapeHtml(d.ref)}</strong>\nBHC ref: <strong>PC-${ref()}</strong>\n\nAllocation usually completes within 1–2 working days.`,
  },
  callback: {
    fields: [
      { name: "name", label: "Full name", type: "text", required: true },
      { name: "phone", label: "Phone number", type: "tel", required: true },
      {
        name: "time",
        label: "Preferred call time",
        type: "select",
        options: ["Morning (08:00–12:00)", "Afternoon (14:00–16:30)", "Anytime during office hours"],
        required: true,
      },
      { name: "reason", label: "Reason for call (optional)", type: "textarea", required: false },
    ],
    submitLabel: "Request call back",
    success: (d) =>
      `Call-back scheduled for <strong>${escapeHtml(d.name)}</strong>.\n\nWe’ll call <strong>${escapeHtml(d.phone)}</strong> — preferred: <strong>${escapeHtml(d.time)}</strong>\nReference: <strong>CB-${ref()}</strong>`,
  },
  ticket: {
    fields: [
      { name: "name", label: "Full name", type: "text", required: true },
      { name: "phone", label: "Phone number", type: "tel", required: true },
      { name: "email", label: "Email (optional)", type: "email", required: false },
      {
        name: "topic",
        label: "Topic",
        type: "select",
        options: ["Buying", "Renting", "Maintenance", "Payments", "Lease", "Other"],
        required: true,
      },
      { name: "details", label: "Describe your issue", type: "textarea", required: true },
    ],
    submitLabel: "Create ticket",
    success: (d) =>
      `Support ticket created.\n\nTopic: <strong>${escapeHtml(d.topic)}</strong>\nTicket: <strong>TKT-${ref()}</strong>\n\nWe’ll follow up with <strong>${escapeHtml(d.name)}</strong> on <strong>${escapeHtml(d.phone)}</strong>.`,
  },
};

let history = [];
let busy = false;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ref() {
  return String(Date.now()).slice(-8);
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

function scrollChat() {
  requestAnimationFrame(() => {
    chatEl.scrollTop = chatEl.scrollHeight;
  });
}

function addBubble(role, html) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = html;
  wrap.appendChild(bubble);
  chatEl.appendChild(wrap);
  scrollChat();
  return wrap;
}

function showTyping() {
  const el = document.createElement("div");
  el.className = "typing";
  el.id = "typing";
  el.innerHTML = "<span></span><span></span><span></span>";
  el.setAttribute("aria-label", "Assistant is typing");
  chatEl.appendChild(el);
  scrollChat();
}

function hideTyping() {
  document.getElementById("typing")?.remove();
}

function clearQuick() {
  quickEl.innerHTML = "";
}

function renderOptions(options) {
  clearQuick();
  inputForm.hidden = true;

  (options || []).forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    if (opt.id === NAV.MAIN.id || opt.label?.startsWith("←")) btn.classList.add("nav");
    if (opt.primary) btn.classList.add("primary");
    btn.textContent = opt.label;
    btn.addEventListener("click", () => onSelect(opt.id, opt.label));
    quickEl.appendChild(btn);
  });
}

function renderForm(formKey, nodeId) {
  const def = FORMS[formKey];
  if (!def) return;

  const lastBot = chatEl.querySelector(".msg.bot:last-of-type .bubble");
  if (!lastBot) return;

  const card = document.createElement("form");
  card.className = "form-card";
  card.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(card).entries());
    card.remove();
    clearQuick();
    addBubble("user", `Submitted ${def.submitLabel.toLowerCase()}`);
    respondWithHtml(def.success(data), [
      { id: parentOf(nodeId) || "welcome", label: NAV.BACK.label },
      NAV.MAIN,
    ]);
  });

  def.fields.forEach((f) => {
    const label = document.createElement("label");
    label.textContent = f.label;

    let input;
    if (f.type === "textarea") {
      input = document.createElement("textarea");
    } else if (f.type === "select") {
      input = document.createElement("select");
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select…";
      placeholder.disabled = true;
      placeholder.selected = true;
      input.appendChild(placeholder);
      f.options.forEach((o) => {
        const opt = document.createElement("option");
        opt.value = o;
        opt.textContent = o;
        input.appendChild(opt);
      });
    } else {
      input = document.createElement("input");
      input.type = f.type;
    }

    input.name = f.name;
    if (f.required) input.required = true;
    if (f.placeholder) input.placeholder = f.placeholder;
    label.appendChild(input);
    card.appendChild(label);
  });

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = def.submitLabel;
  card.appendChild(submit);
  lastBot.appendChild(card);
  scrollChat();
}

function parentOf(nodeId) {
  const map = {
    buy_view: "buy",
    buy_pricing: "buy",
    buy_eligibility: "buy",
    buy_docs: "buy",
    buy_viewing: "buy",
    rent_available: "rent",
    rent_rates: "rent",
    rent_apply: "rent",
    rent_lease: "rent",
    maint_report: "maintenance",
    maint_emergency: "maintenance",
    maint_track: "maintenance",
    maint_faq: "maintenance",
    pay_balance: "payments",
    pay_methods: "payments",
    pay_statements: "payments",
    pay_confirm: "payments",
    office_branches: "office",
    office_hours: "office",
    office_contacts: "office",
    office_directions: "office",
    care_live: "care",
    care_callback: "care",
    care_ticket: "care",
  };
  return map[nodeId];
}

async function respondWithHtml(html, options, formKey, nodeId) {
  busy = true;
  clearQuick();
  showTyping();
  await wait(450 + Math.random() * 350);
  hideTyping();
  addBubble("bot", html);
  if (formKey) renderForm(formKey, nodeId);
  renderOptions(options);
  busy = false;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function goTo(nodeId, { silentUser } = {}) {
  if (nodeId === NAV.MAIN.id) nodeId = "welcome";

  const node = TREE[nodeId];
  if (!node) return;

  history.push(nodeId);
  await respondWithHtml(node.message(), node.options, node.form, nodeId);
}

async function onSelect(id, label) {
  if (busy) return;

  if (id === NAV.MAIN.id) {
    addBubble("user", "Main menu");
    await goTo("welcome");
    return;
  }

  addBubble("user", label.replace(/^←\s*/, "") || label);
  await goTo(id);
}

async function start() {
  chatEl.innerHTML = "";
  history = [];
  clearQuick();
  inputForm.hidden = true;
  await goTo("welcome");
}

restartBtn.addEventListener("click", () => {
  if (busy) return;
  start();
});

inputForm.addEventListener("submit", (e) => {
  e.preventDefault();
});

start();
