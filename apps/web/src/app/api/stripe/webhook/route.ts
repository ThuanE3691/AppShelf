import type Stripe from "stripe";
import { processStripeEvent } from "@/lib/lifecycle";
import { getStripe, getWebhookSecret } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing Stripe-Signature header" }, { status: 400 });

  const secret = await getWebhookSecret();
  if (!secret) return Response.json({ error: "Webhook signing secret is not configured" }, { status: 503 });

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const outcome = await processStripeEvent(event);
    return Response.json({ received: true, outcome });
  } catch (error) {
    // 500 makes Stripe retry; the event row was rolled back with the work.
    console.error(`stripe webhook ${event.type} ${event.id} failed`, error);
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}
