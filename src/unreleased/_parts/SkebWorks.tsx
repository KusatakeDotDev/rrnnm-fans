/**
 * Skeb のボイス作品の一覧（docs/DESIGN.md §2「Skeb の作品リンク」）。
 *
 * セリフの出典は一覧の下で1回だけ言うので、セリフを1件でも描くなら出典の行も必ず描く。出典の無い引用にしないため。
 * ピックアップ・並べ替え・絞り込みは `hidden` で描き、ラッパー（SkebWorks.astro）のスクリプトが出す。
 * JS が無いときに、押しても何も起きない操作を出さないため（docs/DESIGN.md §6）。
 * 納品のポストは X へのリンクで描く。JS が無くても X で見られるようにするため（押したときの開き方は ADR-0022 の決定）。
 */
import { useId, type HTMLAttributes } from 'react';

import type { SkebWork } from '../../data/skeb';
import { cx } from '../../lib/cx';
import { sharedTags } from '../../lib/skeb-browse';
import { validateSummaryData, type Summary } from '../../lib/skeb-summary';
import styles from './SkebWorks.module.css';

type SkebWorksProps = Omit<HTMLAttributes<HTMLDivElement>, 'dangerouslySetInnerHTML' | 'children'> & {
  works: readonly SkebWork[];
  data: unknown;
};

const workNumber = (work: SkebWork) => Number(work.url.slice(work.url.lastIndexOf('/') + 1));

const sourceOf = ({ quote }: Summary) =>
  quote.provenance === 'user-provided'
    ? { name: '運営者提供資料', date: quote.retrieved, action: '資料受領' }
    : { name: 'Skeb の作品ページ', date: quote.retrieved, action: '確認' };

