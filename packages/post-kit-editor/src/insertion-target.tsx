import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export interface InsertionTarget {
  /** Insert `text` at the target's current caret / selection. */
  insert: (text: string) => void;
  /** Short label used in disabled-button explanations. */
  label: string;
}

interface InsertionTargetContextValue {
  target: InsertionTarget | null;
  setTarget: React.Dispatch<React.SetStateAction<InsertionTarget | null>>;
}

const InsertionTargetContext = createContext<InsertionTargetContextValue | null>(null);

export function InsertionTargetProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [target, setTarget] = useState<InsertionTarget | null>(null);
  const value = useMemo(() => ({ target, setTarget }), [target]);
  return (
    <InsertionTargetContext.Provider value={value}>{children}</InsertionTargetContext.Provider>
  );
}

export function useInsertionTarget(): InsertionTargetContextValue {
  const ctx = useContext(InsertionTargetContext);
  if (!ctx) {
    throw new Error('useInsertionTarget must be used within InsertionTargetProvider');
  }
  return ctx;
}

/**
 * Register an insertion target while a focusable element is focused.
 * Clears the target on blur only when this registration is still current.
 */
export function useRegisterInsertionTarget(
  label: string,
  insert: (text: string) => void,
): {
  onFocus: () => void;
  onBlur: () => void;
} {
  const { setTarget } = useInsertionTarget();
  const insertRef = useRef(insert);
  insertRef.current = insert;
  const registrationRef = useRef<{ label: string; insert: (text: string) => void } | null>(null);

  const stableInsert = useCallback((text: string) => {
    insertRef.current(text);
  }, []);

  const onFocus = useCallback(() => {
    const next = { label, insert: stableInsert };
    registrationRef.current = next;
    setTarget(next);
  }, [label, setTarget, stableInsert]);

  const onBlur = useCallback(() => {
    const registration = registrationRef.current;
    registrationRef.current = null;
    // Only clear if we still own the active target — another field may have
    // focused in the meantime. Insert buttons also call preventDefault on
    // mousedown so this blur does not race ahead of their click handler.
    setTarget((current) => (current === registration ? null : current));
  }, [setTarget]);

  return { onFocus, onBlur };
}
