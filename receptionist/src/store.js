// Αποθήκευση σε Cloudflare D1 (δωρεάν).
export function d1Store(db) {
  return {
    async history(phone, sinceMs, limit) {
      const r = await db.prepare("SELECT role, text FROM messages WHERE phone=? AND at>=? ORDER BY id DESC LIMIT ?").bind(phone, sinceMs, limit).all();
      return r.results.reverse();
    },
    async addMessage(phone, role, text) {
      await db.prepare("INSERT INTO messages (phone, role, text, at) VALUES (?,?,?,?)").bind(phone, role, text, Date.now()).run();
    },
    async bookedOn(date) {
      const r = await db.prepare("SELECT start, end FROM appointments WHERE status='booked' AND start>=? AND start<?").bind(date + "T00:00", date + "T99").all();
      return r.results;
    },
    async createAppointment(a) {
      const r = await db.prepare("INSERT INTO appointments (phone,name,service,start,end,lang,note,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(a.phone, a.name, a.service, a.start, a.end, a.lang, a.note, Date.now()).run();
      return r.meta.last_row_id;
    },
    async appointmentsFor(phone, fromIso) {
      const r = await db.prepare("SELECT * FROM appointments WHERE phone=? AND status='booked' AND start>=? ORDER BY start").bind(phone, fromIso).all();
      return r.results;
    },
    async cancelAppointment(id, phone) {
      const r = await db.prepare("UPDATE appointments SET status='cancelled' WHERE id=? AND phone=? AND status='booked'").bind(id, phone).run();
      return r.meta.changes > 0;
    },
    async addHandoff(phone, reason) {
      await db.prepare("INSERT INTO handoffs (phone, reason, at) VALUES (?,?,?)").bind(phone, reason, Date.now()).run();
    },
    async markSeen(wamid) {
      const r = await db.prepare("INSERT OR IGNORE INTO seen (wamid, at) VALUES (?,?)").bind(wamid, Date.now()).run();
      return r.meta.changes > 0;
    },
    async dueReminders(fromIso, toIso) {
      const r = await db.prepare("SELECT * FROM appointments WHERE status='booked' AND reminder_sent=0 AND start>=? AND start<=?").bind(fromIso, toIso).all();
      return r.results;
    },
    async markReminded(id) {
      await db.prepare("UPDATE appointments SET reminder_sent=1 WHERE id=?").bind(id).run();
    },
    async upcoming(fromIso) {
      const r = await db.prepare("SELECT * FROM appointments WHERE start>=? ORDER BY start LIMIT 200").bind(fromIso).all();
      return r.results;
    },
    async openHandoffs() {
      const r = await db.prepare("SELECT * FROM handoffs WHERE done=0 ORDER BY id DESC LIMIT 100").all();
      return r.results;
    },
    async closeHandoff(id) {
      await db.prepare("UPDATE handoffs SET done=1 WHERE id=?").bind(id).run();
    },
    async adminCancel(id) {
      await db.prepare("UPDATE appointments SET status='cancelled' WHERE id=?").bind(id).run();
    },
    async cleanup() {
      const old = Date.now() - 30 * 86400e3;
      await db.prepare("DELETE FROM messages WHERE at<?").bind(old).run();
      await db.prepare("DELETE FROM seen WHERE at<?").bind(old).run();
    },
  };
}
