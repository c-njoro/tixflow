// src/lib/intasend.ts
// @ts-ignore — intasend-node ships without TypeScript types
import IntaSend from 'intasend-node';

const PUBLISHABLE_KEY = process.env.INTASEND_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.INTASEND_SECRET_KEY;
const IS_TEST = process.env.INTASEND_ENVIRONMENT !== 'production';
const WEBHOOK_CHALLENGE = process.env.INTASEND_WEBHOOK_CHALLENGE;

function getClient(): any | null {
  if (!PUBLISHABLE_KEY || !SECRET_KEY) return null;
  return new IntaSend(PUBLISHABLE_KEY, SECRET_KEY, IS_TEST);
}

// Every IntaSend webhook (collection, send-money, chargeback) carries the
// "challenge" string you configure once in the IntaSend dashboard when
// registering the webhook URL — this is how we know a payload genuinely
// came from IntaSend and not someone POSTing to our endpoint directly.
export function verifyWebhookChallenge(payloadChallenge: unknown): boolean {
  if (!WEBHOOK_CHALLENGE) {
    console.error('CRITICAL_INTASEND_WEBHOOK_CHALLENGE_NOT_CONFIGURED');
    return false;
  }
  return payloadChallenge === WEBHOOK_CHALLENGE;
}

// ---------------------------------------------------------------------------
// Collection — buyer pays the platform
// ---------------------------------------------------------------------------

interface CollectionResult {
  success: boolean;
  invoiceId?: string;
  error?: string;
}

export async function initiateMpesaCollection(options: {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  amount: number;
  apiRef: string; // our own PendingOrder id — this is what the webhook echoes back
}): Promise<CollectionResult> {
  const client = getClient();
  if (!client) return { success: false, error: 'Payments are not configured on the server yet.' };

  try {
    const collection = client.collection();
    const response = await collection.mpesaStkPush({
      first_name: options.firstName,
      last_name: options.lastName,
      email: options.email,
      host: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      amount: options.amount,
      phone_number: options.phoneNumber,
      api_ref: options.apiRef,
    });

    // NOTE: verify this against a real sandbox response on first test — the
    // public docs show the request clearly but not the full response body.
    const invoiceId = response?.invoice?.invoice_id || response?.id;
    if (!invoiceId) {
      console.warn('[INTASEND] No invoice id found in collection response:', JSON.stringify(response));
    }

    return { success: true, invoiceId };
  } catch (error: any) {
    console.error('CRITICAL_INTASEND_COLLECTION_ERROR:', error?.response?.data || error);
    return {
      success: false,
      error: error?.response?.data?.detail || error?.message || 'Failed to initiate payment.',
    };
  }
}

export interface CollectionWebhookPayload {
  invoice_id: string;
  state: 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED';
  api_ref: string;
  challenge?: string;
  failed_reason?: string | null;
}

export function isCollectionEvent(payload: any): payload is CollectionWebhookPayload {
  return typeof payload?.invoice_id === 'string' && typeof payload?.state === 'string';
}

// ---------------------------------------------------------------------------
// Payouts — platform pays a tenant. Unified for M-Pesa and bank since both
// go through the same IntaSend balance and the same Send Money Events shape.
// ---------------------------------------------------------------------------

