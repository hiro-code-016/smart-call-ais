export interface TwilioSettings {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

const STORAGE_KEY = 'twilio-settings';

export function getTwilioSettings(): TwilioSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.accountSid || !parsed.authToken || !parsed.phoneNumber) return null;
    return parsed as TwilioSettings;
  } catch {
    return null;
  }
}

export function saveTwilioSettings(settings: TwilioSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearTwilioSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function isTwilioConfigured(): boolean {
  return getTwilioSettings() !== null;
}

export interface TwilioCallResult {
  success: boolean;
  callSid?: string;
  error?: string;
}

export async function placeTwilioCall(
  to: string,
  from: string,
  leadName: string,
  company: string,
  salespersonName: string,
): Promise<TwilioCallResult> {
  const settings = getTwilioSettings();
  if (!settings) {
    return { success: false, error: 'Twilio is not configured. Add your credentials in Settings.' };
  }

  const cleanTo = to.replace(/[^+\d]/g, '');
  const cleanFrom = from.replace(/[^+\d]/g, '');

  if (!cleanTo.match(/^\+\d{10,15}$/)) {
    return { success: false, error: `Invalid lead phone number: ${to}` };
  }
  if (!cleanFrom.match(/^\+\d{10,15}$/)) {
    return { success: false, error: `Invalid salesperson phone number: ${from}` };
  }

  const greeting = `Connecting ${salespersonName} to ${leadName} at ${company}. This call will be recorded.`;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${greeting}</Say>
  <Dial record="record-from-answer" timeout="30">
    <Number>${cleanTo}</Number>
  </Dial>
</Response>`;

  const params = new URLSearchParams();
  params.append("To", cleanFrom);
  params.append("From", settings.phoneNumber);
  params.append("Twiml", twiml);
  params.append("Timeout", "30");

  const callUrl = `https://api.twilio.com/2010-04-01/Accounts/${settings.accountSid}/Calls.json`;

  try {
    const response = await fetch(callUrl, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${settings.accountSid}:${settings.authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Twilio error (${response.status})`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorMessage;
      } catch {
        if (errorText) errorMessage = errorText.slice(0, 300);
      }
      return { success: false, error: errorMessage };
    }

    const data = await response.json();
    return { success: true, callSid: data.sid };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Network error calling Twilio" };
  }
}

export async function fetchRecordingUrl(callSid: string): Promise<string | null> {
  const settings = getTwilioSettings();
  if (!settings || !callSid) return null;

  try {
    const recordingsUrl = `https://api.twilio.com/2010-04-01/Accounts/${settings.accountSid}/Recordings.json?CallSid=${callSid}`;
    const response = await fetch(recordingsUrl, {
      headers: {
        "Authorization": `Basic ${btoa(`${settings.accountSid}:${settings.authToken}`)}`,
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    const recordings = data.recordings || [];
    if (recordings.length === 0) return null;

    const sid = recordings[0].sid;
    return `https://api.twilio.com/2010-04-01/Accounts/${settings.accountSid}/Recordings/${sid}.mp3`;
  } catch {
    return null;
  }
}
