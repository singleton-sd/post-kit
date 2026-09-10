export {
  type TemplateSourceFiles,
  type TemplateVariable,
  type EmailBuilderDocument,
} from './types';
export {
  EDITOR_CLASS_PREFIX,
  EmailTemplateEditor,
  type EmailTemplateEditorProps,
} from './email-template-editor';
export { EmailBuilderCanvas, type EmailBuilderCanvasProps } from './canvas/EmailBuilderCanvas';
export { loadTemplateSource, serializeTemplateSource, TemplateSourceError } from './serialization';
export type { SerializedTemplateSource, SaveResult, SendTestResult } from './save-send/types';
export {
  validateTemplate,
  hasValidationErrors,
  type ValidationIssue,
  type ValidationSeverity,
  type ValidateTemplateOptions,
} from './validation/validate';
