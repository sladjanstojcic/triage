/** ssh alias or user@host: must not start with "-" so it can never be parsed as an ssh option. */
export const SSH_TARGET_RE = /^[A-Za-z0-9_][A-Za-z0-9._@-]*$/;
