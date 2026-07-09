let bookingAdvanceInr = 500;
const WHATSAPP_NUMBERS = ["919648811494", "918874704581"];
const ONLINE_PAYMENT_METHODS = new Set(["card", "upi", "netbanking", "wallet"]);

const bookingForm = document.getElementById("booking-form");
const statusNode = document.getElementById("form-status");
const submitButton = bookingForm?.querySelector(".book-btn") || null;

const navToggle = document.querySelector(".nav-toggle");
const navMenu = document.querySelector(".nav-menu");
const navLinks = document.querySelectorAll(".nav-menu a");

const destinationSelect = document.querySelector('select[name="destination"]');
const customDestinationInput = document.getElementById("custom-destination");
const pickupSelect = document.querySelector('select[name="pickup"]');
const customPickupInput = document.getElementById("custom-pickup");

const customTourForm = document.getElementById("custom-tour-form");
const customPreferencesHidden = document.getElementById("custom-preferences-hidden");
const bookingRequestsField = document.querySelector('#booking-form textarea[name="requests"]');
const paymentMethodSelect = document.querySelector('select[name="payment_method"]');
const paymentModeNote = document.getElementById("payment-mode-note");
const bookingAdvanceAmount = document.getElementById("booking-advance-amount");
let onlinePaymentsEnabled = true;

function setFormStatus(message, type = "info") {
  if (!statusNode) {
    return;
  }

  statusNode.textContent = message;
  statusNode.style.display = "block";
  statusNode.classList.remove("success", "error", "info");
  statusNode.classList.add(type);
}

function setSubmitting(isSubmitting) {
  if (!submitButton) {
    return;
  }

  submitButton.disabled = isSubmitting;
  submitButton.textContent = isSubmitting ? "Processing..." : "Submit Booking";
}

function setPaymentModeNote(message = "", isError = false) {
  if (!paymentModeNote) {
    return;
  }

  paymentModeNote.textContent = message;
  paymentModeNote.style.display = message ? "block" : "none";
  paymentModeNote.classList.toggle("is-error", isError);
}

function updateBookingAdvanceAmount() {
  if (bookingAdvanceAmount) {
    bookingAdvanceAmount.textContent = `₹${bookingAdvanceInr}`;
  }
}

function updatePaymentMethodAvailability() {
  if (!paymentMethodSelect) {
    return;
  }

  Array.from(paymentMethodSelect.options).forEach((option) => {
    if (!option.dataset.baseLabel) {
      option.dataset.baseLabel = option.textContent;
    }

    if (!ONLINE_PAYMENT_METHODS.has(option.value)) {
      return;
    }

    option.disabled = !onlinePaymentsEnabled;
    option.textContent = onlinePaymentsEnabled
      ? option.dataset.baseLabel
      : `${option.dataset.baseLabel} (Temporarily unavailable)`;
  });

  if (!onlinePaymentsEnabled && ONLINE_PAYMENT_METHODS.has(paymentMethodSelect.value)) {
    const cashOption = paymentMethodSelect.querySelector('option[value="cash"]');
    paymentMethodSelect.value = cashOption ? "cash" : "";
  }

  if (onlinePaymentsEnabled) {
    setPaymentModeNote("Secure online payment is active for booking advance.");
  } else {
    setPaymentModeNote("Online payment is currently unavailable. Please use Cash on Pickup.", true);
  }
}

async function initializePaymentConfig() {
  if (!paymentMethodSelect) {
    return;
  }

  try {
    const response = await fetch("/payment-config", {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error("PAYMENT_CONFIG_FAILED");
    }

    const config = await response.json();
    onlinePaymentsEnabled = Boolean(config.onlinePaymentsEnabled);

    if (Number.isFinite(Number(config.bookingAdvanceInr)) && Number(config.bookingAdvanceInr) > 0) {
      bookingAdvanceInr = Number(config.bookingAdvanceInr);
    }
  } catch (error) {
    onlinePaymentsEnabled = false;
  }

  updatePaymentMethodAvailability();
  updateBookingAdvanceAmount();
}

function valueOf(formData, field) {
  return (formData.get(field) || "").toString().trim();
}

function buildBookingPayload(formData) {
  const bookingId = `BTT-${Date.now()}`;
  const destination = valueOf(formData, "destination");
  const customDestination = valueOf(formData, "custom_destination");
  const pickup = valueOf(formData, "pickup");
  const customPickup = valueOf(formData, "custom_pickup");
  const customPreferences = valueOf(formData, "custom_preferences");

  return {
    bookingId,
    name: valueOf(formData, "name"),
    email: valueOf(formData, "email"),
    phone: valueOf(formData, "phone"),
    pickup: pickup === "custom" ? customPickup : pickup,
    destination: destination === "custom" ? customDestination : destination,
    vehicle: valueOf(formData, "vehicle"),
    payment_method: valueOf(formData, "payment_method"),
    date: valueOf(formData, "date"),
    requests: valueOf(formData, "requests"),
    custom_preferences: customPreferences,
    booking_advance_inr: bookingAdvanceInr,
    payment_status: "pending",
    payment_id: "",
    payment_order_id: "",
    payment_signature: ""
  };
}

function buildBookingMessage(booking) {
  return [
    "New Booking",
    `Booking ID: ${booking.bookingId}`,
    `Name: ${booking.name}`,
    `Phone: ${booking.phone}`,
    `Email: ${booking.email || "N/A"}`,
    `Pickup Location: ${booking.pickup || "N/A"}`,
    `Destination: ${booking.destination || "N/A"}`,
    `Vehicle: ${booking.vehicle || "N/A"}`,
    `Payment Method: ${booking.payment_method || "N/A"}`,
    `Booking Advance: INR ${booking.booking_advance_inr}`,
    `Payment Status: ${booking.payment_status || "pending"}`,
    `Payment ID: ${booking.payment_id || "N/A"}`,
    `Payment Order ID: ${booking.payment_order_id || "N/A"}`,
    `Date: ${booking.date || "N/A"}`,
    `Custom Preferences: ${booking.custom_preferences || "None"}`,
    `Requests: ${booking.requests || "None"}`
  ].join("\n");
}

function openWhatsAppFallback(message) {
  const encodedMessage = encodeURIComponent(message);

  WHATSAPP_NUMBERS.forEach((number, index) => {
    setTimeout(() => {
      const popup = window.open(`https://wa.me/${number}?text=${encodedMessage}`, "_blank", "noopener,noreferrer");
      if (popup) {
        popup.opener = null;
      }
    }, index * 500);
  });
}

async function sendBookingToServer(booking) {
  const response = await fetch("/send-whatsapp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ booking })
  });

  if (!response.ok) {
    throw new Error("BOOKING_SUBMIT_FAILED");
  }
}

