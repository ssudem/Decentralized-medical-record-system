import { useState, useEffect } from "react";
import API from "../api/axios";

/**
 * Display component that shows a human-readable name for an Ethereum address.
 *
 * Priority:
 *  1. Internal Name (from user_directory DB)
 *  2. Truncated hex address (fallback)
 *
 * Props:
 *  - address: Ethereum address to display
 *  - className: optional extra classes
 */
export default function UserAddress({ address, className = "" }) {
  const [displayName, setDisplayName] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) { setDisplayName(null); setLoading(false); return; }

    let cancelled = false;
    setLoading(true);

    (async () => {
      // Priority 1: Check internal user directory
      try {
        const { data } = await API.get(`/users/${address}`);
        if (!cancelled && data.success && data.user?.full_name) {
          setDisplayName(data.user.full_name);
          setLoading(false);
          return;
        }
      } catch {
        // Not in directory
      }

      // Priority 2: Truncated address
      if (!cancelled) {
        setDisplayName(null);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [address]);

  if (!address) return null;

  const truncated = `${address.slice(0, 6)}…${address.slice(-4)}`;

  if (loading) {
    return (
      <span className={`font-mono text-text-muted ${className}`} title={address}>
        {truncated}
      </span>
    );
  }

  if (displayName) {
    return (
      <span className={`font-semibold ${className}`} title={address}>
        {displayName}
        <span className="ml-1 text-text-muted font-mono text-[0.7em]">({truncated})</span>
      </span>
    );
  }

  return (
    <span className={`font-mono ${className}`} title={address}>
      {truncated}
    </span>
  );
}

