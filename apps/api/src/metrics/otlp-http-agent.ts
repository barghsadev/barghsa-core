/** Bound DNS, TLS and continuously streaming responses as well as idle requests. */
export async function collectorAgent(protocol: string, timeoutMs: number) {
  const { Agent } = protocol === 'https:' ? await import('node:https') : await import('node:http');
  const agent = new Agent({ keepAlive: false });
  const connect = agent.createConnection.bind(agent);
  agent.createConnection = (options, callback) => {
    const socket = connect(options, callback);
    if (socket) {
      const deadline = setTimeout(() => socket.destroy(), timeoutMs);
      deadline.unref();
      socket.once('close', () => clearTimeout(deadline));
    }
    return socket;
  };
  return agent;
}
