import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");

    if (!accountSid || !authToken) {
      return new Response(
        JSON.stringify({ error: "Twilio not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url = new URL(req.url);
    const callSid = url.searchParams.get("callSid") || "";

    if (!callSid) {
      return new Response(
        JSON.stringify({ error: "Missing callSid parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const recordingsUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings.json?CallSid=${callSid}`;
    const response = await fetch(recordingsUrl, {
      headers: {
        "Authorization": `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      },
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Twilio API error (${response.status})` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    const recordings = (data.recordings || []).map((r: any) => ({
      sid: r.sid,
      duration: r.duration,
      url: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${r.sid}.mp3`,
      status: r.status,
    }));

    return new Response(
      JSON.stringify({ recordings, callSid }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
