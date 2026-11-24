// Δοκιμές χωρίς internet και χωρίς κόστος.
import assert from "node:assert/strict";
import { CLINIC } from "../src/clinic.js";
import { freeSlots, addMinutes, nowLocal, dayOfWeek } from "../src/time.js";
import { reply, runTool } from "../src/agent.js";
import { validSignature, messageText } from "../src/whatsapp.js";
import { memStore } from "./memstore.js";

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log("✓", name); };

await t("ώρα Κύπρου (χειμώνας UTC+2, καλοκαίρι UTC+3)", () => {
  assert.equal(nowLocal("Asia/Nicosia", new Date("2026-11-24T21:00:00Z")), "2026-11-24T23:00");
  assert.equal(nowLocal("Asia/Nicosia", new Date("2026-07-01T09:00:00Z")), "2026-07-01T12:00");
});
await t("πρόσθεση λεπτών πέρα από μεσάνυχτα/μήνα", () => {
  assert.equal(addMinutes("2026-11-30T23:30", 45), "2026-12-01T00:15");
});
await t("ημέρα εβδομάδας", () => assert.equal(dayOfWeek("2026-11-24"), "tue"));
await t("ελεύθερες ώρες: ωράριο, κυριακή, αργίες, ελάχιστη προειδοποίηση", () => {
  const now = "2026-11-24T09:00";
  const tue = freeSlots(CLINIC, "2026-11-24", 30, [], now);
  assert.equal(tue[0], "11:00"); // 2 ώρες μετά
  assert.equal(tue.at(-1), "18:30");
  assert.ok(!tue.includes("12:45") && tue.includes("12:30") && tue.includes("15:00"));
  assert.deepEqual(freeSlots(CLINIC, "2026-11-29", 30, [], now), []); // Κυριακή
  assert.deepEqual(freeSlots(CLINIC, "2026-12-25", 30, [], now), []); // Χριστούγεννα
  assert.deepEqual(freeSlots(CLINIC, "2027-03-01", 30, [], now), []); // πέρα από 21 μέρες
});
await t("δεν επικαλύπτει κλεισμένα ραντεβού", () => {
  const s = freeSlots(CLINIC, "2026-11-25", 45, [{ start: "2026-11-25T10:00", end: "2026-11-25T10:45" }], "2026-11-24T09:00");
  assert.ok(s.includes("09:15") && !s.includes("09:30") && !s.includes("10:30") && s.includes("10:45"));
});
await t("εργαλεία: κράτηση, διπλοκράτηση, λίστα, ακύρωση από άλλο κινητό", async () => {
  const store = memStore(); const ctx = { store, clinic: CLINIC, phone: "35799000001", nowIso: "2026-11-24T09:00" };
  const b = await runTool("book_appointment", { service_id: "cleaning", date: "2026-11-25", time: "10:00", patient_name: "Νίκος", language: "el", note: "" }, ctx);
  assert.equal(b.ok, true);
  const again = await runTool("book_appointment", { service_id: "checkup", date: "2026-11-25", time: "10:15", patient_name: "Άλλος", language: "el", note: "" }, { ...ctx, phone: "35799000002" });
  assert.equal(again.ok, false);
  const l = await runTool("list_my_appointments", {}, ctx); assert.equal(l.appointments.length, 1);
  const other = await runTool("cancel_appointment", { appointment_id: b.appointment_id }, { ...ctx, phone: "35799000002" }); assert.equal(other.ok, false);
  const c = await runTool("cancel_appointment", { appointment_id: b.appointment_id }, ctx); assert.equal(c.ok, true);
  const full = await runTool("find_free_slots", { service_id: "cleaning", date: "2026-11-29" }, ctx);
  assert.equal(full.free.length, 0); assert.equal(full.next_days[0].date, "2026-11-30");
});
await t("βρόχος Claude με ψεύτικο client (tool_use → απάντηση)", async () => {
  const calls = [];
  const client = { beta: { messages: { create: async (p) => {
    calls.push(JSON.parse(JSON.stringify(p)));
    if (calls.length === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "find_free_slots", input: { service_id: "checkup", date: "2026-11-25" } }] };
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Έχω 09:00 ή 11:00. Ποια σας βολεύει;" }] };
  } } } };
  const store = memStore();
  const out = await reply({ client, model: "m", store, clinic: CLINIC, phone: "357", text: "Θέλω ραντεβού αύριο", now: new Date("2026-11-24T07:00:00Z") });
  assert.match(out, /Ποια σας βολεύει/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].messages.at(-1).role, "system");
  assert.match(calls[0].messages.at(-1).content, /2026-11-24T09:00/);
  assert.equal(calls[1].messages.at(-1).content[0].type, "tool_result");
  assert.equal(calls[0].system[0].text, calls[1].system[0].text);
});
await t("υπογραφή Meta (HMAC)", async () => {
  const env = { WA_APP_SECRET: "s3cret" }; const raw = '{"a":1}';
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("s3cret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hex = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await validSignature(env, raw, "sha256=" + hex), true);
  assert.equal(await validSignature(env, raw + " ", "sha256=" + hex), false);
});
await t("τύποι μηνυμάτων", () => {
  assert.equal(messageText({ type: "button", button: { text: "Επιβεβαιώνω" } }), "Επιβεβαιώνω");
  assert.equal(messageText({ type: "audio" }), "[voice note]");
});
console.log(`\n${n} δοκιμές πέρασαν.`);
