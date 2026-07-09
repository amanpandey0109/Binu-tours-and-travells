const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");
const BOOKING_ADVANCE_INR = parsePositiveInteger(process.env.BOOKING_ADVANCE_INR, 500);
const BOOKING_ADVANCE_PAISE = BOOKING_ADVANCE_INR * 100;
const ONLINE_PAYMENT_METHODS = new Set(["card", "upi", "netbanking", "wallet"]);
const PAYMENT_METHODS = new Set(["cash", ...ONLINE_PAYMENT_METHODS]);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  }
}));

app.use("/razorpay-webhook", bodyParser.raw({ type: "*/*", limit: "100kb" }));
app.use((req, res, next) => {
  if (req.path === "/razorpay-webhook") {
    return next();
  }

  return bodyParser.json({ limit: "20kb" })(req, res, next);
});

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
const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
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

function parsePositiveInteger(value, fallback) {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function cleanText(value, maxLength = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanMultiline(value, maxLength = 500) {
  return String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, maxLength);
}

function sanitizeBooking(booking = {}) {
  const bookingId = cleanText(booking.bookingId || `BTT-${Date.now()}`, 40).replace(/[^a-zA-Z0-9_-]/g, "");
  const paymentMethod = cleanText(booking.payment_method, 30).toLowerCase();

  return {
    bookingId: bookingId || `BTT-${Date.now()}`,
    name: cleanText(booking.name, 100),
    email: cleanText(booking.email, 120),
    phone: cleanText(booking.phone, 30),
    pickup: cleanText(booking.pickup, 160),
    destination: cleanText(booking.destination, 160),
    vehicle: cleanText(booking.vehicle, 80),
    payment_method: paymentMethod,
    date: cleanText(booking.date, 30),
    requests: cleanMultiline(booking.requests, 500),
    custom_preferences: cleanMultiline(booking.custom_preferences, 500),
    booking_advance_inr: BOOKING_ADVANCE_INR,
    payment_status: cleanText(booking.payment_status, 40),
    payment_id: cleanText(booking.payment_id || booking.razorpay_payment_id, 120),
    payment_order_id: cleanText(booking.payment_order_id || booking.razorpay_order_id, 120),
    payment_signature: cleanText(booking.payment_signature || booking.razorpay_signature, 200)
  };
}

function validateBasicBooking(booking) {
  if (!booking.name || !booking.phone || !booking.pickup || !booking.destination || !booking.vehicle || !booking.date) {
    return "Missing required booking details";
  }

  if (!PAYMENT_METHODS.has(booking.payment_method)) {
    return "Invalid payment method";
  }

  return "";
}

function timingSafeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyRazorpaySignature(orderId, paymentId, signature) {
  if (!razorpayKeySecret || !orderId || !paymentId || !signature) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  return timingSafeCompare(signature, expected);
}

function sameCleanValue(left, right) {
  return cleanText(left, 160).toLowerCase() === cleanText(right, 160).toLowerCase();
}

function orderMatchesBooking(order, booking) {
  const notes = order.notes || {};

  if (order.receipt && order.receipt !== booking.bookingId) {
    return false;
  }

  if (notes.bookingId && notes.bookingId !== booking.bookingId) {
    return false;
  }

  if (notes.phone && !sameCleanValue(notes.phone, booking.phone)) {
    return false;
  }

  if (notes.name && !sameCleanValue(notes.name, booking.name)) {
    return false;
  }

  return true;
}

async function verifyRazorpayPaymentDetails({ orderId, paymentId, signature, booking }) {
  if (!razorpayClient) {
    return { error: "Online payment is not configured" };
  }

  if (!verifyRazorpaySignature(orderId, paymentId, signature)) {
    return { error: "Payment signature is invalid" };
  }

  let order;
  let payment;

  try {
    [order, payment] = await Promise.all([
      razorpayClient.orders.fetch(orderId),
      razorpayClient.payments.fetch(paymentId)
    ]);
  } catch (error) {
    console.error("Unable to fetch Razorpay payment details:", error);
    return { error: "Unable to verify payment with Razorpay" };
  }

  if (!order || !payment || payment.order_id !== orderId) {
    return { error: "Payment order mismatch" };
  }

  if (Number(order.amount) !== BOOKING_ADVANCE_PAISE || Number(payment.amount) !== BOOKING_ADVANCE_PAISE) {
    return { error: "Payment amount mismatch" };
  }

  if (order.currency !== "INR" || payment.currency !== "INR") {
    return { error: "Payment currency mismatch" };
  }

  if (!["captured", "authorized"].includes(payment.status)) {
    return { error: "Payment is not successful yet" };
  }

  if (booking && !orderMatchesBooking(order, booking)) {
    return { error: "Payment does not match booking details" };
  }

  return {
    error: "",
    status: payment.status === "captured" ? "paid" : "authorized",
    order,
    payment
  };
}

async function verifyBookingPayment(booking) {
  if (!ONLINE_PAYMENT_METHODS.has(booking.payment_method)) {
    booking.payment_status = "cash_on_pickup";
    booking.payment_id = "";
    booking.payment_order_id = "";
    booking.payment_signature = "";
    return "";
  }

  const verification = await verifyRazorpayPaymentDetails({
    orderId: booking.payment_order_id,
    paymentId: booking.payment_id,
    signature: booking.payment_signature,
    booking
  });

  if (verification.error) {
    return verification.error;
  }

  booking.payment_status = verification.status;
  return "";
}

function paymentMethodLabel(method) {
  return {
    cash: "Cash on Pickup",
    card: "Credit/Debit Card",
    upi: "UPI",
    netbanking: "Net Banking",
    wallet: "Digital Wallet"
  }[method] || method || "N/A";
}

function ownerWhatsAppNumbers() {
  const configured = [
    process.env.OWNER_WHATSAPP_NUMBERS,
    process.env.OWNER_WHATSAPP_NUMBER,
    process.env.OWNER_WHATSAPP
  ]
    .filter(Boolean)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(configured)];
}

