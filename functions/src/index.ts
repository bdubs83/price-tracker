import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/https';
import { defineSecret, defineString } from 'firebase-functions/params';

initializeApp();

const zapierSecret = defineSecret('ZAPIER_WEBHOOK_SECRET');
const googleAiApiKey = defineSecret('GOOGLE_AI_API_KEY');
const appSessionHours = defineString('APP_SESSION_HOURS', { default: '48' });
const geminiPdfModel = defineString('GEMINI_PDF_MODEL', { default: 'gemini-3.5-flash' });

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

async function assertAdminAccess(request: { auth?: { uid: string }; data?: unknown }) {
  if (!request.auth) {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }

  const user = await getFirestore().collection('users').doc(request.auth.uid).get();
  const userData = user.data();
  const expiresAt = userData?.sessionExpiresAt;
  const expiresAtMillis = typeof expiresAt?.toMillis === 'function'
    ? expiresAt.toMillis()
    : expiresAt instanceof Date
      ? expiresAt.getTime()
      : Number.NaN;
  if (userData?.role !== 'admin' || !Number.isFinite(expiresAtMillis) || expiresAtMillis <= Date.now()) {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }
}

async function isApprovedMember(email: string) {
  const approved = await getFirestore().collection('approvedMembers').doc(email).get();
  return approved.exists && approved.data()?.active !== false;
}

async function isAdminEmail(email: string) {
  const admin = await getFirestore().collection('admins').doc(email).get();
  return admin.exists && admin.data()?.active !== false;
}

type GeminiExtractedRow = {
  sku?: string;
  vendorProductName?: string;
  mgOrAmountPerVial?: string;
  vialsPerKit?: number;
  kitPrice?: number | null;
  confidence?: number;
  warnings?: string[];
};

function stripJsonFence(text: string) {
  return text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
}

function normalizeExtractedRows(value: unknown): GeminiExtractedRow[] {
  const rows = Array.isArray((value as { rows?: unknown })?.rows) ? (value as { rows: unknown[] }).rows : [];
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      sku: String(item.sku ?? '').trim(),
      vendorProductName: String(item.vendorProductName ?? '').trim(),
      mgOrAmountPerVial: String(item.mgOrAmountPerVial ?? '').trim(),
      vialsPerKit: Number(item.vialsPerKit) || 10,
      kitPrice: item.kitPrice == null ? null : Number(item.kitPrice),
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
      warnings: Array.isArray(item.warnings) ? item.warnings.map((warning) => String(warning)) : [],
    };
  }).filter((row) => row.vendorProductName || row.sku || row.kitPrice);
}

async function readGeminiError(response: Response) {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; status?: string } };
    const message = parsed.error?.message ?? body;
    const status = parsed.error?.status ? ` (${parsed.error.status})` : '';
    return `${message}${status}`;
  } catch {
    return body.slice(0, 300);
  }
}

export const zapierMemberWebhook = onRequest({ secrets: [zapierSecret] }, async (request, response) => {
  if (request.method !== 'POST') {
    response.status(405).send('Method not allowed');
    return;
  }

  const provided = request.header('x-zapier-secret') ?? request.query.secret;
  if (provided !== zapierSecret.value()) {
    response.status(401).send('Unauthorized');
    return;
  }

  const email = normalizeEmail(String(request.body?.email ?? ''));
  if (!isValidEmail(email)) {
    response.status(400).json({ error: 'A valid email is required.' });
    return;
  }

  await getFirestore().collection('approvedMembers').doc(email).set(
    {
      email,
      name: request.body?.name ?? null,
      skoolUsername: request.body?.skoolUsername ?? null,
      joinDate: request.body?.joinDate ?? null,
      source: request.body?.source ?? 'zapier',
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  response.json({ ok: true, email });
});

export const createMemberSession = onCall(async (request) => {
  const email = normalizeEmail(String(request.data?.email ?? ''));
  if (!isValidEmail(email)) {
    throw new HttpsError('invalid-argument', 'Enter a valid email address.');
  }

  const approved = await isApprovedMember(email);
  if (!approved) {
    throw new HttpsError('permission-denied', 'That email is not on the approved member list.');
  }

  const role = await isAdminEmail(email) ? 'admin' : 'member';
  const now = new Date();
  const configuredSessionHours = Number(appSessionHours.value());
  const sessionHours = Number.isFinite(configuredSessionHours) && configuredSessionHours > 0 ? configuredSessionHours : 48;
  const expiresAt = new Date(now.getTime() + sessionHours * 60 * 60 * 1000);
  const uid = email;

  await getFirestore().collection('users').doc(uid).set(
    {
      uid,
      email,
      role,
      verifiedAt: FieldValue.serverTimestamp(),
      lastLoginAt: FieldValue.serverTimestamp(),
      sessionExpiresAt: expiresAt,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const token = await getAuth().createCustomToken(uid, { email, role });
  return {
    token,
    user: {
      uid,
      email,
      role,
      verifiedAt: now.toISOString(),
      lastLoginAt: now.toISOString(),
      sessionExpiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  };
});

export const extractPriceListWithGemini = onCall({ secrets: [googleAiApiKey], timeoutSeconds: 300, memory: '1GiB' }, async (request) => {
  await assertAdminAccess(request);

  const fileBase64 = String(request.data?.fileBase64 ?? '');
  const fileName = String(request.data?.fileName ?? 'price-list.pdf');
  const fileMimeType = String(request.data?.fileMimeType ?? 'application/pdf');
  if (!fileBase64 || fileMimeType !== 'application/pdf') throw new HttpsError('invalid-argument', 'A PDF file is required.');
  if (Buffer.byteLength(fileBase64, 'base64') > 18 * 1024 * 1024) throw new HttpsError('invalid-argument', 'PDF is too large for extraction.');

  const prompt = [
    'Extract vendor price list rows from this PDF for admin review.',
    'Return JSON only, with this exact shape:',
    '{"rows":[{"sku":"string","vendorProductName":"string","mgOrAmountPerVial":"string","vialsPerKit":10,"kitPrice":123.45,"confidence":0.8,"warnings":["string"]}]}',
    'Rules:',
    '- Include only actual product/listing rows.',
    '- kitPrice must be the listed kit/pack price in USD when visible, otherwise null.',
    '- mgOrAmountPerVial should be concise, such as 5mg, 10mg, 100mcg, 10ml, or 5mg*10vials when vial count matters.',
    '- If a vial count is clearly stated, set vialsPerKit. Default to 10 only when the list implies standard 10-vial kits.',
    '- Put uncertainty, suspicious values, odd vial counts, unclear item codes, and translation issues into warnings.',
    `PDF filename: ${fileName}`,
  ].join('\n');

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiPdfModel.value()}:generateContent?key=${googleAiApiKey.value()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: fileMimeType, data: fileBase64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const message = await readGeminiError(response);
    throw new HttpsError('resource-exhausted', `Gemini extraction failed: ${message}`);
  }

  const payload = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('\n') ?? '';
  if (!text.trim()) throw new HttpsError('internal', 'Gemini returned no extraction text.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch {
    throw new HttpsError('internal', 'Gemini returned JSON that could not be parsed.');
  }

  return {
    parsedStatus: 'extracted',
    sessionMaxHours: Number(appSessionHours.value()),
    rows: normalizeExtractedRows(parsed),
  };
});
