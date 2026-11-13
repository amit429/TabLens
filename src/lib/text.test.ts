import { describe, expect, it } from 'vitest';
import { cosine, keywords, tfidf, tokenize } from './text';

describe('text', () => {
  it('tokenizes without stop words', () => {
    expect(tokenize('The best MacBook Air M4 review of 2026')).toEqual(['macbook', 'air', 'm4']);
  });
  it('scores similar docs higher', () => {
    const { vectors } = tfidf([tokenize('macbook air laptop battery'), tokenize('thinkpad laptop battery life'), tokenize('pasta recipe tomato')]);
    expect(cosine(vectors[0]!, vectors[1]!)).toBeGreaterThan(cosine(vectors[0]!, vectors[2]!));
    expect(cosine(vectors[0]!, vectors[0]!)).toBeCloseTo(1);
  });
  it('extracts keywords', () => {
    expect(keywords('laptop laptop battery battery battery screen')).toEqual(['battery', 'laptop', 'screen']);
  });
});
