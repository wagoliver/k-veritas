import { NextResponse } from 'next/server'

export interface ProblemDetail {
  type: string
  title: string
  status: number
  detail?: string
  code?: string
  fields?: Record<string, string>
}

/** RFC 7807 Problem Details para respostas de erro. */
export function problemResponse(p: ProblemDetail, extraHeaders?: HeadersInit) {
  return NextResponse.json(p, {
    status: p.status,
    headers: {
      'Content-Type': 'application/problem+json',
      ...(extraHeaders ?? {}),
    },
  })
}

export const Problems = {
  invalidBody: (fields?: Record<string, string>) =>
    problemResponse({
      type: 'about:blank',
      title: 'Requisição inválida',
      status: 400,
      code: 'invalid_body',
      fields,
    }),
  rateLimited: (retryAfter: number) =>
    problemResponse(
      {
        type: 'about:blank',
        title: 'Muitas requisições',
        status: 429,
        code: 'rate_limited',
        detail: `Tente novamente em ${retryAfter}s`,
      },
      { 'Retry-After': String(retryAfter) },
    ),
  invalidCredentials: () =>
    problemResponse({
      type: 'about:blank',
      title: 'Credenciais inválidas',
      status: 401,
      code: 'invalid_credentials',
    }),
  unauthorized: () =>
    problemResponse({
      type: 'about:blank',
      title: 'Não autenticado',
      status: 401,
      code: 'unauthorized',
    }),
  conflict: (code: string, detail?: string) =>
    problemResponse({
      type: 'about:blank',
      title: 'Conflito',
      status: 409,
      code,
      detail,
    }),
  forbidden: () =>
    problemResponse({
      type: 'about:blank',
      title: 'Proibido',
      status: 403,
      code: 'forbidden',
    }),
  server: (detail?: string) =>
    problemResponse({
      type: 'about:blank',
      title: 'Erro interno',
      status: 500,
      code: 'server_error',
      detail,
    }),
}
