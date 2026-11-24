// Αποθήκευση στη μνήμη για δοκιμές (ίδιες μέθοδοι με το D1 store).
export function memStore() {
  const s = { messages: [], appts: [], handoffs: [], seen: new Set() };
  let id = 0;
  return {
    s,
    async history(phone, since, limit) { return s.messages.filter((m) => m.phone === phone && m.at >= since).slice(-limit); },
    async addMessage(phone, role, text) { s.messages.push({ phone, role, text, at: Date.now() }); },
    async bookedOn(date) { return s.appts.filter((a) => a.status === "booked" && a.start.startsWith(date)); },
    async createAppointment(a) { s.appts.push({ ...a, id: ++id, status: "booked", reminder_sent: 0 }); return id; },
    async appointmentsFor(phone, from) { return s.appts.filter((a) => a.phone === phone && a.status === "booked" && a.start >= from); },
    async cancelAppointment(aid, phone) { const a = s.appts.find((x) => x.id === aid && x.phone === phone && x.status === "booked"); if (a) a.status = "cancelled"; return !!a; },
    async addHandoff(phone, reason) { s.handoffs.push({ phone, reason }); },
    async markSeen(w) { if (s.seen.has(w)) return false; s.seen.add(w); return true; },
  };
}
