import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

const SUPABASE_URL = "https://zaebyhuuwnsvhhnnhcsj.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_STRIPE_PUBLISHABLE_KEY;

// Use the anon key for now — we'll use service key later for secure writes
const SUPABASE_ANON_KEY = "sb_publishable_JnmOtNTTux_wONg0ULPPZA_0xebodgL";

export const config = {
  api: {
    bodyParser: false, // Required for Stripe webhook signature verification
  },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function sb(path, method = "GET", body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "resolution=merge-duplicates,return=minimal" : "return=representation,count=exact",
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (method === "GET") return res.json();
  return res;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { day, hour, originalName, repName, repPinHash, weekKey } = session.metadata;

    try {
      // Save the substitute booking
      const repKey = `${weekKey}-rep-${day}-${hour}-${originalName}`;
      await sb(`cancelled?cancel_key=eq.${encodeURIComponent(repKey)}`, "PATCH", {
        names: [{ name: repName, pinHash: repPinHash }],
      });

      // Also save payment record
      await sb("payments", "POST", {
        stripe_session_id: session.id,
        day,
        hour: parseFloat(hour),
        original_name: originalName,
        rep_name: repName,
        amount: session.amount_total,
        currency: session.currency,
        week_key: weekKey,
        paid_at: new Date().toISOString(),
        status: "paid",
      });

      console.log(`✅ Payment confirmed: ${repName} subbing for ${originalName} on ${day}`);
    } catch (err) {
      console.error("Supabase error:", err);
      return res.status(500).json({ error: "Failed to save booking" });
    }
  }

  res.status(200).json({ received: true });
}
