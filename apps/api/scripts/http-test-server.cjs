// Run the compiled production application so HTTP tests exercise Nest's real
// decorator metadata, middleware, global guards, and dependency injection.
const { createApplication } = require('../dist/src/app.factory.js')

createApplication().then(async (app) => {
  await app.listen(0, '127.0.0.1')
  process.send({ port: app.getHttpServer().address().port })
  process.once('message', async (message) => {
    if (message === 'stop') {
      await app.close()
      process.exit(0)
    }
  })
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
