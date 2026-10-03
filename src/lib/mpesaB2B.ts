// src/lib/mpesaB2B.ts
//
// Sends a tenant's "bank" payout via Daraja's B2B Business Pay Bill API —
// this is how a paybill (ours) pays into a bank account that itself has an
// M-Pesa paybill/business number for receiving deposits (this is exactly
// how "Pay via M-Pesa" deposits into a bank account normally work: the
// bank's own paybill number, with the customer's bank account number as the
// account reference). It reuses the same B2C initiator credentials and
// certificate, since Daraja's B2B Payment Request API is authenticated the
// same way (Initiator + SecurityCredential).
import mpesaService from './mpesaService';
import { generateSecurityCredential, getBaseURL } from './mpesaB2C';
import { mpesaCallbackUrl } from './mpesaCallbacks';

interface B2BResult {
  success: boolean;
  conversationId?: string;
  originatorConversationId?: string;
  error?: string;
  // true when we can't tell whether Safaricom received the request (e.g. a
  // network timeout after sending) — the money MAY have moved, so the
  // payout must not be marked failed and its balance released.
  uncertain?: boolean;
}

export async function initiateB2BPayment(options: {
  paybillNumber: string; // the receiving bank's paybill / business number
  accountNumber: string; // tenant's account number at that bank — sent as AccountReference
  amount: number;
  remarks: string;
}): Promise<B2BResult> {
  const initiatorName = process.env.MPESA_B2C_INITIATOR_NAME;
  const initiatorPassword = process.env.MPESA_B2C_INITIATOR_PASSWORD;
  const shortcode = process.env.MPESA_B2B_SHORTCODE || process.env.MPESA_B2C_SHORTCODE || process.env.MPESA_SHORTCODE;
  // Optional overrides (e.g. a tunnel URL in development); default to this app.
  const resultUrl = mpesaCallbackUrl(process.env.MPESA_B2B_RESULT_URL || '/api/mpesa/b2b-result');
  const timeoutUrl = mpesaCallbackUrl(process.env.MPESA_B2B_TIMEOUT_URL || '/api/mpesa/b2b-result');

  if (!initiatorName || !initiatorPassword || !shortcode) {
    return { success: false, error: 'Bank payouts are not fully configured on the server yet.' };
  }

  // Errors before the request leaves (bad cert, auth failure) mean nothing
  // was sent; errors after it leaves mean we simply don't know.
  let requestSent = false;
  try {
    const accessToken = await mpesaService.getAccessToken();
    const securityCredential = generateSecurityCredential(initiatorPassword);

    requestSent = true;
    const response = await fetch(`${getBaseURL()}/mpesa/b2b/v1/paymentrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        Initiator: initiatorName,
        SecurityCredential: securityCredential,
        CommandID: 'BusinessPayBill',
        SenderIdentifierType: '4',
        RecieverIdentifierType: '4',
        Amount: Math.round(options.amount),
        PartyA: shortcode,
        PartyB: options.paybillNumber,
        AccountReference: options.accountNumber.slice(0, 20),
        Remarks: options.remarks.slice(0, 100),
        QueueTimeOutURL: timeoutUrl,
        ResultURL: resultUrl,
      }),
    });

    const data = await response.json();

    if (data.ResponseCode !== '0') {
      return {
        success: false,
        error: data.errorMessage || data.ResponseDescription || 'Bank payout request was rejected.',
      };
    }

    return {
      success: true,
      conversationId: data.ConversationID,
      originatorConversationId: data.OriginatorConversationID,
    };
  } catch (error) {
    console.error('CRITICAL_B2B_INITIATE_ERROR:', error);
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

interface ParsedB2BResult {
  resultCode: number;
  resultDesc: string;
  conversationId?: string;
  originatorConversationId?: string;
  transactionId?: string;
  transactionReceipt?: string;
}

export function parseB2BResult(callbackData: any): ParsedB2BResult {
  const result = callbackData?.Result;
  if (!result) throw new Error('Invalid B2B result payload.');

  const parsed: ParsedB2BResult = {
    resultCode: result.ResultCode,
    resultDesc: result.ResultDesc,
    conversationId: result.ConversationID,
    originatorConversationId: result.OriginatorConversationID,
    transactionId: result.TransactionID,
  };

  if (result.ResultCode === 0) {
    const items = result.ResultParameters?.ResultParameter || [];
    parsed.transactionReceipt =
      items.find((i: any) => i.Key === 'TransactionReceipt')?.Value?.toString() ||
      result.TransactionID;
  }

  return parsed;
}
