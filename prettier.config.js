export default {
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'es5',
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: 'always',
  endOfLine: 'lf',
  plugins: ['prettier-plugin-astro', 'prettier-plugin-tailwindcss'],
  overrides: [
    {
      files: ['*.astro'],
      options: {
        parser: 'astro',
      },
    },
    {
      files: ['*.css', '*.scss'],
      options: {
        parser: 'css',
      },
    },
    {
      files: ['*.json', '*.jsonc'],
      options: {
        parser: 'json',
      },
    },
    {
      files: ['*.md', '*.mdx'],
      options: {
        parser: 'markdown',
        printWidth: 80,
      },
    },
  ],
};