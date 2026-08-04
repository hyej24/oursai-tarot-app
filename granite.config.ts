import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'oursai-tarot',
  brand: {
    displayName: '타로 : 우리 사이 온도',
    primaryColor: '#D87975',
    icon: 'https://static.toss.im/icons/png/4x/icon-heart.png',
  },
  web: {
    host: 'localhost',
    port: 3000,
    commands: {
      dev: 'vite --host 0.0.0.0',
      build: 'vite build',
    },
  },
  permissions: [],
  outdir: 'dist',
  webViewProps: {
    type: 'partner',
    bounces: false,
    overScrollMode: 'never',
  },
});
