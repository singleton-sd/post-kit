/**
 * Browser-safe entry for `@singleton-sd/post-kit-compiler/preview`.
 *
 * Import this path from browser bundles (e.g. post-kit-editor). Do not import
 * the package root from the browser — it re-exports Node-only `compile` /
 * `compileFromDirectory` which pull in `node:crypto` and `node:fs`.
 */
export { CompilerError, type CompilerErrorCode } from './compiler-error';
export { type TemplateSource } from './template-source';
export { renderPreview, validateSource } from './render-preview';
