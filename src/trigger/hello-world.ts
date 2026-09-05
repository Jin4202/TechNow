import { logger, schedules } from '@trigger.dev/sdk';

/**
 * 배선 확인용 태스크 (로드맵 1.4).
 *
 * 대시보드 테스트 버튼과 스케줄 양쪽에서 도는지만 본다.
 * Phase 1이 끝나면 지운다.
 */
export const helloWorld = schedules.task({
  id: 'hello-world',
  cron: {
    // 실제 파이프라인과 같은 시각·타임존으로 두어 스케줄 동작을 미리 확인한다
    pattern: '0 1 * * *',
    timezone: 'America/Los_Angeles',
  },
  run: async (payload) => {
    logger.info('hello-world 실행', {
      scheduledAt: payload.timestamp,
      lastRunAt: payload.lastTimestamp,
      timezone: payload.timezone,
    });

    return { ok: true, ranAt: new Date().toISOString() };
  },
});
