// Όλες οι ώρες αποθηκεύονται ως τοπική ώρα Κύπρου "YYYY-MM-DDTHH:MM".
// Οι συμβολοσειρές συγκρίνονται σωστά αλφαβητικά.
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function nowLocal(tz, date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  const d = `${p.year}-${p.month}-${p.day}`;
  return `${d}T${p.hour}:${p.minute}`;
}

const toMin = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
const pad = (n) => String(n).padStart(2, "0");
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export function addMinutes(iso, minutes) {
  const [d, t] = iso.split("T");
  const ms = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + (toMin(t) + minutes) * 60000;
  const x = new Date(ms);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
}

export function dayOfWeek(date) {
  return DOW[new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay()];
}

export function isValidDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const x = new Date(date + "T00:00:00Z");
  return !isNaN(x) && x.toISOString().slice(0, 10) === date;
}

// Ελεύθερες ώρες έναρξης για μια μέρα.
export function freeSlots(clinic, date, minutes, booked, nowIso) {
  if (!isValidDate(date) || clinic.closedDates.includes(date)) return [];
  const earliest = addMinutes(nowIso, clinic.minNoticeMinutes);
  const latestDay = addMinutes(nowIso, clinic.bookingDaysAhead * 1440).slice(0, 10);
  if (date > latestDay) return [];
  const out = [];
  for (const [open, close] of clinic.hours[dayOfWeek(date)] || []) {
    for (let m = toMin(open); m + minutes <= toMin(close); m += clinic.slotMinutes) {
      const start = `${date}T${fromMin(m)}`;
      const end = addMinutes(start, minutes);
      if (start < earliest) continue;
      if (booked.some((b) => start < b.end && b.start < end)) continue;
      out.push(fromMin(m));
    }
  }
  return out;
}
