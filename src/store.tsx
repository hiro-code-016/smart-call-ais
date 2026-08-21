import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AssignmentEvent, CallLog, Intervention, Lead, Outcome, Salesperson } from '@/types';
import { SALESPEOPLE, SEED_LEADS } from '@/lib/seed';
import { addDays, defaultFollowUpDays, todayISO } from '@/lib/risk';
import {
  initDb,
  isSeeded,
  loadLeads,
  loadSalespeople,
  seedDatabase,
  insertLead,
  insertCall,
  updateCall,
  updateCallRecording,
  updateLeadStatus,
  updateFollowUpDate,
  updateLeadSalesperson,
  insertAssignment,
  insertIntervention,
  resolveIntervention,
  clearAllData,
} from '@/lib/db';
import { placeTwilioCall, isTwilioConfigured } from '@/lib/twilio';

export interface NewLeadInput {
  name: string;
  company: string;
  email?: string;
  phone?: string;
  dealValue: number;
  salespersonId: string;
}

interface Store {
  salespeople: Salesperson[];
  leads: Lead[];
  highRiskThreshold: number;
  activeSalespersonId: string;
  loading: boolean;
  error: string | null;
  setActiveSalesperson: (id: string) => void;
  setHighRiskThreshold: (n: number) => void;
  createLead: (input: NewLeadInput) => Lead;
  reassignLead: (leadId: string, toSalespersonId: string) => void;
  startCall: (leadId: string) => Promise<{ callId: string; isRealCall: boolean; error?: string }>;
  endCall: (leadId: string, callId: string, outcome: Outcome, notes: string) => void;
  fetchRecording: (callId: string, callSid: string) => Promise<void>;
  setFollowUpDate: (leadId: string, date: string | null) => void;
  flagIntervention: (leadId: string, note: string) => void;
  resolveIntervention: (leadId: string, interventionId: string, note: string) => void;
  getLead: (leadId: string) => Lead | undefined;
  resetAll: () => void;
}

const StoreContext = createContext<Store | null>(null);

