import { useState, useEffect } from "react";
import { isHospitalValidOnChain, getDiagnosticsLabHospital } from "./blockchain";

/**
 * Custom hook: checks whether the current diagnostics lab wallet is linked to a
 * **valid** hospital on-chain.
 *
 * Returns { isAuthorized, hospitalAddr, loading }
 *
 *  - isAuthorized === true   → lab is linked to a valid hospital
 *  - isAuthorized === false  → lab is NOT linked OR hospital was removed
 *  - loading === true        → still checking (show spinner / skeleton)
 */
export default function useDiagnosticsAuth(walletAddress) {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [hospitalAddr, setHospitalAddr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!walletAddress) {
      setIsAuthorized(false);
      setHospitalAddr(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        // Step 1: Get the hospital address linked to this lab
        const addr = await getDiagnosticsLabHospital(walletAddress);
        const isLinked =
          addr && addr !== "0x0000000000000000000000000000000000000000";

        if (!isLinked) {
          if (!cancelled) {
            setHospitalAddr(null);
            setIsAuthorized(false);
          }
          return;
        }

        // Step 2: Verify the hospital is still valid on the blockchain
        const isValid = await isHospitalValidOnChain(addr);

        if (!cancelled) {
          setHospitalAddr(isLinked ? addr : null);
          setIsAuthorized(isLinked && isValid);
        }
      } catch {
        if (!cancelled) {
          setHospitalAddr(null);
          setIsAuthorized(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  return { isAuthorized, hospitalAddr, loading };
}
