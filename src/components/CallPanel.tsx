import { useEffect, useRef, useState } from 'react';
import { PhoneCall, PhoneOff, Square, Settings, AlertCircle, CheckCircle2, Loader2, Mic } from 'lucide-react';
import { useStore } from '@/store';
import type { Lead, Outcome } from '@/types';
import { OUTCOMES } from '@/types';
import { formatDuration } from '@/lib/risk';
import { Modal } from './Modal';
import { OutcomeBadge } from './Badges';
import { isTwilioConfigured, getTwilioSettings, saveTwilioSettings, clearTwilioSettings } from '@/lib/twilio';

export function CallPanel({ lead }: { lead: Lead }) {
  const { startCall, endCall, salespeople, activeSalespersonId } = useStore();
  const [callId, setCallId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [notes, setNotes] = useState('');
  const [callStatus, setCallStatus] = useState<'idle' | 'connecting' | 'in-progress' | 'error'>('idle');
  const [callError, setCallError] = useState<string | null>(null);
  const [isRealCall, setIsRealCall] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const timerRef = useRef<number | null>(null);

  const activeSp = salespeople.find((s) => s.id === activeSalespersonId);
  const twilioReady = isTwilioConfigured();

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  const activeCall = lead.calls.find((c) => c.id === callId && !c.endedAt);
  const activeCallId = activeCall?.id;
  const activeCallStart = activeCall?.startedAt;

  useEffect(() => {
    if (activeCallId && activeCallStart) {
      const start = new Date(activeCallStart).getTime();
      setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
      }, 1000);
    } else {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      setElapsed(0);
    }
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [activeCallId, activeCallStart]);

  useEffect(() => {
    if (!lead.calls.some((c) => c.id === callId)) {
      setCallId(null);
      setOutcome(null);
      setNotes('');
      setCallStatus('idle');
      setCallError(null);
      setIsRealCall(false);
    }
  }, [lead.id, lead.calls, callId]);

  const handleStart = async () => {
    setCallStatus('connecting');
    setCallError(null);

    if (!lead.phone) {
      setCallStatus('error');
      setCallError('This lead has no phone number. Add one before calling.');
      return;
    }

    if (twilioReady && activeSp?.phone) {
      const result = await startCall(lead.id);
      if (result.callId) {
        setCallId(result.callId);
        if (result.isRealCall) {
          setIsRealCall(true);
          setCallStatus('in-progress');
        } else if (result.error) {
          setIsRealCall(false);
          setCallStatus('in-progress');
          setCallError(result.error);
        } else {
          setIsRealCall(false);
          setCallStatus('in-progress');
        }
      }
    } else {
      const result = await startCall(lead.id);
      if (result.callId) {
        setCallId(result.callId);
        setIsRealCall(false);
        setCallStatus('in-progress');
        if (!twilioReady) {
          setCallError('Twilio not configured. Running in simulation mode. Click the gear icon to set up real calls.');
        } else if (!activeSp?.phone) {
          setCallError('Your salesperson profile has no phone number. Add one to enable real calls.');
        }
      }
    }
  };

  const handleEndClick = () => {
    if (!callId) return;
    setModalOpen(true);
  };

  const handleConfirm = () => {
    if (!callId || !outcome) return;
    endCall(lead.id, callId, outcome, notes);
    setCallId(null);
    setModalOpen(false);
    setOutcome(null);
    setNotes('');
    setCallStatus('idle');
    setCallError(null);
    setIsRealCall(false);
  };

  const handleCancelCall = () => {
    if (!callId) return;
    endCall(lead.id, callId, 'No Answer', 'Call cancelled before completion.');
    setCallId(null);
    setCallStatus('idle');
    setCallError(null);
    setIsRealCall(false);
  };

  const canRealCall = twilioReady && !!lead.phone && !!activeSp?.phone;

  return (
    <div className="glass p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PhoneCall size={18} className="text-brand-300" />
          <h3 className="text-base font-semibold text-slate-100">Call</h3>
          {isRealCall && callStatus === 'in-progress' && (
            <span className="chip border border-emerald-400/30 bg-emerald-500/15 text-emerald-300">
              <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            {canRealCall ? 'Real call via Twilio' : twilioReady ? 'Simulated (no rep phone)' : 'Simulated'}
          </span>
          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
            title="Twilio settings"
          >
            <Settings size={15} />
          </button>
        </div>
      </div>

      {callError && callStatus !== 'idle' && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-amber-400" />
          <p className="text-xs text-amber-300">{callError}</p>
        </div>
      )}

      <div className="mt-4 flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-ink-900/50 p-6">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            {activeCall && (
              <span className="absolute inline-flex h-full w-full animate-ring rounded-full bg-emerald-500 opacity-60" />
            )}
            <span
              className={`relative inline-flex h-3 w-3 rounded-full ${
                callStatus === 'connecting'
                  ? 'bg-amber-500'
                  : activeCall
                    ? 'bg-emerald-500'
                    : 'bg-slate-600'
              }`}
            />
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
            {callStatus === 'connecting'
              ? 'Connecting via Twilio...'
              : activeCall
                ? isRealCall ? 'Call in progress' : 'Timer running'
                : 'Ready to call'}
          </span>
        </div>

        <div className="font-mono text-4xl font-semibold tabular text-slate-50">
          {formatDuration(elapsed)}
        </div>

        {isRealCall && callStatus === 'in-progress' && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Mic size={12} className="text-emerald-400" />
            <span>Recording enabled</span>
          </div>
        )}

        <div className="flex gap-3">
          {!activeCall ? (
            <button
              onClick={handleStart}
              disabled={callStatus === 'connecting'}
              className="btn-primary disabled:opacity-60"
            >
              {callStatus === 'connecting' ? (
                <><Loader2 size={16} className="animate-spin" /> Connecting...</>
              ) : (
                <><PhoneCall size={16} /> {canRealCall ? 'Start Call' : 'Start Call'}</>
              )}
            </button>
          ) : (
            <>
              <button onClick={handleEndClick} className="btn-primary">
                <Square size={16} /> End & Log
              </button>
              <button onClick={handleCancelCall} className="btn-ghost">
                <PhoneOff size={16} /> Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {!canRealCall && callStatus === 'idle' && !callError && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-white/5 bg-white/5 p-3">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-slate-500" />
          <p className="text-xs text-slate-500">
            {!twilioReady
              ? 'Click the gear icon to configure Twilio for real phone calls with recording.'
              : !lead.phone
                ? 'Add a phone number to this lead to enable real calls.'
                : 'Add your phone number in Settings to receive the call bridge.'}
          </p>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Log call outcome"
        subtitle={`Duration ${formatDuration(elapsed)} · ${lead.company}`}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={!outcome} onClick={handleConfirm}>
              <Square size={14} /> Save outcome
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <span className="label">Outcome (required)</span>
            <div className="grid grid-cols-1 gap-2">
              {OUTCOMES.map((o) => {
                const selected = outcome === o;
                return (
                  <button
                    key={o}
                    onClick={() => setOutcome(o)}
                    className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm transition-all ${
                      selected
                        ? 'border-brand-400/60 bg-brand-500/15 text-slate-100 shadow-glow'
                        : 'border-white/10 bg-ink-900/50 text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <span>{o}</span>
                    {selected && <OutcomeBadge outcome={o} />}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="label mb-0">Notes</span>
              <span className="text-xs text-slate-500">{notes.length}/500</span>
            </div>
            <textarea
              value={notes}
              maxLength={500}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && outcome) {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              rows={4}
              placeholder="What happened on this call? (Ctrl+Enter to save)"
              className="input resize-none"
            />
          </div>
        </div>
      </Modal>

      <TwilioSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function TwilioSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      const existing = getTwilioSettings();
      if (existing) {
        setAccountSid(existing.accountSid);
        setAuthToken(existing.authToken);
        setPhoneNumber(existing.phoneNumber);
      }
      setSaved(false);
    }
  }, [open]);

  const handleSave = () => {
    if (!accountSid.trim() || !authToken.trim() || !phoneNumber.trim()) return;
    saveTwilioSettings({
      accountSid: accountSid.trim(),
      authToken: authToken.trim(),
      phoneNumber: phoneNumber.trim(),
    });
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 1200);
  };

  const handleClear = () => {
    clearTwilioSettings();
    setAccountSid('');
    setAuthToken('');
    setPhoneNumber('');
    onClose();
  };

  const existing = isTwilioConfigured();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Twilio call settings"
      subtitle="Connect your Twilio account for real phone calls with recording"
      footer={
        <>
          {existing && (
            <button className="btn-ghost text-coral-300" onClick={handleClear}>
              Remove credentials
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button
            className="btn-primary"
            disabled={!accountSid.trim() || !authToken.trim() || !phoneNumber.trim() || saved}
            onClick={handleSave}
          >
            {saved ? <><CheckCircle2 size={15} /> Saved</> : 'Save credentials'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-brand-400/20 bg-brand-500/5 p-3">
          <p className="text-xs text-slate-400">
            Create a free account at twilio.com to get these values. On the free trial,
            you can only call verified numbers. The salesperson's phone rings first,
            then Twilio bridges to the lead with recording enabled.
          </p>
        </div>
        <div>
          <span className="label">Account SID</span>
          <input
            type="text"
            value={accountSid}
            onChange={(e) => setAccountSid(e.target.value)}
            placeholder="AC..."
            className="input tabular"
          />
        </div>
        <div>
          <span className="label">Auth Token</span>
          <input
            type="password"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder="Your Twilio auth token"
            className="input tabular"
          />
        </div>
        <div>
          <span className="label">Twilio Phone Number</span>
          <input
            type="text"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+1234567890"
            className="input tabular"
          />
          <p className="mt-1.5 text-xs text-slate-500">
            Your Twilio trial number, in E.164 format (country code + number).
          </p>
        </div>
      </div>
    </Modal>
  );
}
