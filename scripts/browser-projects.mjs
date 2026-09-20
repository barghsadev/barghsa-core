/** Default production checks to Chromium, but honor explicit browser selection. */
export function browserArguments(args, collecting = false) {
  const projects = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--project' && !args[i].startsWith('--project=')) continue;
    const before = projects.length;
    if (args[i].startsWith('--project=')) {
      const project = args[i].slice('--project='.length);
      if (!project) throw new Error('Missing browser project');
      projects.push(project);
    }
    // Playwright accepts multiple names after one --project flag.
    while (i + 1 < args.length && !args[i + 1].startsWith('-')) projects.push(args[++i]);
    if (projects.length === before) throw new Error('Missing browser project');
  }
  if (collecting && projects.some((project) => project !== 'chromium')) {
    throw new Error('Browser source coverage requires the Chromium project only');
  }
  return projects.length ? [...args] : [...args, '--project', 'chromium'];
}