function toWhatsAppAddress(number) {
  const cleanNumber = String(number || "").replace(/[^0-9+]/g, "");
  const withCountryCode = cleanNumber.startsWith("+") ? cleanNumber : `+${cleanNumber}`;

  if (!/^\+[1-9]\d{7,14}$/.test(withCountryCode)) {
    return null;
  }

  return `whatsapp:${withCountryCode}`;
}

function formatDate(dateValue) {
  const parsedDate = dateValue ? new Date(dateValue) : null;
  return parsedDate && !Number.isNaN(parsedDate.getTime())
    ? parsedDate.toLocaleDateString("en-IN")
    : "N/A";
}

function buildBookingMessage(booking) {
  return [
    "NEW BOOKING:",
    `Booking ID: ${booking.bookingId}`,
    `Name: ${booking.name}`,
    `Email: ${booking.email || "N/A"}`,
    `Phone: ${booking.phone}`,
    `Pickup Location: ${booking.pickup || "N/A"}`,
    `Destination: ${booking.destination || "N/A"}`,
    `Vehicle: ${booking.vehicle || "N/A"}`,
    `Payment Method: ${paymentMethodLabel(booking.payment_method)}`,
    `Booking Advance: INR ${BOOKING_ADVANCE_INR}`,
    `Payment Status: ${booking.payment_status || "pending"}`,
    `Payment ID: ${booking.payment_id || "N/A"}`,
    `Payment Order ID: ${booking.payment_order_id || "N/A"}`,
    `Date: ${formatDate(booking.date)}`,
    `Custom Preferences: ${booking.custom_preferences || "None"}`,
    `Requests: ${booking.requests || "None"}`
  ].join("\n");
}

app.get("/payment-config", (req, res) => {
  return res.json({
    onlinePaymentsEnabled: Boolean(razorpayClient),
    provider: "razorpay",
    bookingAdvanceInr: BOOKING_ADVANCE_INR
  });
});

