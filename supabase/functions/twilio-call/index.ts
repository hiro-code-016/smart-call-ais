import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface StartCallRequest {
  to: string;
  from: string;
  callId: string;
  leadName?: string;
  company?: string;
  salespersonName?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!accountSid || !authToken || !fromNumber) {
      return new Response(
        JSON.stringify({
          configured: false,
          error: "Twilio credentials are not configured.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body: StartCallRequest = await req.json();
    const { to, from, callId, leadName, company, salespersonName } = body;

    if (!to || !from || !callId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, from, callId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cleanTo = to.replace(/[^+\d]/g, "");
    const cleanFrom = from.replace(/[^+\d]/g, "");

    if (!cleanTo.match(/^\+\d{10,15}$/)) {
      return new Response(
        JSON.stringify({ error: `Invalid lead phone number: ${to}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!cleanFrom.match(/^\+\d{10,15}$/)) {
      return new Response(
        JSON.stringify({ error: `Invalid salesperson phone number: ${from}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const greeting = `Connecting ${salespersonName || "you"} to ${leadName || "the lead"} at ${company || ""}. This call will be recorded.`;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${greeting}</Say>
  <Dial record="record-from-answer" timeout="30">
    <Number>${cleanTo}</Number>
  </Dial>
</Response>`;

    const params = new URLSearchParams();
    params.append("To", cleanFrom);
    params.append("From", fromNumber);
    params.append("Twiml", twiml);
    params.append("Timeout", "30");

    const callUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;

    const twilioResponse = await fetch(callUrl, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!twilioResponse.ok) {
      const errorText = await twilioResponse.text();
      let errorMessage = `Twilio API error (${twilioResponse.status})`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorMessage;
      } catch {
        if (errorText) errorMessage = errorText.slice(0, 300);
      }
      return new Response(
        JSON.stringify({ error: errorMessage, twilioStatus: twilioResponse.status }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const callData = await twilioResponse.json();

    return new Response(
      JSON.stringify({
        configured: true,
        callSid: callData.sid,
        status: callData.status,
        from: fromNumber,
        to: cleanFrom,
        bridgedTo: cleanTo,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
