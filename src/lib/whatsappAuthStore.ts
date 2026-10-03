// src/lib/whatsappAuthStore.ts
//
// A Baileys auth state kept in MongoDB (WhatsappAuthKey) — the database
// version of Baileys' useMultiFileAuthState, which its own docs say not to
// use in production. Same shape, same serialisation (BufferJSON), so the
// socket can't tell the difference; the login just survives restarts and
// deploys without a disk.
//
// Writes to the same key are applied in order (a per-key promise chain),
// like the file version's per-file mutex: Baileys rewrites keys often and
// an older write must never land after a newer one.
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import { prisma } from './prisma';

const CREDS_KEY = 'creds';

const pending = new Map<string, Promise<unknown>>();
function inOrder<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
  pending.set(key, run);
  run.finally(() => {
    if (pending.get(key) === run) pending.delete(key);
  }).catch(() => {});
  return run;
}

const writeValue = (key: string, value: unknown) =>
  inOrder(key, () => {
    const json = JSON.stringify(value, BufferJSON.replacer);
    return prisma.whatsappAuthKey.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
  });

const removeValue = (key: string) => inOrder(key, () => prisma.whatsappAuthKey.deleteMany({ where: { key } }));

export async function hasStoredWhatsappSession() {
  return (await prisma.whatsappAuthKey.count({ where: { key: CREDS_KEY } })) > 0;
}

// Logging out: forget everything, so the next connect shows a fresh QR.
export async function clearStoredWhatsappSession() {
  await Promise.all([...pending.values()].map((p) => p.catch(() => {})));
  await prisma.whatsappAuthKey.deleteMany({});
}

export async function useMongoAuthState(): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const stored = await prisma.whatsappAuthKey.findUnique({ where: { key: CREDS_KEY } });
  const creds: AuthenticationCreds = stored ? JSON.parse(stored.value, BufferJSON.reviver) : initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const rows = await prisma.whatsappAuthKey.findMany({ where: { key: { in: ids.map((id) => `${type}-${id}`) } } });
          const byKey = new Map(rows.map((r) => [r.key, r.value]));
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const id of ids) {
            const raw = byKey.get(`${type}-${id}`);
            if (!raw) continue;
            let value = JSON.parse(raw, BufferJSON.reviver);
            if (type === 'app-state-sync-key') value = proto.Message.AppStateSyncKeyData.fromObject(value);
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          const tasks: Promise<unknown>[] = [];
          for (const category in data) {
            const entries = data[category as keyof SignalDataTypeMap] ?? {};
            for (const id in entries) {
              const value = entries[id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeValue(key, value) : removeValue(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await writeValue(CREDS_KEY, creds);
    },
  };
}
