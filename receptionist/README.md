# WhatsApp AI ρεσεψιόν για οδοντιατρεία

Cloudflare Worker (δωρεάν) + WhatsApp Cloud API (Meta) + Claude API.

- `src/clinic.js` – στοιχεία ιατρείου (το μόνο που αλλάζει ανά πελάτη)
- `src/prompt.js` – master system prompt
- `src/agent.js` – Claude + εργαλεία (ελεύθερες ώρες, κράτηση, ακύρωση, παράδοση σε άνθρωπο)
- `src/index.js` – webhook WhatsApp, υπενθυμίσεις (cron κάθε 30'), σελίδα `/admin?key=...`
- `npm test` – δοκιμές χωρίς κόστος · `npm run eval` – 8 σενάρια με το πραγματικό API

Ανέβασμα και δοκιμή: GitHub → Actions → **receptionist** → Run workflow (`eval` ή `deploy`).
