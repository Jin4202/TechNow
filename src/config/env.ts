import { z } from 'zod';

/**
 * 환경변수 스키마.
 *
 * 앱용과 파이프라인 전용을 **의도적으로 분리**해서 노출한다 (CLAUDE.md §2.1).
 * Next.js 앱 코드가 getPipelineEnv() 를 import 하면 그 자체가 위반 신호이며,
 * scripts/check-secrets.mjs 가 CI에서 잡는다.
 *
 * 검증은 최초 접근 시점에 한 번만 한다. 모듈 로드 시점에 던지면
 * 키가 필요 없는 빌드 단계까지 깨진다.
 */

const appEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const pipelineEnvSchema = z.object({
  /** RLS를 우회한다. Trigger.dev 태스크 전용 */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  BRAVE_API_KEY: z.string().min(1),
  FAL_KEY: z.string().min(1),
});

export type AppEnv = z.infer<typeof appEnvSchema>;
export type PipelineEnv = z.infer<typeof pipelineEnvSchema>;

function parseOrThrow<T>(schema: z.ZodType<T>, label: string): T {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(
      `${label} 환경변수가 올바르지 않습니다: ${missing}. .env.example 을 참고해 .env.local 을 채우세요.`,
    );
  }
  return result.data;
}

let appEnvCache: AppEnv | undefined;
let pipelineEnvCache: PipelineEnv | undefined;

/** Next.js 앱에서 쓰는 환경변수. anon 키까지만 */
export function getAppEnv(): AppEnv {
  appEnvCache ??= parseOrThrow(appEnvSchema, '앱');
  return appEnvCache;
}

/**
 * 파이프라인 전용 환경변수.
 *
 * ⚠️ src/app, src/components 에서 호출하지 말 것.
 * Trigger.dev 태스크와 src/pipeline 에서만 쓴다.
 */
export function getPipelineEnv(): PipelineEnv {
  pipelineEnvCache ??= parseOrThrow(pipelineEnvSchema, '파이프라인');
  return pipelineEnvCache;
}

/** 테스트에서 캐시를 비운다 */
export function resetEnvCache(): void {
  appEnvCache = undefined;
  pipelineEnvCache = undefined;
}
