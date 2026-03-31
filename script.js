const bookingForm = document.getElementById("booking-form");
const statusNode = document.getElementById("form-status");

function buildBookingPayload(formData) {
  const bookingId = `BTT-${Date.now()}`;

  return {
    bookingId,
    name: formData.get("name")?.trim() || "",
    email: formData.get("email")?.trim() || "",
    phone: formData.get("phone")?.trim() || "",
    destination: formData.get("destination") || "",
    vehicle: formData.get("vehicle") || "",
    date: formData.get("date") || "",
    requests: formData.get("requests")?.trim() || ""
  };
}

async function submitBooking(event) {
  event.preventDefault();

  if (!bookingForm || !statusNode) {
    return;
  }

  const formData = new FormData(bookingForm);
  const booking = buildBookingPayload(formData);
  const ownerWhatsApp = "919648811494";

  statusNode.textContent = "Submitting your booking...";

  try {
    const response = await fetch("/send-whatsapp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ booking, ownerWhatsApp })
    });

    if (!response.ok) {
      throw new Error("Server request failed");
    }

    statusNode.textContent = "Booking submitted successfully. We will contact you soon.";
    bookingForm.reset();
  } catch (error) {
    const message = [
      "New Booking",
      `Booking ID: ${booking.bookingId}`,
      `Name: ${booking.name}`,
      `Phone: ${booking.phone}`,
      `Email: ${booking.email || "N/A"}`,
      `Destination: ${booking.destination}`,
      `Vehicle: ${booking.vehicle}`,
      `Date: ${booking.date}`,
      `Requests: ${booking.requests || "None"}`
    ].join("\n");

    window.open(`https://wa.me/${ownerWhatsApp}?text=${encodeURIComponent(message)}`, "_blank");
    statusNode.textContent = "Direct WhatsApp opened because server is not available right now.";
  }
}

if (bookingForm) {
  bookingForm.addEventListener("submit", submitBooking);
}
