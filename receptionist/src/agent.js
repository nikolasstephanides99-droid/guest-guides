import { buildSystem } from "./prompt.js";
import { freeSlots, addMinutes, nowLocal, isValidDate, dayOfWeek } from "./time.js";

const HISTORY_HOURS = 48;
const HISTORY_LIMIT = 20;
const MAX_STEPS = 6;

const obj = (properties, required) => ({ type: "object", properties, required, additionalProperties: false });

export const TOOLS = [
  {
    name: "find_free_slots",
    description: "Free start times for a service on a date (YYYY-MM-DD, Cyprus time). If the date is full or closed, also returns the next days that have free times.",
    strict: true,
    input_schema: obj({ service_id: { type: "string" }, date: { type: "string" } }, ["service_id", "date"]),
  },
  {
    name: "book_appointment",
    description: "Book an appointment for the patient writing to you. Only after the patient chose a specific time.",
    strict: true,
    input_schema: obj({
      service_id: { type: "string" },
      date: { type: "string", description: "YYYY-MM-DD" },
      time: { type: "string", description: "HH:MM, 24h" },
      patient_name: { type: "string" },
      language: { type: "string", enum: ["el", "en", "ru"] },
      note: { type: "string", description: "Short note for the dentist, or empty string" },
    }, ["service_id", "date", "time", "patient_name", "language", "note"]),
  },
  {
    name: "list_my_appointments",
    description: "Upcoming appointments of the patient writing to you.",
    strict: true,
    input_schema: obj({}, []),
  },
  {
    name: "cancel_appointment",
    description: "Cancel one of the patient's upcoming appointments by id (from list_my_appointments).",
    strict: true,
    input_schema: obj({ appointment_id: { type: "integer" } }, ["appointment_id"]),
  },
  {
    name: "handoff_to_staff",
    description: "Flag this conversation for a human at reception.",
    strict: true,
    input_schema: obj({ reason: { type: "string" } }, ["reason"]),
  },
];

function spread(list, n) {
  if (list.length <= n) return list;
  const step = (list.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => list[Math.round(i * step)]);
}

export async function runTool(name, input, { store, clinic, phone, nowIso }) {
  const svc = (id) => clinic.services.find((s) => s.id === id);
  switch (name) {
    case "find_free_slots": {
      const s = svc(input.service_id);
      if (!s) return { error: "unknown service_id", valid: clinic.services.map((x) => x.id) };
      if (!isValidDate(input.date)) return { error: "date must be YYYY-MM-DD" };
      const slotsFor = async (date) => {
        const booked = await store.bookedOn(date);
        return freeSlots(clinic, date, s.minutes, booked, nowIso);
      };
      const slots = await slotsFor(input.date);
      const res = { date: input.date, weekday: dayOfWeek(input.date), free: spread(slots, 8) };
      if (slots.length === 0) {
        res.next_days = [];
        let d = input.date < nowIso.slice(0, 10) ? nowIso.slice(0, 10) : input.date;
        for (let i = 0; i < 14 && res.next_days.length < 3; i++) {
          d = addMinutes(d + "T00:00", 1440).slice(0, 10);
          const x = await slotsFor(d);
          if (x.length) res.next_days.push({ date: d, weekday: dayOfWeek(d), free: spread(x, 4) });
        }
      }
      return res;
    }
    case "book_appointment": {
      const s = svc(input.service_id);
      if (!s) return { ok: false, error: "unknown service_id" };
      if (!/^\d{2}:\d{2}$/.test(input.time)) return { ok: false, error: "time must be HH:MM" };
      const booked = await store.bookedOn(input.date);
      const free = freeSlots(clinic, input.date, s.minutes, booked, nowIso);
      if (!free.includes(input.time)) return { ok: false, error: "time not available", free: spread(free, 4) };
      const start = `${input.date}T${input.time}`;
      const id = await store.createAppointment({
        phone, name: input.patient_name.slice(0, 60), service: s.id, start,
        end: addMinutes(start, s.minutes), lang: input.language, note: (input.note || "").slice(0, 200),
      });
      return { ok: true, appointment_id: id, service: s.name, start, weekday: dayOfWeek(input.date), address: clinic.address };
    }
    case "list_my_appointments": {
      const list = await store.appointmentsFor(phone, nowIso);
      return { appointments: list.map((a) => ({ id: a.id, service: a.service, start: a.start, weekday: dayOfWeek(a.start.slice(0, 10)), name: a.name })) };
    }
    case "cancel_appointment": {
      const ok = await store.cancelAppointment(input.appointment_id, phone);
      return ok ? { ok: true } : { ok: false, error: "no such upcoming appointment for this patient" };
    }
    case "handoff_to_staff": {
      await store.addHandoff(phone, input.reason.slice(0, 300));
      return { ok: true };
    }
    default:
      return { error: "unknown tool" };
  }
}

// Παίρνει το μήνυμα του ασθενή, επιστρέφει το κείμενο της απάντησης.
export async function reply({ client, model, store, clinic, phone, text, now = new Date() }) {
  const nowIso = nowLocal(clinic.timezone, now);
  const history = await store.history(phone, now.getTime() - HISTORY_HOURS * 3600e3, HISTORY_LIMIT);
  const messages = [];
  for (const h of history) {
    const role = h.role === "user" ? "user" : "assistant";
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content += "\n" + h.text;
    else messages.push({ role, content: h.text });
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg.role === "user") lastMsg.content += "\n" + text;
  else messages.push({ role: "user", content: text });
  // Η τρέχουσα ώρα μπαίνει ως system note στο τέλος, ώστε το system prompt να μένει σταθερό (cache).
  messages.push({ role: "system", content: `Current Cyprus time: ${nowIso} (${dayOfWeek(nowIso.slice(0, 10))}).` });

  const system = [{ type: "text", text: buildSystem(clinic), cache_control: { type: "ephemeral" } }];
  const ctx = { store, clinic, phone, nowIso };
  let answer = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system,
      tools: TOOLS,
      messages,
    });
    if (res.stop_reason === "refusal") break;
    const texts = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (texts) answer = texts;
    if (res.stop_reason !== "tool_use") break;

    messages.push({ role: "assistant", content: res.content });
    const results = [];
    for (const b of res.content) {
      if (b.type !== "tool_use") continue;
      let out;
      try { out = await runTool(b.name, b.input, ctx); } catch (e) { out = { error: String(e.message || e) }; }
      results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }

  if (!answer) {
    answer = `Συγγνώμη, δεν μπόρεσα να απαντήσω τώρα. Καλέστε μας στο ${clinic.phone}. / Sorry, please call ${clinic.phone}.`;
    await store.addHandoff(phone, "bot could not answer");
  }
  return answer;
}
