// src/lib/whatsappCloud.ts
//
// Meta's official WhatsApp Cloud API. Stateless HTTP, so — unlike the
// Baileys connection — it works on any host, serverless included.
// Configure with:
//   WHATSAPP_CLOUD_TOKEN        permanent System User access token
//   WHATSAPP_PHONE_NUMBER_ID    the sending number's id (WhatsApp Manager → API setup)
//   WHATSAPP_GRAPH_VERSION      optional, default v23.0
//   WHATSAPP_TEMPLATE_LANGUAGE  optional, default "en" — must match the language the templates were approved in
import mpesaService from './mpesaService';
import type { WhatsappMessage } from './whatsappTemplates';

export interface SendResult {
  success: boolean;
  error?: string;
}

const graphVersion = () => process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';

export function cloudConfig() {
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return token && phoneNumberId ? { token, phoneNumberId } : null;
}

export async function sendCloudTemplate(phone: string, message: WhatsappMessage): Promise<SendResult> {
  const config = cloudConfig();
  if (!config) return { success: false, error: 'WhatsApp Cloud API is not configured.' };

  const components: Record<string, unknown>[] = [];
  if (message.imageUrl) {
    components.push({ type: 'header', parameters: [{ type: 'image', image: { link: message.imageUrl } }] });
  }
  if (message.params.length > 0) {
    components.push({ type: 'body', parameters: message.params.map((text) => ({ type: 'text', text })) });
  }

  try {
    const res = await fetch(`https://graph.facebook.com/${graphVersion()}/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        // 2547XXXXXXXX — Kenyan numbers in international format, no "+".
        to: mpesaService.formatPhoneNumber(phone),
        type: 'template',
        template: {
          name: message.template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en' },
          components,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { success: true };

    const body = await res.json().catch(() => ({}));
    const error = body?.error?.error_user_msg || body?.error?.message || `WhatsApp Cloud API error ${res.status}`;
    console.error('CRITICAL_WHATSAPP_CLOUD_SEND_ERROR:', message.template, res.status, JSON.stringify(body?.error ?? body));
    return { success: false, error };
  } catch (error) {
    console.error('CRITICAL_WHATSAPP_CLOUD_SEND_ERROR:', message.template, error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to reach WhatsApp Cloud API.' };
  }
}
