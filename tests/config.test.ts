import { describe, expect, it } from 'vitest';

import { budget } from '@/config/budget';
import { categoryLabel, CATEGORIES } from '@/config/categories';
import { DEFAULT_LOCALE, LOCALES } from '@/config/locales';
import { MODEL_HAIKU, MODEL_SONNET, models, sourceReadingModels } from '@/config/models';
import { ALL_ASSETS, requiredAssets } from '@/config/required-assets';
import { thresholds } from '@/config/thresholds';
import { Constants } from '@/db/types';

/**
 * config 값이 docs/DECISIONS.md 와 어긋나지 않는지 지킨다.
 *
 * 값을 바꾸는 것 자체는 정상이다 (튜닝 대상이므로). 다만 결정 문서를 함께
 * 고치지 않고 바꾸면 여기서 걸린다.
 */

describe('thresholds', () => {
  it('선정 규칙은 total >= 10 && minAxis >= 3 (D-09)', () => {
    expect(thresholds.total).toBe(10);
    expect(thresholds.minAxis).toBe(3);
  });

  it('총점 상한(15)을 넘지 않고, 최소 축 점수로 총점이 자동 통과되지 않는다', () => {
    expect(thresholds.total).toBeLessThanOrEqual(15);
    // 모든 축이 최소값이기만 해도 통과해버리면 총점 조건이 무의미해진다
    expect(thresholds.minAxis * 3).toBeLessThan(thresholds.total);
  });

  it('pending TTL 이 follow-up 윈도우보다 짧다 (D-01)', () => {
    expect(thresholds.pendingTtlDays).toBe(3);
    expect(thresholds.pendingTtlDays).toBeLessThan(thresholds.followUpWindowDays);
  });

  it('processed 보존 기간이 follow-up 윈도우보다 훨씬 길다 (D-01)', () => {
    expect(thresholds.processedRetentionDays).toBeGreaterThan(thresholds.followUpWindowDays);
  });

  it('일 상한은 5 (비용 가드, D-46)', () => {
    expect(thresholds.dailyCap).toBe(5);
  });

  // 재채점은 "상한의 3배" 규칙이다 (D-19). 상한을 올리고 여기를 안 올리면
  // 후보가 상한보다 적어져 조용히 공급이 막힌다
  it('재채점 대상이 일 상한의 3배다 (D-19)', () => {
    expect(thresholds.rescoreTopN).toBe(thresholds.dailyCap * 3);
  });
});

describe('models', () => {
  it('출처 본문을 읽는 단계가 전부 같은 모델이다 (D-06)', () => {
    // 하나라도 다르면 prompt cache 프리픽스가 깨지고 예산이 무너진다.
    // 비용 최적화로도 건드리지 말 것.
    const used = new Set(Object.values(sourceReadingModels));
    expect(used.size).toBe(1);
    expect(used.has(MODEL_SONNET)).toBe(true);
  });

  it('출처를 읽는 단계는 write/verifyClaims/rewrite 다 (D-24)', () => {
    // 클레임 추출은 기사만 읽으므로 여기 없다
    expect(Object.keys(sourceReadingModels).sort()).toEqual([
      'rewrite',
      'verifyClaims',
      'write',
    ]);
  });

  it('클레임 추출은 Haiku 다 (D-24)', () => {
    expect(models.extractClaims).toBe(MODEL_HAIKU);
  });

  it('모든 단계가 알려진 모델 ID 중 하나를 쓴다', () => {
    for (const [step, id] of Object.entries(models)) {
      expect([MODEL_SONNET, MODEL_HAIKU], `${step} 의 모델 ID`).toContain(id);
    }
  });

  it('고빈도 저비용 단계는 Haiku 에 남아 있다', () => {
    expect(models.group).toBe(MODEL_HAIKU);
    expect(models.score).toBe(MODEL_HAIKU);
  });
});

describe('budget', () => {
  it('토픽당 상한이 기획서 값과 같다', () => {
    expect(budget.searchCallsPerTopic).toBe(3);
    expect(budget.pagesPerTopic).toBe(10);
  });

  it('출처 수 범위가 3~5 이다', () => {
    expect(budget.minSources).toBe(3);
    expect(budget.maxSources).toBe(5);
    expect(budget.minSources).toBeLessThanOrEqual(budget.maxSources);
  });

  it('일 상한으로 한 달을 채워도 변동비가 월 예산을 넘지 않는다 (D-07)', () => {
    const variableMonthly = budget.variableUsdPerArticle * thresholds.dailyCap * 30;
    expect(variableMonthly).toBeLessThan(budget.monthlyUsd);
  });
});

describe('required assets', () => {
  it('필수 자산이 전체 자산 목록의 부분집합이다', () => {
    for (const asset of requiredAssets) {
      expect(ALL_ASSETS).toContain(asset);
    }
  });

  it('영문 본문은 어느 Phase에서든 필수다', () => {
    expect(requiredAssets).toContain('english_body');
  });
});

describe('locales (D-08)', () => {
  it('지원 언어는 en / ko 이고 기본값은 영어다', () => {
    expect(LOCALES).toEqual(['en', 'ko']);
    // 영어가 원본이고 품질 기준이다 (기획서 §0). 번역이 없어도 영어는 항상 있다
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('DB 의 locale enum 과 목록이 같다', () => {
    // 여기가 어긋나면 앱이 만드는 경로와 DB 가 받는 값이 갈린다.
    // article_translations.locale, profiles.locale 이 이 enum 을 쓴다
    expect([...LOCALES]).toEqual(Constants.public.Enums.locale);
  });

  it('카테고리 라벨이 모든 언어를 갖는다', () => {
    for (const locale of LOCALES) {
      for (const category of CATEGORIES) {
        expect(categoryLabel(category.value, locale)).toBeTruthy();
      }
    }
  });
});

describe('필수 자산 (4.6)', () => {
  it('Phase 4 부터 한국어 번역이 필수다', () => {
    // 이 한 줄이 initialStatus() 를 ready_pending 으로 바꾼다.
    // 번역이 없는 기사는 그날 아침 발행에서 빠진다 (기획서 §2.3)
    expect(requiredAssets).toContain('korean_translation');
  });

  it('Phase 5 부터 커버 이미지가 필수다', () => {
    // 커버 없는 기사는 그날 아침 발행에서 빠진다 (기획서 §2.4).
    // placeholder 이미지를 대신 넣지 않는다 (CLAUDE.md §5)
    expect(requiredAssets).toContain('cover_image');
  });
});
