import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { day, hour, originalName, repName, repPinHash, weekKey } = req.body;

  if (!day || !hour || !originalName || !repName || !repPinHash || !weekKey) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      currency: "eur",
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Padel Class - ${day} at ${formatHour(hour)}`,
              description: `Substitute booking for ${originalName} at Celbridge Padel Academy`,
            },
            unit_amount: 2500, // €25.00 in cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        day,
        hour: String(hour),
        originalName,
        repName,
        repPinHash,
        weekKey,
      },
      success_url: `https://celbridge-padel-academy.vercel.app/?payment=success&rep=${encodeURIComponent(repName)}&day=${day}&hour=${hour}`,
      cancel_url: `https://celbridge-padel-academy.vercel.app/?payment=cancelled`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: err.message });
  }
}

function formatHour(h) {
  const hrs = Math.floor(h);
  const mins = h % 1 === 0.5 ? "30" : "00";
  const period = hrs < 12 ? "AM" : "PM";
  const display = hrs <= 12 ? hrs : hrs - 12;
  return `${display}:${mins} ${period}`;
}
