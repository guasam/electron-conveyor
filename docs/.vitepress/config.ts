import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'Conveyor',
  description:
    'Type-safe IPC and cross-window state for Electron — one source of truth per feature, end-to-end inference.',

  // Project pages are served at https://<user>.github.io/<repo>/.
  // Change this if the repository is renamed or hosted at a custom domain (then use '/').
  base: '/electron-conveyor/',

  lastUpdated: true,
  cleanUrls: true,

  head: [
    ['meta', { name: 'theme-color', content: '#6d5efc' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Conveyor — type-safe IPC for Electron' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'Type-safe IPC and cross-window state for Electron, with end-to-end inference.',
      },
    ],
  ],

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Guide', link: '/guide/what-is-conveyor', activeMatch: '/guide/' },
      { text: 'Reference', link: '/reference/api', activeMatch: '/reference/' },
      { text: '0.1.0', link: 'https://github.com/guasam/electron-conveyor/releases' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is Conveyor?', link: '/guide/what-is-conveyor' },
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Mental Model', link: '/guide/mental-model' },
          ],
        },
        {
          text: 'Core Concepts',
          items: [
            { text: 'Procedures', link: '/guide/procedures' },
            { text: 'Events', link: '/guide/events' },
            { text: 'Stores', link: '/guide/stores' },
            { text: 'Window Targeting', link: '/guide/window-targeting' },
            { text: 'Error Handling', link: '/guide/error-handling' },
          ],
        },
        {
          text: 'Going Further',
          items: [
            { text: 'The Process Boundary', link: '/guide/process-boundary' },
            { text: 'React Hooks', link: '/guide/react-hooks' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [{ text: 'API', link: '/reference/api' }],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/guasam/electron-conveyor' }],

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/guasam/electron-conveyor/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Guasam',
    },
  },
})
