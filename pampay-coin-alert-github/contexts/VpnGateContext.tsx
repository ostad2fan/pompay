/**
 * VpnGateContext.tsx — v1.4.8 single shared exit-IP poller for the WHOLE app.
 *
 * One provider (mounted above everything in _layout) force-rechecks the
 * public exit IP + country every 15 seconds (and instantly on every app
 * resume). Everything else consumes the state:
 *
 *   • StartupIpGate      — full-screen blocking overlay when status === 'iran'
 *                          (covers startup AND «فیلترشکن وسط کار خاموش شد»)
 *   • Settings IP card   — live IP/country display at the top of the settings
 *   • meme-scanner/pre-listing/etc — queries disabled while blocked
 *   • AppContext scan    — refuses to scan Binance while blocked
 *   • Wallet screen      — foreign-exchange queries fully gated (v1.4.7)
 *
 * The check bypasses vpnGuard's 2-minute cache (force) so a VPN toggle is
 * noticed within one poll cycle (≤15s).
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { getIpInfo, IpInfo, VpnStatus } from '@/utils/vpnGuard';

/** How often the exit IP is re-checked while the app is open. */
const POLL_MS = 15_000;

interface VpnGateState {
  status: VpnStatus;
  ip?: string;
  country?: string;
  countryNameFa?: string;
  checking: boolean;
  lastCheckedAt: number | null;
  /** true ONLY on a POSITIVE Iranian-IP match (never for 'unknown'). */
  blocked: boolean;
  /** The moment the gate re-armed after having been released before
   *  (mid-session VPN-off) — used to switch the gate's message. */
  reArmedAt: number | null;
  recheck: () => Promise<void>;
}

const VpnGateContext = createContext<VpnGateState | null>(null);

export function VpnGateProvider({ children }: { children: React.ReactNode }) {
  const [info, setInfo] = useState<IpInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [reArmedAt, setReArmedAt] = useState<number | null>(null);
  const appState = useRef(AppState.currentState);
  const releasedOnce = useRef(false);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      const result = await getIpInfo(true);
      setInfo(result);
      setLastCheckedAt(Date.now());
      if (result.status === 'vpn') {
        releasedOnce.current = true;
        setReArmedAt(null);
      } else if (result.status === 'iran') {
        // Released before + now Iranian again → mid-session VPN drop.
        if (releasedOnce.current) setReArmedAt(Date.now());
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void runCheck();
    const timer = setInterval(() => void runCheck(), POLL_MS);
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appState.current;
      appState.current = next;
      if (prev.match(/inactive|background/) && next === 'active') {
        void runCheck(); // instant re-check on every app resume
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [runCheck]);

  const state: VpnGateState = {
    status: info?.status ?? 'unknown',
    ip: info?.ip,
    country: info?.country,
    countryNameFa: info?.countryNameFa,
    checking,
    lastCheckedAt,
    blocked: info?.status === 'iran',
    reArmedAt,
    recheck: runCheck,
  };

  return <VpnGateContext.Provider value={state}>{children}</VpnGateContext.Provider>;
}

export function useVpnGate(): VpnGateState {
  const ctx = useContext(VpnGateContext);
  if (!ctx) {
    // Provider missing (defensive) — never block anything.
    return {
      status: 'unknown',
      checking: false,
      lastCheckedAt: null,
      blocked: false,
      reArmedAt: null,
      recheck: async () => {},
    };
  }
  return ctx;
}
