import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import type { TaskResponse } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { Hono } from 'hono';

import { runReleaseCheck } from './run-check';

const app = new Hono();

app.post('/internal/scheduler/check-releases', async (c) => {
  try {
    const result = await runReleaseCheck();
    console.log('Scheduled GitHub release check completed', result);
    return c.json<TaskResponse>({ status: 'ok' });
  } catch (error) {
    console.error('Scheduled GitHub release check failed', error);
    return c.json<TaskResponse>({ status: 'error' }, 500);
  }
});

app.post('/internal/menu/check-releases', async (c) => {
  try {
    const result = await runReleaseCheck();
    const text =
      result.status === 'locked'
        ? 'A release check is already running.'
        : result.posted > 0
          ? `Posted ${result.posted} new release${result.posted === 1 ? '' : 's'}.`
          : result.initialized
            ? 'Initialized. Existing releases were recorded without posting.'
            : 'No new GitHub releases found.';
    return c.json<UiResponse>({ showToast: { text, appearance: 'neutral' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Manual GitHub release check failed', error);
    return c.json<UiResponse>(
      { showToast: { text: `Release check failed: ${message}`, appearance: 'neutral' } },
      500
    );
  }
});

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});

