export type CompilerErrorCode =
  'INVALID_TEMPLATE_JSON' | 'INVALID_METADATA' | 'MISSING_PREVIEW_VARIABLE' | 'RENDER_FAILURE';

export class CompilerError extends Error {
  constructor(
    public readonly code: CompilerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CompilerError';
  }
}
