import type { TrackerState } from './tracker';

const configuredBaseUrl = import.meta.env?.VITE_API_BASE_URL?.trim();

export const API_BASE_URL = (configuredBaseUrl || 'http://localhost:8080').replace(/\/+$/, '');

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 24;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const RESERVED_USERNAMES = Object.freeze([
  'admin',
  'angelo',
  'api',
  'auth',
  'login',
  'logout',
  'me',
  'profile',
  'profiles',
  'root',
  'settings',
  'signup',
  'support',
  'system',
] as const);

const reservedUsernames = new Set<string>(RESERVED_USERNAMES);

export interface Account {
  username: string;
  isPublic: boolean;
  createdAt: string;
}

export interface SignupInput {
  username: string;
  password: string;
  tracker: TrackerState;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  account: Account;
  tracker: TrackerState;
}

export interface MeResponse {
  account: Account;
  tracker: TrackerState;
}

export interface LogoutResponse {
  ok: true;
}

export interface TrackerUpdateResponse {
  updatedAt: string;
}

export interface ProfileUpdateResponse {
  account: Account;
}

export interface ProfileSummary {
  username: string;
  title: string;
  habitCount: number;
  updatedAt: string;
}

export interface ProfileSearchResponse {
  profiles: ProfileSummary[];
}

export interface ProfileStats {
  completed: number;
  total: number;
  percentage: number;
}

export interface PublicProfile {
  username: string;
  title: string;
  habits: string[];
  month: string;
  stats: ProfileStats;
  joinedAt: string;
  updatedAt: string;
}

export interface PublicProfileResponse {
  profile: PublicProfile;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(message: string, status: number, code = 'HTTP_ERROR', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  token?: string;
  body?: unknown;
  signal?: AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorDetails(payload: unknown): { code: string; message: string } | undefined {
  if (!isRecord(payload)) return undefined;

  if (isRecord(payload.error)) {
    const code = typeof payload.error.code === 'string' ? payload.error.code : 'HTTP_ERROR';
    if (typeof payload.error.message === 'string' && payload.error.message.trim()) {
      return { code, message: payload.error.message };
    }
  }

  if (typeof payload.message === 'string' && payload.message.trim()) {
    return { code: 'HTTP_ERROR', message: payload.message };
  }
  if (typeof payload.detail === 'string' && payload.detail.trim()) {
    return { code: 'HTTP_ERROR', message: payload.detail };
  }
  return undefined;
}

async function readResponse(response: Response): Promise<{ payload: unknown; text: string }> {
  const text = await response.text();
  if (!text.trim()) return { payload: undefined, text };

  try {
    return { payload: JSON.parse(text) as unknown, text };
  } catch {
    return { payload: undefined, text };
  }
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.token !== undefined) {
    if (!options.token.trim()) throw new TypeError('A bearer token is required.');
    headers.set('Authorization', `Bearer ${options.token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('Unable to reach the server.', 0, 'NETWORK_ERROR', error);
  }

  const { payload, text } = await readResponse(response);
  if (!response.ok) {
    const parsedError = errorDetails(payload);
    const fallbackMessage = text.trim() || response.statusText || `Request failed (${response.status}).`;
    throw new ApiError(
      parsedError?.message ?? fallbackMessage,
      response.status,
      parsedError?.code ?? 'HTTP_ERROR',
      payload,
    );
  }
  if (payload === undefined) {
    throw new ApiError(
      text.trim()
        ? 'The server returned an invalid JSON response.'
        : 'The server returned an empty response.',
      response.status,
      'INVALID_RESPONSE',
      text || undefined,
    );
  }
  return payload as T;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function getUsernameValidationError(username: string): string | null {
  const normalized = normalizeUsername(username);
  if (normalized.length < USERNAME_MIN_LENGTH || normalized.length > USERNAME_MAX_LENGTH) {
    return `Username must be ${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} characters.`;
  }
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    return 'Username can only contain letters, numbers, and underscores.';
  }
  if (reservedUsernames.has(normalized)) return 'That username is reserved.';
  return null;
}

export function isValidUsername(username: string): boolean {
  return getUsernameValidationError(username) === null;
}

export function getPasswordValidationError(password: string): string | null {
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    return `Password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}

export function isValidPassword(password: string): boolean {
  return getPasswordValidationError(password) === null;
}

export function signup(input: SignupInput, signal?: AbortSignal): Promise<AuthResponse> {
  return requestJson<AuthResponse>('/v1/auth/signup', {
    method: 'POST',
    body: { username: input.username, password: input.password, tracker: input.tracker },
    signal,
  });
}

export function login(input: LoginInput, signal?: AbortSignal): Promise<AuthResponse> {
  return requestJson<AuthResponse>('/v1/auth/login', {
    method: 'POST',
    body: { username: input.username, password: input.password },
    signal,
  });
}

export function getMe(token: string, signal?: AbortSignal): Promise<MeResponse> {
  return requestJson<MeResponse>('/v1/auth/me', { token, signal });
}

export function logout(token: string, signal?: AbortSignal): Promise<LogoutResponse> {
  return requestJson<LogoutResponse>('/v1/auth/logout', { method: 'POST', token, signal });
}

export function updateTracker(
  token: string,
  tracker: TrackerState,
  signal?: AbortSignal,
): Promise<TrackerUpdateResponse> {
  return requestJson<TrackerUpdateResponse>('/v1/me/tracker', {
    method: 'PUT',
    token,
    body: { tracker },
    signal,
  });
}

export function updateProfile(
  token: string,
  isPublic: boolean,
  signal?: AbortSignal,
): Promise<ProfileUpdateResponse> {
  return requestJson<ProfileUpdateResponse>('/v1/me/profile', {
    method: 'PATCH',
    token,
    body: { isPublic },
    signal,
  });
}

export function searchProfiles(
  query: string,
  signal?: AbortSignal,
): Promise<ProfileSearchResponse> {
  const params = new URLSearchParams({ query });
  return requestJson<ProfileSearchResponse>(`/v1/profiles?${params.toString()}`, { signal });
}

export function getPublicProfile(
  username: string,
  month: string,
  signal?: AbortSignal,
): Promise<PublicProfileResponse> {
  const params = `?${new URLSearchParams({ month }).toString()}`;
  return requestJson<PublicProfileResponse>(
    `/v1/profiles/${encodeURIComponent(username)}${params}`,
    { signal },
  );
}
