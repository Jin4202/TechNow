import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PromptSource } from '@/prompts/grounded-steps';

/**
 * 조사 결과 fixture (로드맵 3.11).
 *
 * 프롬프트를 고칠 때마다 검색과 fetch 를 다시 하면 비용도 들고 결과도 매번
 * 달라져 비교가 안 된다. 실제 조사 결과를 파일로 굳혀두고 반복 실행한다.
 *
 * 테스트와 개발 스크립트에서만 쓴다. 파이프라인은 이 모듈을 import 하지 않는다.
 */

export interface TopicFixture {
  slug: string;
  topicTitle: string;
  capturedAt: string;
  queries: string[];
  sources: PromptSource[];
}

const FIXTURE_DIR = 'fixtures/topics';

export function saveFixture(fixture: TopicFixture): string {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const path = join(FIXTURE_DIR, `${fixture.slug}.json`);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  return path;
}

export function loadFixture(slug: string): TopicFixture {
  const raw = readFileSync(join(FIXTURE_DIR, `${slug}.json`), 'utf8');
  return JSON.parse(raw) as TopicFixture;
}

export function listFixtures(): TopicFixture[] {
  let files: string[];
  try {
    files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.map((f) => loadFixture(f.replace(/\.json$/, '')));
}

export function hasFixture(slug: string): boolean {
  try {
    loadFixture(slug);
    return true;
  } catch {
    return false;
  }
}