app.post("/send-whatsapp", async (req, res) => {
  try {
    const booking = sanitizeBooking(req.body.booking);
    const basicError = validateBasicBooking(booking);
    const paymentError = basicError ? "" : await verifyBookingPayment(booking);
    const validationError = basicError || paymentError;

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    if (!twilioClient || !twilioWhatsAppFrom) {
      return res.status(500).json({ error: "Twilio not configured on server" });
    }

    const recipients = ownerWhatsAppNumbers().map(toWhatsAppAddress).filter(Boolean);

    if (recipients.length === 0) {
      return res.status(500).json({ error: "Owner WhatsApp number not configured" });
    }

    const messageBody = buildBookingMessage(booking);
    const results = await Promise.all(recipients.map((to) => (
      twilioClient.messages.create({
        from: twilioWhatsAppFrom,
        to,
        body: messageBody
      })
    )));

    return res.json({
      success: true,
      messagesSent: results.length
    });
  } catch (error) {
    console.error("Error in /send-whatsapp:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/create-order", async (req, res) => {
  try {
    const booking = sanitizeBooking(req.body.booking);
    const validationError = validateBasicBooking(booking);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    if (!ONLINE_PAYMENT_METHODS.has(booking.payment_method)) {
      return res.status(400).json({ error: "Online payment method required" });
    }

    if (!razorpayClient) {
      return res.status(500).json({ error: "Razorpay not configured" });
    }

    const options = {
      amount: BOOKING_ADVANCE_PAISE,
      currency: "INR",
      receipt: booking.bookingId,
      payment_capture: 1,
      notes: {
        bookingId: booking.bookingId,
        name: booking.name,
        phone: booking.phone,
        pickup: booking.pickup || "N/A",
        destination: booking.destination || "N/A"
      }
    };

    const order = await razorpayClient.orders.create(options);
    return res.json({ success: true, order, keyId: razorpayKeyId });
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    return res.status(500).json({ error: "Unable to create order" });
  }
});

app.post("/verify-payment", async (req, res) => {
  try {
    const booking = req.body.booking ? sanitizeBooking(req.body.booking) : null;
    const paymentId = cleanText(req.body.razorpay_payment_id, 120);
    const orderId = cleanText(req.body.razorpay_order_id, 120);
    const signature = cleanText(req.body.razorpay_signature, 200);

    const verification = await verifyRazorpayPaymentDetails({
      orderId,
      paymentId,
      signature,
      booking
    });

    if (verification.error) {
      return res.status(400).json({ error: verification.error });
    }

    return res.json({
      success: true,
      paymentId,
      orderId,
      paymentStatus: verification.status
    });
  } catch (error) {
    console.error("Payment verification error:", error);
    return res.status(500).json({ error: "Unable to verify payment" });
  }
});

app.post("/razorpay-webhook", async (req, res) => {
  try {
    if (!razorpayWebhookSecret) {
      return res.status(500).send("Webhook not configured");
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const signature = req.headers["x-razorpay-signature"];
    const expected = crypto.createHmac("sha256", razorpayWebhookSecret).update(rawBody).digest("hex");

    if (!timingSafeCompare(signature, expected)) {
      console.warn("Invalid razorpay webhook signature");
      return res.status(400).send("invalid signature");
    }

    const event = JSON.parse(rawBody.toString("utf8"));
    console.log("Razorpay webhook received:", event.event);

    if (event.event === "payment.captured" || event.event === "payment.authorized") {
      const payment = event.payload.payment.entity;
      if (twilioClient && twilioWhatsAppFrom) {
        const recipients = ownerWhatsAppNumbers().map(toWhatsAppAddress).filter(Boolean);

        const messageBody =
          `PAYMENT RECEIVED:\n` +
          `Payment ID: ${payment.id}\n` +
          `Order ID: ${payment.order_id}\n` +
          `Amount: ${payment.amount / 100} ${payment.currency}\n` +
          `Method: ${payment.method}`;

        if (recipients.length > 0) {
          await Promise.all(recipients.map((to) => twilioClient.messages.create({
            from: twilioWhatsAppFrom,
            to,
            body: messageBody
          })));
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

app.use(express.static(publicDir));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`WhatsApp server running on port ${PORT}`);
  });
}

module.exports = app;
