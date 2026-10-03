#!/usr/bin/env node
// scripts/create-whatsapp-templates.mjs
//
// Submits every Tixflow WhatsApp template (src/lib/whatsappTemplates.json)
// to Meta for approval, so moving to the official Cloud API is one command.
//
//   node scripts/create-whatsapp-templates.mjs --dry-run   # print what would be sent
//   node scripts/create-whatsapp-templates.mjs             # submit for approval
//   node scripts/create-whatsapp-templates.mjs --status    # show approval status
//
// Reads from .env (or the environment):
//   WHATSAPP_CLOUD_TOKEN          System User token with whatsapp_business_management
//   WHATSAPP_BUSINESS_ACCOUNT_ID  WhatsApp Business Account (WABA) id
//   META_APP_ID                   your Meta app id — needed to upload the sample
//                                 QR image for the ticket template's image header
//   WHATSAPP_TEMPLATE_LANGUAGE    optional, default "en"
//   WHATSAPP_GRAPH_VERSION        optional, default v23.0
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';

const templates = JSON.parse(readFileSync(new URL('../src/lib/whatsappTemplates.json', import.meta.url), 'utf8'));
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const version = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';
const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en';
const token = process.env.WHATSAPP_CLOUD_TOKEN;
const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const appId = process.env.META_APP_ID;
const graph = (path) => `https://graph.facebook.com/${version}/${path}`;

if (!dryRun && (!token || !wabaId)) {
  console.error('Set WHATSAPP_CLOUD_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID first (or use --dry-run).');
  process.exit(1);
}

async function call(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.error_user_msg || body?.error?.message || `HTTP ${res.status}`);
  return body;
}

if (args.has('--status')) {
  const body = await call(graph(`${wabaId}/message_templates?fields=name,status,language,category&limit=100`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const ours = body.data.filter((t) => t.name in templates);
  for (const name of Object.keys(templates)) {
    const found = ours.filter((t) => t.name === name);
    console.log(name.padEnd(30), found.length ? found.map((t) => `${t.status} (${t.language})`).join(', ') : 'NOT SUBMITTED');
  }
  process.exit(0);
}

// Meta wants a sample image for an IMAGE header, uploaded via the
// Resumable Upload API, and referenced by its handle.
async function sampleImageHandle() {
  if (dryRun) return '<uploaded-sample-image-handle>';
  if (!appId) throw new Error('Set META_APP_ID to upload the sample image for templates with an IMAGE header.');
  const png = await QRCode.toBuffer('TIX-1A2B3C4D5E', { type: 'png', width: 480, margin: 2 });
  const session = await call(
    graph(`${appId}/uploads?file_name=sample-ticket.png&file_length=${png.length}&file_type=image/png&access_token=${token}`),
    { method: 'POST' }
  );
  const uploaded = await call(graph(session.id), {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, file_offset: '0' },
    body: png,
  });
  return uploaded.h;
}

let handle;
for (const [name, t] of Object.entries(templates)) {
  const components = [];
  if (t.header === 'IMAGE') {
    try {
      handle ??= await sampleImageHandle();
    } catch (error) {
      console.error(`✗ ${name}: ${error.message}`);
      continue;
    }
    components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [handle] } });
  }
  components.push({ type: 'BODY', text: t.body, example: { body_text: [t.example] } });
  const payload = { name, language, category: t.category, components };

  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    continue;
  }
  try {
    const result = await call(graph(`${wabaId}/message_templates`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(`✓ ${name}: submitted (${result.status ?? 'PENDING'})`);
  } catch (error) {
    // Re-running is safe — an existing template is just reported.
    console.error(`✗ ${name}: ${error.message}`);
  }
}
if (!dryRun) console.log('\nApproval usually takes minutes to a few hours. Check with: node scripts/create-whatsapp-templates.mjs --status');
