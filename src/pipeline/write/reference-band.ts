import { readFileSync } from 'node:fs';

import { percentile, type TextMetrics } from './quality-metrics';

/**
 * 기준 대역 — 실제 과학 매체가 어느 범위에 있는지 (평가 프레임워크).
 *
 * **우리 기사가 어디에 있어야 하는지의 근거.** 이전에는 "평균 20단어" 처럼
 * 지어낸 숫자를 기준으로 썼고, 그 결과 실제 저널리즘이 어떤지 모르는 채로
 * 프롬프트를 네 번 고치며 헤맸다 (D-29).
 *
 * 우리 기사와 **같은 `textMetrics` 함수**로 재야 비교가 성립한다.
 * 음절 계산이 정확하지 않아도 양쪽에 동일하게 적용되므로 상관없다.
 */

export interface Band {
  p25: number;
  p50: number;
  p75: number;
}

/** TextMetrics 의 각 수치 축에 대한 대역 */
export type ReferenceBand = Record<keyof TextMetrics, Band>;

export interface ReferenceCorpus {
  builtAt: string;
  /** 매체별 수집 편수. 한 매체에 쏠렸는지 확인용 */
  sampleCounts: Record<string, number>;
  articles: number;
  band: ReferenceBand;
}

const METRIC_KEYS: (keyof TextMetrics)[] = [
  'sentences',
  'sentenceMean',
  'sentenceMedian',
  'sentenceP90',
  'sentenceMax',
  'sentenceStdev',
  'longSentenceRatio',
  'words',
  'syllablesPerWord',
  'polysyllabicRatio',
  'fleschReadingEase',
  'fleschKincaidGrade',
];

export function computeBand(samples: readonly TextMetrics[]): ReferenceBand {
  const band = {} as ReferenceBand;

  for (const key of METRIC_KEYS) {
    const values = samples.map((s) => s[key]);
    band[key] = {
      p25: percentile(values, 0.25),
      p50: percentile(values, 0.5),
      p75: percentile(values, 0.75),
    };
  }

  return band;
}

export type BandVerdict = 'below' | 'within' | 'above';

/**
 * 값이 대역 안인가.
 *
 * **합격/불합격이 아니다.** 대역 밖이라고 나쁜 것이 아니라 "실제 매체와 다르다"는
 * 뜻이고, 그것이 문제인지는 사람이 판단한다.
 */
export function classify(value: number, band: Band): BandVerdict {
  if (value < band.p25) return 'below';
  if (value > band.p75) return 'above';
  return 'within';
}

export interface MetricComparison {
  metric: keyof TextMetrics;
  value: number;
  band: Band;
  verdict: BandVerdict;
}

export function compareToBand(
  metrics: TextMetrics,
  band: ReferenceBand,
): MetricComparison[] {
  return METRIC_KEYS.map((metric) => ({
    metric,
    value: metrics[metric],
    band: band[metric],
    verdict: classify(metrics[metric], band[metric]),
  }));
}

export const REFERENCE_PATH = 'fixtures/reference/metrics.json';

export function loadReference(path = REFERENCE_PATH): ReferenceCorpus {
  return JSON.parse(readFileSync(path, 'utf8')) as ReferenceCorpus;
}
