import { useState, useEffect, useCallback, useRef } from "react";
import API from "../api/axios";
import { Input } from "./UI";
import { CheckCircle, Loader2, AlertCircle, User } from "lucide-react";

/**
 * A drop-in replacement for <Input> that supports:
 *  1. Name-based search from the user directory (type "Amit" → dropdown)
 *  2. Hex address validation
 *
 * Props:
 *  - value, onChange: controlled input
 *  - onResolvedAddress: optional callback when address is resolved
 *  - searchRole: optional filter for search (e.g. "patient", "doctor")
 *  - label, id, placeholder, required, className: passed to <Input>
 */
export default function UserAddressInput({
  value,
  onChange,
  onResolvedAddress,
  searchRole,
  label = "Address or Name",
  placeholder = "0x… or search by name",
  id,
  required,
  className = "",
}) {
  const [resolvedAddr, setResolvedAddr] = useState(null);
  const [error, setError] = useState(null);

  // Name search state
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Debounced resolve / search
  const doResolve = useCallback(async (input) => {
    if (!input || !input.trim()) {
      setResolvedAddr(null);
      setError(null);
      setSearchResults([]);
      onResolvedAddress?.(null);
      return;
    }

    const trimmed = input.trim();

    // If it's a hex address, no resolution needed
    if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
      setResolvedAddr(trimmed);
      setError(null);
      setSearchResults([]);
      onResolvedAddress?.(trimmed);
      return;
    }

    // Otherwise, search the user directory by name (min 2 chars)
    if (trimmed.length >= 2 && !/^0x/i.test(trimmed)) {
      setSearching(true);
      try {
        const params = { q: trimmed };
        if (searchRole) params.role = searchRole;
        const { data } = await API.get("/users/search", { params });
        setSearchResults(data.users || []);
        setShowDropdown((data.users || []).length > 0);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    } else {
      setSearchResults([]);
    }

    setResolvedAddr(null);
    setError(null);
    onResolvedAddress?.(null);
  }, [onResolvedAddress, searchRole]);

  useEffect(() => {
    const timer = setTimeout(() => doResolve(value), 500);
    return () => clearTimeout(timer);
  }, [value, doResolve]);

  // Handle selecting a user from the dropdown
  const handleSelectUser = (user) => {
    // Set the input value to the wallet address
    onChange({ target: { value: user.wallet_address } });
    setResolvedAddr(user.wallet_address);
    setSearchResults([]);
    setShowDropdown(false);
    onResolvedAddress?.(user.wallet_address);
  };

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      <Input
        id={id}
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e);
          if (!e.target.value) setShowDropdown(false);
        }}
        onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
        required={required}
      />

      {/* Search feedback line */}
      {(searching || resolvedAddr || error) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs">
          {searching && (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
              <span className="text-accent">Searching users…</span>
            </>
          )}
          {!searching && resolvedAddr && (
            <>
              <CheckCircle className="w-3.5 h-3.5 text-success" />
              <span className="text-success font-mono">
                {resolvedAddr.slice(0, 6)}…{resolvedAddr.slice(-4)}
              </span>
            </>
          )}
          {!searching && error && (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-danger" />
              <span className="text-danger">{error}</span>
            </>
          )}
        </div>
      )}

      {/* Name search dropdown */}
      {showDropdown && searchResults.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-xl bg-surface border border-border shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {searchResults.map((user) => (
            <button
              key={user.wallet_address}
              type="button"
              onClick={() => handleSelectUser(user)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-light transition-colors text-left"
            >
              <User className="w-4 h-4 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-primary truncate">{user.full_name}</p>
                <p className="text-xs text-text-muted font-mono">
                  {user.wallet_address.slice(0, 6)}…{user.wallet_address.slice(-4)}
                  <span className="ml-2 text-text-secondary capitalize">({user.role})</span>
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

