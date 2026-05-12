export interface AntonFetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

export interface AntonClientOptions {
  baseUrl?: string;
}

export class AntonError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AntonError";
    this.status = status;
  }
}

export function hasAntonConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTON_API_BASE_URL?.trim() && env.ANTON_API_KEY?.trim());
}

function resolveAntonBaseUrl(options?: AntonClientOptions): string {
  const baseUrl = options?.baseUrl ?? process.env.ANTON_API_BASE_URL;
  if (!baseUrl?.trim()) {
    throw new AntonError("ANTON_API_BASE_URL is required for Anton requests.");
  }
  return baseUrl.trim().replace(/\/+$/, "");
}

function resolveAntonApiKey(): string {
  const apiKey = process.env.ANTON_API_KEY;
  if (!apiKey?.trim()) {
    throw new AntonError("ANTON_API_KEY is required for Anton requests.");
  }
  return apiKey;
}

function buildAntonUrl(path: string, options?: AntonClientOptions): string {
  const baseUrl = resolveAntonBaseUrl(options);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

async function buildAntonHttpError(response: Response): Promise<AntonError> {
  if (response.status === 401) {
    return new AntonError(
      "Anton authentication failed (401): ANTON_API_KEY is missing or invalid.",
      response.status
    );
  }

  if (response.status === 403) {
    return new AntonError(
      "Anton authorization failed (403): ANTON_API_KEY lacks permission for this endpoint.",
      response.status
    );
  }

  const body = await response.text().catch(() => "");
  const suffix = body ? `: ${body.slice(0, 300)}` : "";
  return new AntonError(`Anton API error (${response.status})${suffix}`, response.status);
}

export async function fetchAnton(
  path: string,
  options: AntonFetchOptions = {},
  clientOptions?: AntonClientOptions
): Promise<Response> {
  const antonApiKey = resolveAntonApiKey();
  const response = await fetch(buildAntonUrl(path, clientOptions), {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${antonApiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw await buildAntonHttpError(response);
  }

  return response;
}

export async function fetchAntonJson<T>(
  path: string,
  options: AntonFetchOptions = {},
  clientOptions?: AntonClientOptions
): Promise<T> {
  const response = await fetchAnton(path, options, clientOptions);
  return (await response.json()) as T;
}
