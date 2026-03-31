const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();

const app = express();
app.use(cors());

app.use((req, res, next) => {
  if (req.originalUrl === "/razorpay-webhook") {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      req.rawBody = data;
      try {
        req.body = JSON.parse(data);
      } catch (error) {
        req.body = {};
      }
      next();
    });
  } else {
    bodyParser.json()(req, res, next);
  }
});

const PORT = process.env.PORT || 3000;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioWhatsAppFrom = process.env.TWILIO_WHATSAPP_FROM;

let twilioClient = null;
if (accountSid && authToken) {
  const twilio = require("twilio");
  twilioClient = twilio(accountSid, authToken);
} else {
  console.warn("Twilio credentials not set. Server will return 500 for /send-whatsapp.");
}

const Razorpay = require("razorpay");
const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
let razorpayClient = null;

if (razorpayKeyId && razorpayKeySecret) {
  razorpayClient = new Razorpay({
    key_id: razorpayKeyId,
    key_secret: razorpayKeySecret
  });
  console.log("Razorpay configured");
} else {
  console.warn("Razorpay credentials not set. /create-order will fail until configured.");
}

app.post("/send-whatsapp", async (req, res) => {
  try {
    const { booking, ownerWhatsApp } = req.body;
    if (!booking || !ownerWhatsApp) {
      return res.status(400).json({ error: "Missing booking or ownerWhatsApp in body" });
    }

    if (!twilioClient) {
      return res.status(500).json({ error: "Twilio not configured on server" });
    }

    const toNumber = ownerWhatsApp.replace(/[^0-9+]/g, "");
    const to = toNumber.startsWith("+") ? `whatsapp:${toNumber}` : `whatsapp:+${toNumber}`;

    const messageBody =
      `NEW BOOKING:\n` +
      `Booking ID: ${booking.bookingId}\n` +
      `Name: ${booking.name}\n` +
      `Email: ${booking.email}\n` +
      `Phone: ${booking.phone}\n` +
      `Destination: ${booking.destination}\n` +
      `Vehicle: ${booking.vehicle || "N/A"}\n` +
      `Date: ${new Date(booking.date).toLocaleDateString()}\n` +
      `Requests: ${booking.requests || "None"}`;

    const message = await twilioClient.messages.create({
      from: twilioWhatsAppFrom,
      to,
      body: messageBody
    });

    return res.json({ success: true, sid: message.sid });
  } catch (error) {
    console.error("Error in /send-whatsapp:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/create-order", async (req, res) => {
  try {
    const { amount, currency = "INR", booking } = req.body;
    if (!amount || !booking) {
      return res.status(400).json({ error: "Missing amount or booking" });
    }

    if (!razorpayClient) {
      return res.status(500).json({ error: "Razorpay not configured" });
    }

    const options = {
      amount: parseInt(amount, 10),
      currency,
      receipt: booking.bookingId,
      payment_capture: 1
    };

    const order = await razorpayClient.orders.create(options);
    return res.json({ success: true, order, keyId: razorpayKeyId });
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    return res.status(500).json({ error: "Unable to create order" });
  }
});

app.post("/razorpay-webhook", async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return res.status(500).send("Webhook not configured");
    }

    const signature = req.headers["x-razorpay-signature"];
    const crypto = require("crypto");
    const expected = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");

    if (signature !== expected) {
      console.warn("Invalid razorpay webhook signature");
      return res.status(400).send("invalid signature");
    }

    const event = req.body;
    console.log("Razorpay webhook received:", event.event);

    if (event.event === "payment.captured" || event.event === "payment.authorized") {
      const payment = event.payload.payment.entity;
      if (twilioClient && twilioWhatsAppFrom) {
        const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER || process.env.OWNER_WHATSAPP || null;
        const toNumber = ownerNumber
          ? ownerNumber.startsWith("+")
            ? `whatsapp:${ownerNumber}`
            : `whatsapp:+${ownerNumber}`
          : null;

        const messageBody =
          `PAYMENT RECEIVED:\n` +
          `Payment ID: ${payment.id}\n` +
          `Order ID: ${payment.order_id}\n` +
          `Amount: ${payment.amount / 100} ${payment.currency}\n` +
          `Method: ${payment.method}`;

        if (toNumber) {
          await twilioClient.messages.create({
            from: twilioWhatsAppFrom,
            to: toNumber,
            body: messageBody
          });
          console.log("Owner notified via WhatsApp about payment");
        } else {
          console.log("Owner WhatsApp number not configured; skipping owner notify");
        }
      }
    }

    return res.json({ status: "ok" });
  } catch (error) {
    console.error("Webhook handling error:", error);
    return res.status(500).send("error");
  }
});

const path = require("path");
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`WhatsApp server running on port ${PORT}`);
});
