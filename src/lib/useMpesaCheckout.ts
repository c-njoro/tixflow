// src/lib/useMpesaCheckout.ts — browser only.
//
// Pay through /api/checkout/mpesa/initiate and wait for the result: the
// STK prompt, then polling the order until it completes or fails. For the
// smaller checkouts outside the event page (group bookings).
import { useEffect, useRef, useState } from 'react';

export type MpesaStage = 'idle' | 'submitting' | 'awaiting_pin' | 'completed' | 'failed';

const POLL_MS = 3000;
const GIVE_UP_MS = 2 * 60_000;

export function useMpesaCheckout() {
  const [stage, setStage] = useState<MpesaStage>('idle');
  const [error, setError] = useState('');
  const [tickets, setTickets] = useState<{ ticketCode: string }[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current = null;
    timeoutRef.current = null;
  };
  useEffect(() => stop, []);

  const status = (orderId: string, key: string) =>
    fetch(`/api/checkout/mpesa/status?orderId=${orderId}&key=${encodeURIComponent(key)}`).then((r) => r.json());

  // Resolves true once paid (tickets are set by then).
  const pay = (body: Record<string, unknown>) =>
    new Promise<boolean>((resolve) => {
      stop();
      setError('');
      setStage('submitting');
      fetch('/api/checkout/mpesa/initiate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(async (res) => {
          const result = await res.json();
          if (!res.ok) throw new Error(result.error || 'Failed to start payment.');
          const { orderId, accessKey } = result.data;
          if (result.data.free) {
            const s = await status(orderId, accessKey);
            setTickets(s.data?.tickets || []);
            setStage('completed');
            return resolve(true);
          }
          setStage('awaiting_pin');
          pollRef.current = setInterval(async () => {
            try {
              const s = await status(orderId, accessKey);
              if (s.data?.status === 'completed') {
                stop();
                setTickets(s.data.tickets || []);
                setStage('completed');
                resolve(true);
              } else if (s.data?.status === 'failed') {
                stop();
                setError(s.data.failureReason || 'Payment was not completed.');
                setStage('failed');
                resolve(false);
              }
            } catch {
              // a network blip: the next tick tries again
            }
          }, POLL_MS);
          timeoutRef.current = setTimeout(() => {
            stop();
            setError('This took too long. Check your M-Pesa messages: if you paid, your ticket is on its way by email.');
            setStage('failed');
            resolve(false);
          }, GIVE_UP_MS);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to start payment.');
          setStage('idle');
          resolve(false);
        });
    });

  const reset = () => {
    stop();
    setStage('idle');
    setError('');
    setTickets([]);
  };

  return { stage, error, tickets, pay, reset };
}
