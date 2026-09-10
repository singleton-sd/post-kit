/**
 * End-to-end flow for EmailTemplateEditor under `node --test` + SSR markup.
 *
 * Interaction (clicks / controlled inputs) is not available without a DOM.
 * Edit → validate → save / send-test are driven through the same pure helpers
 * and action controllers the editor uses (`withMetadata` / `validateTemplate`,
 * `startSaveAction` / `finishSaveAction`, `startSendTestAction` /
 * `finishSendTestAction`, `SaveSendBar`). Markup assertions cover panels,
 * loading shells, and Send-test chrome. Preview-pending Save gating under SSR
 * is asserted on the full editor; “enabled after preview settles” is covered
 * via SaveSendBar props once validation is clean.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EmailBuilderCanvas } from './canvas/EmailBuilderCanvas';
import {
  EDITOR_CLASS_PREFIX,
  EmailTemplateEditor,
  type EmailTemplateEditorProps,
} from './email-template-editor';
import { loadTemplateSource, serializeTemplateSource } from './serialization';
import {
  finishSaveAction,
  finishSendTestAction,
  startSaveAction,
  startSendTestAction,
} from './save-send/actions';
import { SaveSendBar } from './save-send/SaveSendBar';
import type { EmailBuilderDocument, TemplateSourceFiles } from './types';
import { hasValidationErrors, validateTemplate } from './validation/validate';
import { withDocument, withMetadata, withPreviewData } from './working-files';

const p = EDITOR_CLASS_PREFIX;
const FIXTURES_DIR = join(import.meta.dirname, '__fixtures__', 'nested-blocks');

/** Load fixtures once before the in-memory flow (not part of the flow itself). */
async function loadNestedBlocksFixture(): Promise<TemplateSourceFiles> {
  const [templateJson, metadata, previewData] = await Promise.all([
    readFile(join(FIXTURES_DIR, 'template.json'), 'utf-8').then(JSON.parse),
    readFile(join(FIXTURES_DIR, 'metadata.json'), 'utf-8').then(JSON.parse),
    readFile(join(FIXTURES_DIR, 'preview.json'), 'utf-8').then(JSON.parse),
  ]);
  return loadTemplateSource({ templateJson, metadata, previewData });
}

function installSideChannelGuards(): {
  assertClean: () => void;
  restore: () => void;
} {
  const fetchCalls: unknown[][] = [];
  const httpCalls: unknown[][] = [];
  const httpsCalls: unknown[][] = [];
  const fsCalls: unknown[][] = [];

  const previousFetch = globalThis.fetch;
  globalThis.fetch = ((...args: unknown[]) => {
    fetchCalls.push(args);
    throw new Error('unexpected fetch during editor e2e flow');
  }) as typeof fetch;

  const previousHttpRequest = http.request;
  const previousHttpsRequest = https.request;
  http.request = ((...args: unknown[]) => {
    httpCalls.push(args);
    throw new Error('unexpected http.request during editor e2e flow');
  }) as typeof http.request;
  https.request = ((...args: unknown[]) => {
    httpsCalls.push(args);
    throw new Error('unexpected https.request during editor e2e flow');
  }) as typeof https.request;

  const previousReadFileSync = fs.readFileSync;
  const previousWriteFileSync = fs.writeFileSync;
  const previousReadFile = fs.promises.readFile;
  const previousWriteFile = fs.promises.writeFile;
  fs.readFileSync = ((...args: unknown[]) => {
    fsCalls.push(['readFileSync', ...args]);
    throw new Error('unexpected fs.readFileSync during editor e2e flow');
  }) as typeof fs.readFileSync;
  fs.writeFileSync = ((...args: unknown[]) => {
    fsCalls.push(['writeFileSync', ...args]);
    throw new Error('unexpected fs.writeFileSync during editor e2e flow');
  }) as typeof fs.writeFileSync;
  fs.promises.readFile = ((...args: unknown[]) => {
    fsCalls.push(['promises.readFile', ...args]);
    return Promise.reject(new Error('unexpected fs.promises.readFile during editor e2e flow'));
  }) as typeof fs.promises.readFile;
  fs.promises.writeFile = ((...args: unknown[]) => {
    fsCalls.push(['promises.writeFile', ...args]);
    return Promise.reject(new Error('unexpected fs.promises.writeFile during editor e2e flow'));
  }) as typeof fs.promises.writeFile;

  return {
    assertClean: () => {
      assert.equal(fetchCalls.length, 0, 'fetch must not be called');
      assert.equal(httpCalls.length, 0, 'http.request must not be called');
      assert.equal(httpsCalls.length, 0, 'https.request must not be called');
      assert.equal(fsCalls.length, 0, 'filesystem must not be accessed');
    },
    restore: () => {
      if (previousFetch) {
        globalThis.fetch = previousFetch;
      } else {
        Reflect.deleteProperty(globalThis, 'fetch');
      }
      http.request = previousHttpRequest;
      https.request = previousHttpsRequest;
      fs.readFileSync = previousReadFileSync;
      fs.writeFileSync = previousWriteFileSync;
      fs.promises.readFile = previousReadFile;
      fs.promises.writeFile = previousWriteFile;
    },
  };
}

