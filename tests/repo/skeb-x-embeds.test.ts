import { expect, it } from 'vitest';

import { SKEB_WORKS } from '../../src/data/skeb';
import { X_EMBEDS } from '../helpers/x-embed';

// 片方にだけ足すと、埋め込めない納品のポストへのリンクか、使わない埋め込みの許可が残る。
it('Skeb の納品のポストと、/skeb/ で X の埋め込みを許すポストが、同じ順に同じだけある', () => {
  expect(SKEB_WORKS.flatMap((work) => (work.deliveryPost ? [work.deliveryPost.url.split('/').pop()] : []))).toEqual(X_EMBEDS['/skeb/']!.posts);
});
