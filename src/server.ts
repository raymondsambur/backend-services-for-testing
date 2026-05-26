import { createServer } from 'http';
import app from './app';
import { config, validateProductionSecrets } from './config';
import prisma from './config/database';

const SHUTDOWN_TIMEOUT = 10_000;

function gracefulShutdown(signal: string) {
  console.log(`${signal} received. Initiating graceful shutdown...`);

  server.close(async () => {
    console.log('All connections closed. Disconnecting database...');
    await prisma.$disconnect();
    process.exit(0);
  });

  setTimeout(async () => {
    console.error('Shutdown timeout exceeded. Force terminating...');
    await prisma.$disconnect();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);
}

const server = createServer(app);

validateProductionSecrets();

server.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
