import { describe, expect, it } from 'vitest';

import { checkParity, hangulRatio } from '@/pipeline/translate/check-parity';

/**
 * 번역본 구조 검증 (로드맵 4.3a, D-03).
 *
 * 여기서 놓치면 섹션별 출처 표기가 틀린 문단을 가리킨 채 발행된다 —
 * 독자에게는 근거가 있는 것처럼 보이지만 실제로는 없다.
 */

const original = {
  title: 'Underground detector records a flash it cannot explain',
  oneLineSummary: 'The odds that background noise produced the signal are about one in two hundred.',
  sections: [
    {
      heading: 'What the detector saw',
      paragraphs: ['The experiment recorded a single flash.', 'Backgrounds are ordinary events.'],
      sources: [1, 2],
    },
    {
      heading: 'Why researchers are cautious',
      paragraphs: ['A single event is not a discovery.'],
      sources: [2, 3],
    },
  ],
};

const good = {
  title: '지하 검출기가 설명할 수 없는 섬광을 기록했습니다',
  oneLineSummary: '배경 잡음이 이 신호를 만들었을 확률은 약 200분의 1입니다.',
  sections: [
    {
      heading: '검출기가 본 것',
      paragraphs: ['실험은 단 한 번의 섬광을 기록했습니다.', '배경은 늘 일어나는 사건입니다.'],
      sources: [1, 2],
    },
    {
      heading: '연구진이 신중한 이유',
      paragraphs: ['사건 하나는 발견이 아닙니다.'],
      sources: [2, 3],
    },
  ],
};

/** 한 군데만 망가뜨린 번역본을 만든다 */
function broken(mutate: (draft: typeof good) => void): typeof good {
  const draft = structuredClone(good);
  mutate(draft);
  return draft;
}

describe('checkParity', () => {
  it('구조가 같으면 통과', () => {
    expect(checkParity(original, good)).toBeNull();
  });

  it('섹션이 늘거나 줄면 실패', () => {
    const result = checkParity(
      original,
      broken((d) => d.sections.pop()),
    );
    expect(result?.failure).toBe('section-count');
  });

  it('문단 수가 다르면 실패', () => {
    // 번역하며 문단을 합치는 것이 가장 흔한 이탈이다
    const result = checkParity(
      original,
      broken((d) => {
        d.sections[0]!.paragraphs = ['둘을 하나로 합친 문단입니다.'];
      }),
    );
    expect(result?.failure).toBe('paragraph-count');
  });

  it('출처 번호가 다르면 실패', () => {
    const result = checkParity(
      original,
      broken((d) => {
        d.sections[0]!.sources = [1];
      }),
    );
    expect(result?.failure).toBe('sources-mismatch');
    expect(result?.detail).toContain('섹션 1');
  });

  it('출처 번호는 순서까지 같아야 한다', () => {
    // 집합이 같아도 순서가 다르면 화면의 "출처 2, 1" 표기가 원문과 어긋난다
    const result = checkParity(
      original,
      broken((d) => {
        d.sections[0]!.sources = [2, 1];
      }),
    );
    expect(result?.failure).toBe('sources-mismatch');
  });

  it('제목이나 소제목이 비면 실패', () => {
    expect(
      checkParity(
        original,
        broken((d) => {
          d.title = '   ';
        }),
      )?.failure,
    ).toBe('empty-field');

    expect(
      checkParity(
        original,
        broken((d) => {
          d.sections[1]!.heading = '';
        }),
      )?.failure,
    ).toBe('empty-field');
  });

  it('구조가 완벽해도 번역이 안 됐으면 실패', () => {
    // 모델이 영문을 그대로 돌려주는 실패. 구조 검증만으로는 통과해버린다
    const result = checkParity(original, structuredClone(original));
    expect(result?.failure).toBe('not-translated');
  });

  it('고유명사가 영문으로 남은 정상 번역은 통과', () => {
    const result = checkParity(
      original,
      broken((d) => {
        d.sections[0]!.paragraphs[0] =
          'LUX-ZEPLIN 실험은 단 한 번의 섬광을 기록했습니다. 이는 액체 제논(liquid xenon) 검출기입니다.';
      }),
    );
    expect(result).toBeNull();
  });
});

describe('hangulRatio', () => {
  it('숫자와 문장부호는 세지 않는다', () => {
    // 200분의 1 같은 표현이 비율을 끌어내리면 정상 번역이 실패한다
    expect(hangulRatio('약 200분의 1입니다.')).toBe(1);
  });

  it('영문만 있으면 0', () => {
    expect(hangulRatio('A single event is not a discovery.')).toBe(0);
  });

  it('글자가 없으면 0', () => {
    expect(hangulRatio('123 — 456')).toBe(0);
  });
});
