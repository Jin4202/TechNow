import { useTranslations } from 'next-intl';
import Image from 'next/image';

/**
 * 커버 이미지 + AI 생성 표기 (7.9, D-52).
 *
 * **표기가 이 컴포넌트의 존재 이유다.** 커버는 목록 카드와 기사 페이지 두 곳에서
 * 그려지는데, 두 곳이 같은 `<Image fill>` 블록을 복붙하고 있었다. 표기를 각각
 * 넣으면 나중에 한쪽만 고쳐지는 날이 온다 — 그래서 이미지와 표기를 한 덩어리로 묶는다.
 *
 * 왜 표기하나: 커버 화풍을 평면 벡터에서 **사진 품질로 바꿨다** (사용자 결정).
 * D-38 은 그것을 일부러 피했었다 — "사진처럼 보이는 이미지는 실제 사건의 사진으로
 * 오해된다. 우리 기사에는 실제 사진이 없다." 화풍을 바꿔도 그 위험은 사라지지 않으므로
 * 표기로 상쇄한다.
 *
 * **`alt` 는 비운다.** 커버는 장식이고 생성된 그림의 설명을 저장하지 않으므로,
 * 지어낸 alt 는 화면낭독기 사용자에게 틀린 설명을 읽어주게 된다. 표기는 alt 가 아니라
 * 캡션과 `sr-only` 로 전한다 — **장식 이미지에 대한 고지는 이미지 설명과 다른 것이다.**
 */

/** 목록은 본문 폭(max-w-2xl)까지만 넓어진다. 그 이상은 내려받아도 버린다 */
const SIZES = '(max-width: 672px) 100vw, 672px';

const FRAME = 'relative aspect-[16/9] overflow-hidden rounded-lg bg-black/5 dark:bg-white/5';

export function CoverImage({
  src,
  variant,
  priority = false,
}: {
  src: string;
  /** 목록 카드는 배지, 기사 페이지는 캡션 */
  variant: 'card' | 'article';
  priority?: boolean;
}) {
  const t = useTranslations();

  if (variant === 'article') {
    return (
      <figure className="mt-6">
        <div className={FRAME}>
          <Image src={src} alt="" fill priority={priority} sizes={SIZES} className="object-cover" />
        </div>
        <figcaption className="mt-2 text-xs text-black/45 dark:text-white/45">
          {t('article.coverNotice')}
        </figcaption>
      </figure>
    );
  }

  return (
    <div className={`${FRAME} mb-3`}>
      <Image src={src} alt="" fill priority={priority} sizes={SIZES} className="object-cover" />
      {/*
        카드에는 캡션 자리가 없다. 배지로 대신하되 낭독기에는 전체 문구를 준다 —
        배지만 있으면 "에이아이" 두 글자만 읽힌다.
        밝은 커버에서도 읽히도록 배지 자체에 어두운 배경을 깐다
      */}
      <span className="absolute right-2 bottom-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-white/90 backdrop-blur-sm">
        <span aria-hidden="true">{t('article.coverBadge')}</span>
        <span className="sr-only">{t('article.coverNotice')}</span>
      </span>
    </div>
  );
}
