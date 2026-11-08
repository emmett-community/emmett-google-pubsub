export const dataOf = <T extends object = Record<string, string>>(message: {
  data?: unknown;
}): T => message.data as T;

export const metadataOf = (
  message: object,
): Record<string, unknown> | undefined =>
  (message as { metadata?: Record<string, unknown> }).metadata;
