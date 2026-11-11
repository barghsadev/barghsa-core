// @ts-check

const labels = {
  development: { en: 'Dev', fa: 'توسعه' },
  staging: { en: 'Staging', fa: 'آزمایشی' },
};

const style = `<style>
  .environment-indicator {
    position: fixed;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 0.5rem);
    right: calc(env(safe-area-inset-right, 0px) + 0.5rem);
    z-index: 50;
    border-radius: 1rem;
    padding: 0.125rem 0.5rem;
    background: #fef3c7;
    color: #422006;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.5;
    pointer-events: none;
  }
  .environment-indicator [lang="fa"],
  html:lang(fa) .environment-indicator [lang="en"] { display: none; }
  html:lang(fa) .environment-indicator [lang="fa"] { display: inline; }
</style>`;

/**
 * @param {string} html Trusted application HTML.
 * @param {string} environment Deployment label from the server.
 */
export function addEnvironmentIndicator(html, environment) {
  if (environment !== 'development' && environment !== 'staging') return html;
  const { en, fa } = labels[environment];
  const badge = `<span class="environment-indicator" data-environment="${environment}"><span lang="en">${en}</span><span lang="fa">${fa}</span></span>`;
  return html.replace('</head>', `${style}</head>`).replace('</body>', `${badge}</body>`);
}
