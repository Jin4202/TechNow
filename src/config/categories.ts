/**
 * 고정 카테고리 7종.
 *
 * 기획서 §0에서 고정된 목록이며, 늘리지 않는다. 드문 주제는 가장 가까운
 * 카테고리에 넣고 tags 로 구분한다. 하루 3개짜리 사이트에서 카테고리가 더
 * 늘면 빈 섹션만 생긴다.
 *
 * 값은 DB enum 과 URL 슬러그에 그대로 쓰인다 (kebab-case 단일 표기).
 *
 * description 은 두 벌이다:
 *   ko — UI 와 문서용
 *   en — 작성 프롬프트에 들어간다. 프롬프트 나머지가 영어인데 여기만 한국어면
 *        모델이 분류에서 언어를 전환해야 한다
 */

export const CATEGORIES = [
  {
    value: 'ai-computing',
    en: 'AI & Computing',
    ko: 'AI·컴퓨팅',
    description:
      '기계학습 모델과 연구, 반도체와 컴퓨팅 아키텍처, 소프트웨어 인프라, 양자컴퓨팅.',
    descriptionEn:
      'Machine learning models and research, semiconductors and computing architecture, software infrastructure, quantum computing.',
  },
  {
    value: 'space-astronomy',
    en: 'Space & Astronomy',
    ko: '우주·천문',
    description:
      '발사와 임무, 우주망원경과 관측, 행성과학, 우주생물학, 발사체와 위성 산업.',
    descriptionEn:
      'Launches and missions, telescopes and observations, planetary science, astrobiology, launch vehicles and the satellite industry.',
  },
  {
    value: 'health-biotech',
    en: 'Health & Biotech',
    ko: '건강·바이오',
    description:
      '의학 연구와 임상시험, 유전학과 유전자편집, 신약과 백신, 감염병, 생명공학 도구.',
    descriptionEn:
      'Medical research and clinical trials, genetics and gene editing, drugs and vaccines, infectious disease, biotechnology tools.',
  },
  {
    value: 'climate-energy',
    en: 'Climate & Energy',
    ko: '기후·에너지',
    description:
      '기후과학과 관측, 재생에너지와 원자력, 배터리와 저장, 탄소포집, 환경생태.',
    descriptionEn:
      'Climate science and observation, renewables and nuclear power, batteries and storage, carbon capture, environment and ecology.',
  },
  {
    value: 'physics-materials',
    en: 'Physics & Materials',
    ko: '물리·소재',
    description:
      '기초물리와 입자·중력파 실험, 초전도체, 신소재와 나노기술, 화학.',
    descriptionEn:
      'Fundamental physics, particle and gravitational-wave experiments, superconductors, new materials and nanotechnology, chemistry.',
  },
  {
    value: 'robotics-hardware',
    en: 'Robotics & Hardware',
    ko: '로봇·하드웨어',
    description:
      '로봇과 자율주행, 드론, 소비자·산업용 기기, 제조와 3D 프린팅, 웨어러블.',
    descriptionEn:
      'Robots and autonomous vehicles, drones, consumer and industrial devices, manufacturing and 3D printing, wearables.',
  },
  {
    value: 'industry-policy',
    en: 'Tech Industry & Policy',
    ko: '산업·정책',
    description:
      '기술 규제와 입법, 기업 전략과 인수합병, 연구비와 과학정책, 프라이버시와 보안 정책.',
    descriptionEn:
      'Technology regulation and legislation, corporate strategy and acquisitions, research funding and science policy, privacy and security policy.',
  },
] as const;

export type Category = (typeof CATEGORIES)[number]['value'];

export const CATEGORY_VALUES = CATEGORIES.map((c) => c.value) as readonly Category[];

const BY_VALUE = new Map(CATEGORIES.map((c) => [c.value, c]));

export function getCategory(value: Category) {
  const found = BY_VALUE.get(value);
  if (!found) throw new Error(`알 수 없는 카테고리: ${value}`);
  return found;
}

export function isCategory(value: string): value is Category {
  return BY_VALUE.has(value as Category);
}

/** locale 에 맞는 표시 이름 */
export function categoryLabel(value: Category, locale: 'en' | 'ko'): string {
  return getCategory(value)[locale];
}
