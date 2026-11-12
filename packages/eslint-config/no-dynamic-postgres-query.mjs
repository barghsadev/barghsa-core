import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { binding, propertyName, staticText } from './no-dynamic-drizzle-raw.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const reviewed = JSON.parse(readFileSync(new URL('./reviewed-postgres-sql.json', import.meta.url)));

function destructured(definition, name) {
  const { id } = definition.node;
  return (
    id.type === 'ObjectPattern' &&
    id.properties.some(
      (property) =>
        property.type === 'Property' &&
        property.value === definition.name &&
        propertyName(property.key, property.computed) === name
    )
  );
}

function queryReference(source, node, seen = new Set()) {
  if (!node) return false;
  if (node.type === 'MemberExpression') {
    return propertyName(node.property, node.computed) === 'query';
  }
  if (node.type !== 'Identifier') return false;
  const definition = binding(source, node);
  if (definition?.type !== 'Variable' || seen.has(definition)) return false;
  if (definition.node.id.type === 'ObjectPattern') return destructured(definition, 'query');
  seen.add(definition);
  return queryReference(source, definition.node.init, seen);
}

function staticQuery(source, node) {
  if (node?.type !== 'ObjectExpression') return staticText(source, node);
  const properties = node.properties;
  if (properties.some((property) => property.type !== 'Property' || property.computed))
    return false;
  const text = properties.filter((property) => propertyName(property.key, false) === 'text');
  return text.length === 1 && text[0].kind === 'init' && staticText(source, text[0].value);
}

function pgQueryConstructor(source, node) {
  const local = node.type === 'MemberExpression' ? node.object : node;
  if (local.type !== 'Identifier') return false;
  const definition = binding(source, local);
  if (definition?.type === 'Variable') {
    const { init } = definition.node;
    if (
      init?.type !== 'CallExpression' ||
      init.callee.type !== 'Identifier' ||
      init.callee.name !== 'require' ||
      init.arguments.length !== 1 ||
      init.arguments[0].type !== 'Literal' ||
      init.arguments[0].value !== 'pg'
    ) {
      return false;
    }
    return node.type === 'MemberExpression'
      ? propertyName(node.property, node.computed) === 'Query'
      : destructured(definition, 'Query');
  }
  if (definition?.type !== 'ImportBinding' || definition.parent.source.value !== 'pg') {
    return false;
  }
  if (node.type === 'MemberExpression') {
    return (
      definition.node.type !== 'ImportSpecifier' &&
      propertyName(node.property, node.computed) === 'Query'
    );
  }
  return (
    definition.node.type === 'ImportSpecifier' &&
    propertyName(definition.node.imported, false) === 'Query'
  );
}

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      dynamic: 'Use static PostgreSQL query text and bind values with driver parameters.',
      indirect: 'Pass SQL text and bound values directly to the PostgreSQL query method.',
      staleReview:
        'This source changed since its PostgreSQL SQL review. Recheck its query text and renew or remove the recorded digest.',
    },
  },
  create(context) {
    const source = context.sourceCode;
    const expected = reviewed[relative(root, context.filename)];
    if (expected && createHash('sha256').update(source.text).digest('hex') === expected) return {};
    function checkText(node) {
      const [text] = node.arguments;
      if (!staticQuery(source, text)) {
        context.report({ node: text ?? node, messageId: 'dynamic' });
      }
    }
    return {
      Program(node) {
        if (expected) context.report({ node, messageId: 'staleReview' });
      },
      NewExpression(node) {
        if (pgQueryConstructor(source, node.callee)) checkText(node);
      },
      CallExpression(node) {
        const { callee } = node;
        if (queryReference(source, callee)) {
          checkText(node);
        } else if (
          callee.type === 'MemberExpression' &&
          ['bind', 'call', 'apply'].includes(propertyName(callee.property, callee.computed)) &&
          queryReference(source, callee.object)
        ) {
          context.report({ node, messageId: 'indirect' });
        }
      },
    };
  },
};