async function createRazorpayOrder(booking) {
  const response = await fetch("/create-order", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      booking
    })
  });

  if (!response.ok) {
    throw new Error("PAYMENT_ORDER_FAILED");
  }

  return response.json();
}

async function verifyRazorpayPayment(booking, paymentResponse, fallbackOrderId) {
  const response = await fetch("/verify-payment", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      bookingId: booking.bookingId,
      booking,
      razorpay_payment_id: paymentResponse.razorpay_payment_id || "",
      razorpay_order_id: paymentResponse.razorpay_order_id || fallbackOrderId,
      razorpay_signature: paymentResponse.razorpay_signature || ""
    })
  });

  if (!response.ok) {
    throw new Error("PAYMENT_VERIFICATION_FAILED");
  }

  return response.json();
}

function openRazorpayCheckout(orderPayload, booking) {
  if (!window.Razorpay) {
    throw new Error("PAYMENT_SDK_MISSING");
  }

  return new Promise((resolve, reject) => {
    const selectedMethod = booking.payment_method;
    const methods = {
      card: selectedMethod === "card",
      upi: selectedMethod === "upi",
      netbanking: selectedMethod === "netbanking",
      wallet: selectedMethod === "wallet"
    };

    const options = {
      key: orderPayload.keyId,
      amount: orderPayload.order.amount,
      currency: orderPayload.order.currency,
      name: "Binu Tours & Travels",
      description: `Booking advance (INR ${bookingAdvanceInr})`,
      order_id: orderPayload.order.id,
      prefill: {
        name: booking.name,
        email: booking.email,
        contact: booking.phone
      },
      notes: {
        bookingId: booking.bookingId,
        pickup: booking.pickup || "N/A",
        destination: booking.destination || "N/A"
      },
      method: methods,
      theme: {
        color: "#0f5f7f"
      },
      modal: {
        ondismiss: () => reject(new Error("PAYMENT_CANCELLED"))
      },
      handler: (response) => resolve(response)
    };

    const razorpay = new window.Razorpay(options);
    razorpay.on("payment.failed", () => reject(new Error("PAYMENT_FAILED")));
    razorpay.open();
  });
}

function resetCustomBookingState() {
  if (customPickupInput) {
    customPickupInput.style.display = "none";
    customPickupInput.required = false;
    customPickupInput.value = "";
  }

  if (customDestinationInput) {
    customDestinationInput.style.display = "none";
    customDestinationInput.required = false;
    customDestinationInput.value = "";
  }

  if (customPreferencesHidden) {
    customPreferencesHidden.value = "";
  }
}

