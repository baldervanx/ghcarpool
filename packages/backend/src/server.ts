import 'dotenv/config';
import app from './app';

const PORT = process.env.PORT ?? 3000;

// Express 4 fångar inte async-fel i route-handlers automatiskt.
// Utan den här guardsn crashar processen vid t.ex. Prisma FK-violations,
// vilket stänger alla öppna SSE-anslutningar och ger 502 under omstarten.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] Ohanterat async-fel:', reason);
  // Logga men krascha INTE — låt Express error-handler ta nästa anrop.
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
