import React, { useEffect, useRef, useState } from 'react';

import { html, json } from './highlighters';

type TextEditorPanelProps = {
  type: 'json' | 'html' | 'javascript';
  value: string;
};
export default function HighlightedCodePanel({ type, value }: TextEditorPanelProps) {
  const [code, setCode] = useState<string | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    const apply = (next: string) => {
      if (generation === generationRef.current) {
        setCode(next);
      }
    };

    switch (type) {
      case 'html':
        html(value).then(apply);
        return;
      case 'json':
        json(value).then(apply);
        return;
    }
  }, [value, type]);

  if (code === null) {
    return null;
  }

  return (
    <pre
      style={{ margin: 0, padding: 16 }}
      dangerouslySetInnerHTML={{ __html: code }}
      onClick={(ev) => {
        const s = window.getSelection();
        if (s === null) {
          return;
        }
        s.selectAllChildren(ev.currentTarget);
      }}
    />
  );
}