async function submitBooking(event) {
  event.preventDefault();

  if (!bookingForm || !statusNode) {
    return;
  }

  const formData = new FormData(bookingForm);
  const booking = buildBookingPayload(formData);
  let bookingMessage = buildBookingMessage(booking);

  setSubmitting(true);
  setFormStatus("Preparing your booking...");

  try {
    if (ONLINE_PAYMENT_METHODS.has(booking.payment_method) && !onlinePaymentsEnabled) {
      throw new Error("ONLINE_PAYMENT_DISABLED");
    }

    if (ONLINE_PAYMENT_METHODS.has(booking.payment_method)) {
      setFormStatus("Creating secure payment order...");
      const orderPayload = await createRazorpayOrder(booking);

      setFormStatus("Opening payment gateway...");
      const paymentResponse = await openRazorpayCheckout(orderPayload, booking);

      setFormStatus("Verifying payment...");
      const verification = await verifyRazorpayPayment(booking, paymentResponse, orderPayload.order.id);

      booking.payment_status = verification.paymentStatus || "paid";
      booking.payment_id = paymentResponse.razorpay_payment_id || "";
      booking.payment_order_id = paymentResponse.razorpay_order_id || orderPayload.order.id;
      booking.payment_signature = paymentResponse.razorpay_signature || "";
      bookingMessage = buildBookingMessage(booking);
    } else {
      booking.payment_status = "cash_on_pickup";
      bookingMessage = buildBookingMessage(booking);
    }

    setFormStatus("Submitting your booking...");
    await sendBookingToServer(booking);

    setFormStatus("Booking submitted successfully! Details sent on WhatsApp.", "success");
    bookingForm.reset();
    resetCustomBookingState();
  } catch (error) {
    if (error.message === "ONLINE_PAYMENT_DISABLED") {
      setFormStatus("Online payment is unavailable right now. Please choose Cash on Pickup.", "error");
      return;
    }

    if (error.message === "PAYMENT_CANCELLED") {
      setFormStatus("Payment cancelled. Booking not submitted.", "error");
      return;
    }

    if (error.message === "PAYMENT_FAILED") {
      setFormStatus("Payment failed. Please try again.", "error");
      return;
    }

    if (error.message === "PAYMENT_VERIFICATION_FAILED") {
      setFormStatus("Payment verification failed. Please contact us with your payment ID.", "error");
      return;
    }

    if (error.message === "PAYMENT_ORDER_FAILED" || error.message === "PAYMENT_SDK_MISSING") {
      setFormStatus("Online payment is unavailable right now. Opening WhatsApp booking fallback...", "error");
      openWhatsAppFallback(bookingMessage);
      return;
    }

    setFormStatus("Server unavailable. Opening WhatsApp windows to complete booking...", "error");
    openWhatsAppFallback(bookingMessage);
  } finally {
    setSubmitting(false);
  }
}

if (bookingForm) {
  bookingForm.addEventListener("submit", submitBooking);
}

initializePaymentConfig();

function closeMobileMenu() {
  if (!navToggle || !navMenu) {
    return;
  }

  navToggle.classList.remove("is-open");
  navMenu.classList.remove("is-open");
  navToggle.setAttribute("aria-expanded", "false");
}

if (navToggle && navMenu) {
  navToggle.addEventListener("click", () => {
    const isOpen = navMenu.classList.toggle("is-open");
    navToggle.classList.toggle("is-open", isOpen);
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });

  navLinks.forEach((link) => {
    link.addEventListener("click", closeMobileMenu);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 820) {
      closeMobileMenu();
    }
  });
}

if (destinationSelect && customDestinationInput) {
  destinationSelect.addEventListener("change", (event) => {
    if (event.target.value === "custom") {
      customDestinationInput.style.display = "block";
      customDestinationInput.required = true;
    } else {
      customDestinationInput.style.display = "none";
      customDestinationInput.required = false;
      customDestinationInput.value = "";
    }
  });
}

if (pickupSelect && customPickupInput) {
  pickupSelect.addEventListener("change", (event) => {
    if (event.target.value === "custom") {
      customPickupInput.style.display = "block";
      customPickupInput.required = true;
    } else {
      customPickupInput.style.display = "none";
      customPickupInput.required = false;
      customPickupInput.value = "";
    }
  });
}

if (customTourForm) {
  customTourForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const customPickupLocation = document.querySelector('input[name="custom_pickup_location"]')?.value.trim();
    const customDestinationValue = document.querySelector('input[name="custom_destination_input"]')?.value.trim();
    const customPreferenceValue = document.querySelector('textarea[name="custom_preferences"]')?.value.trim();

    const bookingPickupSelect = document.querySelector('select[name="pickup"]');
    const bookingCustomPickup = document.getElementById("custom-pickup");
    const bookingDestinationSelect = document.querySelector('select[name="destination"]');
    const bookingCustomDestination = document.getElementById("custom-destination");

    if (customPickupLocation && bookingPickupSelect && bookingCustomPickup) {
      bookingPickupSelect.value = "custom";
      bookingCustomPickup.value = customPickupLocation;
      bookingCustomPickup.style.display = "block";
      bookingCustomPickup.required = true;
    }

    if (customDestinationValue && bookingDestinationSelect && bookingCustomDestination) {
      bookingDestinationSelect.value = "custom";
      bookingCustomDestination.value = customDestinationValue;
      bookingCustomDestination.style.display = "block";
      bookingCustomDestination.required = true;
    }

    if (customPreferencesHidden) {
      customPreferencesHidden.value = customPreferenceValue || "";
    }

    if (bookingRequestsField && !bookingRequestsField.value.trim() && customPreferenceValue) {
      bookingRequestsField.value = customPreferenceValue;
    }

    const bookingSection = document.getElementById("booking");
    if (bookingSection) {
      bookingSection.scrollIntoView({ behavior: "smooth" });
    }
  });
}
