import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('migrations');
  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: '2026-11-01',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB'],
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: 'production',
            ALLOWED_ORIGIN: 'https://striatix.com',
            PUBLIC_BASE_URL: 'https://striatix.com',
            IP_HASH_PEPPER: 'test-pepper-not-a-real-secret-0123456789',
            EMAIL_FROM: 'waitlist@example.test',
            EMAIL_FROM_NAME: 'Striatix Supplements',
            EMAIL_REPLY_TO: 'striatixsupps@gmail.com',
            NOTIFY_TO: 'striatixsupps@gmail.com',
            NOTIFY_TIMEZONE: 'UTC',
            ADMIN_EXPORT_TOKEN: 'test-admin-token-0123456789abcdef',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'] },
  };
});
