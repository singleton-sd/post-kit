import React, { useState } from 'react';

import { EmailBuilderCanvas, type EmailBuilderDocument } from '../../../../src';

/** Stateful canvas wrapper for block-focused stories. */
export function CanvasStory({ initial }: { initial: EmailBuilderDocument }): JSX.Element {
  const [document, setDocument] = useState(initial);
  return <EmailBuilderCanvas document={document} onChange={setDocument} />;
}
