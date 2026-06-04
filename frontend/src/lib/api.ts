// 统一 API 基础地址，生产环境从 .env.production 读取
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '') as string

export function apiUrl(path: string): string {
  return API_BASE + path
}
