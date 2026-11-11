function propertyName(key, computed) {
  if (key.type === 'Literal') return key.value;
  if (!computed && key.type === 'Identifier') return key.name;
}

function binding(source, identifier) {
  for (let scope = source.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable.defs.length === 1 ? variable.defs[0] : undefined;
  }
}

function drizzleSql(source, node, visiting = new Set()) {
  if (!node) return false;
  if (node.type === 'Identifier') {
    const definition = binding(source, node);
    if (!definition || visiting.has(definition)) return false;
    if (definition.type === 'ImportBinding') {
      return (
        drizzleModule(definition.parent.source.value) &&
        definition.node.type === 'ImportSpecifier' &&
        propertyName(definition.node.imported, false) === 'sql'
      );
    }
    if (definition.type === 'Variable' && definition.node.id.type === 'Identifier') {
      visiting.add(definition);
      const imported = drizzleSql(source, definition.node.init, visiting);
      visiting.delete(definition);
      return imported;
    }
  }
  if (
    node.type === 'MemberExpression' &&
    propertyName(node.property, node.computed) === 'sql' &&
    node.object.type === 'Identifier'
  ) {
    const definition = binding(source, node.object);
    return (
      definition?.type === 'ImportBinding' &&
      drizzleModule(definition.parent.source.value) &&
      definition.node.type === 'ImportNamespaceSpecifier'
    );
  }
  return false;
}

function drizzleModule(name) {
  return name === 'drizzle-orm' || name === 'drizzle-orm/sql';
}

function staticText(source, node, visiting = new Set()) {
  if (!node) return false;
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string';
    case 'TemplateLiteral':
      return node.expressions.every((expression) => staticText(source, expression, visiting));
    case 'BinaryExpression':
      return (
        node.operator === '+' &&
        staticText(source, node.left, visiting) &&
        staticText(source, node.right, visiting)
      );
    case 'ConditionalExpression':
      return (
        staticText(source, node.consequent, visiting) &&
        staticText(source, node.alternate, visiting)
      );
    case 'Identifier': {
      const definition = binding(source, node);
      if (
        definition?.type !== 'Variable' ||
        definition.parent.kind !== 'const' ||
        definition.node.id !== definition.name ||
        visiting.has(definition)
      ) {
        return false;
      }
      visiting.add(definition);
      const valid = staticText(source, definition.node.init, visiting);
      visiting.delete(definition);
      return valid;
    }
    case 'TSAsExpression':
    case 'TSTypeAssertion':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
      return staticText(source, node.expression, visiting);
    default:
      return false;
  }
}

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      dynamic: 'Pass only static text to Drizzle sql.raw. Bind values with the Drizzle SQL tag.',
      rawReference: 'Use a direct Drizzle sql.raw call with static SQL text.',
    },
  },
  create(context) {
    const source = context.sourceCode;
    function checkDestructuring(pattern, value) {
      if (pattern.type !== 'ObjectPattern' || !drizzleSql(source, value)) return;
      for (const property of pattern.properties) {
        const name =
          property.type === 'Property' ? propertyName(property.key, property.computed) : undefined;
        if (name === 'raw' || name === undefined) {
          context.report({ node: property, messageId: 'rawReference' });
        }
      }
    }
    return {
      VariableDeclarator(node) {
        checkDestructuring(node.id, node.init);
      },
      AssignmentExpression(node) {
        checkDestructuring(node.left, node.right);
      },
      MemberExpression(node) {
        const name = propertyName(node.property, node.computed);
        if ((name !== 'raw' && name !== undefined) || !drizzleSql(source, node.object)) return;
        const call = node.parent;
        if (name === undefined || call.type !== 'CallExpression' || call.callee !== node) {
          context.report({ node, messageId: 'rawReference' });
          return;
        }
        const [text] = call.arguments;
        if (call.arguments.length !== 1 || !staticText(source, text)) {
          context.report({ node: text ?? call, messageId: 'dynamic' });
        }
      },
    };
  },
};