let idc = 0;
function uid(prefix: string): string {
  idc += 1;
  return `${prefix}_${Date.now().toString(36)}_${idc}`;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [highRiskThreshold, setHighRiskThreshold] = useState(60);
  const [activeSalespersonId, setActiveSalespersonId] = useState<string>('sp_john');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initDb();
        const seeded = await isSeeded();
        if (!seeded) {
          await seedDatabase(SALESPEOPLE, SEED_LEADS);
        }
        const sp = await loadSalespeople();
        const ld = await loadLeads();
        if (cancelled) return;
        setSalespeople(sp);
        setLeads(ld);
        setActiveSalespersonId(sp[0]?.id ?? 'sp_john');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const updateLeadState = useCallback((leadId: string, fn: (l: Lead) => Lead) => {
    setLeads((prev) => prev.map((l) => (l.id === leadId ? fn(l) : l)));
  }, []);

  const createLead = useCallback((input: NewLeadInput): Lead => {
    const lead: Lead = {
      id: uid('lead'),
      name: input.name,
      company: input.company,
      email: input.email,
      phone: input.phone,
      dealValue: input.dealValue,
      status: 'New',
      salespersonId: input.salespersonId,
      createdAt: todayISO(),
      followUpDate: null,
      calls: [],
      assignments: [
        { id: uid('asg'), at: todayISO(), fromSalespersonId: null, toSalespersonId: input.salespersonId, by: 'manager' },
      ],
      interventions: [],
    };
    setLeads((prev) => [lead, ...prev]);
    void insertLead(lead);
    return lead;
  }, []);

  const reassignLead = useCallback(
    (leadId: string, toSalespersonId: string) => {
      const event: AssignmentEvent = {
        id: uid('asg'),
        at: todayISO(),
        fromSalespersonId: null,
        toSalespersonId,
        by: 'manager',
      };
      updateLeadState(leadId, (l) => {
        event.fromSalespersonId = l.salespersonId;
        return { ...l, salespersonId: toSalespersonId, assignments: [...l.assignments, event] };
      });
      void updateLeadSalesperson(leadId, toSalespersonId);
      void insertAssignment({ ...event, leadId });
    },
    [updateLeadState],
  );

  const startCall = useCallback(
    async (leadId: string): Promise<{ callId: string; isRealCall: boolean; error?: string }> => {
      const callId = uid('call');
      const lead = leads.find((l) => l.id === leadId);
      const sp = salespeople.find((s) => s.id === activeSalespersonId);

      let isRealCall = false;
      let callSid: string | undefined;
      let twilioError: string | undefined;

      if (isTwilioConfigured() && lead?.phone && sp?.phone) {
        const result = await placeTwilioCall(
          lead.phone,
          sp.phone,
          lead.name,
          lead.company,
          sp.name,
        );
        if (result.success && result.callSid) {
          isRealCall = true;
          callSid = result.callSid;
        } else {
          twilioError = result.error;
        }
      }

      const call: CallLog = {
        id: callId,
        startedAt: todayISO(),
        endedAt: null,
        durationSec: null,
        outcome: null,
        notes: '',
        salespersonId: activeSalespersonId,
        callSid,
        isRealCall,
      };
      updateLeadState(leadId, (l) => ({ ...l, calls: [...l.calls, call] }));
      void insertCall({ ...call, leadId });
      return { callId, isRealCall, error: twilioError };
    },
    [activeSalespersonId, updateLeadState, leads, salespeople],
  );

  const endCall = useCallback(
    (leadId: string, callId: string, outcome: Outcome, notes: string) => {
      const endedAt = todayISO();
      const lead = leads.find((l) => l.id === leadId);
      if (!lead) return;
      const call = lead.calls.find((c) => c.id === callId);
      if (!call) return;

      const durationSec = Math.max(1, Math.round((new Date(endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000));
      const trimmedNotes = notes.slice(0, 500);

      let status = lead.status;
      if (outcome === 'Spoke - Interested') status = 'Interested';
      else if (outcome === 'Spoke - Not Interested') status = 'Not Interested';
      else if (outcome === 'Disqualified') status = 'Disqualified';
      else if (lead.status === 'New') status = 'In Progress';

      let followUpDate = lead.followUpDate;
      const def = defaultFollowUpDays(outcome);
      if (outcome === 'Disqualified') {
        followUpDate = null;
      } else if (def !== null) {
        const base = todayISO().slice(0, 10);
        followUpDate = addDays(base, def);
      }

      updateLeadState(leadId, (l) => ({
        ...l,
        calls: l.calls.map((c) =>
          c.id === callId ? { ...c, endedAt, durationSec, outcome, notes: trimmedNotes } : c,
        ),
        status,
        followUpDate,
      }));

      void updateCall(callId, endedAt, durationSec, outcome, trimmedNotes);
      void updateLeadStatus(leadId, status, followUpDate);
    },
    [leads, updateLeadState],
  );

  const setFollowUpDate = useCallback(
    (leadId: string, date: string | null) => {
      updateLeadState(leadId, (l) => ({ ...l, followUpDate: date }));
      void updateFollowUpDate(leadId, date);
    },
    [updateLeadState],
  );

  const flagIntervention = useCallback(
    (leadId: string, note: string) => {
      const iv: Intervention = {
        id: uid('iv'),
        at: todayISO(),
        note,
        status: 'open',
      };
      updateLeadState(leadId, (l) => ({ ...l, interventions: [...l.interventions, iv] }));
      void insertIntervention({ ...iv, leadId });
    },
    [updateLeadState],
  );

  const resolveIntervention = useCallback(
    (leadId: string, interventionId: string, note: string) => {
      const resolvedAt = todayISO();
      updateLeadState(leadId, (l) => ({
        ...l,
        interventions: l.interventions.map((iv) =>
          iv.id === interventionId ? { ...iv, status: 'resolved', resolvedAt, resolveNote: note } : iv,
        ),
      }));
      void resolveIntervention(interventionId, resolvedAt, note);
    },
    [updateLeadState],
  );

  const getLead = useCallback((leadId: string) => leads.find((l) => l.id === leadId), [leads]);

  const resetAll = useCallback(async () => {
    await clearAllData();
    await seedDatabase(SALESPEOPLE, SEED_LEADS);
    const sp = await loadSalespeople();
    const ld = await loadLeads();
    setSalespeople(sp);
    setLeads(ld);
    setHighRiskThreshold(60);
    setActiveSalespersonId(sp[0]?.id ?? 'sp_john');
  }, []);

  const fetchRecording = useCallback(
    async (callId: string, callSid: string) => {
      const { fetchRecordingUrl } = await import('@/lib/twilio');
      const recordingUrl = await fetchRecordingUrl(callSid);
      if (recordingUrl) {
        updateLeadState(leads.find((l) => l.calls.some((c) => c.id === callId))?.id ?? '', (l) => ({
          ...l,
          calls: l.calls.map((c) =>
            c.id === callId ? { ...c, recordingSid: recordingUrl } : c,
          ),
        }));
        void updateCallRecording(callId, callSid, recordingUrl);
      }
    },
    [leads, updateLeadState],
  );

  const value = useMemo<Store>(
    () => ({
      salespeople,
      leads,
      highRiskThreshold,
      activeSalespersonId,
      loading,
      error,
      setActiveSalesperson: setActiveSalespersonId,
      setHighRiskThreshold,
      createLead,
      reassignLead,
      startCall,
      endCall,
      fetchRecording,
      setFollowUpDate,
      flagIntervention,
      resolveIntervention,
      getLead,
      resetAll,
    }),
    [salespeople, leads, highRiskThreshold, activeSalespersonId, loading, error, createLead, reassignLead, startCall, endCall, fetchRecording, setFollowUpDate, flagIntervention, resolveIntervention, getLead, resetAll],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
