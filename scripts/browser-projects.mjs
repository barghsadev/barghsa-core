/** Default production checks to Chromium, but honor explicit browser selection. */
export function browserArguments(args, collecting = false) {
  const projects = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project') {
      const project = args[++i];
      if (!project || project.startsWith('-')) throw new Error('Missing browser project');
      projects.push(project);
    } else if (args[i].startsWith('--project=')) {
      const project = args[i].slice('--project='.length);
      if (!project) throw new Error('Missing browser project');
      projects.push(project);
    }
  }
  if (collecting && projects.some((project) => project !== 'chromium')) {
    throw new Error('Browser source coverage requires the Chromium project only');
  }
  return projects.length ? [...args] : [...args, '--project', 'chromium'];
}
