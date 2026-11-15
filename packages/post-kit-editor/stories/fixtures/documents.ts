/**
 * Synthetic EmailBuilder documents for Storybook — no network image URLs.
 */
import type { EmailBuilderDocument } from '../../src';

import emptySample from '../../src/email-builder-ui/getConfiguration/sample/empty-email-message';
import welcomeSample from '../../src/email-builder-ui/getConfiguration/sample/welcome';
import otpSample from '../../src/email-builder-ui/getConfiguration/sample/one-time-passcode';
import resetPasswordSample from '../../src/email-builder-ui/getConfiguration/sample/reset-password';
import respondSample from '../../src/email-builder-ui/getConfiguration/sample/respond-to-message';
import receiptSample from '../../src/email-builder-ui/getConfiguration/sample/order-ecommerce';
import reportSample from '../../src/email-builder-ui/getConfiguration/sample/post-metrics-report';

/** Deterministic 1×1 SVG used wherever samples previously pointed at CDN images. */
export const FIXTURE_IMAGE_DATA_URI =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
      <rect width="320" height="180" fill="#d9e2ec"/>
      <text x="160" y="96" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#486581">PostKit</text>
    </svg>`,
  );

/** Smaller avatar-shaped SVG. */
export const FIXTURE_AVATAR_DATA_URI =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <circle cx="64" cy="64" r="64" fill="#9fb3c8"/>
      <circle cx="64" cy="48" r="24" fill="#f0f4f8"/>
      <ellipse cx="64" cy="100" rx="36" ry="28" fill="#f0f4f8"/>
    </svg>`,
  );

const IMAGE_URL_KEYS = new Set(['url', 'imageUrl']);

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function looksLikeImageUrl(key: string, value: string): boolean {
  if (!IMAGE_URL_KEYS.has(key)) return false;
  // Button `url` props are hrefs — only replace when the value looks like an image asset
  // or is under a known CDN / avatar host used by samples.
  if (key === 'imageUrl') return true;
  if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(value)) return true;
  if (/cloudfront\.net|ui-avatars\.com|assets\.usewaypoint\.com/i.test(value)) return true;
  return false;
}

function replaceExternalImageUrls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(replaceExternalImageUrls);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isHttpUrl(entry) && looksLikeImageUrl(key, entry)) {
        out[key] = key === 'imageUrl' ? FIXTURE_AVATAR_DATA_URI : FIXTURE_IMAGE_DATA_URI;
      } else {
        out[key] = replaceExternalImageUrls(entry);
      }
    }
    return out;
  }
  return value;
}

/** Deep-clone a sample document and swap external image URLs for data URIs. */
export function sanitizeDocumentImages(document: EmailBuilderDocument): EmailBuilderDocument {
  return replaceExternalImageUrls(JSON.parse(JSON.stringify(document))) as EmailBuilderDocument;
}

type BlockData = Record<string, unknown>;

function layoutRoot(
  childrenIds: string[],
  overrides: Partial<{
    backdropColor: string;
    canvasColor: string;
    textColor: string;
    fontFamily: string;
  }> = {},
): EmailBuilderDocument['root'] {
  return {
    type: 'EmailLayout',
    data: {
      backdropColor: overrides.backdropColor ?? '#F5F5F5',
      canvasColor: overrides.canvasColor ?? '#FFFFFF',
      textColor: overrides.textColor ?? '#262626',
      fontFamily: overrides.fontFamily ?? 'MODERN_SANS',
      childrenIds,
    },
  };
}

export function createEmptyEmailDocument(): EmailBuilderDocument {
  return sanitizeDocumentImages(emptySample as EmailBuilderDocument);
}

export function createSingleBlockDocument(
  blockId: string,
  block: { type: string; data: BlockData },
  layoutOverrides?: Parameters<typeof layoutRoot>[1],
): EmailBuilderDocument {
  return {
    root: layoutRoot([blockId], layoutOverrides),
    [blockId]: block,
  } as EmailBuilderDocument;
}

const pad = { top: 16, bottom: 16, left: 24, right: 24 };

export function createTextBlockDocument(): EmailBuilderDocument {
  return createSingleBlockDocument('block-text', {
    type: 'Text',
    data: {
      props: { text: 'Hello from a Text block. Use {{name}} in templates.' },
      style: { padding: pad, fontWeight: 'normal', fontSize: 16 },
    },
  });
}

