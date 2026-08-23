import { app, HttpResponseInit } from '@azure/functions';

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (): Promise<HttpResponseInit> => ({
    status: 200,
    jsonBody: { status: 'ok', service: 'post-kit-api' },
  }),
});
