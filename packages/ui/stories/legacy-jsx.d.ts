import type * as React from 'react';

// Ladle's MDX and Prism declarations still refer to the pre-React-19 global
// namespace. Alias the real React JSX types for documentation compilation only.
declare global {
  namespace JSX {
    type Element = React.JSX.Element;
    type ElementClass = React.JSX.ElementClass;
    type IntrinsicElements = React.JSX.IntrinsicElements;
  }
}
