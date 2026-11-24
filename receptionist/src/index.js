import Anthropic from "@anthropic-ai/sdk";
import { CLINIC } from "./clinic.js";
import { reply } from "./agent.js";
import { d1Store } from "./store.js";
import { sendText, markRead, sendReminder, validSignature, messageText } from "./whatsapp.js";
import { nowLocal, addMinutes, dayOfWeek } from "./time.js";

const DAYS = {
  el: { sun: "Κυρ", mon: "Δευ", tue: "Τρι", wed: "Τετ", thu: "Πεμ", fri: "Παρ", sat: "Σαβ" },
  en: { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" },
  ru: { sun: "Вс", mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб" },
};
const whenText = (iso, lang) => {
  const d = iso.slice(0, 10);
  return `${(DAYS[lang] || DAYS.el)[dayOfWeek(d)]} ${+d.slice(8, 10)}/${+d.slice(5, 7)}, ${iso.slice(11, 16)}`;
};

async function handleMessage(env, m) {
  const store = d1Store(env.DB);
  if (!(await store.markSeen(m.id))) return; // το Meta ξαναστέλνει μερικές φορές το ίδιο μήνυμα
  await markRead(env, m.id);
  const phone = m.from;
  const text = messageText(m).slice(0, 2000);
  if (!text) return;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const answer = await reply({ client, model: env.MODEL, store, clinic: CLINIC, phone, text });
  await store.addMessage(phone, "user", text);
  await store.addMessage(phone, "assistant", answer);
  await sendText(env, phone, answer);
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function admin(env, url, request) {
  const key = url.searchParams.get("key");
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return new Response("Not found", { status: 404 });
  const store = d1Store(env.DB);
  if (request.method === "POST") {
    const f = await request.formData();
    if (f.get("cancel")) await store.adminCancel(+f.get("cancel"));
    if (f.get("done")) await store.closeHandoff(+f.get("done"));
    return Response.redirect(url.toString(), 303);
  }
  const today = nowLocal(CLINIC.timezone).slice(0, 10) + "T00:00";
  const [appts, hand] = await Promise.all([store.upcoming(today), store.openHandoffs()]);
  const svc = (id) => CLINIC.services.find((s) => s.id === id)?.name || id;
  const rows = appts.map((a) => `<tr class="${a.status}"><td>${esc(whenText(a.start, "el"))}</td><td>${esc(a.name)}</td><td><a href="https://wa.me/${esc(a.phone)}">+${esc(a.phone)}</a></td><td>${esc(svc(a.service))}${a.note ? "<br><small>" + esc(a.note) + "</small>" : ""}</td><td>${a.status === "booked" ? (a.reminder_sent ? "✔ υπενθύμιση" : "κλεισμένο") : "ακυρώθηκε"}</td><td>${a.status === "booked" ? `<form method="post"><button name="cancel" value="${a.id}">Ακύρωση</button></form>` : ""}</td></tr>`).join("");
  const hrows = hand.map((h) => `<tr><td>${new Date(h.at).toLocaleString("el-GR", { timeZone: CLINIC.timezone })}</td><td><a href="https://wa.me/${esc(h.phone)}">+${esc(h.phone)}</a></td><td>${esc(h.reason)}</td><td><form method="post"><button name="done" value="${h.id}">Έγινε</button></form></td></tr>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(CLINIC.name)} – Ραντεβού</title>
<style>body{font:15px system-ui;margin:16px;color:#14202b}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}tr.cancelled{opacity:.45}h2{margin-top:28px}</style>
<h1>${esc(CLINIC.name)}</h1><h2>Χρειάζονται άνθρωπο (${hand.length})</h2><table><tr><th>Πότε</th><th>Ασθενής</th><th>Λόγος</th><th></th></tr>${hrows || "<tr><td colspan=4>Τίποτα</td></tr>"}</table>
<h2>Ραντεβού</h2><table><tr><th>Ώρα</th><th>Όνομα</th><th>Τηλέφωνο</th><th>Υπηρεσία</th><th>Κατάσταση</th><th></th></tr>${rows || "<tr><td colspan=6>Κανένα</td></tr>"}</table>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/webhook" && request.method === "GET") {
      const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === env.WA_VERIFY_TOKEN;
      return ok ? new Response(url.searchParams.get("hub.challenge")) : new Response("Forbidden", { status: 403 });
    }
    if (url.pathname === "/webhook" && request.method === "POST") {
      const raw = await request.text();
      if (!(await validSignature(env, raw, request.headers.get("x-hub-signature-256")))) return new Response("Bad signature", { status: 401 });
      const body = JSON.parse(raw);
      for (const e of body.entry || []) for (const c of e.changes || []) for (const m of c.value?.messages || []) {
        ctx.waitUntil(handleMessage(env, m).catch((err) => console.error("handleMessage", err)));
      }
      return new Response("ok"); // απαντάμε αμέσως στο Meta, η δουλειά συνεχίζει στο παρασκήνιο
    }
    if (url.pathname === "/admin") return admin(env, url, request);
    if (url.pathname === "/") return new Response("ok");
    return new Response("Not found", { status: 404 });
  },

  // Κάθε 30 λεπτά: υπενθυμίσεις για ραντεβού σε 23-25 ώρες.
  async scheduled(event, env, ctx) {
    const store = d1Store(env.DB);
    const now = nowLocal(CLINIC.timezone);
    const due = await store.dueReminders(addMinutes(now, 23 * 60), addMinutes(now, 25 * 60));
    for (const a of due) {
      try {
        await sendReminder(env, a.phone, a.name, whenText(a.start, a.lang), a.lang);
        await store.markReminded(a.id);
      } catch (err) {
        console.error("reminder", a.id, err);
      }
    }
    ctx.waitUntil(store.cleanup());
  },
};
