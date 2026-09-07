import '@barghsa/ui/styles.css';
import { UiDirectionProvider } from '../../../src/providers/UiDirectionProvider';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '../../../../../packages/ui/src/components/ui/tabs';
const params = new URLSearchParams(location.search);
document.documentElement.lang = params.has('fa') ? 'fa' : 'en';
document.documentElement.dir = params.has('fa') ? 'rtl' : 'ltr';
function Fixture() {
  return (
    <main>
      <button
        onClick={() => {
          document.documentElement.lang = document.documentElement.lang === 'fa' ? 'en' : 'fa';
        }}
      >
        Switch language
      </button>
      <Tabs defaultValue="a" orientation={params.has('vertical') ? 'vertical' : 'horizontal'}>
        <TabsList aria-label="Sections">
          <TabsTrigger value="a">Alpha</TabsTrigger>
          <TabsTrigger value="b">Beta</TabsTrigger>
          <TabsTrigger value="c">Gamma</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Alpha content</TabsContent>
        <TabsContent value="b">Beta content</TabsContent>
        <TabsContent value="c">Gamma content</TabsContent>
      </Tabs>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <UiDirectionProvider>
    <Fixture />
  </UiDirectionProvider>
);
