import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Marks keys that appear after the first paint so they can fade in.
 * Keys present on the initial render (or after `resetKey` changes) are treated as
 * already seen (no animation).
 */
export function useEnterAnimation(
  keys: string[],
  resetKey?: string,
): (key: string) => boolean {
  const primedRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  const [entering, setEntering] = useState<Set<string>>(() => new Set());
  const prevResetKeyRef = useRef(resetKey);
  const keysSignature = useMemo(() => keys.join("\0"), [keys]);

  useEffect(() => {
    const currentKeys = keysSignature.length > 0 ? keysSignature.split("\0") : [];

    if (prevResetKeyRef.current !== resetKey) {
      prevResetKeyRef.current = resetKey;
      primedRef.current = false;
      seenRef.current = new Set();
      setEntering(new Set());
    }

    if (!primedRef.current) {
      seenRef.current = new Set(currentKeys);
      primedRef.current = true;
      return;
    }

    const fresh: string[] = [];
    for (const key of currentKeys) {
      if (!seenRef.current.has(key)) {
        seenRef.current.add(key);
        fresh.push(key);
      }
    }
    if (fresh.length === 0) {
      return;
    }

    setEntering((prev) => {
      const next = new Set(prev);
      for (const key of fresh) {
        next.add(key);
      }
      return next;
    });
  }, [keysSignature, resetKey]);

  return (key: string) => entering.has(key);
}
