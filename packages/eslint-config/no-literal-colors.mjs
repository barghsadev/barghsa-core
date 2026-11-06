const color = /#[\da-f]{3}(?:[\da-f]{3})?(?:[\da-f]{2})?\b|(?:rgba?|hsla?|oklch|oklab)\s*\(/i;

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: { semantic: 'Use a semantic CSS color token instead of a literal color.' },
  },
  create(context) {
    const check = (node, value) => {
      if (typeof value === 'string' && color.test(value))
        context.report({ node, messageId: 'semantic' });
    };
    return {
      Literal: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.raw),
    };
  },
};