describe('EmailTemplateEditor e2e (SSR + pure helpers)', () => {
  it('load → panels populated; edit → validate → save round-trip; send-test; no network/fs', async () => {
    const seed = await loadNestedBlocksFixture();
    const guards = installSideChannelGuards();

    try {
      const baseProps: EmailTemplateEditorProps = {
        template: seed,
        availableVariables: [{ name: 'name', label: 'Recipient name' }],
        onSave: () => undefined,
      };

      // --- Load: canvas, metadata, variables, preview panels ---
      const loaded = renderToStaticMarkup(<EmailTemplateEditor {...baseProps} />);
      assert.match(loaded, new RegExp(`data-testid="${p}canvas"`));
      assert.match(loaded, /Hello \{\{name\}\}/);
      assert.match(loaded, new RegExp(`data-testid="${p}metadata"`));
      assert.match(loaded, /value="test\.nested"/);
      assert.match(loaded, /value="Nested Blocks"/);
      assert.match(loaded, /Preview: Hello Jane Doe/);
      assert.match(loaded, new RegExp(`data-testid="${p}variables"`));
      assert.match(loaded, /\{\{name\}\}/);
      assert.match(loaded, new RegExp(`data-testid="${p}preview-data"`));
      assert.match(loaded, /data-testid="pk-editor-preview-value-name"/);
      assert.match(loaded, new RegExp(`data-testid="${p}preview-pane"`));
      // SSR: preview has not settled — Save stays blocked.
      assert.match(loaded, /Wait for the preview to finish/);
      assert.match(loaded, new RegExp(`data-testid="${p}save"[^>]*disabled`));
      assert.doesNotMatch(loaded, new RegExp(`data-testid="${p}send-test"`));

      const withSend = renderToStaticMarkup(
        <EmailTemplateEditor {...baseProps} onSendTest={async () => undefined} />,
      );
      assert.match(withSend, new RegExp(`data-testid="${p}send-test"`));

      assert.match(
        renderToStaticMarkup(<EmailTemplateEditor {...baseProps} loading />),
        new RegExp(`data-testid="${p}loading"`),
      );
      assert.match(
        renderToStaticMarkup(<EmailTemplateEditor {...baseProps} loadError="offline" />),
        /offline/,
      );

      // --- Edit working state via the same pure helpers the editor uses ---
      let working = withMetadata(seed, {
        ...seed.metadata,
        name: 'Nested Blocks Updated',
        subject: 'Welcome {{name}}',
      });
      working = withPreviewData(working, { name: 'Alex Example' });

      assert.equal(working.metadata.name, 'Nested Blocks Updated');
      assert.equal(working.previewData.name, 'Alex Example');
      assert.match(
        renderToStaticMarkup(
          <EmailTemplateEditor
            {...baseProps}
            template={working}
            onSendTest={async () => undefined}
          />,
        ),
        /value="Nested Blocks Updated"/,
      );
      assert.match(
        renderToStaticMarkup(<EmailTemplateEditor {...baseProps} template={working} />),
        /Preview: Welcome Alex Example/,
      );

      // --- Undeclared variable → validation errors → Save disabled ---
      const undeclaredDoc: EmailBuilderDocument = {
        ...working.templateJson,
        'block-text': {
          type: 'Text',
          data: {
            style: {
              fontWeight: 'normal',
              padding: { top: 8, bottom: 16, right: 24, left: 24 },
            },
            props: {
              text: 'Hello {{name}} and {{bonus}}',
            },
          },
        },
      };
      const withUndeclared = withDocument(working, undeclaredDoc);
      const undeclaredIssues = validateTemplate(withUndeclared);
      assert.ok(hasValidationErrors(undeclaredIssues));
      assert.ok(
        undeclaredIssues.some((i) => i.code === 'undeclared-variable' && i.variable === 'bonus'),
      );

      const blockedBar = renderToStaticMarkup(
        <SaveSendBar
          saveFeedback={{ status: 'idle' }}
          sendFeedback={{ status: 'idle' }}
          busy={false}
          validationBlocked={true}
          validationBlockedReason="Fix validation errors before saving or sending a test."
          showSendTest={true}
          onSave={() => undefined}
          onSendTest={() => undefined}
        />,
      );
      assert.match(blockedBar, new RegExp(`data-testid="${p}save"[^>]*disabled`));
      assert.match(blockedBar, /Fix validation errors before saving/);

      const editorWithErrors = renderToStaticMarkup(
        <EmailTemplateEditor {...baseProps} template={withUndeclared} />,
      );
      assert.match(editorWithErrors, /undeclared-variable|not declared/i);
      assert.match(editorWithErrors, new RegExp(`data-testid="${p}validation"`));
      assert.match(editorWithErrors, new RegExp(`data-testid="${p}save"[^>]*disabled`));

      // --- Fix → validation clean → Save enabled (post-preview, via SaveSendBar) ---
      const fixed = withDocument(working, working.templateJson);
      const fixedIssues = validateTemplate(fixed);
      assert.equal(hasValidationErrors(fixedIssues), false);

      let saveClicked = false;
      const enabledBar = renderToStaticMarkup(
        <SaveSendBar
          saveFeedback={{ status: 'idle' }}
          sendFeedback={{ status: 'idle' }}
          busy={false}
          validationBlocked={false}
          showSendTest={true}
          onSave={() => {
            saveClicked = true;
          }}
          onSendTest={() => undefined}
        />,
      );
      assert.doesNotMatch(enabledBar, new RegExp(`data-testid="${p}save"[^>]*disabled`));
      assert.equal(saveClicked, false);

      // --- onSave via action controllers (same path as EmailTemplateEditor) ---
      const recorded: {
        serialized: ReturnType<typeof serializeTemplateSource>;
        files: TemplateSourceFiles;
      }[] = [];
      assert.equal(
        startSaveAction({ busy: false, validationBlocked: true, files: fixed }).status,
        'noop',
      );
      const saveStarted = startSaveAction({
        busy: false,
        validationBlocked: false,
        files: fixed,
      });
      assert.equal(saveStarted.status, 'ready');
      if (saveStarted.status !== 'ready') {
        throw new Error('expected save ready');
      }
      const saveResult = await finishSaveAction({
        payload: saveStarted.payload,
        isGenerationCurrent: () => true,
        onSave: (serialized, files) => {
          recorded.push({ serialized, files });
        },
      });
      assert.equal(saveResult.status, 'success');
      assert.equal(recorded.length, 1);

      const roundTripped = loadTemplateSource({
        templateJson: JSON.parse(recorded[0]!.serialized.templateJson),
        metadata: JSON.parse(recorded[0]!.serialized.metadataJson),
        previewData: JSON.parse(recorded[0]!.serialized.previewJson),
      });
      assert.deepEqual(roundTripped.metadata, fixed.metadata);
      assert.deepEqual(roundTripped.previewData, fixed.previewData);
      assert.deepEqual(roundTripped.templateJson, fixed.templateJson);
      assert.equal(
        serializeTemplateSource(roundTripped).templateJson,
        recorded[0]!.serialized.templateJson,
      );

      // Gating: validation errors must prevent building a “successful save” path
      // the UI would allow (hasValidationErrors mirrors EmailTemplateEditor).
      assert.equal(hasValidationErrors(validateTemplate(withUndeclared)), true);
      assert.equal(hasValidationErrors(validateTemplate(fixed)), false);

      // --- onSendTest via action controllers ---
      assert.equal(
        startSendTestAction({
          busy: false,
          validationBlocked: false,
          sendTestEnabled: true,
          files: fixed,
          recipient: '',
        }).status,
        'recipient-error',
      );
      assert.equal(
        startSendTestAction({
          busy: false,
          validationBlocked: false,
          sendTestEnabled: true,
          files: fixed,
          recipient: 'not-an-email',
        }).status,
        'recipient-error',
      );

      const sendCalls: Array<{
        serialized: ReturnType<typeof serializeTemplateSource>;
        files: TemplateSourceFiles;
        recipient: string;
      }> = [];
      const sendStarted = startSendTestAction({
        busy: false,
        validationBlocked: false,
        sendTestEnabled: true,
        files: fixed,
        recipient: 'tester@example.com',
      });
      assert.equal(sendStarted.status, 'ready');
      if (sendStarted.status !== 'ready') {
        throw new Error('expected send ready');
      }
      const sendResult = await finishSendTestAction({
        payload: sendStarted.payload,
        recipient: sendStarted.recipient,
        isGenerationCurrent: () => true,
        onSendTest: (serialized, files, recipient) => {
          sendCalls.push({ serialized, files, recipient });
        },
      });
      assert.equal(sendResult.status, 'success');
      assert.equal(sendCalls.length, 1);
      assert.equal(sendCalls[0]!.recipient, 'tester@example.com');
      assert.deepEqual(sendCalls[0]!.files.metadata, fixed.metadata);

      // Stale generation is ignored (same guard as EmailTemplateEditor).
      const staleSave = await finishSaveAction({
        payload: saveStarted.payload,
        isGenerationCurrent: () => false,
        onSave: () => undefined,
      });
      assert.equal(staleSave.status, 'stale');

      // Canvas still renders the edited document without network.
      const canvasHtml = renderToStaticMarkup(
        <EmailBuilderCanvas document={fixed.templateJson} onChange={() => undefined} readOnly />,
      );
      assert.match(canvasHtml, /Hello \{\{name\}\}/);

      guards.assertClean();
    } finally {
      guards.restore();
    }
  });
});
