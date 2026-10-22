// Claude Design へ同期するコンポーネントのエントリポイント（/design-sync 用）。サイトのビルドには使わない。
// コンポーネントは default export なので、ここで名前を付けて書き出す。
// サイトでは Base.astro が読むもののうち3枚を、ここでバンドルに入れる（レイヤーの順、役割トークン、.on-paper・.tabular など）。
// レイヤーの順の宣言（layers.css）は、バンドルの CSS の先頭に出すため最初に置く。
// fonts.css（webfont）は入れない（.design-sync/NOTES.md「書体」）。
import '../src/styles/layers.css';
import '../src/styles/tokens.css';
import '../src/styles/global.css';

export { default as Butterfly } from '../src/components/Butterfly.tsx';
export { default as Card } from '../src/components/Card.tsx';
export { default as CategoryBadge } from '../src/components/CategoryBadge.tsx';
export { default as EntryItem } from '../src/components/EntryItem.tsx';
export { default as EntryList } from '../src/components/EntryList.tsx';
export { default as Eyebrow } from '../src/components/Eyebrow.tsx';
export { default as FieldValue } from '../src/components/FieldValue.tsx';
export { default as Flower } from '../src/components/Flower.tsx';
export { default as Marquee } from '../src/components/Marquee.tsx';
export { default as NemophilaField } from '../src/components/NemophilaField.tsx';
export { default as PlaylistGrid } from '../src/components/PlaylistGrid.tsx';
export { default as Quote } from '../src/components/Quote.tsx';
export { default as ScheduleCard } from '../src/components/ScheduleCard.tsx';
export { default as SectionLabel } from '../src/components/SectionLabel.tsx';
export { default as SiteFooter } from '../src/components/SiteFooter.tsx';
export { default as SiteHeader } from '../src/components/SiteHeader.tsx';
export { default as StatGrid } from '../src/components/StatGrid.tsx';
export { default as StatTile } from '../src/components/StatTile.tsx';
export { default as StickerHeading } from '../src/components/StickerHeading.tsx';
export { default as Twitter } from '../src/components/Twitter.tsx';
export { default as UnknownChip } from '../src/components/UnknownChip.tsx';
export { default as XPost } from '../src/components/XPost.tsx';
export { default as YouTubeThumbnail } from '../src/components/YouTubeThumbnail.tsx';
export { default as SkebWorks } from '../src/unreleased/_parts/SkebWorks.tsx';
