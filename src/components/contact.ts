/**
 * 当サイトの窓口（docs/CONCEPT.md §2）。提案の窓口と、削除・訂正の窓口（制作者の X への DM）。
 *
 * 制作者の X。公式ではないので official.ts には置かない。
 * official.ts の YouTube と違って、リンク先を ID の形にしない。ID にしても画面に出すハンドルは古いまま残るし、
 * ハンドルを変えるのはこのサイトを直す本人なので、変えたときにここを直す。手放したハンドルは他人が取れるので、
 * 直し忘れると申し出が他人に届く。提案の窓口の README にも書いてあるので、そちらも直す。
 *
 * src/lib に置かない理由は official.ts と同じ（あそこは純関数だけの層）。
 */
export const CONTACT_HANDLE = 'ekatas93';
export const CONTACT = `https://x.com/${CONTACT_HANDLE}`;

/** 提案の窓口。別のリポジトリの Discussions で受ける。リンクは README へ向ける（理由は about.astro）。 */
export const IDEAS = 'https://github.com/KusatakeDotDev/rrnnm-fans-ideas';