export function createHeadingBlockDocument(): EmailBuilderDocument {
  return createSingleBlockDocument('block-heading', {
    type: 'Heading',
    data: {
      props: { text: 'Heading block', level: 'h2' },
      style: { padding: pad },
    },
  });
}

export function createButtonBlockDocument(): EmailBuilderDocument {
  return createSingleBlockDocument('block-button', {
    type: 'Button',
    data: {
      props: {
        text: 'Continue',
        url: 'https://example.com/continue',
        buttonBackgroundColor: '#1f4b99',
        buttonTextColor: '#FFFFFF',
      },
      style: { padding: pad, textAlign: 'center' },
    },
  });
}

export function createImageBlockDocument(): EmailBuilderDocument {
  return createSingleBlockDocument('block-image', {
    type: 'Image',
    data: {
      props: {
        url: FIXTURE_IMAGE_DATA_URI,
        alt: 'Fixture image',
        contentAlignment: 'middle',
        linkHref: null,
      },
      style: { padding: pad },
    },
  });
}

export function createAvatarBlockDocument(): EmailBuilderDocument {
  return createSingleBlockDocument('block-avatar', {
    type: 'Avatar',
    data: {
      props: {
        imageUrl: FIXTURE_AVATAR_DATA_URI,
        shape: 'circle',
        size: 64,
      },
      style: { padding: pad, textAlign: 'center' },
    },
  });
}

export function createDividerBlockDocument(): EmailBuilderDocument {
  return createSingleBlockDocument('block-divider', {
    type: 'Divider',
    data: {
      props: { lineColor: '#CCCCCC' },
      style: { padding: { top: 16, bottom: 16, left: 0, right: 0 } },
    },
  });
}

export function createSpacerBlockDocument(): EmailBuilderDocument {
  return createSingleBlockDocument('block-spacer', {
    type: 'Spacer',
    data: {
      props: { height: 48 },
    },
  });
}

export function createHtmlBlockDocument(): EmailBuilderDocument {
  return createSingleBlockDocument('block-html', {
    type: 'Html',
    data: {
      props: { contents: '<strong>Custom HTML</strong> — <em>fixture only</em>' },
      style: { padding: pad, fontSize: 16 },
    },
  });
}

export function createContainerBlockDocument(): EmailBuilderDocument {
  return {
    root: layoutRoot(['block-container']),
    'block-container': {
      type: 'Container',
      data: {
        style: { padding: pad, backgroundColor: '#F0F4F8' },
        props: { childrenIds: ['block-inner-text'] },
      },
    },
    'block-inner-text': {
      type: 'Text',
      data: {
        props: { text: 'Inside a Container' },
        style: { padding: { top: 8, bottom: 8, left: 8, right: 8 }, fontWeight: 'normal' },
      },
    },
  } as EmailBuilderDocument;
}

export function createColumnsBlockDocument(): EmailBuilderDocument {
  return {
    root: layoutRoot(['block-columns']),
    'block-columns': {
      type: 'ColumnsContainer',
      data: {
        props: {
          columnsGap: 16,
          columnsCount: 2,
          columns: [{ childrenIds: ['col-a'] }, { childrenIds: ['col-b'] }, { childrenIds: [] }],
        },
        style: { padding: pad },
      },
    },
    'col-a': {
      type: 'Text',
      data: {
        props: { text: 'Column A' },
        style: { padding: { top: 8, bottom: 8, left: 8, right: 8 }, fontWeight: 'normal' },
      },
    },
    'col-b': {
      type: 'Text',
      data: {
        props: { text: 'Column B' },
        style: { padding: { top: 8, bottom: 8, left: 8, right: 8 }, fontWeight: 'normal' },
      },
    },
  } as EmailBuilderDocument;
}

/** Configured variants with richer styling. */
export function createConfiguredTextDocument(): EmailBuilderDocument {
  return createSingleBlockDocument('block-text-configured', {
    type: 'Text',
    data: {
      props: { text: 'Configured text with color and weight.' },
      style: {
        padding: pad,
        fontWeight: 'bold',
        fontSize: 18,
        color: '#1f4b99',
        textAlign: 'center',
      },
    },
  });
}

