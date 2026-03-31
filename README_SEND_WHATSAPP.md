Automatic WhatsApp notifications

What this adds

- Client (`script.js`) now POSTs booking data to `/send-whatsapp` on the same host.
- A sample server (`server.js`) using Twilio sends WhatsApp messages to the owner's number automatically.

Setup steps

1. Sign up at Twilio and enable WhatsApp sandbox or an approved sender.
2. Copy `.env.example` to `.env` and fill values.
3. Install and run server:

```bash
cd "d:\Binu tours and travells"
npm install
npm start
```

4. Open `http://localhost:3000` to access the site.

Notes

- If the server is not running, `script.js` falls back to opening WhatsApp Web with prefilled booking details.
- The server also includes `/create-order` and `/razorpay-webhook` endpoints for Razorpay integration.
