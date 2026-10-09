// The chapter list. Loaded one file at a time with dynamic import, so chapters
// can land independently while the page keeps working — a missing file is a
// console warning, never a broken page.
//
// Chapters are numbered in reading order; ch01 is the introduction and is
// expected to exist. `title` here is only a fallback: the module's own title wins.

export const CHAPTERS = [
  { id: 'ch01', file: './ch01.js', title: 'You are the receiver' },
  { id: 'ch02', file: './ch02.js', title: 'Distance from time' },
  { id: 'ch03', file: './ch03.js', title: 'One sphere, two spheres, a circle' },
  { id: 'ch04', file: './ch04.js', title: 'Two points, and the wrong one' },
  { id: 'ch05', file: './ch05.js', title: 'Why four' },
  { id: 'ch06', file: './ch06.js', title: 'The shape of the sky' },
  { id: 'ch07', file: './ch07.js', title: 'One frequency, everyone shouting' },
  { id: 'ch08', file: './ch08.js', title: 'Thirty-eight microseconds' },
  { id: 'ch09', file: './ch09.js', title: 'At your receiver' }
];

export async function loadChapters() {
  const loaded = [];
  for (const entry of CHAPTERS) {
    try {
      const mod = await import(entry.file);
      loaded.push({ ...entry, ...mod, id: entry.id });
    } catch (err) {
      console.warn('[chapters] ' + entry.id + ' did not load: ' + err.message);
    }
  }
  return loaded;
}
