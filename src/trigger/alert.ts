import { logger, task } from '@trigger.dev/sdk';

/**
 * 알림 태스크 (로드맵 7.4, 7.5).
 *
 * **일부러 실패하는 태스크다.** Trigger.dev 의 내장 알림은 "태스크 실행 실패" 에
 * 걸리므로, 알릴 일이 생기면 이 태스크를 띄우고 던진다. 대시보드에서 이메일이나
 * Slack 을 켜 두면 그대로 전달된다 (D-43).
 *
 * 왜 이렇게 하나: 알릴 조건 중 상당수가 **예외가 아니다.** 예산 80% 초과나
 * "기사 2건이 hold-back 끝에 failed" 는 런이 성공한 상태에서 일어난다.
 * 그렇다고 런 전체를 실패로 만들면 재시도 로직과 로그가 거짓말을 하게 된다.
 * 알림을 별도 실행 단위로 떼면 런의 성패와 알림이 섞이지 않는다.
 *
 * 이 방식의 대가: 대시보드에 실패한 실행이 쌓인다. 그것이 알림 기록이기도 하다.
 */

export type AlertKind =
  /** 월 예산 환산치가 경보 비율을 넘음 (7.5) */
  | 'budget'
  /** 자산을 못 채워 포기한 기사가 있음 (기획서 §2.5) */
  | 'articles-failed'
  /** 런은 돌았는데 기사가 하나도 안 나옴 */
  | 'no-articles'
  /** 월간 요약을 못 만든 사용자가 있음 */
  | 'summaries-skipped';

export interface AlertPayload {
  kind: AlertKind;
  message: string;
  data?: Record<string, unknown>;
}

/** 알림 자체가 실패의 형태를 띠므로, 로그에서 구분되도록 이름을 붙인다 */
export class TechNowAlert extends Error {
  constructor(
    readonly kind: AlertKind,
    message: string,
  ) {
    super(message);
    this.name = 'TechNowAlert';
  }
}

export const alertTask = task({
  id: 'alert',
  // 재시도하면 같은 알림이 여러 번 간다
  retry: { maxAttempts: 1 },
  run: async (payload: AlertPayload) => {
    logger.error(`[${payload.kind}] ${payload.message}`, payload.data ?? {});

    // 여기서 던지는 것이 곧 알림이다
    throw new TechNowAlert(payload.kind, payload.message);
  },
});
