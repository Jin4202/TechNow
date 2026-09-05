import { logger, task } from '@trigger.dev/sdk';

import { getAnthropic } from '@/clients/anthropic';
import { BraveClient } from '@/clients/brave';
import { createServiceClient } from '@/db/supabase/service';
import { buildTopic, type BuildTopicInput } from '@/pipeline/build-topic';

/**
 * 토픽 하나를 기사로 만드는 자식 태스크 (로드맵 3.12).
 *
 * CLAUDE.md §3 — 얇은 래퍼다. 흐름은 src/pipeline/build-topic.ts 에 있다.
 *
 * **토픽마다 별도 태스크인 이유**: 한 기사의 조사나 검증 실패가 다른 기사의
 * 생성을 막아서는 안 된다 (ARCHITECTURE §2). 재시도도 이 단위로 돈다.
 */
export const buildArticleTask = task({
  id: 'build-article',
  // 조사(검색 3회 + fetch 최대 10회)와 작성·검증까지 한 번에 돈다
  maxDuration: 600,
  // 근거 검증 실패는 buildArticle 안에서 1회 재작성으로 다룬다.
  // 여기서 재시도하는 것은 네트워크·레이트리밋 같은 일시적 실패다
  retry: { maxAttempts: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 30_000 },
  run: async (payload: BuildTopicInput) => {
    const result = await buildTopic(
      createServiceClient(),
      getAnthropic(),
      new BraveClient(),
      payload,
    );

    if (result.failure) {
      logger.warn('기사 생성 실패', {
        topicTitle: payload.topicTitle,
        failure: result.failure,
        detail: result.detail ?? '',
        attempts: result.attempts,
        sourceCount: result.sourceCount,
      });
    } else {
      logger.info('기사 생성 완료', {
        topicTitle: payload.topicTitle,
        articleId: result.articleId ?? '(중복이라 건너뜀)',
        attempts: result.attempts,
        sourceCount: result.sourceCount,
      });
    }

    return result;
  },
});
