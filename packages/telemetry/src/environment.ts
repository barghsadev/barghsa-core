export function deploymentEnvironment() {
  const configured = process.env.BARGHSA_DEPLOYMENT_ENV ?? process.env.NODE_ENV;
  if (configured === 'staging' || configured === 'development' || configured === 'test') {
    return configured;
  }
  return configured === undefined ? 'development' : 'production';
}