export const KENYA_BANK_CODES: { name: string; code: string }[] = [
  { name: 'KCB', code: '1' },
  { name: 'Standard Chartered Bank KE', code: '2' },
  { name: 'Barclays Bank', code: '3' },
  { name: 'NCBA', code: '7' },
  { name: 'Prime Bank', code: '10' },
  { name: 'Cooperative Bank', code: '11' },
  { name: 'National Bank', code: '12' },
  { name: 'Citibank', code: '16' },
  { name: 'Habib Bank AG Zurich', code: '17' },
  { name: 'Middle East Bank', code: '18' },
  { name: 'Bank of Africa', code: '19' },
  { name: 'Consolidated Bank', code: '23' },
  { name: 'Credit Bank Ltd', code: '25' },
  { name: 'Stanbic Bank', code: '31' },
  { name: 'ABC Bank', code: '35' },
  { name: 'Spire Bank', code: '49' },
  { name: 'Paramount Universal Bank', code: '50' },
  { name: 'Jamii Bora Bank', code: '51' },
  { name: 'Guaranty Bank', code: '53' },
  { name: 'Victoria Commercial Bank', code: '54' },
  { name: 'Guardian Bank', code: '55' },
  { name: 'I&M Bank', code: '57' },
  { name: 'Housing Finance Company Limited (HFCK)', code: '61' },
  { name: 'DTB', code: '63' },
  { name: 'Mayfair Bank Limited', code: '65' },
  { name: 'Sidian Bank', code: '66' },
  { name: 'Equity Bank', code: '68' },
  { name: 'Family Bank', code: '70' },
  { name: 'Gulf African Bank', code: '72' },
  { name: 'First Community Bank', code: '74' },
  { name: 'KWFT Bank', code: '78' },
];

interface PayoutResult {
  success: boolean;
  trackingId?: string;
  error?: string;
}

export async function initiateMpesaPayout(options: {
  phoneNumber: string;
  accountName: string;
  amount: number;
  narrative: string;
}): Promise<PayoutResult> {
  const client = getClient();
  if (!client) return { success: false, error: 'Payouts are not configured on the server yet.' };

  try {
    const payouts = client.payouts();
    const response = await payouts.mpesa({
      currency: 'KES',
      requires_approval: 'NO', // our own OTP already gates this trigger
      transactions: [
        {
          name: options.accountName,
          account: options.phoneNumber,
          amount: Math.round(options.amount),
          narrative: options.narrative.slice(0, 100),
        },
      ],
    });

    const trackingId = response?.tracking_id;
    if (!trackingId) {
      console.warn('[INTASEND] No tracking id found in M-Pesa payout response:', JSON.stringify(response));
    }

    return { success: true, trackingId };
  } catch (error: any) {
    console.error('CRITICAL_INTASEND_MPESA_PAYOUT_ERROR:', error?.response?.data || error);
    return {
      success: false,
      error: error?.response?.data?.detail || error?.message || 'Failed to initiate payout.',
    };
  }
}

export async function initiateBankPayout(options: {
  accountName: string;
  accountNumber: string;
  bankCode: string;
  amount: number;
  narrative: string;
}): Promise<PayoutResult> {
  const client = getClient();
  if (!client) return { success: false, error: 'Payouts are not configured on the server yet.' };

  try {
    const payouts = client.payouts();
    const response = await payouts.bank({
      currency: 'KES',
      requires_approval: 'NO',
      transactions: [
        {
          name: options.accountName,
          account: options.accountNumber,
          bank_code: options.bankCode,
          amount: Math.round(options.amount),
          narrative: options.narrative.slice(0, 100),
        },
      ],
    });

    const trackingId = response?.tracking_id;
    if (!trackingId) {
      console.warn('[INTASEND] No tracking id found in bank payout response:', JSON.stringify(response));
    }

    return { success: true, trackingId };
  } catch (error: any) {
    console.error('CRITICAL_INTASEND_BANK_PAYOUT_ERROR:', error?.response?.data || error);
    return {
      success: false,
      error: error?.response?.data?.detail || error?.message || 'Failed to initiate bank payout.',
    };
  }
}

export async function checkPayoutStatus(trackingId: string): Promise<any> {
  const baseUrl = IS_TEST ? 'https://sandbox.intasend.com' : 'https://payment.intasend.com';

  const response = await fetch(`${baseUrl}/api/v1/send-money/status/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tracking_id: trackingId }),
  });

  return response.json();
}

export interface SendMoneyWebhookPayload {
  tracking_id: string;
  status: string;
  challenge?: string;
  transactions: {
    transaction_id: string;
    status: string;
    status_description?: string;
    provider_reference?: string;
  }[];
}

export function isSendMoneyEvent(payload: any): payload is SendMoneyWebhookPayload {
  return typeof payload?.tracking_id === 'string' && Array.isArray(payload?.transactions);
}