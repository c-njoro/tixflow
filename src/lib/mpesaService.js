const axios = require('axios');

// Daraja OAuth tokens live for 3600s. Re-fetching one on every call adds a
// round trip to each payment and payout — cache it and refresh a little
// before it expires.
const TOKEN_REFRESH_MARGIN_MS = 60_000;

class MpesaService {
  constructor() {
    this.consumerKey = process.env.MPESA_CONSUMER_KEY;
    this.consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    this.passkey = process.env.MPESA_PASSKEY;
    this.shortcode = process.env.MPESA_SHORTCODE;
    this.environment = process.env.MPESA_ENVIRONMENT || 'sandbox';
    this.cachedToken = null;
    this.cachedTokenExpiresAt = 0;
  }

  /**
   * Get base URL based on current environment
   */
  getBaseURL() {
    return this.environment === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';
  }

  /**
   * Generate (or reuse a cached) OAuth access token
   */
  async getAccessToken() {
    if (this.cachedToken && Date.now() < this.cachedTokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.cachedToken;
    }

    try {
      if (!this.consumerKey || !this.consumerSecret) {
        throw new Error('M‑Pesa consumer key and secret are not set');
      }

      const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
      const authURL = `${this.getBaseURL()}/oauth/v1/generate?grant_type=client_credentials`;

      const response = await axios.get(authURL, {
        headers: { Authorization: `Basic ${auth}` },
        timeout: 15_000,
      });

      const expiresInSec = Number(response.data.expires_in) || 3599;
      this.cachedToken = response.data.access_token;
      this.cachedTokenExpiresAt = Date.now() + expiresInSec * 1000;
      return this.cachedToken;
    } catch (error) {
      console.error('❌ M‑Pesa token error:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with M‑Pesa API');
    }
  }

  /**
   * Generate password for STK push
   */
  generatePassword() {
    const timestamp = this.getTimestamp();
    const password = Buffer.from(`${this.shortcode}${this.passkey}${timestamp}`).toString('base64');
    return { password, timestamp };
  }

  /**
   * Timestamp in YYYYMMDDHHmmss, in Kenyan time (EAT, UTC+3) — Daraja
   * expects local Kenyan time, and production servers usually run in UTC.
   */
  getTimestamp() {
    const eat = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return (
      `${eat.getUTCFullYear()}${pad(eat.getUTCMonth() + 1)}${pad(eat.getUTCDate())}` +
      `${pad(eat.getUTCHours())}${pad(eat.getUTCMinutes())}${pad(eat.getUTCSeconds())}`
    );
  }

  /**
   * Format phone number to 254XXXXXXXXX
   */
  formatPhoneNumber(phone) {
    let cleaned = String(phone).replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    if (!cleaned.startsWith('254')) {
      cleaned = '254' + cleaned;
    }
    return cleaned;
  }

  /**
   * Initiate STK Push
   * @param {Object} options - { phoneNumber, amount, accountReference, callbackUrl, transactionDesc }
   */
  async initiateSTKPush(options) {
    try {
      if (!this.consumerKey || !this.consumerSecret || !this.passkey || !this.shortcode) {
        throw new Error('M‑Pesa credentials are incomplete');
      }

      const { phoneNumber, amount, accountReference, callbackUrl, transactionDesc } = options;

      if (!phoneNumber || !amount || !accountReference || !callbackUrl) {
        throw new Error('Missing required parameters for STK push');
      }

      const accessToken = await this.getAccessToken();
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      const { password, timestamp } = this.generatePassword();

      const requestBody = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: formattedPhone,
        PartyB: this.shortcode,
        PhoneNumber: formattedPhone,
        CallBackURL: callbackUrl,
        AccountReference: accountReference,
        TransactionDesc: transactionDesc || `Payment for ${accountReference}`
      };

      const response = await axios.post(`${this.getBaseURL()}/mpesa/stkpush/v1/processrequest`, requestBody, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 30_000,
      });

      return {
        success: true,
        checkoutRequestId: response.data.CheckoutRequestID,
        merchantRequestId: response.data.MerchantRequestID,
        responseCode: response.data.ResponseCode,
        responseDescription: response.data.ResponseDescription,
        customerMessage: response.data.CustomerMessage
      };

    } catch (error) {
      console.error('❌ STK Push error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.errorMessage || error.message,
        errorCode: error.response?.data?.errorCode
      };
    }
  }

  /**
   * Ask Safaricom directly what happened to an STK push. This is an
   * authenticated outbound call, so unlike an inbound callback its answer
   * can be trusted as-is.
   *
   * Returns one of:
   *   { state: 'paid' }
   *   { state: 'failed', resultCode, resultDesc }
   *   { state: 'unknown', error }  — still processing, or the query itself failed
   * @param {String} checkoutRequestId
   */
  async querySTKPush(checkoutRequestId) {
    try {
      const accessToken = await this.getAccessToken();
      const { password, timestamp } = this.generatePassword();

      const response = await axios.post(
        `${this.getBaseURL()}/mpesa/stkpushquery/v1/query`,
        {
          BusinessShortCode: this.shortcode,
          Password: password,
          Timestamp: timestamp,
          CheckoutRequestID: checkoutRequestId
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 15_000,
        }
      );

      const resultCode = Number(response.data.ResultCode);
      if (response.data.ResultCode === undefined || Number.isNaN(resultCode)) {
        return { state: 'unknown', error: response.data.ResponseDescription || 'No result yet' };
      }
      if (resultCode === 0) return { state: 'paid' };
      return { state: 'failed', resultCode, resultDesc: response.data.ResultDesc };
    } catch (error) {
      // Daraja answers "The transaction is being processed" with an HTTP
      // error while the buyer still has the PIN prompt open — not a failure.
      return {
        state: 'unknown',
        error: error.response?.data?.errorMessage || error.message
      };
    }
  }

  /**
   * Parse M‑Pesa callback data
   */
  parseCallback(callbackData) {
    try {
      const { Body } = callbackData;
      const { stkCallback } = Body;

      const result = {
        merchantRequestId: stkCallback.MerchantRequestID,
        checkoutRequestId: stkCallback.CheckoutRequestID,
        resultCode: stkCallback.ResultCode,
        resultDesc: stkCallback.ResultDesc
      };

      if (stkCallback.ResultCode === 0) {
        const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];
        result.amount = callbackMetadata.find(item => item.Name === 'Amount')?.Value;
        result.mpesaReceiptNumber = callbackMetadata.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
        result.transactionDate = callbackMetadata.find(item => item.Name === 'TransactionDate')?.Value;
        result.phoneNumber = callbackMetadata.find(item => item.Name === 'PhoneNumber')?.Value;
      }

      return result;
    } catch (error) {
      console.error('❌ Callback parsing error:', error);
      throw new Error('Invalid callback data');
    }
  }

  /**
   * Get result code description
   */
  getResultCodeDescription(resultCode) {
    const codes = {
      0: 'Success',
      1: 'Insufficient Funds',
      1032: 'Request cancelled by user',
      1037: 'Timeout - User did not enter PIN',
      2001: 'Wrong PIN',
      1001: 'Unable to complete transaction',
      1019: 'Transaction failed',
      1025: 'Unable to complete transaction',
      1026: 'Unable to complete transaction'
    };
    return codes[resultCode] || 'Transaction failed';
  }
}

module.exports = new MpesaService();
