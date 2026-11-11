// Run the compiled production application so HTTP tests exercise Nest's real
// decorator metadata, middleware, global guards, and dependency injection.
const { createApplication } = require('../dist/src/app.factory.js');

createApplication()
  .then(async (app) => {
    const server = app.getHttpServer();
    // The loopback browser harness keeps connections across pauses between
    // actions. Leave those sockets open until the disposable app shuts down.
    if (process.env.BARGHSA_BROWSER_FIXTURE_LOOPBACK === '1') server.keepAliveTimeout = 0;
    await app.listen(0, '127.0.0.1');
    process.send({ port: server.address().port });
    process.once('message', async (message) => {
      if (message === 'stop') {
        await app.close();
        process.exit(0);
      }
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