export function createConfiguredButtonDocument(): EmailBuilderDocument {
  return createSingleBlockDocument('block-button-configured', {
    type: 'Button',
    data: {
      props: {
        text: 'Primary action',
        url: 'https://example.com',
        buttonBackgroundColor: '#0f766e',
        buttonTextColor: '#ecfdf5',
        size: 'large',
      },
      style: { padding: pad, textAlign: 'center' },
    },
  });
}

export function createConfiguredHeadingDocument(): EmailBuilderDocument {
  return createSingleBlockDocument('block-heading-configured', {
    type: 'Heading',
    data: {
      props: { text: 'Large configured heading', level: 'h1' },
      style: {
        padding: pad,
        color: '#102a43',
        textAlign: 'center',
        fontWeight: 'bold',
      },
    },
  });
}

export function createTypographyLayoutDocument(): EmailBuilderDocument {
  const fonts = [
    'MODERN_SANS',
    'BOOK_SANS',
    'GEOMETRIC_SANS',
    'MODERN_SERIF',
    'BOOK_SERIF',
    'MONOSPACE',
  ] as const;
  const childrenIds = fonts.map((_, i) => `font-${i}`);
  const doc: EmailBuilderDocument = {
    root: layoutRoot([...childrenIds]),
  } as EmailBuilderDocument;
  fonts.forEach((fontFamily, i) => {
    const id = `font-${i}`;
    doc[id] = {
      type: 'Text',
      data: {
        props: { text: `${fontFamily} — The quick brown fox` },
        style: {
          padding: { top: 8, bottom: 8, left: 24, right: 24 },
          fontFamily,
          fontWeight: 'normal',
          fontSize: 16,
        },
      },
    };
  });
  return doc;
}

export function createColoursLayoutDocument(): EmailBuilderDocument {
  return createSingleBlockDocument(
    'block-colour-text',
    {
      type: 'Text',
      data: {
        props: { text: 'Coloured layout: dark backdrop, light canvas, brand text.' },
        style: { padding: pad, fontWeight: 'normal', color: '#F0F4F8' },
      },
    },
    {
      backdropColor: '#102a43',
      canvasColor: '#243b53',
      textColor: '#F0F4F8',
      fontFamily: 'MODERN_SANS',
    },
  );
}

export function createNestedContainersDocument(): EmailBuilderDocument {
  return {
    root: layoutRoot(['outer']),
    outer: {
      type: 'Container',
      data: {
        style: { padding: pad, backgroundColor: '#E3E8EE' },
        props: { childrenIds: ['inner'] },
      },
    },
    inner: {
      type: 'Container',
      data: {
        style: {
          padding: { top: 12, bottom: 12, left: 12, right: 12 },
          backgroundColor: '#F0F4F8',
        },
        props: { childrenIds: ['nested-text'] },
      },
    },
    'nested-text': {
      type: 'Text',
      data: {
        props: { text: 'Nested containers' },
        style: { padding: { top: 8, bottom: 8, left: 8, right: 8 }, fontWeight: 'normal' },
      },
    },
  } as EmailBuilderDocument;
}

export function createLongContentDocument(): EmailBuilderDocument {
  const paragraphs = Array.from({ length: 12 }, (_, i) => `block-long-${i}`);
  const doc: EmailBuilderDocument = {
    root: layoutRoot(paragraphs),
  } as EmailBuilderDocument;
  paragraphs.forEach((id, i) => {
    doc[id] = {
      type: 'Text',
      data: {
        props: {
          text: `Paragraph ${i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
        },
        style: {
          padding: { top: 8, bottom: 8, left: 24, right: 24 },
          fontWeight: 'normal',
          fontSize: 15,
        },
      },
    };
  });
  return doc;
}

export const welcomeDocument = sanitizeDocumentImages(welcomeSample as EmailBuilderDocument);
export const otpDocument = sanitizeDocumentImages(otpSample as EmailBuilderDocument);
export const passwordResetDocument = sanitizeDocumentImages(
  resetPasswordSample as EmailBuilderDocument,
);
export const transactionalDocument = sanitizeDocumentImages(respondSample as EmailBuilderDocument);
export const receiptDocument = sanitizeDocumentImages(receiptSample as EmailBuilderDocument);
export const reportDocument = sanitizeDocumentImages(reportSample as EmailBuilderDocument);