export default function SkebWorks({ works, data, className, ...rest }: SkebWorksProps) {
  const pickupId = useId();
  const listId = useId();
  const worksId = useId();
  const records = validateSummaryData(data, works.map((work) => work.url)).works;
  const summaryOf = (work: SkebWork) => records.find((record) => record.url === work.url)?.summary;
  const summaries = works.flatMap((work) => summaryOf(work) ?? []);
  const sources = [...new Map(summaries.map(sourceOf).map((source) => [`${source.name}${source.date}`, source])).values()];
  const filterTags = sharedTags(summaries.map((summary) => summary.tags));
  const lastNumber = Math.max(0, ...works.map(workNumber));

  return (
    <div className={cx(styles.root, className)} {...rest} data-skeb-works>
      <section className={cx(styles.pickup, 'on-paper')} aria-labelledby={pickupId} hidden data-skeb-pickup>
        <div className={styles.pickupHead}>
          <h2 id={pickupId} className={styles.pickupTitle} data-skeb-pickup-title>今日のピックアップ</h2>
          <p className={styles.pickupNote} data-skeb-pickup-note />
          <button type="button" className={styles.draw} data-skeb-pickup-draw><span className={styles.dice} aria-hidden="true">🎲</span>別の作品を引く</button>
        </div>
        <div className={cx(styles.card, styles.featured)} data-skeb-pickup-slot />
      </section>

      <section className={cx(styles.section, 'on-paper')} aria-labelledby={worksId}>
        <div className={styles.head}>
          <h2 id={worksId}>作品一覧</h2>
          <p className={styles.count} aria-live="polite" data-skeb-count>{`（全${works.length}件）`}</p>
          <label className={styles.sort} hidden data-skeb-sort>
            <span className="sr-only">並び順</span>
            <select defaultValue="asc" autoComplete="off" aria-controls={listId}>
              <option value="asc">#1 から順</option>
              <option value="desc">{`#${lastNumber} から順`}</option>
              <option value="shuffle">シャッフル</option>
            </select>
          </label>
        </div>

        {filterTags.length > 0 && (
          <div className={styles.filter} role="group" aria-label="タグで絞り込む" hidden data-skeb-filter>
            <div className={styles.filterTags} data-skeb-filter-tags>
              <button type="button" aria-pressed="true" aria-controls={listId} data-skeb-filter-tag="">
                すべて<span className={styles.tally}>{works.length}<span className="sr-only">件</span></span>
              </button>
              {filterTags.map(({ tag, count }) => (
                <button key={tag} type="button" className={styles.hashTag} aria-pressed="false" aria-controls={listId} data-skeb-filter-tag={tag}>
                  {tag}<span className={styles.tally}>{count}<span className="sr-only">件</span></span>
                </button>
              ))}
            </div>
            <button type="button" className={styles.expand} aria-expanded="false" hidden data-skeb-filter-expand>すべて見る</button>
          </div>
        )}

        <ul id={listId} className={styles.works} role="list" data-skeb-list>
          {works.map((work) => {
            const summary = summaryOf(work);
            const provided = summary?.quote.provenance === 'user-provided';
            const scoped = summary && work.summaryScope === 'selected-audio';
            return (
              <li key={work.url} className={styles.card} data-skeb-work={workNumber(work)} {...(summary ? { 'data-skeb-summary': '' } : {})}>
                <div className={styles.meta}>
                  <h3 className={styles.title}>{work.title}</h3>
                  {(scoped || work.deliveryPost) && (
                    <div className={styles.extras}>
                      {work.deliveryPost && (
                        <span className={styles.xPost} data-x-post>
                          <a href={work.deliveryPost.url} target="_blank" rel="noopener noreferrer">
                            {work.deliveryPost.video ? 'X で試聴' : 'X の納品ポスト'}
                            <span className="sr-only">
                              {`（${work.title}の納品ポスト。`}
                              <span data-skeb-x-note>外部サイトを新しいタブで開く</span>
                              {'）'}
                            </span>
                          </a>
                        </span>
                      )}
                      {scoped && <p className={styles.scope}>一部の音声を紹介</p>}
                    </div>
                  )}
                </div>
                {summary && (
                  <>
                    <div className={styles.bubble}>
                      <blockquote className={styles.quote} cite={provided ? undefined : summary.quote.url}>{summary.quote.text}</blockquote>
                    </div>
                    <p className={styles.topic}>{summary.heading}</p>
                  </>
                )}
                <div className={styles.foot}>
                  {summary && summary.tags.length > 0 && (
                    <ul className={styles.tags} aria-label="作品のタグ" role="list">
                      {summary.tags.map((tag) => <li key={tag} className={styles.hashTag} data-skeb-tag>{tag}</li>)}
                    </ul>
                  )}
                  <div className={styles.links}>
                    {work.youtube && (
                      <a className={styles.youtube} href={work.youtube} target="_blank" rel="noopener noreferrer">
                        {'YouTube で聴く ↗'}
                        <span className="sr-only">{`（${work.title}。外部サイトを新しいタブで開く）`}</span>
                      </a>
                    )}
                    <a className={styles.listen} href={work.url} target="_blank" rel="noopener noreferrer">
                      {'Skeb で聴く'}
                      <span className={styles.wave} aria-hidden="true"><span /><span /><span /></span>
                      {' ↗'}
                      <span className="sr-only">{`（${work.title}。外部サイトを新しいタブで開く）`}</span>
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <footer className={styles.notes}>
          {sources.length > 0 && (
            <p>
              {'セリフの出典：'}
              {sources.map(({ name, date, action }, index) => (
                <span key={`${name}${date}`}>
                  {`${index > 0 ? '、' : ''}${name}（`}
                  <span className={styles.date}>{date}</span>
                  {` ${action}）`}
                </span>
              ))}
            </p>
          )}
          <p>
            {[
              '「ボイス作品 #番号」は作品番号を使った案内用の名前で、正式タイトルではありません。',
              summaries.length > 0 && 'お題とタグは、内容を短くまとめた当サイトの案内です。',
              summaries.some((summary) => summary.quote.provenance === 'user-provided') && '運営者提供資料のセリフは、原音との照合を行っていません。',
            ].filter(Boolean).join('')}
          </p>
        </footer>
      </section>
    </div>
  );
}
