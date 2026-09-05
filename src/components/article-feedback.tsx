'use client';

import { useState, useSyncExternalStore } from 'react';

import { submitFeedback } from '@/app/articles/actions';

/**
 * "이해하기 쉬웠나요?" (D-28, 로드맵 3.14a).
 *
 * **집계를 보여주지 않는다.** 남이 어떻게 눌렀는지 보이면 지표가 편향된다.
 *
 * 중복 방지는 브라우저가 만든 익명 키와 localStorage 로 한다. 완벽하지 않지만
 * 내부 품질 지표라 남용 방어보다 신호 확보가 우선이다.
 */

const VOTER_KEY_STORAGE = 'technow.voter-key';

function votedStorageKey(articleId: string): string {
  return `technow.voted.${articleId}`;
}

type StoredState = 'server' | 'voted' | 'not-voted' | 'unavailable';

/**
 * localStorage 는 외부 저장소다. useEffect + setState 로 읽으면 렌더가 연쇄된다.
 *
 * 서버 스냅샷은 'server' 다 — 서버는 브라우저 저장소를 볼 수 없다. 대부분의 독자는
 * 투표한 적이 없으므로 그 상태에서는 버튼을 그려두고, 이미 투표한 소수만
 * 하이드레이션 뒤에 감사 문구로 바뀐다.
 */
function useVoteState(articleId: string): StoredState {
  return useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return localStorage.getItem(votedStorageKey(articleId)) ? 'voted' : 'not-voted';
      } catch {
        // 사생활 보호 모드 등에서 저장소가 막힌다
        return 'unavailable';
      }
    },
    () => 'server' as const,
  );
}

/** 브라우저마다 하나. 없으면 만든다 */
function getVoterKey(): string | null {
  try {
    const existing = localStorage.getItem(VOTER_KEY_STORAGE);
    if (existing) return existing;

    const created = crypto.randomUUID();
    localStorage.setItem(VOTER_KEY_STORAGE, created);
    return created;
  } catch {
    return null;
  }
}

export function ArticleFeedback({
  articleId,
  styleGuideVersion,
  locale = 'en',
}: {
  articleId: string;
  styleGuideVersion: string | null;
  locale?: 'en' | 'ko';
}) {
  const stored = useVoteState(articleId);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  if (stored === 'unavailable') return null;

  const done = submitted || stored === 'voted';

  async function vote(helpful: boolean) {
    const voterKey = getVoterKey();
    if (!voterKey) {
      setSubmitted(true);
      return;
    }

    setSending(true);
    try {
      await submitFeedback({ articleId, helpful, voterKey, locale, styleGuideVersion });
      localStorage.setItem(votedStorageKey(articleId), helpful ? 'up' : 'down');
    } catch {
      // 실패해도 독자에게 부담을 주지 않는다. 품질 지표일 뿐이다
    }
    setSending(false);
    setSubmitted(true);
  }

  return (
    <section className="mt-10 rounded-lg border border-black/10 p-4 dark:border-white/15">
      {done ? (
        <p className="text-sm text-black/60 dark:text-white/60">
          {locale === 'ko' ? '고맙습니다.' : 'Thanks for the feedback.'}
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {locale === 'ko' ? '이해하기 쉬웠나요?' : 'Was this easy to follow?'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={sending}
              onClick={() => vote(true)}
              className="rounded-md border border-black/15 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/20"
            >
              {locale === 'ko' ? '네' : 'Yes'}
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() => vote(false)}
              className="rounded-md border border-black/15 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/20"
            >
              {locale === 'ko' ? '아니요' : 'No'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
