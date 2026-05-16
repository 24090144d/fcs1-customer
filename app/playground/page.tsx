import { AppLayout } from '@/components/layout/AppLayout';
import PlaygroundClient from './PlaygroundClient';

export const dynamic = 'force-dynamic';

export default function PlaygroundPage() {
  return (
    <AppLayout breadcrumbs={[{ label: 'Playground' }]}>
      <PlaygroundClient />
    </AppLayout>
  );
}
