import { describe, expect, it } from 'vitest';
import { topicShelves, type LibraryItem } from './library';

const item = (title: string, url: string): LibraryItem => ({ key: url, url, title, folder: 'Bookmarks', duplicate: false });

describe('topicShelves', () => {
  it('puts related bookmarks on the same shelf', () => {
    const shelves = topicShelves([
      item('Rust async book', 'https://rust-lang.github.io/async-book/'),
      item('Tokio tutorial: async Rust', 'https://tokio.rs/tokio/tutorial'),
      item('Pasta carbonara the Roman way', 'https://www.seriouseats.com/pasta-carbonara-recipe'),
      item('Neapolitan pizza dough recipe', 'https://www.seriouseats.com/neapolitan-pizza-dough'),
      item('Postgres indexing explained', 'https://use-the-index-luke.com/'),
    ]);
    const shelfOf = (t: string) => shelves.find((s) => s.items.some((i) => i.title.startsWith(t)))!.name;
    expect(shelfOf('Rust async')).toBe(shelfOf('Tokio'));
    expect(shelfOf('Pasta')).toBe(shelfOf('Neapolitan'));
    expect(shelfOf('Pasta')).not.toBe(shelfOf('Rust async'));
  });
});
