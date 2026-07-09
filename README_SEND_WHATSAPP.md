Automatic WhatsApp notifications

What this adds

- Client (`script.js`) now POSTs booking data to `/send-whatsapp` on the same host.
- A sample server (`server.js`) using Twilio sends WhatsApp messages to the owner's number automatically.

Setup steps

1. Sign up at Twilio and enable WhatsApp sandbox or an approved sender.
2. Copy `.env.example` to `.env` and fill values.
   - Add one or more owner numbers in `OWNER_WHATSAPP_NUMBERS`, separated by commas.
   - Set `BOOKING_ADVANCE_INR` to the advance amount shown and charged online.
   - If frontend and backend are on different domains, add the frontend URL in `ALLOWED_ORIGINS`.
3. Install and run server:

```bash
cd "d:\Binu tours and travells"
npm install
npm start
```

4. Open `http://localhost:3000` to access the site.

Razorpay payment activation

1. Add `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`.
2. Optional but recommended: add `RAZORPAY_WEBHOOK_SECRET` and configure webhook URL as `/razorpay-webhook`.
3. Restart server after updating `.env`.
4. In booking form, Card/UPI/Net Banking/Wallet will be active only when Razorpay is configured.
5. The backend creates the order, verifies Razorpay signature, fetches the order/payment from Razorpay, checks amount/currency/status, and only then accepts the paid booking.

Notes

- If the server is not running, `script.js` falls back to opening WhatsApp Web with prefilled booking details.
- The server also includes `/create-order` and `/razorpay-webhook` endpoints for Razorpay integration.
- Booking messages are built on the server and sent only to configured owner numbers.
- Online payment bookings are accepted only after Razorpay signature, order, amount, currency, and payment status verification.
