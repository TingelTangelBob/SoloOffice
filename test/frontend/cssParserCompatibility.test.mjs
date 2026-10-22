import assert from 'node:assert/strict';
import test from 'node:test';
import postcss from 'postcss';
import nested from 'postcss-nested';
import tailwind from 'tailwindcss';

test('CSS-Sicherheitspatch erhält verschachtelte Selektoren und Tailwind-3-Varianten', async () => {
  const nestedResult = await postcss([nested()]).process('.card { &:hover, &:focus { color: red } .title { color: blue } }', { from: undefined });
  assert.match(nestedResult.css, /\.card:hover, \.card:focus/);
  assert.match(nestedResult.css, /\.card \.title/);
  const result = await postcss([tailwind({
    content: [{ raw: '<div class="md:flex hover:bg-red-500 w-[17px] [&>span]:font-bold"></div>' }],
    corePlugins: { preflight: false },
  })]).process('@tailwind utilities; .action { @apply px-2 font-bold; }', { from: undefined });
  for (const pattern of [/min-width: 768px/, /display: flex/, /width: 17px/, />span/, /font-weight: 700/, /padding-left: 0.5rem/]) assert.match(result.css, pattern);
});
