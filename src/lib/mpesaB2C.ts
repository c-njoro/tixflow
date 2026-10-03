// src/lib/mpesaB2C.ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mpesaService from './mpesaService';
import { mpesaCallbackUrl } from './mpesaCallbacks';

export function getBaseURL() {
  return process.env.MPESA_ENVIRONMENT === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

// Encrypts the B2C initiator's password with Safaricom's public certificate.
// Sandbox and production use DIFFERENT certificates — mixing them up is a
// well-documented cause of "Invalid initiator information" errors.
// Download and place at:
//   certs/sandbox_cert.cer    — https://developer.safaricom.co.ke/sites/default/files/cert/cert_sandbox/cert.cer
//   certs/production_cert.cer — https://developer.safaricom.co.ke/sites/default/files/cert/cert_prod/cert.cer
export function generateSecurityCredential(initiatorPassword: string): string {
  const certFileName =
    process.env.MPESA_ENVIRONMENT === 'production' ? 'production_cert.cer' : 'sandbox_cert.cer';
  const certPath = path.join(process.cwd(), 'certs', certFileName);
  const cert = fs.readFileSync(certPath, 'utf8');

  const encrypted = crypto.publicEncrypt(
    { key: cert, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(initiatorPassword)
  );

  return encrypted.toString('base64');
}

interface B2CResult {
  success: boolean;
  conversationId?: string;
  originatorConversationId?: string;
  error?: string;
  // true when we can't tell whether Safaricom received the request (e.g. a
  // network timeout after sending) — the money MAY have moved, so the
  // payout must not be marked failed and its balance released.
  uncertain?: boolean;
}

export async function initiateB2CPayment(options: {
  phoneNumber: string;
  amount: number;
  remarks: string;
  occasion?: string;
}): Promise<B2CResult> {
  const initiatorName = process.env.MPESA_B2C_INITIATOR_NAME;
  const initiatorPassword = process.env.MPESA_B2C_INITIATOR_PASSWORD;
  const shortcode = process.env.MPESA_B2C_SHORTCODE || process.env.MPESA_SHORTCODE;
  // Optional overrides (e.g. a tunnel URL in development); default to this app.
  const resultUrl = mpesaCallbackUrl(process.env.MPESA_B2C_RESULT_URL || '/api/mpesa/b2c-result');
  const timeoutUrl = mpesaCallbackUrl(process.env.MPESA_B2C_TIMEOUT_URL || '/api/mpesa/b2c-result');

  if (!initiatorName || !initiatorPassword || !shortcode) {
    return { success: false, error: 'Payouts are not fully configured on the server yet.' };
  }

  // Errors before the request leaves (bad cert, auth failure) mean nothing
  // was sent; errors after it leaves mean we simply don't know.
  let requestSent = false;
  try {
    const accessToken = await mpesaService.getAccessToken();
    const securityCredential = generateSecurityCredential(initiatorPassword);
    const formattedPhone = mpesaService.formatPhoneNumber(options.phoneNumber);

    requestSent = true;
    const response = await fetch(`${getBaseURL()}/mpesa/b2c/v1/paymentrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        InitiatorName: initiatorName,
        SecurityCredential: securityCredential,
        CommandID: 'BusinessPayment',
        Amount: Math.round(options.amount),
        PartyA: shortcode,
        PartyB: formattedPhone,
        Remarks: options.remarks.slice(0, 100),
        QueueTimeOutURL: timeoutUrl,
        ResultURL: resultUrl,
        Occasion: (options.occasion || '').slice(0, 100),
      }),
    });

    const data = await response.json();

    if (data.ResponseCode !== '0') {
      return {
        success: false,
        error: data.errorMessage || data.ResponseDescription || 'Payout request was rejected.',
      };
    }

    return {
      success: true,
      conversationId: data.ConversationID,
      originatorConversationId: data.OriginatorConversationID,
    };
  } catch (error) {
    console.error('CRITICAL_B2C_INITIATE_ERROR:', error);
    if (!requestSent) {
      return { success: false, error: 'Failed to prepare the payout request — check server M-Pesa configuration.' };
    }
    return {
      success: false,
      uncertain: true,
      error: 'No clear answer from M-Pesa — check the M-Pesa portal before retrying.',
    };
  }
}

interface ParsedB2CResult {
  resultCode: number;
  resultDesc: string;
  conversationId?: string;
  originatorConversationId?: string;
  transactionId?: string;
  transactionReceipt?: string;
}

export function parseB2CResult(callbackData: any): ParsedB2CResult {
  const result = callbackData?.Result;
  if (!result) throw new Error('Invalid B2C result payload.');

  const parsed: ParsedB2CResult = {
    resultCode: result.ResultCode,
    resultDesc: result.ResultDesc,
    conversationId: result.ConversationID,
    originatorConversationId: result.OriginatorConversationID,
    transactionId: result.TransactionID,
  };

  if (result.ResultCode === 0) {
    const items = result.ResultParameters?.ResultParameter || [];
    parsed.transactionReceipt = items.find((i: any) => i.Key === 'TransactionReceipt')?.Value;
  }

  return parsed;
}