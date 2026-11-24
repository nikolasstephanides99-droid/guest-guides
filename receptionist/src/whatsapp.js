// WhatsApp Cloud API (Meta). Δωρεάν οι απαντήσεις σε μηνύματα ασθενών μέσα σε 24 ώρες.
const api = (env) => `https://graph.facebook.com/${env.GRAPH_VERSION}/${env.WA_PHONE_NUMBER_ID}/messages`;

async function post(env, body) {
  const r = await fetch(api(env), {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${await r.text()}`);
  return r.json();
}

export const sendText = (env, to, text) => post(env, { to, type: "text", text: { body: text.slice(0, 4000) } });

export const markRead = (env, id) => post(env, { status: "read", message_id: id }).catch(() => {});

// Template που εγκρίνεται μία φορά στο Meta (βλ. SETUP.md). Μεταβλητές: {{1}} όνομα, {{2}} μέρα/ώρα.
export const sendReminder = (env, to, name, when, lang) =>
  post(env, {
    to,
    type: "template",
    template: {
      name: env.REMINDER_TEMPLATE,
      language: { code: lang || env.REMINDER_LANG },
      components: [{ type: "body", parameters: [{ type: "text", text: name }, { type: "text", text: when }] }],
    },
  });

export async function validSignature(env, raw, header) {
  if (!env.WA_APP_SECRET) return false;
  if (!header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.WA_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// Μετατρέπει ένα εισερχόμενο μήνυμα σε κείμενο για το bot.
export function messageText(m) {
  switch (m.type) {
    case "text": return m.text.body;
    case "button": return m.button.text;
    case "interactive": return m.interactive.button_reply?.title || m.interactive.list_reply?.title || "";
    case "audio": return "[voice note]";
    case "image": return "[image]" + (m.image?.caption ? " " + m.image.caption : "");
    case "document": return "[document]";
    case "location": return "[location]";
    default: return `[${m.type}]`;
  }
}
