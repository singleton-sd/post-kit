/**
 * API send contracts.
 *
 * These types define the HTTP request/response surface of the PostKit API's
 * `POST /emails/send` endpoint. They are shared between:
 *   - apps/api   — the server that validates and handles requests
 *   - post-kit-client — the SDK that constructs and sends requests
 *
 * Keep these types stable — they are a public API surface.
 */

/**
 * Stable error codes returned by the PostKit API.
 * Consumers should switch on these codes rather than HTTP status or message text.
 */
export enum PostKitErrorCode {
  /** No credential was provided, or the credential format is invalid. */
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  /** A valid credential was provided but it does not map to a known tenant. */
  UNAUTHORIZED = 'UNAUTHORIZED',
  /** The requested template key does not exist in the tenant's storage. */
  TEMPLATE_NOT_FOUND = 'TEMPLATE_NOT_FOUND',
  /** The template artifact exists but could not be parsed or is structurally invalid. */
  INVALID_TEMPLATE = 'INVALID_TEMPLATE',
  /** One or more variables declared in the template metadata were absent from the request. */
  MISSING_VARIABLES = 'MISSING_VARIABLES',
  /** The `to` recipient address failed basic validation. */
  INVALID_RECIPIENT = 'INVALID_RECIPIENT',
  /** The request body or variables exceed configured size limits. */
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  /** The authenticated tenant exceeded the send rate limit. */
  RATE_LIMITED = 'RATE_LIMITED',
  /** The email provider accepted the request but returned an error or unexpected response. */
  PROVIDER_FAILURE = 'PROVIDER_FAILURE',
  /** The template storage backend returned an error. */
  STORAGE_FAILURE = 'STORAGE_FAILURE',
}

/**
 * Request body for `POST /emails/send`.
 *
 * Tenant identity is resolved server-side from the authentication credential
 * and must NOT be supplied in the request body.
 *
 * @example
 * {
 *   template: 'marketing.contact-us',
 *   to: 'hello@example.com',
 *   variables: { name: 'Jane Doe', email: 'jane@example.com', message: 'Hi' },
 * }
 */
export interface SendRequest {
  /**
   * Template key, e.g. `marketing.contact-us`.
   * Must match a compiled artifact published to the tenant's storage.
   */
  template: string;
  /** Recipient email address. */
  to: string;
  /**
   * Variable values to substitute into the template subject and body.
   * All variables declared in `TemplateSourceMetadata.variables` must be present.
   */
  variables: Record<string, string>;
}

/**
 * Successful response body from `POST /emails/send`.
 */
export interface SendResponse {
  /** PostKit correlation / request ID for tracing. */
  id: string;
  /** Always `'sent'` on a 200 response. */
  status: 'sent';
}

/**
 * Error response body from `POST /emails/send` on any non-2xx status.
 */
export interface PostKitErrorResponse {
  /** Human-readable error message. Do not rely on this for programmatic branching. */
  error: string;
  /** Stable machine-readable error code. Use this for error handling logic. */
  code: PostKitErrorCode;
  /** PostKit correlation ID — include in support requests and error logs. */
  correlationId: string;
}
