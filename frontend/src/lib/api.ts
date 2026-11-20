import axios from 'axios';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000/api/v1';

export const api = axios.create({ baseURL: API_BASE_URL });

// يرفق التوكن المحفوظ تلقائياً في كل طلب
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers = config.headers ?? {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; organizationId: string; role: string; email: string };
}

export async function login(email: string, password: string) {
  const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
  return data;
}

export async function register(payload: {
  organizationName: string;
  fullName: string;
  email: string;
  password: string;
}) {
  const { data } = await api.post<LoginResponse>('/auth/register', payload);
  return data;
}

export function saveSession(response: LoginResponse) {
  localStorage.setItem('accessToken', response.accessToken);
  localStorage.setItem('refreshToken', response.refreshToken);
  localStorage.setItem('user', JSON.stringify(response.user));
}

export function clearSession() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
}

export function getCurrentUser() {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}
