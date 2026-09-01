import type { SeriesCharacter } from './types';

type Anchor = NonNullable<SeriesCharacter['photographicAnchor']>;
type Review = NonNullable<Anchor['review']>;

/** Rendering taste is advisory, never a reason to buy another image. Provider
 * failures are handled separately by prepareSeriesImage, without hiding them. */
export async function ensurePhotographicAnchor(
  anchor: Anchor,
  operations: {
    generate: (correction: string) => Promise<string>;
    review: (imageUrl: string) => Promise<Review>;
    save: (stage: string) => Promise<void>;
    label: string;
  },
): Promise<string> {
  const { label, save } = operations;
  // Old quality retries sometimes left a later failed submission but also a
  // perfectly usable completed candidate. Reuse that accepted provider output;
  // preserve the later provider refusal/failure record and never resubmit it.
  if (!anchor.imageUrl && anchor.rejected?.length && (anchor.imageIssue || !anchor.imageTaskId)) {
    const existing = anchor.rejected.at(-1)!;
    anchor.imageUrl = existing.imageUrl;
    anchor.reusedCandidateTaskId = existing.imageTaskId;
    anchor.review = { photographic: false, issues: existing.issues };
    await save(`${label}复用已生成候选，保留原任务记录`);
  }
  if (!anchor.imageUrl) {
    anchor.imageUrl = await operations.generate('');
    anchor.review = undefined;
    await save(`${label}实拍定妆主图已保存`);
  }
  if (!anchor.review) {
    try { anchor.review = await operations.review(anchor.imageUrl); }
    catch { anchor.review = {photographic:null,issues:['质感建议暂不可用；保留图片并继续制作']}; }
    await save(`${label}质感建议已记录（不触发重做）`);
  }
  return anchor.imageUrl;
}
