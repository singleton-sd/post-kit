import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export interface InsertionTarget {
  /** Insert `text` at the target's current caret / selection. */
  insert: (text: string) => void;
  /** Short label used in disabled-button explanations. */
  label: string;
}

interface InsertionTargetContextValue {
  target: InsertionTarget | null;
  setTarget: (target: InsertionTarget | null) => void;
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

  const stableInsert = useCallback((text: string) => {
    insertRef.current(text);
  }, []);

  const onFocus = useCallback(() => {
    setTarget({ label, insert: stableInsert });
  }, [label, setTarget, stableInsert]);

  const onBlur = useCallback(() => {
    setTarget(null);
  }, [setTarget]);

  return { onFocus, onBlur };
}
